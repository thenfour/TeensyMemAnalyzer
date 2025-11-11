import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Analysis, Summaries, Symbol as AnalyzerSymbol } from '@teensy-mem-explorer/analyzer';
import { SizeValue } from './SizeValue';
import AddressValue from './AddressValue';
import { useMemoryMapData, type MemoryMapSpan, type MemoryMapColumnData } from '../hooks/useMemoryMapData';
import type { MemoryMapSpanLayout } from '../utils/memoryMapLayout';
import { computeMemoryMapSpanLayout } from '../utils/memoryMapLayout';

interface MemoryMapCardProps {
    analysis: Analysis | null;
    summaries: Summaries | null;
    lastRunCompletedAt: Date | null;
}

const MEMORY_MAP_DIMENSIONS = {
    width: 360,
    height: 900,
    padding: 0,
    minSpanHeight: 12,
};

type SymbolIndex = Map<string, AnalyzerSymbol[]>;

interface SymbolContribution {
    id: string;
    name: string;
    size: number;
    coverage: number;
    addr: number;
}

interface MemoryMapBankVisualizationProps {
    bankName: string;
    columns: MemoryMapColumnData[];
    bankStart: number;
    bankEnd: number;
    symbolIndex: SymbolIndex;
}

type MemoryMapStyle = CSSProperties & {
    '--memory-map-bank-width': string;
    '--memory-map-bank-height': string;
    '--memory-map-bank-padding': string;
    '--memory-map-min-span-height': string;
};

const MemoryMapBankVisualization = ({
    bankName,
    columns,
    bankStart,
    bankEnd,
    symbolIndex,
}: MemoryMapBankVisualizationProps): JSX.Element => {
    const { width, height, padding, minSpanHeight } = MEMORY_MAP_DIMENSIONS;
    const labelOffset = 24;
    const layoutHeight = Math.max(1, height - labelOffset);

    const allSpans = useMemo(
        () => columns.flatMap((column) => column.spans),
        [columns],
    );

    const spansById = useMemo(() => {
        const map = new Map<string, MemoryMapSpan>();
        allSpans.forEach((span) => {
            map.set(span.id, span);
        });
        return map;
    }, [allSpans]);

    const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

    useEffect(() => {
        if (!selectedSpanId) {
            return;
        }

        if (!spansById.has(selectedSpanId)) {
            setSelectedSpanId(null);
        }
    }, [selectedSpanId, spansById]);

    const selectedSpan = selectedSpanId ? spansById.get(selectedSpanId) ?? null : null;

    const detailColumnIndex = useMemo(
        () => columns.findIndex((column) => column.spans.some((span) => span.column === 'block')),
        [columns],
    );

    const baseColumnIndex = detailColumnIndex >= 0 ? detailColumnIndex : columns.findIndex((column) => column.spans.length > 0);
    const baseColumnSpans = baseColumnIndex >= 0 ? columns[baseColumnIndex].spans : [];

    const { layouts: baseLayouts } = useMemo(
        () =>
            computeMemoryMapSpanLayout(baseColumnSpans, {
                bankStart,
                bankEnd,
                totalHeight: layoutHeight,
                padding,
                minSpanHeight,
            }),
        [baseColumnSpans, bankStart, bankEnd, layoutHeight, padding, minSpanHeight],
    );

    const baseLayoutBySpanId = useMemo(() => {
        const map = new Map<string, MemoryMapSpanLayout>();
        baseLayouts.forEach((entry) => {
            map.set(entry.span.id, entry);
        });
        return map;
    }, [baseLayouts]);

    const aggregateBounds = useCallback(
        (span: MemoryMapSpan): { y: number; height: number } | null => {
            if (baseLayouts.length === 0) {
                return null;
            }

            let top = Number.POSITIVE_INFINITY;
            let bottom = Number.NEGATIVE_INFINITY;

            baseLayouts.forEach((layout) => {
                const layoutSpan = layout.span;
                if (layoutSpan.end <= span.start || layoutSpan.start >= span.end) {
                    return;
                }

                const layoutTop = layout.y;
                const layoutBottom = layout.y + layout.height;
                if (layoutTop < top) {
                    top = layoutTop;
                }
                if (layoutBottom > bottom) {
                    bottom = layoutBottom;
                }
            });

            if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
                return null;
            }

            return {
                y: top,
                height: Math.max(bottom - top, 0),
            };
        },
        [baseLayouts],
    );

    const columnLayouts = useMemo(() => {
        if (columns.length === 0) {
            return [] as Array<{ label: string; spans: MemoryMapSpanLayout[] }>;
        }

        return columns.map((column, columnIndex) => {
            const spans = column.spans.map((span) => {
                if (columnIndex === baseColumnIndex) {
                    const layout = baseLayoutBySpanId.get(span.id);
                    if (layout) {
                        return layout;
                    }
                }

                const bounds = aggregateBounds(span);
                if (bounds) {
                    return {
                        span,
                        y: bounds.y,
                        height: bounds.height,
                    } satisfies MemoryMapSpanLayout;
                }

                const fallback = computeMemoryMapSpanLayout([span], {
                    bankStart,
                    bankEnd,
                    totalHeight: layoutHeight,
                    padding,
                    minSpanHeight,
                }).layouts[0];

                return fallback ?? { span, y: 0, height: 0 };
            });

            return {
                label: column.label,
                spans,
            };
        });
    }, [
        aggregateBounds,
        baseColumnIndex,
        baseLayoutBySpanId,
        bankEnd,
        bankStart,
        columns,
        layoutHeight,
        minSpanHeight,
        padding,
    ]);

    const columnCount = Math.max(1, columnLayouts.length);
    const columnGap = Math.min(20, Math.max(12, width * 0.05));
    const usableWidth = width - columnGap * (columnCount + 1);
    const trackWidth = Math.max(40, usableWidth / columnCount);
    const totalColumnsWidth = columnCount * trackWidth + (columnCount + 1) * columnGap;
    const horizontalOffset = Math.max(0, (width - totalColumnsWidth) / 2);
    const trackHeight = layoutHeight - padding;
    const spanWidth = Math.max(32, trackWidth - 4);

    return (
        <div className="memory-map-bank">
            <div className="memory-map-bank-header">
                <span className="memory-map-bank-name">{bankName}</span>
            </div>
            <div className="memory-map-bank-content">
                <svg className="memory-map-svg" viewBox={`0 0 ${width} ${height}`} role="presentation">
                    {columnLayouts.map((column, columnIndex) => {
                        const trackX = horizontalOffset + columnGap + columnIndex * (trackWidth + columnGap);
                        const spanX = trackX + (trackWidth - spanWidth) / 2;
                        const columnLabelY = labelOffset - 8;

                        return (
                            <g key={`${bankName}:${column.label}`}>
                                <text
                                    x={trackX + trackWidth / 2}
                                    y={Math.max(12, columnLabelY)}
                                    fill="#334155"
                                    fontSize={12}
                                    textAnchor="middle"
                                    pointerEvents="none"
                                >
                                    {column.label}
                                </text>
                                <rect
                                    className="memory-map-track"
                                    x={trackX}
                                    y={labelOffset}
                                    width={trackWidth}
                                    height={trackHeight}
                                    rx={10}
                                    fill="#f8fafc"
                                    stroke="#cbd5e1"
                                    strokeWidth={1}
                                />
                                {column.spans.map(({ span, y, height: spanHeight }) => {
                                    if (spanHeight <= 0) {
                                        return null;
                                    }

                                    const isSelected = selectedSpanId === span.id;
                                    const drawY = labelOffset + y;
                                    const clampedHeight = Math.max(spanHeight, 0);
                                    const textY = drawY + clampedHeight / 2 + 4;
                                    const fontSize = Math.min(12, Math.max(10, clampedHeight / 4 + 8));

                                    return (
                                        <g
                                            key={span.id}
                                            className="memory-map-span"
                                            onClick={() => setSelectedSpanId(span.id)}
                                        >
                                            <rect
                                                className="memory-map-span-rect"
                                                x={spanX}
                                                y={drawY}
                                                width={spanWidth}
                                                height={clampedHeight}
                                                rx={6}
                                                fill={span.color}
                                                stroke={isSelected ? '#2563eb' : '#0f172a33'}
                                                strokeWidth={isSelected ? 2 : 1}
                                            />
                                            <text
                                                x={trackX + trackWidth / 2}
                                                y={textY}
                                                textAnchor="middle"
                                                fontSize={fontSize}
                                                fill="#0f172a"
                                                pointerEvents="none"
                                            >
                                                {span.label}
                                            </text>
                                        </g>
                                    );
                                })}
                            </g>
                        );
                    })}
                </svg>
                <div className="memory-map-bank-details">
                    <h4>Selection details</h4>
                    <MemoryMapSpanDetails span={selectedSpan} symbolIndex={symbolIndex} />
                </div>
            </div>
        </div>
    );
};

const MemoryMapSpanDetails = ({ span, symbolIndex }: { span: MemoryMapSpan | null; symbolIndex: SymbolIndex }): JSX.Element => {
    if (!span) {
        return <p className="memory-map-details-empty">Select a span to inspect its address range and size.</p>;
    }

    const renderAddress = (value: number | undefined): JSX.Element =>
        value !== undefined ? <AddressValue value={value} /> : <span className="memory-map-address-unknown">Unknown</span>;

    const topSymbols = useMemo<SymbolContribution[]>(() => {
        if (!span?.regionId || span.startAddress === undefined || span.endAddress === undefined) {
            return [];
        }

        const candidates = symbolIndex.get(span.regionId);
        if (!candidates || candidates.length === 0) {
            return [];
        }

        const spanStart = span.startAddress;
        const spanEnd = span.endAddress;
        const contributions: SymbolContribution[] = [];

        for (const symbol of candidates) {
            const symbolStart = symbol.addr;
            if (symbolStart >= spanEnd) {
                break;
            }

            const symbolSize = Math.max(0, symbol.size);
            const symbolEnd = symbolStart + symbolSize;
            if (symbolEnd <= spanStart) {
                continue;
            }

            const overlapStart = Math.max(symbolStart, spanStart);
            const overlapEnd = Math.min(symbolEnd, spanEnd);
            const coverage = Math.max(0, overlapEnd - overlapStart);
            if (coverage <= 0) {
                continue;
            }

            contributions.push({
                id: symbol.id,
                name: symbol.name ?? symbol.id,
                size: symbolSize,
                coverage,
                addr: symbolStart,
            });
        }

        contributions.sort((a, b) => {
            if (b.coverage !== a.coverage) {
                return b.coverage - a.coverage;
            }
            if (b.size !== a.size) {
                return b.size - a.size;
            }
            if (a.addr !== b.addr) {
                return a.addr - b.addr;
            }
            return a.name.localeCompare(b.name);
        });

        return contributions.slice(0, 8);
    }, [span, symbolIndex]);

    return (
        <dl className="memory-map-details-list">
            <div>
                <dt>Label</dt>
                <dd>{span.label}</dd>
            </div>
            {span.regionName ? (
                <div>
                    <dt>Region</dt>
                    <dd>{span.regionName}</dd>
                </div>
            ) : null}
            {span.column === 'block' && span.blockName ? (
                <div>
                    <dt>Block</dt>
                    <dd>{span.blockName}</dd>
                </div>
            ) : span.blockNames ? (
                <div>
                    <dt>Blocks</dt>
                    <dd>{span.blockNames.join(', ')}</dd>
                </div>
            ) : null}
            {span.sectionIds && span.sectionIds.length > 0 ? (
                <div>
                    <dt>Sections</dt>
                    <dd>{span.sectionIds.join(', ')}</dd>
                </div>
            ) : null}
            <div>
                <dt>Size</dt>
                <dd>
                    <SizeValue value={span.size} />
                </dd>
            </div>
            <div>
                <dt>Start</dt>
                <dd>
                    {renderAddress(span.startAddress)}
                </dd>
            </div>
            <div>
                <dt>End</dt>
                <dd>
                    {renderAddress(span.endAddress)}
                </dd>
            </div>
            <div>
                <dt>Type</dt>
                <dd>
                    {(() => {
                        switch (span.type) {
                            case 'occupied':
                                return 'Occupied';
                            case 'reserved':
                                return 'Reserved';
                            case 'block':
                                return 'Block';
                            case 'padding':
                                return 'Padding';
                            default:
                                return 'Free';
                        }
                    })()}
                </dd>
            </div>
            <div>
                <dt>Top symbols</dt>
                <dd>
                    {topSymbols.length > 0 ? (
                        <ul className="memory-map-symbols-list">
                            {topSymbols.map((symbol) => (
                                <li key={symbol.id}>
                                    <span className="memory-map-symbol-name">{symbol.name}</span>
                                    <span className="memory-map-symbol-size">
                                        <SizeValue value={symbol.coverage} />
                                        {symbol.coverage < symbol.size ? (
                                            <span className="memory-map-symbol-size-total">
                                                {' '}
                                                / <SizeValue value={symbol.size} />
                                            </span>
                                        ) : null}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <span className="memory-map-symbols-empty">No symbols found in this span.</span>
                    )}
                </dd>
            </div>
        </dl>
    );
};

const MemoryMapCard = ({ analysis, summaries, lastRunCompletedAt }: MemoryMapCardProps): JSX.Element | null => {
    const { groups } = useMemoryMapData(analysis, summaries);

    const symbolIndex = useMemo<SymbolIndex>(() => {
        if (!analysis) {
            return new Map();
        }

        const map = new Map<string, AnalyzerSymbol[]>();
        analysis.symbols.forEach((symbol) => {
            if (!symbol.windowId || symbol.size <= 0) {
                return;
            }

            const list = map.get(symbol.windowId);
            if (list) {
                list.push(symbol);
            } else {
                map.set(symbol.windowId, [symbol]);
            }
        });

        map.forEach((list) => {
            list.sort((a, b) => a.addr - b.addr);
        });

        return map;
    }, [analysis]);

    const memoryMapStyle = useMemo<MemoryMapStyle>(() => ({
        '--memory-map-bank-width': `${MEMORY_MAP_DIMENSIONS.width}px`,
        '--memory-map-bank-height': `${MEMORY_MAP_DIMENSIONS.height}px`,
        '--memory-map-bank-padding': `${MEMORY_MAP_DIMENSIONS.padding}px`,
        '--memory-map-min-span-height': `${MEMORY_MAP_DIMENSIONS.minSpanHeight}px`,
    }), []);

    if (groups.length === 0) {
        return null;
    }

    return (
        <section className="summary-card memory-map-card" style={memoryMapStyle}>
            <div className="summary-header">
                <h2>Memory Map</h2>
                <div className="summary-meta">
                    {lastRunCompletedAt ? (
                        <span className="summary-updated">Based on {lastRunCompletedAt.toLocaleString()}</span>
                    ) : (
                        <span className="summary-updated">Awaiting first analysis</span>
                    )}
                </div>
            </div>
            <div className="memory-map-content">
                <div className="memory-map-groups">
                    {groups.map((group) => (
                        <div key={group.id} className="memory-map-group">
                            <div className="memory-map-group-header">
                                <h3>{group.name}</h3>
                            </div>
                            <div className="memory-map-banks">
                                {group.banks.map((bank) => (
                                    <MemoryMapBankVisualization
                                        key={bank.id}
                                        bankName={bank.name}
                                        columns={bank.columns}
                                        bankStart={bank.start}
                                        bankEnd={bank.end}
                                        symbolIndex={symbolIndex}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default MemoryMapCard;
