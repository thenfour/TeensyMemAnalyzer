import type { Symbol as AnalyzerSymbol } from '@analyzer';
import SymbolValue from '../SymbolValue';
import { SizeValue } from '../SizeValue';

export interface TreemapSymbolSummaryItem<M = unknown> {
    nodeId: string;
    symbolId: string;
    label: string;
    value: number;
    percentOfSelection: number;
    meta?: M;
}

interface TreemapSymbolSummaryProps<M = unknown> {
    items: Array<TreemapSymbolSummaryItem<M>>;
    symbolLookup: Map<string, AnalyzerSymbol>;
    maxItems?: number;
    className?: string;
    showHeader?: boolean;
    title?: string;
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

const toSubtitle = (meta: unknown): string | null => {
    if (!meta || typeof meta !== 'object') {
        return null;
    }

    const record = meta as Record<string, unknown>;
    const scope = record.fullScope;
    if (Array.isArray(scope) && scope.length > 0 && scope.every((segment) => typeof segment === 'string')) {
        return scope.join('::');
    }

    const candidates: Array<string | undefined> = [];

    const coerce = (value: unknown): string | undefined => {
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
        return undefined;
    };

    const section = coerce(record.sectionName ?? record.sectionId);
    const block = coerce(record.blockName ?? record.blockId);
    const windowName = coerce(record.windowName ?? record.windowId);
    const hardwareBank = coerce(record.hardwareBankName ?? record.hardwareBankId);

    if (section) {
        candidates.push(section);
    }
    if (block) {
        candidates.push(block);
    }
    if (windowName) {
        candidates.push(windowName);
    }
    if (hardwareBank) {
        candidates.push(hardwareBank);
    }

    const uniqueCandidates: string[] = [];
    candidates.forEach((candidate) => {
        if (candidate && !uniqueCandidates.includes(candidate)) {
            uniqueCandidates.push(candidate);
        }
    });

    if (uniqueCandidates.length === 0) {
        return null;
    }

    return uniqueCandidates.join(' • ');
};

const TreemapSymbolSummary = <M,>({
    items,
    symbolLookup,
    maxItems = 8,
    className,
    showHeader = true,
    title = 'Symbols in selection',
}: TreemapSymbolSummaryProps<M>): JSX.Element | null => {
    if (!items || items.length === 0) {
        return null;
    }

    const displayItems = items.slice(0, maxItems);
    const remainder = Math.max(items.length - displayItems.length, 0);
    const containerClassName = className ? `${className} treemap-summary-body` : 'treemap-summary-body';

    return (
        <div className={containerClassName}>
            {showHeader ? (
                <div className="treemap-summary-header">
                    <h4>{title}</h4>
                    <span className="treemap-summary-count">{items.length.toLocaleString()} total</span>
                </div>
            ) : null}
            <ol className="treemap-summary-list">
                {displayItems.map((item) => {
                    const symbol = symbolLookup.get(item.symbolId);
                    const subtitle = toSubtitle(item.meta);
                    return (
                        <li key={item.nodeId} className="treemap-summary-item">
                            <div className="treemap-summary-info">
                                <SymbolValue
                                    symbolId={item.symbolId}
                                    symbol={symbol}
                                    className="treemap-summary-symbol"
                                />
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
                    + {remainder.toLocaleString()} more symbol{remainder === 1 ? '' : 's'} in this selection
                </p>
            ) : null}
        </div>
    );
};

export default TreemapSymbolSummary;
