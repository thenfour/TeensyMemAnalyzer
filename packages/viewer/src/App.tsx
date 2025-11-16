import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
    type Analysis,
    type Summaries,
    type TeensySizeReportSummary,
    type TeensySizeReportEntrySummary,
} from '@analyzer';
import type {
    AnalysisBroadcastPayload,
    HealthResponse,
    ServerConfig,
    ServerMessage,
    ServerStatusPayload,
} from './shared/protocol';
import { SizeValue, useSizeFormat } from './components/SizeValue';
import TeensySizeCard, { TeensySizeWithExtras, type TeensySizePanel } from './components/TeensySizeCard';
import RegionUsageCard from './components/RegionUsageCard';
import MemoryMapCard from './components/MemoryMapCard';
import TreemapCard from './components/TreemapCard';
import RuntimeBankCard from './components/RuntimeBankCard';
import TemplateGroupsCard from './components/TemplateGroupsCard';
import { useRegionUsage } from './hooks/useRegionUsage';
import { AddressResolutionProvider } from './context/AddressResolverContext';

type LatestAnalysisBundle = {
    analysis: Analysis;
    summaries: Summaries;
    report?: TeensySizeReportSummary;
    generatedAt: string;
};

type AnalysisSummaryState =
    | {
        kind: 'server';
        targetName: string;
        runtimeBytes?: number;
        loadImageBytes?: number;
        generatedAt?: string;
    }
    | {
        kind: 'manual';
        message: string;
        targetName?: string;
        runtimeBytes?: number;
        loadImageBytes?: number;
    };

const buildBundle = (payload: AnalysisBroadcastPayload): LatestAnalysisBundle => ({
    analysis: payload.analysis,
    summaries: payload.summaries,
    report: payload.report,
    generatedAt: payload.generatedAt,
});

const parseBundleFromJson = (input: unknown): LatestAnalysisBundle | null => {
    if (!input || typeof input !== 'object') {
        return null;
    }

    const candidate = input as Partial<AnalysisBroadcastPayload> & { generatedAt?: string };
    if (!candidate.analysis || !candidate.summaries) {
        return null;
    }

    const generatedAt = typeof candidate.generatedAt === 'string' ? candidate.generatedAt : new Date().toISOString();
    return {
        analysis: candidate.analysis,
        summaries: candidate.summaries,
        report: candidate.report,
        generatedAt,
    } satisfies LatestAnalysisBundle;
};

const getBucketValue = (
    entry: TeensySizeReportEntrySummary | undefined,
    bucket: string,
): number => entry?.bucketTotals?.[bucket] ?? 0;

const sumBucketValues = (
    entry: TeensySizeReportEntrySummary | undefined,
    buckets: string[],
): number => buckets.reduce((total, bucket) => total + getBucketValue(entry, bucket), 0);

const APP_SURFACE_MAX_WIDTH = 1320;

type AppRootStyle = CSSProperties & {
    '--app-surface-max-width': string;
};

const App = (): JSX.Element => {
    const { formatValue } = useSizeFormat();
    const [analysisSummary, setAnalysisSummary] = useState<AnalysisSummaryState | null>(null);
    const [health, setHealth] = useState<HealthResponse | null>(null);
    const [serverStatus, setServerStatus] = useState<ServerStatusPayload | null>({ state: 'idle' });
    const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'error' | 'disconnected'>(
        'connecting',
    );
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const [config, setConfig] = useState<ServerConfig>({});
    const [pendingConfig, setPendingConfig] = useState<ServerConfig>({});
    const [isSavingConfig, setIsSavingConfig] = useState(false);
    const [configError, setConfigError] = useState<string | null>(null);
    const [isTriggeringRun, setIsTriggeringRun] = useState(false);
    const [runError, setRunError] = useState<string | null>(null);
    const [latestBundle, setLatestBundle] = useState<LatestAnalysisBundle | null>(null);

    const latestAnalysis = latestBundle?.analysis ?? null;
    const latestSummaries = latestBundle?.summaries ?? null;
    const latestReport = latestBundle?.report;

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }

        try {
            const text = await file.text();
            const json = JSON.parse(text) as unknown;
            const bundle = parseBundleFromJson(json);
            if (!bundle) {
                throw new Error('File did not contain an analysis bundle.');
            }

            setLatestBundle(bundle);
            setAnalysisSummary({
                kind: 'manual',
                message: `[Manual] Loaded analysis from ${file.name}`,
                targetName: bundle.analysis.target.name,
                runtimeBytes: bundle.summaries?.totals?.runtimeBytes,
                loadImageBytes: bundle.summaries?.totals?.loadImageBytes,
            });
        } catch (error) {
            console.error('Failed to parse analysis JSON', error);
            setAnalysisSummary({
                kind: 'manual',
                message: 'Failed to parse analysis JSON. Please check the file contents.',
            });
        }
    };

    useEffect(() => {
        let isMounted = true;

        const loadHealth = async (): Promise<void> => {
            try {
                const response = await fetch('/api/health');
                if (!response.ok) {
                    throw new Error(`Health check failed with status ${response.status}`);
                }
                const data = (await response.json()) as HealthResponse;
                if (isMounted) {
                    setHealth(data);
                    setServerStatus(data.state);
                    setConnectionState('connected');
                }
            } catch (error) {
                if (!isMounted) {
                    return;
                }
                setConnectionState('error');
                setConnectionError(error instanceof Error ? error.message : 'Unknown error');
            }
        };

        loadHealth();

        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        setPendingConfig(config ? { ...config } : {});
    }, [config]);

    useEffect(() => {
        let socket: WebSocket | null = null;
        let reconnectTimeout: number | undefined;

        const connect = (): void => {
            const { protocol, host } = window.location;
            const wsProtocol = protocol === 'https:' ? 'wss' : 'ws';
            const customPort = import.meta.env.VITE_COMPANION_PORT as string | undefined;
            const wsHost = customPort ? `${window.location.hostname}:${customPort}` : host;
            const wsUrl = `${wsProtocol}://${wsHost}/ws`;

            socket = new WebSocket(wsUrl);

            socket.addEventListener('open', () => {
                setConnectionState('connected');
                setConnectionError(null);
            });

            socket.addEventListener('message', (event) => {
                try {
                    const message = JSON.parse(event.data) as ServerMessage;
                    if (message.type === 'status') {
                        setServerStatus(message.payload);
                    } else if (message.type === 'config') {
                        setConfig(message.payload ?? {});
                        setPendingConfig(message.payload ?? {});
                    } else if (message.type === 'analysis') {
                        const bundle = buildBundle(message.payload);
                        setLatestBundle(bundle);
                        const totals = bundle.summaries?.totals;
                        setAnalysisSummary({
                            kind: 'server',
                            targetName: bundle.analysis.target.name,
                            runtimeBytes: totals?.runtimeBytes,
                            loadImageBytes: totals?.loadImageBytes,
                            generatedAt: bundle.generatedAt,
                        });
                    }
                } catch (error) {
                    console.warn('Failed to parse server message', error);
                }
            });

            socket.addEventListener('close', () => {
                setConnectionState('disconnected');
                reconnectTimeout = window.setTimeout(connect, 1500);
            });

            socket.addEventListener('error', (event) => {
                console.warn('WebSocket error', event);
                setConnectionState('error');
                setConnectionError('WebSocket not connected');
            });
        };

        connect();

        return () => {
            if (reconnectTimeout) {
                window.clearTimeout(reconnectTimeout);
            }
            socket?.close();
        };
    }, []);

    const statusLabel = useMemo(() => {
        if (!serverStatus) {
            return 'unknown';
        }
        switch (serverStatus.state) {
            case 'idle':
                return 'Idle';
            case 'watching':
                return 'Watching';
            case 'running':
                return 'Analyzing';
            case 'error':
                return 'Error';
            default:
                return serverStatus.state;
        }
    }, [serverStatus]);

    const handleConfigInputChange = <K extends keyof ServerConfig>(key: K, value: ServerConfig[K]): void => {
        const sanitizedValue =
            typeof value === 'number' && Number.isNaN(value)
                ? undefined
                : ((value === '' ? undefined : value) as ServerConfig[K] | undefined);

        setPendingConfig((prev) => {
            const next = { ...prev };
            if (sanitizedValue === undefined) {
                delete next[key];
            } else {
                next[key] = sanitizedValue;
            }
            return next;
        });
    };

    const handleConfigSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        setIsSavingConfig(true);
        setConfigError(null);

        try {
            const response = await fetch('/api/config', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(pendingConfig),
            });

            if (!response.ok) {
                throw new Error(`Config update failed with status ${response.status}`);
            }

            const data = (await response.json()) as { config: ServerConfig };
            setConfig(data.config);
            setPendingConfig(data.config);
        } catch (error) {
            setConfigError(error instanceof Error ? error.message : 'Failed to update config');
        } finally {
            setIsSavingConfig(false);
        }
    };

    const handleManualRun = async (): Promise<void> => {
        if (connectionState !== 'connected') {
            return;
        }

        setIsTriggeringRun(true);
        setRunError(null);

        try {
            const response = await fetch('/api/run', {
                method: 'POST',
            });

            if (!response.ok) {
                throw new Error(`Run request failed with status ${response.status}`);
            }
        } catch (error) {
            setRunError(error instanceof Error ? error.message : 'Failed to trigger analysis');
        } finally {
            setIsTriggeringRun(false);
        }
    };

    const configReady = Boolean(pendingConfig.targetId && pendingConfig.elfPath);
    const isRunDisabled =
        connectionState !== 'connected' || isTriggeringRun || serverStatus?.state === 'running' || !configReady;

    const { runtimeBanks: runtimeBankUsage, regions: regionUsage } = useRegionUsage({
        analysis: latestAnalysis,
        summaries: latestSummaries,
        formatValue,
    });

    const teensySizeWithExtras = useMemo<TeensySizeWithExtras>(() => {
        const ret: TeensySizeWithExtras = {
            panels: [],
            freeStackBytes: null,
            fastRunCodeBytes: null,
            flashMemCodeBytes: null,
            totalCodeBytes: null,
        };
        if (!latestReport) {
            return ret;
        }

        const report = latestReport;

        if (report.flash) {
            const flash = report.flash;
            const flashCode = getBucketValue(flash, 'code');
            ret.totalCodeBytes = flashCode;
            const flashData = getBucketValue(flash, 'data');
            const flashHeaders = getBucketValue(flash, 'headers');
            ret.panels.push({
                title: 'FLASH',
                rows: [
                    { label: 'Code', value: flashCode },
                    { label: 'Data', value: flashData },
                    { label: 'Headers', value: flashHeaders },
                    { label: 'Free for files', value: flash.freeBytes },
                ],
            });
        }

        if (report.ram1) {
            const ram1 = report.ram1;
            const variables = sumBucketValues(ram1, ['data', 'bss', 'noinit']);
            const codeBytes = ram1.codeBytes ?? getBucketValue(ram1, 'code');
            ret.fastRunCodeBytes = codeBytes;
            const padding = Math.max(ram1.adjustedUsedBytes - ram1.rawUsedBytes, 0);
            ret.freeStackBytes = ram1.freeBytes;
            ret.panels.push({
                title: 'RAM1',
                rows: [
                    { label: 'Code (ITCM)', value: codeBytes },
                    { label: 'Variables (DTCM)', value: variables },
                    { label: 'Padding', value: padding },
                    { label: 'Free for local variables', value: ram1.freeBytes },
                ],
            });
        }

        if (report.ram2) {
            const ram2 = report.ram2;
            const variables = sumBucketValues(ram2, ['data', 'bss', 'noinit']);
            ret.panels.push({
                title: 'RAM2',
                rows: [
                    { label: 'Variables', value: variables },
                    { label: 'Free for malloc/new', value: ram2.freeBytes },
                ],
            });
        }

        if (ret.totalCodeBytes !== null && ret.fastRunCodeBytes !== null) {
            ret.flashMemCodeBytes = ret.totalCodeBytes - ret.fastRunCodeBytes;
        }

        return ret;
    }, [latestReport]);

    const teensySizeError = null;
    const lastRunCompletedAt = serverStatus?.lastRunCompletedAt ? new Date(serverStatus.lastRunCompletedAt) : null;
    const analysisTotals = latestSummaries?.totals ?? null;

    const renderAnalysisSummary = (): JSX.Element => {
        if (!analysisSummary) {
            return <p>No analysis loaded yet.</p>;
        }

        if (analysisSummary.kind === 'manual') {
            return (
                <p className="summary">
                    <span>{analysisSummary.message}</span>
                    {analysisSummary.targetName ? (
                        <>
                            {' • '}
                            <span>Target {analysisSummary.targetName}</span>
                        </>
                    ) : null}
                    {analysisSummary.runtimeBytes !== undefined ? (
                        <>
                            {' • '}
                            <span>
                                Runtime <SizeValue value={analysisSummary.runtimeBytes} />
                            </span>
                        </>
                    ) : null}
                    {analysisSummary.loadImageBytes !== undefined ? (
                        <>
                            {' • '}
                            <span>
                                Load image <SizeValue value={analysisSummary.loadImageBytes} />
                            </span>
                        </>
                    ) : null}
                </p>
            );
        }

        return (
            <p className="summary">
                <span>Target: {analysisSummary.targetName}</span>
                {analysisSummary.runtimeBytes !== undefined ? (
                    <>
                        {' • '}
                        <span>
                            Runtime <SizeValue value={analysisSummary.runtimeBytes} />
                        </span>
                    </>
                ) : null}
                {analysisSummary.loadImageBytes !== undefined ? (
                    <>
                        {' • '}
                        <span>
                            Load image <SizeValue value={analysisSummary.loadImageBytes} />
                        </span>
                    </>
                ) : null}
                {analysisSummary.generatedAt ? (
                    <>
                        {' • '}
                        <span>Generated {new Date(analysisSummary.generatedAt).toLocaleString()}</span>
                    </>
                ) : null}
            </p>
        );
    };

    const appRootStyle = useMemo<AppRootStyle>(
        () => ({
            '--app-surface-max-width': `${APP_SURFACE_MAX_WIDTH}px`,
        }),
        [],
    );

    console.log(latestAnalysis);

    return (
        <AddressResolutionProvider analysis={latestAnalysis}>
            <div className="app-root" style={appRootStyle}>
                <header>
                    <h1>Teensy Memory Explorer Viewer</h1>
                    <p>Select an analyzer JSON output file to explore memory usage visually.</p>
                </header>
                <main>
                    <section className="status-card">
                        <h2>Companion Service</h2>
                        <dl>
                            <div>
                                <dt>Connection</dt>
                                <dd className={`chip chip--${connectionState}`}>{connectionState}</dd>
                            </div>
                            <div>
                                <dt>Status</dt>
                                <dd>{statusLabel}</dd>
                            </div>
                            {latestAnalysis ? (
                                <div>
                                    <dt>Target</dt>
                                    <dd>{latestAnalysis.target.name}</dd>
                                </div>
                            ) : null}
                            {serverStatus?.lastRunCompletedAt ? (
                                <div>
                                    <dt>Last analysis</dt>
                                    <dd>{new Date(serverStatus.lastRunCompletedAt).toLocaleString()}</dd>
                                </div>
                            ) : null}
                            {analysisTotals ? (
                                <>
                                    <div>
                                        <dt>Runtime bytes</dt>
                                        <dd>
                                            <SizeValue value={analysisTotals.runtimeBytes} />
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>Load image bytes</dt>
                                        <dd>
                                            <SizeValue value={analysisTotals.loadImageBytes} />
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>File-only bytes</dt>
                                        <dd>
                                            <SizeValue value={analysisTotals.fileOnlyBytes} />
                                        </dd>
                                    </div>
                                </>
                            ) : null}
                            {health?.version ? (
                                <div>
                                    <dt>Server version</dt>
                                    <dd>{health.version}</dd>
                                </div>
                            ) : null}
                            {connectionError ? <div className="status-warning">{connectionError}</div> : null}
                        </dl>

                        <div className="status-actions">
                            <button type="button" onClick={handleManualRun} disabled={isRunDisabled}>
                                {isTriggeringRun || serverStatus?.state === 'running' ? 'Running…' : 'Run Analysis'}
                            </button>
                            {!configReady ? (
                                <span className="status-hint">Set target ID and ELF path to enable analysis.</span>
                            ) : null}
                            {configReady && !(pendingConfig.autoRun ?? false) ? (
                                <span className="status-hint">Auto-run is off. Use this button after builds.</span>
                            ) : null}
                        </div>

                        {(runError || serverStatus?.errorMessage) && (
                            <div className="status-error">{runError ?? serverStatus?.errorMessage}</div>
                        )}
                    </section>

                    <section className="config-card">
                        <h2>Watch Configuration</h2>
                        <form onSubmit={handleConfigSubmit} className="config-form">
                            <div className="config-grid">
                                <label>
                                    <span>Target ID</span>
                                    <input
                                        type="text"
                                        placeholder="teensy40"
                                        value={pendingConfig.targetId ?? ''}
                                        onChange={(event) => handleConfigInputChange('targetId', event.target.value)}
                                    />
                                </label>
                                <label>
                                    <span>ELF Path</span>
                                    <input
                                        type="text"
                                        placeholder="C:\\path\\to\\firmware.elf"
                                        value={pendingConfig.elfPath ?? ''}
                                        onChange={(event) => handleConfigInputChange('elfPath', event.target.value)}
                                    />
                                </label>
                                <label>
                                    <span>MAP Path</span>
                                    <input
                                        type="text"
                                        placeholder="C:\\path\\to\\firmware.map"
                                        value={pendingConfig.mapPath ?? ''}
                                        onChange={(event) => handleConfigInputChange('mapPath', event.target.value)}
                                    />
                                </label>
                                <label>
                                    <span>Toolchain Directory</span>
                                    <input
                                        type="text"
                                        placeholder="C:\\.platformio\\toolchain\\bin"
                                        value={pendingConfig.toolchainDir ?? ''}
                                        onChange={(event) => handleConfigInputChange('toolchainDir', event.target.value)}
                                    />
                                </label>
                                <label>
                                    <span>Toolchain Prefix</span>
                                    <input
                                        type="text"
                                        placeholder="arm-none-eabi-"
                                        value={pendingConfig.toolchainPrefix ?? ''}
                                        onChange={(event) => handleConfigInputChange('toolchainPrefix', event.target.value)}
                                    />
                                </label>
                                <label>
                                    <span>Debounce (ms)</span>
                                    <input
                                        type="number"
                                        min={250}
                                        step={250}
                                        value={pendingConfig.debounceMs ?? 1500}
                                        onChange={(event) =>
                                            handleConfigInputChange('debounceMs', Number.parseInt(event.target.value, 10))
                                        }
                                    />
                                </label>
                            </div>

                            <label className="toggle">
                                <input
                                    type="checkbox"
                                    checked={pendingConfig.autoRun ?? false}
                                    onChange={(event) => handleConfigInputChange('autoRun', event.target.checked)}
                                />
                                <span>Automatically run analysis when files change</span>
                            </label>

                            {configError ? <p className="config-error">{configError}</p> : null}

                            <div className="config-actions">
                                <button type="submit" disabled={isSavingConfig}>
                                    {isSavingConfig ? 'Saving…' : 'Save Configuration'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPendingConfig(config)}
                                    disabled={isSavingConfig}
                                    className="secondary"
                                >
                                    Reset
                                </button>
                            </div>
                        </form>
                    </section>

                    <label className="uploader">
                        <span>Load analysis JSON:</span>
                        <input type="file" accept="application/json" onChange={handleFileChange} />
                    </label>
                    {renderAnalysisSummary()}

                    {latestAnalysis && (
                        <section className="summary-card">
                            <dl>
                                <dt>Stack / locals available</dt>
                                <dd>
                                    {teensySizeWithExtras.freeStackBytes !== null ? (
                                        <SizeValue value={teensySizeWithExtras.freeStackBytes} />
                                    ) : (
                                        'N/A'
                                    )}
                                </dd>
                                <dt>Fast run code size (FASTRUN / default code bloating RAM1)</dt>
                                <dd>
                                    {teensySizeWithExtras.fastRunCodeBytes !== null ? (
                                        <SizeValue value={teensySizeWithExtras.fastRunCodeBytes} />
                                    ) : (
                                        'N/A'
                                    )}
                                </dd>
                                <dt>Code only in FLASHMEM (non-performance critical but keeps RAM1 usage down)</dt>
                                <dd>
                                    {teensySizeWithExtras.flashMemCodeBytes !== null ? (
                                        <SizeValue value={teensySizeWithExtras.flashMemCodeBytes} />
                                    ) : (
                                        'N/A'
                                    )}
                                </dd>
                                <dt>Total code size</dt>
                                <dd>
                                    {teensySizeWithExtras.totalCodeBytes !== null ? (
                                        <SizeValue value={teensySizeWithExtras.totalCodeBytes} />
                                    ) : (
                                        'N/A'
                                    )}
                                </dd>
                            </dl>
                        </section>

                    )}

                    <TeensySizeCard hasAnalysis={Boolean(latestAnalysis)} error={teensySizeError} panels={teensySizeWithExtras.panels} />

                    <RuntimeBankCard usage={runtimeBankUsage} lastRunCompletedAt={lastRunCompletedAt} />

                    <RegionUsageCard regionUsage={regionUsage} lastRunCompletedAt={lastRunCompletedAt} />

                    <TemplateGroupsCard
                        groups={latestAnalysis?.templateGroups ?? []}
                        lastRunCompletedAt={lastRunCompletedAt}
                    />

                    <MemoryMapCard
                        analysis={latestAnalysis}
                        summaries={latestSummaries}
                        lastRunCompletedAt={lastRunCompletedAt}
                    />
                    <TreemapCard />
                    <section className="placeholder-grid" />
                </main>
            </div>
        </AddressResolutionProvider>
    );
};

export default App;
