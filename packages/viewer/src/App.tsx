import { useEffect, useMemo, useState } from 'react';
import * as teensySizeModule from '@teensy-mem-explorer/analyzer/analysis/reports/teensy-size';
import type {
    Analysis,
    RegionKind,
    RegionSummary,
    RuntimeBankSummary,
    RuntimeGroupSummary,
    TeensySizeReportSummary,
} from '@teensy-mem-explorer/analyzer';
import type {
    HealthResponse,
    ServerConfig,
    ServerMessage,
    ServerStatusPayload,
} from './shared/protocol';
import { SizeValue, useSizeFormat } from './components/SizeValue';

const computeUsagePercent = (used: number | undefined, total: number | undefined): number | null => {
    if (used === undefined || total === undefined || total === 0) {
        return null;
    }
    return Math.min(100, Math.max(0, (used / total) * 100));
};

const humanizeRegionKind = (kind: RegionKind): string => {
    switch (kind) {
        case 'flash':
            return 'Flash';
        case 'code_ram':
            return 'Code RAM';
        case 'data_ram':
            return 'Data RAM';
        case 'dma_ram':
            return 'DMA RAM';
        case 'ext_ram':
            return 'External RAM';
        default:
            return 'Other';
    }
};

type UsageBarData = {
    id: string;
    label: string;
    used: number | undefined;
    total: number | undefined;
    free?: number | undefined;
    percent: number | null;
    description?: string;
};

const { calculateTeensySizeReport } = teensySizeModule as {
    calculateTeensySizeReport: (analysis: Analysis) => TeensySizeReportSummary;
};

type TopLevelGroup = {
    id: string;
    label: string;
    description: string;
    kinds: RegionKind[];
};

const TOP_LEVEL_GROUPS: TopLevelGroup[] = [
    {
        id: 'flash',
        label: 'Flash',
        description: 'Program storage in onboard flash (read-only at runtime).',
        kinds: ['flash'],
    },
    {
        id: 'ram1',
        label: 'RAM1',
        description: 'Tightly coupled RAM for instructions, globals, stack, and heap.',
        kinds: ['code_ram', 'data_ram'],
    },
    {
        id: 'ram2',
        label: 'RAM2',
        description: 'AXI RAM well-suited for DMA buffers and large allocations.',
        kinds: ['dma_ram'],
    },
];

type AnalysisSummaryState =
    | {
        kind: 'server';
        targetName: string;
        flashUsed?: number;
        ramUsed?: number;
    }
    | {
        kind: 'manual';
        message: string;
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
    const [config, setConfig] = useState<ServerConfig>({
    });
    const [pendingConfig, setPendingConfig] = useState<ServerConfig>({
    });
    const [isSavingConfig, setIsSavingConfig] = useState(false);
    const [configError, setConfigError] = useState<string | null>(null);
    const [isTriggeringRun, setIsTriggeringRun] = useState(false);
    const [runError, setRunError] = useState<string | null>(null);
    const [latestAnalysis, setLatestAnalysis] = useState<Analysis | null>(null);
    const [teensySizeReport, setTeensySizeReport] = useState<TeensySizeReportSummary | null>(null);
    const [teensySizeError, setTeensySizeError] = useState<string | null>(null);

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
        const file = event.target.files?.[0];
        if (!file) {
            setAnalysisSummary(null);
            return;
        }

        try {
            const text = await file.text();
            // For now just parse and summarize top-level keys to validate ingestion.
            const json = JSON.parse(text) as Record<string, unknown>;
            const keys = Object.keys(json).sort();
            setAnalysisSummary({
                kind: 'manual',
                message: `[Manual] Loaded analysis with top-level keys: ${keys.join(', ')}`,
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
                    // Config will arrive via websocket handshake; if not, keep pending empty.
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
                        setLatestAnalysis(message.payload.analysis);

                        const totals = message.payload.analysis.summaries?.totals;
                        const targetName = message.payload.analysis.target.name;
                        if (totals) {
                            setAnalysisSummary({
                                kind: 'server',
                                targetName,
                                flashUsed: totals.flashUsed,
                                ramUsed: totals.ramUsed,
                            });
                        } else {
                            setAnalysisSummary({
                                kind: 'server',
                                targetName,
                            });
                        }
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

    useEffect(() => {
        if (!latestAnalysis) {
            setTeensySizeReport(null);
            setTeensySizeError(null);
            return;
        }

        try {
            const report = calculateTeensySizeReport(latestAnalysis);
            setTeensySizeReport(report);
            setTeensySizeError(null);
        } catch (error) {
            console.warn('Failed to compute teensy_size report', error);
            setTeensySizeReport(null);
            setTeensySizeError(error instanceof Error ? error.message : 'Unknown calculator failure');
        }
    }, [latestAnalysis]);

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

    const regionUsage = useMemo<UsageBarData[]>(() => {
        if (!latestAnalysis) {
            return [];
        }

        const runtimeBanks: RuntimeBankSummary[] = latestAnalysis.summaries.runtimeBanks ?? [];
        if (runtimeBanks.length > 0) {
            return runtimeBanks.map((bank: RuntimeBankSummary) => {
                const total = bank.capacityBytes;
                const used = Math.max(total - bank.freeBytes, 0);
                const contributors = bank.contributors
                    .map((contributor) => `${contributor.regionName} (${formatValue(contributor.sizeBytes)})`)
                    .join(', ');

                const descriptionParts: string[] = [];
                if (bank.description) {
                    descriptionParts.push(bank.description);
                }
                if (contributors.length > 0) {
                    descriptionParts.push(`Segments: ${contributors}`);
                }

                return {
                    id: bank.bankId,
                    label: bank.name,
                    total,
                    used,
                    free: bank.freeBytes,
                    percent: computeUsagePercent(used, total),
                    description: descriptionParts.join(' • '),
                };
            });
        }

        const regionSummaryEntries: Array<[string, RegionSummary]> = latestAnalysis.summaries.byRegion.map(
            (summary: RegionSummary) => [summary.regionId, summary],
        );
        const regionSummaryMap = new Map<string, RegionSummary>(regionSummaryEntries);

        return latestAnalysis.regions.map((region) => {
            const summary = regionSummaryMap.get(region.id);
            const size = summary?.size ?? region.size;
            const freeRaw =
                summary?.freeForDynamic !== undefined
                    ? summary.freeForDynamic
                    : summary
                        ? Math.max(size - summary.usedStatic - (summary.reserved ?? 0), 0)
                        : undefined;
            const free = freeRaw !== undefined ? Math.max(freeRaw, 0) : undefined;
            const used =
                free !== undefined
                    ? Math.max(size - free, 0)
                    : summary
                        ? Math.max(summary.usedStatic + (summary.reserved ?? 0), 0)
                        : undefined;

            const descriptionParts: string[] = [];
            if (region.name && region.name !== region.id) {
                descriptionParts.push(`${region.name} (${region.id})`);
            } else {
                descriptionParts.push(`Region ${region.id}`);
            }
            descriptionParts.push(`Kind: ${humanizeRegionKind(region.kind)}`);
            if (summary?.reserved) {
                descriptionParts.push(`Reserved ${formatValue(summary.reserved)}`);
            }

            return {
                id: region.id,
                label: region.name ?? region.id,
                total: size,
                used,
                free,
                percent: computeUsagePercent(used, size),
                description: descriptionParts.join(' • '),
            };
        });
    }, [latestAnalysis]);

    const teensySizePanels = useMemo(
        () => {
            if (!teensySizeReport) {
                return [] as { title: string; rows: { label: string; value: number | undefined }[] }[];
            }

            const panels: { title: string; rows: { label: string; value: number | undefined }[] }[] = [];

            if (teensySizeReport.flash) {
                const { code, data, headers, freeForFiles } = teensySizeReport.flash;
                panels.push({
                    title: 'FLASH',
                    rows: [
                        { label: 'Code', value: code },
                        { label: 'Data', value: data },
                        { label: 'Headers', value: headers },
                        { label: 'Free for files', value: freeForFiles },
                    ],
                });
            }

            if (teensySizeReport.ram1) {
                const { code, variables, padding, freeForLocalVariables } = teensySizeReport.ram1;
                panels.push({
                    title: 'RAM1',
                    rows: [
                        { label: 'Code (ITCM)', value: code },
                        { label: 'Variables (DTCM)', value: variables },
                        { label: 'Padding', value: padding },
                        { label: 'Free for local variables', value: freeForLocalVariables },
                    ],
                });
            }

            if (teensySizeReport.ram2) {
                const { variables, freeForMalloc } = teensySizeReport.ram2;
                panels.push({
                    title: 'RAM2',
                    rows: [
                        { label: 'Variables', value: variables },
                        { label: 'Free for malloc/new', value: freeForMalloc },
                    ],
                });
            }

            return panels;
        },
        [teensySizeReport],
    );
    const hasTeensySizeReport = teensySizePanels.length > 0;

    const renderUsageBar = (summary: UsageBarData): JSX.Element => {
        const percent = summary.percent ?? computeUsagePercent(summary.used, summary.total);
        const hasPercent = percent !== null;

        return (
            <div className="usage-item" key={summary.id}>
                <div className="usage-header">
                    <span className="usage-label">{summary.label}</span>
                    <span className="usage-values">
                        <SizeValue value={summary.used} /> / <SizeValue value={summary.total} />
                        {hasPercent ? ` (${percent.toFixed(1)}%)` : ''}
                    </span>
                </div>
                <div className="usage-bar">
                    <div className="usage-bar-fill" style={{ width: hasPercent ? `${percent}%` : '0%' }} />
                </div>
                {summary.description ? <p className="usage-description">{summary.description}</p> : null}
                {summary.free !== undefined ? (
                    <p className="usage-free">
                        Free now: <SizeValue value={summary.free} />
                    </p>
                ) : null}
            </div>
        );
    };

    const lastRunCompletedAt = serverStatus?.lastRunCompletedAt
        ? new Date(serverStatus.lastRunCompletedAt)
        : null;
    const analysisTotals = latestAnalysis?.summaries?.totals;

    const renderAnalysisSummary = (): JSX.Element => {
        if (!analysisSummary) {
            return <p>No analysis loaded yet.</p>;
        }

        if (analysisSummary.kind === 'manual') {
            return <p className="summary">{analysisSummary.message}</p>;
        }

        return (
            <p className="summary">
                <span>Target: {analysisSummary.targetName}</span>
                {analysisSummary.flashUsed !== undefined ? (
                    <>
                        {' • '}
                        <span>
                            Flash <SizeValue value={analysisSummary.flashUsed} />
                        </span>
                    </>
                ) : null}
                {analysisSummary.ramUsed !== undefined ? (
                    <>
                        {' • '}
                        <span>
                            RAM <SizeValue value={analysisSummary.ramUsed} />
                        </span>
                    </>
                ) : null}
            </p>
        );
    };

    return (
        <div className="app-root">
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
                        {latestAnalysis && (
                            <div>
                                <dt>Target</dt>
                                <dd>{latestAnalysis.target.name}</dd>
                            </div>
                        )}
                        {serverStatus?.lastRunCompletedAt && (
                            <div>
                                <dt>Last analysis</dt>
                                <dd>{new Date(serverStatus.lastRunCompletedAt).toLocaleString()}</dd>
                            </div>
                        )}
                        {analysisTotals ? (
                            <>
                                <div>
                                    <dt>Flash used</dt>
                                    <dd>
                                        <SizeValue value={analysisTotals.flashUsed} />
                                    </dd>
                                </div>
                                <div>
                                    <dt>RAM used</dt>
                                    <dd>
                                        <SizeValue value={analysisTotals.ramUsed} />
                                    </dd>
                                </div>
                            </>
                        ) : null}
                        {health?.version && (
                            <div>
                                <dt>Server version</dt>
                                <dd>{health.version}</dd>
                            </div>
                        )}
                        {connectionError && (
                            <div className="status-warning">{connectionError}</div>
                        )}
                    </dl>

                    <div className="status-actions">
                        <button type="button" onClick={handleManualRun} disabled={isRunDisabled}>
                            {isTriggeringRun || serverStatus?.state === 'running' ? 'Running…' : 'Run Analysis'}
                        </button>
                        {!configReady && (
                            <span className="status-hint">Set target ID and ELF path to enable analysis.</span>
                        )}
                        {configReady && !(pendingConfig.autoRun ?? false) && (
                            <span className="status-hint">Auto-run is off. Use this button after builds.</span>
                        )}
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

                        {configError && <p className="config-error">{configError}</p>}

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

                <section className="summary-card">
                    <div className="summary-header">
                        <h2>Teensy-size Compatibility</h2>
                        <div className="summary-meta">
                            {latestAnalysis ? (
                                teensySizeError ? (
                                    <span className="summary-updated">Calculation error</span>
                                ) : hasTeensySizeReport ? (
                                    <span className="summary-updated">Config-driven teensy_size buckets</span>
                                ) : (
                                    <span className="summary-updated">No mapping for this target</span>
                                )
                            ) : (
                                <span className="summary-updated">Awaiting first analysis</span>
                            )}
                        </div>
                    </div>
                    {!latestAnalysis ? (
                        <p className="summary-placeholder">Run an analysis to compute teensy_size metrics.</p>
                    ) : teensySizeError ? (
                        <p className="summary-placeholder">Failed to compute teensy_size metrics: {teensySizeError}</p>
                    ) : hasTeensySizeReport ? (
                        <div className="usage-grid teensy-size-grid">
                            {teensySizePanels.map((panel) => (
                                <div className="teensy-size-card" key={panel.title}>
                                    <h3>{panel.title}</h3>
                                    <dl>
                                        {panel.rows.map((row) => (
                                            <div key={row.label}>
                                                <dt>{row.label}</dt>
                                                <dd>
                                                    <SizeValue value={row.value} />
                                                </dd>
                                            </div>
                                        ))}
                                    </dl>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="summary-placeholder">Target configuration does not define teensy_size report mappings.</p>
                    )}
                </section>

                <section className="summary-card region-card">
                    <div className="summary-header">
                        <h2>Regions</h2>
                        <div className="summary-meta">
                            {lastRunCompletedAt ? (
                                <span className="summary-updated">Based on {lastRunCompletedAt.toLocaleString()}</span>
                            ) : (
                                <span className="summary-updated">Awaiting first analysis</span>
                            )}
                        </div>
                    </div>
                    {regionUsage.length > 0 ? (
                        <div className="usage-grid region-list">
                            {regionUsage.map((usage) => renderUsageBar(usage))}
                        </div>
                    ) : (
                        <p className="summary-placeholder">Run an analysis to see per-region usage.</p>
                    )}
                </section>


                <section className="placeholder-grid">
                    <div className="panel">
                        <h2>Memory Map</h2>
                        <p>Interactive region visualization coming soon.</p>
                    </div>
                    <div className="panel">
                        <h2>Treemap</h2>
                        <p>Symbol treemap will appear here after selecting an analysis.</p>
                    </div>
                </section>
            </main>
        </div>
    );
};

export default App;
