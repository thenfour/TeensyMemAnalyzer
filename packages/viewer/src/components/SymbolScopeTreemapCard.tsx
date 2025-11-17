import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import type { Analysis, Symbol as AnalyzerSymbol } from '@analyzer';
import { SizeValue, useSizeFormat } from './SizeValue';
import SymbolValue from './SymbolValue';
import { hashColor } from '../utils/color';
import {
    buildScopeTreemap,
    computeTreemapLayout,
    hasActiveFilters,
    type ScopeTreemapNodeKind,
    type ScopeTreemapNodeMeta,
    type TreemapLayoutNode,
    type TreemapLayoutTree,
    type TreemapSymbolFilters,
} from '../treemap';

interface SymbolScopeTreemapCardProps {
    analysis: Analysis | null;
    lastRunCompletedAt: Date | null;
    filters?: TreemapSymbolFilters;
}

type ScopeLayoutNode = TreemapLayoutNode<ScopeTreemapNodeKind, ScopeTreemapNodeMeta>;

interface DetailRow {
    label: string;
    value: ReactNode;
}

const VIEWBOX_WIDTH = 960;
const VIEWBOX_HEIGHT = 560;
const MIN_LABEL_WIDTH = 56;
const MIN_LABEL_HEIGHT = 28;
const NODE_TEXT_PADDING = 8;

const formatNodeKindLabel = (kind: ScopeTreemapNodeKind): string => {
    switch (kind) {
        case 'root':
            return 'Target summary';
        case 'scope':
            return 'Scope';
        case 'symbol':
            return 'Symbol';
        default:
            return kind;
    }
};

const getNodeColor = (node: ScopeLayoutNode): { fill: string; opacity: number } => {
    const meta = node.data.meta;
    if (!meta) {
        return { fill: '#e2e8f0', opacity: 1 };
    }

    switch (meta.nodeKind) {
        case 'root':
            return { fill: '#e2e8f0', opacity: 1 };
        case 'scope':
            return { fill: hashColor(`scope:${meta.fullName}`), opacity: 0.9 };
        case 'symbol':
            return { fill: hashColor(`symbol:${meta.symbolId}`), opacity: 0.82 };
        default:
            return { fill: '#cbd5e1', opacity: 0.9 };
    }
};

const buildDetailRows = (
    node: ScopeLayoutNode,
    symbolLookup: Map<string, AnalyzerSymbol>,
): DetailRow[] => {
    const meta = node.data.meta;
    if (!meta) {
        return [];
    }

    const rows: DetailRow[] = [];

    if (node.depth > 0) {
        rows.push({ label: 'Node ID', value: node.id });
    }

    switch (meta.nodeKind) {
        case 'root':
            rows.push({ label: 'Target', value: meta.targetName });
            rows.push({ label: 'Target ID', value: meta.targetId });
            break;
        case 'scope':
            rows.push({ label: 'Scope path', value: meta.fullName });
            rows.push({ label: 'Symbols', value: meta.symbolCount.toLocaleString() });
            break;
        case 'symbol': {
            const symbol = symbolLookup.get(meta.symbolId);
            rows.push({
                label: 'Symbol',
                value: <SymbolValue symbolId={meta.symbolId} symbol={symbol} />,
            });
            if (meta.fullScope.length > 0) {
                rows.push({ label: 'Scope', value: meta.fullScope.join('::') });
            }
            if (meta.windowId) {
                rows.push({ label: 'Window', value: meta.windowName ?? meta.windowId });
            }
            if (meta.blockId) {
                rows.push({ label: 'Block', value: meta.blockName ?? meta.blockId });
            }
            if (meta.sectionId) {
                rows.push({ label: 'Section', value: meta.sectionName ?? meta.sectionId });
            }
            if (meta.hardwareBankId) {
                rows.push({ label: 'Hardware bank', value: meta.hardwareBankName ?? meta.hardwareBankId });
            }
            rows.push({ label: 'Declared size', value: <SizeValue value={meta.symbolSize} /> });
            if (meta.mangledName) {
                rows.push({ label: 'Mangled name', value: meta.mangledName });
            }
            break;
        }
        default:
            break;
    }

    return rows;
};

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

const SymbolScopeTreemapCard = ({ analysis, lastRunCompletedAt, filters }: SymbolScopeTreemapCardProps): JSX.Element => {
    const { formatValue } = useSizeFormat();

    const treemap = useMemo(() => buildScopeTreemap(analysis, filters), [analysis, filters]);

    const layout = useMemo<TreemapLayoutTree<ScopeTreemapNodeKind, ScopeTreemapNodeMeta> | null>(() => {
        if (!treemap) {
            return null;
        }
        return computeTreemapLayout(treemap, {
            width: VIEWBOX_WIDTH,
            height: VIEWBOX_HEIGHT,
            paddingInner: 2,
            paddingOuter: 6,
            paddingTop: 24,
            paddingRight: 6,
            paddingBottom: 6,
            paddingLeft: 6,
        });
    }, [treemap]);

    const symbolLookup = useMemo(() => {
        const map = new Map<string, AnalyzerSymbol>();
        analysis?.symbols.forEach((symbol) => map.set(symbol.id, symbol));
        return map;
    }, [analysis]);

    const nodeIndex = useMemo(() => {
        const map = new Map<string, ScopeLayoutNode>();
        if (!layout) {
            return map;
        }
        const stack: ScopeLayoutNode[] = [layout as ScopeLayoutNode];
        while (stack.length > 0) {
            const current = stack.pop() as ScopeLayoutNode;
            map.set(current.id, current);
            current.children?.forEach((child) => stack.push(child as ScopeLayoutNode));
        }
        return map;
    }, [layout]);

    const [selectedId, setSelectedId] = useState<string | null>(null);

    useEffect(() => {
        if (!layout) {
            setSelectedId(null);
            return;
        }
        setSelectedId((current) => (current && nodeIndex.has(current) ? current : layout.id));
    }, [layout, nodeIndex]);

    const selectedNode = useMemo<ScopeLayoutNode | null>(() => {
        if (!layout) {
            return null;
        }
        if (!selectedId) {
            return layout as ScopeLayoutNode;
        }
        return nodeIndex.get(selectedId) ?? (layout as ScopeLayoutNode);
    }, [layout, nodeIndex, selectedId]);

    const nodes = useMemo(() => {
        if (!layout) {
            return [] as ScopeLayoutNode[];
        }
        const collected: ScopeLayoutNode[] = [];
        const walk = (node: ScopeLayoutNode): void => {
            if (node.depth > 0) {
                collected.push(node);
            }
            node.children?.forEach((child) => walk(child as ScopeLayoutNode));
        };
        walk(layout as ScopeLayoutNode);
        collected.sort((a, b) => a.depth - b.depth);
        return collected;
    }, [layout]);

    const breadcrumbs = useMemo(() => {
        if (!layout || !selectedNode) {
            return [] as ScopeLayoutNode[];
        }
        const trail: ScopeLayoutNode[] = [];
        let current: ScopeLayoutNode | undefined | null = selectedNode;
        while (current) {
            trail.push(current);
            if (!current.parentId) {
                break;
            }
            current = nodeIndex.get(current.parentId) ?? null;
        }
        return trail.reverse();
    }, [layout, nodeIndex, selectedNode]);

    const totalValue = layout?.value ?? 0;
    const percentOfTotal = selectedNode && totalValue > 0 ? (selectedNode.value / totalValue) * 100 : 0;
    const percentLabel = formatPercent(percentOfTotal);
    const detailRows = selectedNode ? buildDetailRows(selectedNode, symbolLookup) : [];
    const selectedKindLabel = formatNodeKindLabel(selectedNode?.data.meta?.nodeKind ?? 'root');
    const hasFiltersApplied = hasActiveFilters(filters);
    const hasNodes = nodes.length > 0;

    const emptyMessage = analysis
        ? hasFiltersApplied
            ? 'No symbols match the current filters.'
            : 'No symbols with size information are available to build the scope treemap.'
        : 'Load an analysis to explore symbol scopes.';

    const handleBackgroundClick = (): void => {
        if (layout) {
            setSelectedId(layout.id);
        }
    };

    const handleNodeClick = (event: MouseEvent<SVGRectElement>, node: ScopeLayoutNode): void => {
        event.stopPropagation();
        setSelectedId(node.id);
    };

    const handleNodeKeyDown = (event: KeyboardEvent<SVGRectElement>, node: ScopeLayoutNode): void => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            setSelectedId(node.id);
        } else if (event.key === 'Escape' && node.parentId) {
            event.preventDefault();
            event.stopPropagation();
            setSelectedId(node.parentId);
        }
    };

    return (
        <section className="summary-card treemap-card">
            <div className="summary-header">
                <h2>Scope Treemap</h2>
                <div className="summary-meta">
                    {analysis?.target?.name ? <span className="summary-state">{analysis.target.name}</span> : null}
                    {lastRunCompletedAt ? (
                        <span className="summary-updated">Based on {lastRunCompletedAt.toLocaleString()}</span>
                    ) : (
                        <span className="summary-updated">Awaiting first analysis</span>
                    )}
                </div>
            </div>
            <p className="summary-description">
                Groups symbol sizes by C++ namespaces, classes, and function scopes. Use this view to locate large
                contributions within your code structure.
            </p>

            {!layout || !hasNodes ? (
                <p className="summary-placeholder">{emptyMessage}</p>
            ) : (
                <>
                    <div className="treemap-content">
                        <div className="treemap-surface">
                            <svg
                                className="treemap-svg"
                                viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
                                role="presentation"
                                onClick={handleBackgroundClick}
                            >
                                <title>Symbol scope treemap</title>
                                {nodes.map((node) => {
                                    if (node.width <= 1 || node.height <= 1) {
                                        return null;
                                    }
                                    const isSelected = selectedNode?.id === node.id;
                                    const { fill, opacity } = getNodeColor(node);
                                    const labelX = node.x + NODE_TEXT_PADDING;
                                    const labelY = node.y + NODE_TEXT_PADDING + 12;
                                    const canShowLabel = node.width >= MIN_LABEL_WIDTH && node.height >= MIN_LABEL_HEIGHT;
                                    const canShowValue = node.height >= MIN_LABEL_HEIGHT * 1.6;
                                    const valueLabel = canShowLabel ? formatValue(node.value, 'pretty') : null;
                                    const ariaLabel = `${node.data.label}, ${formatValue(node.value, 'pretty')}`;

                                    return (
                                        <g
                                            key={node.id}
                                            className={`treemap-node${isSelected ? ' treemap-node--selected' : ''}${node.isLeaf ? ' treemap-node--leaf' : ''}`}
                                        >
                                            <rect
                                                x={node.x}
                                                y={node.y}
                                                width={node.width}
                                                height={node.height}
                                                fill={fill}
                                                fillOpacity={opacity}
                                                stroke={isSelected ? '#1d4ed8' : '#1f29373a'}
                                                strokeWidth={isSelected ? 2 : 1}
                                                rx={8}
                                                aria-label={ariaLabel}
                                                role="button"
                                                tabIndex={0}
                                                aria-pressed={isSelected}
                                                onClick={(event) => handleNodeClick(event, node)}
                                                onKeyDown={(event) => handleNodeKeyDown(event, node)}
                                            />
                                            {canShowLabel ? (
                                                <text x={labelX} y={labelY} className="treemap-node-text">
                                                    <tspan x={labelX} className="treemap-node-label">
                                                        {node.data.label}
                                                    </tspan>
                                                    {valueLabel && canShowValue ? (
                                                        <tspan x={labelX} dy={16} className="treemap-node-value">
                                                            {valueLabel}
                                                        </tspan>
                                                    ) : null}
                                                </text>
                                            ) : null}
                                        </g>
                                    );
                                })}
                            </svg>
                        </div>
                    </div>
                    <div className="treemap-details">
                        {breadcrumbs.length > 1 ? (
                            <div className="treemap-breadcrumb" aria-label="Treemap selection path">
                                {breadcrumbs.map((crumb, index) => {
                                    const isLast = index === breadcrumbs.length - 1;
                                    return (
                                        <span key={crumb.id} className="treemap-breadcrumb-item">
                                            <button
                                                type="button"
                                                className="treemap-crumb-button"
                                                onClick={() => setSelectedId(crumb.id)}
                                                aria-current={isLast ? 'page' : undefined}
                                                disabled={isLast}
                                            >
                                                {crumb.data.label}
                                            </button>
                                            {index < breadcrumbs.length - 1 ? (
                                                <span className="treemap-crumb-separator" aria-hidden="true">
                                                    ›
                                                </span>
                                            ) : null}
                                        </span>
                                    );
                                })}
                            </div>
                        ) : null}

                        {selectedNode ? (
                            <>
                                <h3>{selectedNode.data.label}</h3>
                                <p className="treemap-details-kind">{selectedKindLabel}</p>
                                <div className="treemap-details-size">
                                    <SizeValue value={selectedNode.value} />
                                    {totalValue > 0 ? (
                                        <span className="treemap-details-percent">{percentLabel}% of total</span>
                                    ) : null}
                                </div>
                                <dl className="treemap-details-list">
                                    {detailRows.map((row) => (
                                        <div key={row.label} className="treemap-details-row">
                                            <dt>{row.label}</dt>
                                            <dd>{row.value}</dd>
                                        </div>
                                    ))}
                                </dl>
                            </>
                        ) : (
                            <p className="treemap-details-empty">Select a scope in the treemap to inspect it.</p>
                        )}
                    </div>
                </>
            )}
        </section>
    );
};

export default SymbolScopeTreemapCard;
