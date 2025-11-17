import { SizeValue } from '../SizeValue';

export interface TreemapChildSummaryItem<M = unknown> {
    nodeId: string;
    label: string;
    value: number;
    percentOfSelection: number;
    kindLabel: string;
    meta?: M;
    childCount: number;
    isLeaf: boolean;
}

interface TreemapChildrenSummaryProps<M = unknown> {
    items: Array<TreemapChildSummaryItem<M>>;
    maxItems?: number;
    className?: string;
}

const formatPercent = (value: number): string => {
    if (!Number.isFinite(value) || value <= 0) {
        return '0';
    }
    if (value < 0.01) {
        return '<0.01';
    }
    if (value < 1) {
        return value.toFixed(2);
    }
    return value.toFixed(1);
};

const describeChild = (item: TreemapChildSummaryItem): string | null => {
    const badges: string[] = [];
    if (item.kindLabel) {
        badges.push(item.kindLabel);
    }
    if (item.childCount > 0 && !item.isLeaf) {
        badges.push(`${item.childCount.toLocaleString()} child${item.childCount === 1 ? '' : 'ren'}`);
    }
    return badges.length > 0 ? badges.join(' • ') : null;
};

const TreemapChildrenSummary = <M,>({ items, maxItems = 8, className }: TreemapChildrenSummaryProps<M>): JSX.Element | null => {
    if (!items || items.length === 0) {
        return null;
    }

    const displayItems = items.slice(0, maxItems);
    const remainder = Math.max(items.length - displayItems.length, 0);
    const containerClassName = className ? `${className} treemap-summary-body` : 'treemap-summary-body';

    return (
        <div className={containerClassName}>
            <ol className="treemap-summary-list">
                {displayItems.map((item) => {
                    const subtitle = describeChild(item);
                    return (
                        <li key={item.nodeId} className="treemap-summary-item">
                            <div className="treemap-summary-info">
                                <span className="treemap-summary-label">{item.label}</span>
                                {subtitle ? <span className="treemap-summary-subtitle">{subtitle}</span> : null}
                            </div>
                            <div className="treemap-summary-metrics">
                                <SizeValue value={item.value} />
                                {item.percentOfSelection > 0 ? (
                                    <span className="treemap-summary-percent">{formatPercent(item.percentOfSelection)}%</span>
                                ) : null}
                            </div>
                        </li>
                    );
                })}
            </ol>
            {remainder > 0 ? (
                <p className="treemap-summary-note">
                    + {remainder.toLocaleString()} more child{remainder === 1 ? '' : 'ren'} in this selection
                </p>
            ) : null}
        </div>
    );
};

export default TreemapChildrenSummary;
