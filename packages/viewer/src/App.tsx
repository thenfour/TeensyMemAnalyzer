import { useEffect, useMemo, useState } from 'react';
import type { HealthResponse, ServerMessage, ServerStatusPayload } from './shared/protocol';

const App = (): JSX.Element => {
    const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
    const [health, setHealth] = useState<HealthResponse | null>(null);
    const [serverStatus, setServerStatus] = useState<ServerStatusPayload | null>({ state: 'idle' });
    const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'error' | 'disconnected'>(
        'connecting',
    );
    const [connectionError, setConnectionError] = useState<string | null>(null);

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
