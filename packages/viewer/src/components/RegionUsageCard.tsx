import { SizeValue } from './SizeValue';
import AddressValue from './AddressValue';
import type { UsageBarData } from '../types/usage';
import { computeUsagePercent } from '../utils/usage';

interface RegionUsageCardProps {
    regionUsage: UsageBarData[];
    lastRunCompletedAt: Date | null;
}

const RegionUsageCard = ({ regionUsage, lastRunCompletedAt }: RegionUsageCardProps): JSX.Element => {
    const renderUsageBar = (summary: UsageBarData): JSX.Element => {
        const percent = summary.percent ?? computeUsagePercent(summary.used, summary.total);
        const hasPercent = percent !== null;

        const renderAddressRangeRow = (boundsLabel: string, bounds: { start: number; end: number }, meta: NonNullable<UsageBarData['addressRange']>) => {
            const commonMeta = {
                regionId: meta.regionId,
                regionName: meta.regionName,
                regionKind: meta.regionKind,
                regionKindLabel: meta.regionKindLabel,
            };

            return (
                <div className="usage-address-range-row" key={boundsLabel}>
                    <span className="usage-address-range-label">{boundsLabel}</span>
                    <span className="usage-address-range-values">
                        <AddressValue
                            value={bounds.start}
                            meta={{
                                ...commonMeta,
                                label: `${boundsLabel} start`,
                            }}
                        />
                        <span className="usage-address-range-separator">–</span>
                        <AddressValue
                            value={bounds.end}
                            meta={{
                                ...commonMeta,
                                label: `${boundsLabel} end`,
                            }}
                        />
                    </span>
                </div>
            );
        };

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
                {summary.addressRange ? (
                    <div className="usage-address-range">
                        {renderAddressRangeRow('Total range', summary.addressRange.total, summary.addressRange)}
                        {summary.addressRange.occupied
                            ? renderAddressRangeRow('Occupied range', summary.addressRange.occupied, summary.addressRange)
                            : null}
                    </div>
                ) : null}
            </div>
        );
    };

    return (
        <section className="summary-card region-card">
            <div className="summary-header">
                <h2>Address Windows</h2>
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
                <p className="summary-placeholder">Run an analysis to see per-window usage.</p>
            )}
        </section>
    );
};

export default RegionUsageCard;
