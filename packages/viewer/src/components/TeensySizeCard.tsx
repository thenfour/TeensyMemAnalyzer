import { SizeValue } from './SizeValue';

export type TeensySizePanel = {
    title: string;
    rows: {
        label: string;
        value: number | undefined;
    }[];
};

export type TeensySizeWithExtras = {
    panels: TeensySizePanel[];
    freeStackBytes: number | null;
    fastRunCodeBytes: number | null;
    flashMemCodeBytes: number | null;
    totalCodeBytes: number | null;
};

interface TeensySizeCardProps {
    hasAnalysis: boolean;
    error: string | null;
    panels: TeensySizePanel[];
}

const TeensySizeCard = ({ hasAnalysis, error, panels }: TeensySizeCardProps): JSX.Element => {
    const hasReport = panels.length > 0;

    return (
        <section className="summary-card">
            <div className="summary-header">
                <h2>Teensy-size</h2>
                <div className="summary-meta">
                    {hasAnalysis ? (
                        error ? (
                            <span className="summary-updated">Calculation error</span>
                        ) : hasReport ? (
                            <span className="summary-updated">Config-driven teensy_size buckets</span>
                        ) : (
                            <span className="summary-updated">No mapping for this target</span>
                        )
                    ) : (
                        <span className="summary-updated">Awaiting first analysis</span>
                    )}
                </div>
            </div>

            {!hasAnalysis ? (
                <p className="summary-placeholder">Run an analysis to compute teensy_size metrics.</p>
            ) : error ? (
                <p className="summary-placeholder">Failed to compute teensy_size metrics: {error}</p>
            ) : hasReport ? (
                <div className="usage-grid teensy-size-grid">
                    {panels.map((panel) => (
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
    );
};

export default TeensySizeCard;
