import { SizeValue } from './SizeValue';
import type { UsageBarData } from '../types/usage';
import { computeUsagePercent } from '../utils/usage';

interface RuntimeBankCardProps {
    usage: UsageBarData[];
    lastRunCompletedAt: Date | null;
}

const RuntimeBankCard = ({ usage, lastRunCompletedAt }: RuntimeBankCardProps): JSX.Element | null => {
    if (usage.length === 0) {
        return null;
    }

    const renderUsage = (summary: UsageBarData): JSX.Element => {
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

    return (
        <section className="summary-card">
            <div className="summary-header">
                <h2>Runtime Banks</h2>
                <div className="summary-meta">
                    {lastRunCompletedAt ? (
                        <span className="summary-updated">Based on {lastRunCompletedAt.toLocaleString()}</span>
                    ) : (
                        <span className="summary-updated">Awaiting first analysis</span>
                    )}
                </div>
            </div>
            <div className="usage-grid region-list">
                {usage.map((entry) => renderUsage(entry))}
            </div>
        </section>
    );
};

export default RuntimeBankCard;
