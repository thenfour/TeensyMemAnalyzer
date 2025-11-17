import {
    useEffect,
    useMemo,
    useState,
    type ReactNode,
    type MouseEvent,
    type KeyboardEvent,
    type FocusEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { Analysis, Symbol as AnalyzerSymbol } from '@analyzer';
import { SizeValue, useSizeFormat } from '../SizeValue';
import {
    computeTreemapLayout,
    hasActiveFilters,
    type TreemapLayoutNode,
    type TreemapLayoutOptions,
    type TreemapLayoutTree,
    type TreemapSymbolFilters,
    type TreemapTree,
} from '../../treemap';
import TreemapSymbolSummary, { TreemapSymbolSummaryItem } from './TreemapSymbolSummary';
import TreemapChildrenSummary, { TreemapChildSummaryItem } from './TreemapChildrenSummary';

export interface TreemapDetailRow {
    label: string;
    value: ReactNode;
}

interface HoverState {
    nodeId: string;
    clientX: number;
    clientY: number;
}

interface NodeColor {
    fill: string;
    opacity: number;
}

export interface TreemapCardConfig<K extends string, M extends { nodeKind: K }> {
    title: string;
    description: string;
    svgTitle: string;
    buildTreemap: (analysis: Analysis | null, filters?: TreemapSymbolFilters) => TreemapTree<K, M> | null;
    layoutOptions?: Partial<TreemapLayoutOptions>;
    formatNodeKindLabel: (meta: M | undefined) => string;
    buildDetailRows: (node: TreemapLayoutNode<K, M>, symbolLookup: Map<string, AnalyzerSymbol>) => TreemapDetailRow[];
    getNodeColor: (node: TreemapLayoutNode<K, M>) => NodeColor;
    getEmptyStateMessage: (context: { analysis: Analysis | null; hasFiltersApplied: boolean }) => string;
}

export interface TreemapCardBaseProps<K extends string, M extends { nodeKind: K }> {
    analysis: Analysis | null;
    lastRunCompletedAt: Date | null;
    filters?: TreemapSymbolFilters;
    config: TreemapCardConfig<K, M>;
}

const DEFAULT_LAYOUT: TreemapLayoutOptions = {
    width: 960,
    height: 560,
    paddingInner: 2,
    paddingOuter: 6,
    paddingTop: 24,
    paddingRight: 6,
    paddingBottom: 6,
    paddingLeft: 6,
    round: false,
};

const MIN_LABEL_WIDTH = 56;
const MIN_LABEL_HEIGHT = 28;
const NODE_TEXT_PADDING = 8;

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

type TreemapDetailMode = 'symbols' | 'children';

const DETAIL_MODE_OPTIONS: Array<{ value: TreemapDetailMode; label: string }> = [
    { value: 'symbols', label: 'Symbols' },
    { value: 'children', label: 'Direct children' },
];

const TreemapCardBase = <K extends string, M extends { nodeKind: K }>(
    { analysis, lastRunCompletedAt, filters, config }: TreemapCardBaseProps<K, M>,
): JSX.Element => {
    const { formatValue } = useSizeFormat();

    const treemap = useMemo(() => config.buildTreemap(analysis, filters), [analysis, config, filters]);

    const layoutOptions = useMemo<TreemapLayoutOptions>(() => ({
        ...DEFAULT_LAYOUT,
        ...config.layoutOptions,
    }), [config.layoutOptions]);

    const layout = useMemo<TreemapLayoutTree<K, M> | null>(() => {
        if (!treemap) {
            return null;
        }
        return computeTreemapLayout(treemap, layoutOptions);
    }, [treemap, layoutOptions]);

    const symbolLookup = useMemo(() => {
        const map = new Map<string, AnalyzerSymbol>();
        analysis?.symbols.forEach((symbol) => map.set(symbol.id, symbol));
        return map;
    }, [analysis]);

    const nodeIndex = useMemo(() => {
        const map = new Map<string, TreemapLayoutNode<K, M>>();
        if (!layout) {
            return map;
        }
        const stack: Array<TreemapLayoutNode<K, M>> = [layout];
        while (stack.length > 0) {
            const current = stack.pop() as TreemapLayoutNode<K, M>;
            map.set(current.id, current);
            current.children?.forEach((child) => stack.push(child));
        }
        return map;
    }, [layout]);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [hoverState, setHoverState] = useState<HoverState | null>(null);
    const [detailMode, setDetailMode] = useState<TreemapDetailMode>('symbols');

    useEffect(() => {
        if (!layout) {
            setSelectedId(null);
            setHoverState(null);
            return;
        }
        setSelectedId((current) => (current && nodeIndex.has(current) ? current : layout.id));
        setHoverState(null);
    }, [layout, nodeIndex]);

    const selectedNode = useMemo(() => {
        if (!layout) {
            return null;
        }
        if (!selectedId) {
            return layout;
        }
        return nodeIndex.get(selectedId) ?? layout;
    }, [layout, nodeIndex, selectedId]);

    const hoveredNode = hoverState?.nodeId ? nodeIndex.get(hoverState.nodeId) ?? null : null;

    const nodes = useMemo(() => {
        if (!layout) {
            return [] as Array<TreemapLayoutNode<K, M>>;
        }
        const collected: Array<TreemapLayoutNode<K, M>> = [];
        const walk = (node: TreemapLayoutNode<K, M>): void => {
            if (node.depth > 0) {
                collected.push(node);
            }
            node.children?.forEach((child) => walk(child));
        };
        walk(layout);
        collected.sort((a, b) => a.depth - b.depth);
        return collected;
    }, [layout]);

    const breadcrumbs = useMemo(() => {
        if (!layout || !selectedNode) {
            return [] as Array<TreemapLayoutNode<K, M>>;
        }
        const trail: Array<TreemapLayoutNode<K, M>> = [];
        let current: TreemapLayoutNode<K, M> | undefined | null = selectedNode;
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
    const detailRows = selectedNode ? config.buildDetailRows(selectedNode, symbolLookup) : [];
    const selectedKindLabel = config.formatNodeKindLabel(selectedNode?.data.meta as M | undefined);
    const hasFiltersApplied = hasActiveFilters(filters);
    const hasNodes = nodes.length > 0;
    const emptyMessage = config.getEmptyStateMessage({ analysis, hasFiltersApplied });
    const symbolSummaryItems = useMemo<TreemapSymbolSummaryItem<M>[]>(() => {
        if (!selectedNode) {
            return [];
        }
        const selectionValue = selectedNode.value > 0 ? selectedNode.value : 0;
        const items: TreemapSymbolSummaryItem<M>[] = [];
        const stack: Array<TreemapLayoutNode<K, M>> = [selectedNode];
        while (stack.length > 0) {
            const current = stack.pop() as TreemapLayoutNode<K, M>;
            const meta = current.data.meta;
            const nodeKind = (meta as { nodeKind?: string } | undefined)?.nodeKind;
            if (meta && nodeKind === 'symbol') {
                const symbolId = (meta as { symbolId?: string }).symbolId ?? current.id;
                items.push({
                    nodeId: current.id,
                    symbolId,
                    label: current.data.label,
                    value: current.value,
                    percentOfSelection: selectionValue > 0 ? (current.value / selectionValue) * 100 : 0,
                    meta,
                });
                continue;
            }
            current.children?.forEach((child) => stack.push(child));
        }
        items.sort((a, b) => b.value - a.value);
        return items;
    }, [selectedNode]);

    const childSummaryItems = useMemo<TreemapChildSummaryItem<M>[]>(() => {
        if (!selectedNode?.children || selectedNode.children.length === 0) {
            return [];
        }
        const selectionValue = selectedNode.value > 0 ? selectedNode.value : 0;
        return selectedNode.children
            .map((child) => {
                const meta = child.data.meta as M | undefined;
                return {
                    nodeId: child.id,
                    label: child.data.label,
                    value: child.value,
                    percentOfSelection: selectionValue > 0 ? (child.value / selectionValue) * 100 : 0,
                    kindLabel: config.formatNodeKindLabel(meta),
                    meta,
                    childCount: child.children?.length ?? 0,
                    isLeaf: child.isLeaf,
                } satisfies TreemapChildSummaryItem<M>;
            })
            .sort((a, b) => b.value - a.value);
    }, [config, selectedNode]);


    const handleBackgroundClick = (): void => {
        if (layout) {
            setSelectedId(layout.id);
        }
    };

    const handleNodeClick = (event: MouseEvent<SVGRectElement>, node: TreemapLayoutNode<K, M>): void => {
        event.stopPropagation();
        setSelectedId(node.id);
    };

    const handleNodeKeyDown = (event: KeyboardEvent<SVGRectElement>, node: TreemapLayoutNode<K, M>): void => {
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

    const handleNodeMouseEnter = (event: MouseEvent<SVGRectElement>, node: TreemapLayoutNode<K, M>): void => {
        setHoverState({ nodeId: node.id, clientX: event.clientX, clientY: event.clientY });
    };

    const handleNodeMouseMove = (event: MouseEvent<SVGRectElement>, node: TreemapLayoutNode<K, M>): void => {
        setHoverState((current) => {
            if (current && current.nodeId === node.id && current.clientX === event.clientX && current.clientY === event.clientY) {
                return current;
            }
            return { nodeId: node.id, clientX: event.clientX, clientY: event.clientY };
        });
    };

    const handleNodeMouseLeave = (): void => {
        setHoverState(null);
    };

    const handleNodeFocus = (event: FocusEvent<SVGRectElement>, node: TreemapLayoutNode<K, M>): void => {
        const rect = event.currentTarget.getBoundingClientRect();
        setHoverState({ nodeId: node.id, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
    };

    const handleNodeBlur = (): void => {
        setHoverState(null);
    };

    const handleSvgMouseLeave = (): void => {
        setHoverState(null);
    };

    const tooltipRowsForNode = (node: TreemapLayoutNode<K, M>): TreemapDetailRow[] => {
        const rows = config.buildDetailRows(node, symbolLookup);
        return rows.filter((row) => row.label !== 'Node ID' && row.label !== 'Children');
    };

    const renderTooltipContent = (node: TreemapLayoutNode<K, M>): ReactNode => {
        const meta = node.data.meta as M | undefined;
        if (!meta) {
            return null;
        }
        const parent = node.parentId ? nodeIndex.get(node.parentId) ?? null : null;
        const percentTotal = totalValue > 0 ? (node.value / totalValue) * 100 : 0;
        const percentParent = parent && parent.value > 0 ? (node.value / parent.value) * 100 : 0;
        const detailRowsForTooltip = tooltipRowsForNode(node).slice(0, 4);

        return (
            <div className="treemap-tooltip">
                <div className="treemap-tooltip-header">
                    <span className="treemap-tooltip-title">{node.data.label}</span>
                    <span className="treemap-tooltip-kind">{config.formatNodeKindLabel(meta)}</span>
                </div>
                <div className="treemap-tooltip-metric">
                    <span className="treemap-tooltip-metric-value">{formatValue(node.value)}</span>
                    {percentTotal > 0 ? (
                        <span className="treemap-tooltip-metric-note">{formatPercent(percentTotal)}% of target</span>
                    ) : null}
                </div>
                {parent && percentParent > 0 ? (
                    <div className="treemap-tooltip-metric treemap-tooltip-metric--secondary">
                        <span className="treemap-tooltip-metric-note">
                            {formatPercent(percentParent)}% of {parent.data.label}
                        </span>
                    </div>
                ) : null}
                {detailRowsForTooltip.length > 0 ? (
                    <dl className="treemap-tooltip-details">
                        {detailRowsForTooltip.map((row) => (
                            <div key={row.label} className="treemap-tooltip-row">
                                <dt>{row.label}</dt>
                                <dd>{row.value}</dd>
                            </div>
                        ))}
                    </dl>
                ) : null}
            </div>
        );
    };

    const hoverOverlay = hoverState && hoveredNode && typeof document !== 'undefined'
        ? createPortal(
            <span
                className="tooltip-overlay"
                style={{
                    left: (() => {
                        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
                        const desired = hoverState.clientX + 16;
                        return Math.min(Math.max(desired, 16), viewportWidth - 16);
                    })(),
                    top: hoverState.clientY + 20,
                }}
            >
                <span className="tooltip-bubble">{renderTooltipContent(hoveredNode)}</span>
            </span>,
            document.body,
        )
        : null;

    return (
        <section className="summary-card treemap-card">
            <div className="summary-header">
                <h2>{config.title}</h2>
                <div className="summary-meta">
                    {analysis?.target?.name ? <span className="summary-state">{analysis.target.name}</span> : null}
                    {lastRunCompletedAt ? (
                        <span className="summary-updated">Based on {lastRunCompletedAt.toLocaleString()}</span>
                    ) : (
                        <span className="summary-updated">Awaiting first analysis</span>
                    )}
                </div>
            </div>
            <p className="summary-description">{config.description}</p>

            {!layout || !hasNodes ? (
                <p className="summary-placeholder">{emptyMessage}</p>
            ) : (
                <>
                    <div className="treemap-content">
                        <div className="treemap-surface">
                            <svg
                                className="treemap-svg"
                                viewBox={`0 0 ${layoutOptions.width ?? DEFAULT_LAYOUT.width} ${layoutOptions.height ?? DEFAULT_LAYOUT.height}`}
                                role="presentation"
                                onClick={handleBackgroundClick}
                                onMouseLeave={handleSvgMouseLeave}
                            >
                                <title>{config.svgTitle}</title>
                                {nodes.map((node) => {
                                    if (node.width <= 1 || node.height <= 1) {
                                        return null;
                                    }
                                    const isSelected = selectedNode?.id === node.id;
                                    const isHovered = hoverState?.nodeId === node.id;
                                    const { fill, opacity } = config.getNodeColor(node);
                                    const labelX = node.x + NODE_TEXT_PADDING;
                                    const labelY = node.y + NODE_TEXT_PADDING + 12;
                                    const canShowLabel = node.width >= MIN_LABEL_WIDTH && node.height >= MIN_LABEL_HEIGHT;
                                    const canShowValue = node.height >= MIN_LABEL_HEIGHT * 1.6;
                                    const valueLabel = canShowLabel ? formatValue(node.value, 'pretty') : null;
                                    const ariaLabel = `${node.data.label}, ${formatValue(node.value, 'pretty')}`;

                                    return (
                                        <g
                                            key={node.id}
                                            className={`treemap-node${isSelected ? ' treemap-node--selected' : ''}${node.isLeaf ? ' treemap-node--leaf' : ''}${isHovered ? ' treemap-node--hovered' : ''}`}
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
                                                onMouseEnter={(event) => handleNodeMouseEnter(event, node)}
                                                onMouseMove={(event) => handleNodeMouseMove(event, node)}
                                                onMouseLeave={handleNodeMouseLeave}
                                                onFocus={(event) => handleNodeFocus(event, node)}
                                                onBlur={handleNodeBlur}
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
                        {hoverOverlay}
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
                                <div className="treemap-detail-summary">
                                    <div className="treemap-detail-summary-controls">
                                        <span className="treemap-detail-summary-title">What&apos;s inside</span>
                                        <div className="treemap-detail-toggle" role="group" aria-label="Select detail view">
                                            {DETAIL_MODE_OPTIONS.map((option) => (
                                                <button
                                                    key={option.value}
                                                    type="button"
                                                    className={`treemap-detail-toggle-button${detailMode === option.value ? ' treemap-detail-toggle-button--active' : ''}`}
                                                    onClick={() => setDetailMode(option.value)}
                                                    aria-pressed={detailMode === option.value}
                                                >
                                                    {option.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    {detailMode === 'symbols' ? (
                                        symbolSummaryItems.length > 0 ? (
                                            <TreemapSymbolSummary
                                                items={symbolSummaryItems}
                                                symbolLookup={symbolLookup}
                                                showHeader={false}
                                            />
                                        ) : (
                                            <p className="treemap-summary-empty">No symbols within this selection.</p>
                                        )
                                    ) : childSummaryItems.length > 0 ? (
                                        <TreemapChildrenSummary items={childSummaryItems} />
                                    ) : (
                                        <p className="treemap-summary-empty">This selection has no direct children.</p>
                                    )}
                                </div>
                            </>
                        ) : (
                            <p className="treemap-details-empty">Select a node in the treemap to inspect it.</p>
                        )}
                    </div>
                </>
            )}
        </section>
    );
};

export default TreemapCardBase;
