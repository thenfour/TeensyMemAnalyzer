import { useEffect, useMemo, useState } from 'react';
import type { HealthResponse, ServerConfig, ServerMessage, ServerStatusPayload } from './shared/protocol';

const App = (): JSX.Element => {
    const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
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
            setAnalysisSummary(`Loaded analysis with top-level keys: ${keys.join(', ')}`);
        } catch (error) {
            console.error('Failed to parse analysis JSON', error);
            setAnalysisSummary('Failed to parse analysis JSON. Please check the file contents.');
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
                setConnectionError('WebSocket connection error');
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
                        {serverStatus?.lastRunCompletedAt && (
                            <div>
                                <dt>Last analysis</dt>
                                <dd>{new Date(serverStatus.lastRunCompletedAt).toLocaleString()}</dd>
                            </div>
                        )}
                        {health?.version && (
                            <div>
                                <dt>Server version</dt>
                                <dd>{health.version}</dd>
                            </div>
                        )}
                        {connectionError && (
                            <div className="status-error">{connectionError}</div>
                        )}
                    </dl>
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
                {analysisSummary ? <p className="summary">{analysisSummary}</p> : <p>No analysis loaded yet.</p>}
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
