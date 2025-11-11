import { useMemo, useState } from 'react';
import type { Analysis } from '@teensy-mem-explorer/analyzer';
import { SizeValue } from './SizeValue';
import AddressValue from './AddressValue';
import { useMemoryMapData, type MemoryMapAggregation, type MemoryMapSpan } from '../hooks/useMemoryMapData';
import MemoryMapLegend from './MemoryMapLegend';

interface MemoryMapCardProps {
    analysis: Analysis | null;
    lastRunCompletedAt: Date | null;
}

interface MemoryMapBankVisualizationProps {
    bankName: string;
    spans: MemoryMapSpan[];
    bankStart: number;
    bankEnd: number;
    aggregation: MemoryMapAggregation;
    selectedSpanId: string | null;
    onSelectSpan: (spanId: string) => void;
}

const BANK_HEIGHT = 500;
const BANK_WIDTH = 140;
const BANK_PADDING = 18;
const MIN_SPAN_HEIGHT = 8;

const MemoryMapBankVisualization = ({
    bankName,
    spans,
    bankStart,
    bankEnd,
    aggregation,
    selectedSpanId,
    onSelectSpan,
}: MemoryMapBankVisualizationProps): JSX.Element => {
    const usableHeight = BANK_HEIGHT - BANK_PADDING * 2;
    const extent = bankEnd - bankStart;
    const scale = extent > 0 ? usableHeight / extent : 1;

    const sortedSpans = useMemo(() => [...spans].sort((a, b) => a.start - b.start), [spans]);

    return (
        <div className="memory-map-bank">
            <div className="memory-map-bank-header">
                <span className="memory-map-bank-name">{bankName}</span>
            </div>
            <svg className="memory-map-svg" viewBox={`0 0 ${BANK_WIDTH} ${BANK_HEIGHT}`} role="presentation">
                <rect
                    x={BANK_WIDTH / 2 - 32}
                    y={BANK_PADDING / 2}
                    width={64}
                    height={BANK_HEIGHT - BANK_PADDING}
                    rx={10}
                    fill="#f8fafc"
                    stroke="#cbd5e1"
                    strokeWidth={1}
                />
                {sortedSpans.map((span) => {
                    const offsetEnd = span.end - bankStart;
                    const rawHeight = Math.max((span.size || 0) * scale, MIN_SPAN_HEIGHT);
                    const rawY = BANK_PADDING + (extent > 0 ? (extent - offsetEnd) * scale : 0);
                    const clampedY = Math.min(Math.max(rawY, BANK_PADDING), BANK_HEIGHT - BANK_PADDING);
                    const bottom = Math.min(clampedY + rawHeight, BANK_HEIGHT - BANK_PADDING);
                    const height = Math.max(rawHeight, MIN_SPAN_HEIGHT);
                    let y = bottom - height;
                    if (y < BANK_PADDING) {
                        y = BANK_PADDING;
                    }
                    let effectiveHeight = height;
                    if (y + effectiveHeight > BANK_HEIGHT - BANK_PADDING) {
                        effectiveHeight = BANK_HEIGHT - BANK_PADDING - y;
                    }

                    const isSelected = selectedSpanId === span.id;
                    const textY = y + effectiveHeight / 2 + 4;
                    const fontSize = Math.min(12, Math.max(10, effectiveHeight / 4 + 8));

                    return (
                        <g
                            key={`${span.id}:${aggregation}`}
                            className="memory-map-span"
                            onClick={() => onSelectSpan(span.id)}
                        >
                            <rect
                                x={BANK_WIDTH / 2 - 30}
                                y={y}
                                width={60}
                                height={Math.max(effectiveHeight, 0)}
                                rx={6}
                                fill={span.type === 'free' ? '#e2e8f0' : span.color}
                                stroke={isSelected ? '#2563eb' : '#0f172a33'}
                                strokeWidth={isSelected ? 2 : 1}
                            />
                            {effectiveHeight >= 14 ? (
                                <text
                                    x={BANK_WIDTH / 2}
                                    y={textY}
                                    textAnchor="middle"
                                    fontSize={fontSize}
                                    fill="#0f172a"
                                    pointerEvents="none"
                                >
                                    {span.label}
                                </text>
                            ) : null}
                        </g>
                    );
                })}
            </svg>
        </div>
    );
};

const MemoryMapCard = ({ analysis, lastRunCompletedAt }: MemoryMapCardProps): JSX.Element | null => {
    const { groups, spansById } = useMemoryMapData(analysis);
    const [aggregation, setAggregation] = useState<MemoryMapAggregation>('region');
    const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

    const selectedSpan = selectedSpanId ? spansById.get(selectedSpanId) ?? null : null;

    if (groups.length === 0) {
        return null;
    }

    const handleToggle = (mode: MemoryMapAggregation): void => {
        setAggregation(mode);
        setSelectedSpanId(null);
    };

    return (
        <section className="summary-card memory-map-card">
            <div className="summary-header">
                <h2>Memory Map</h2>
                <div className="summary-meta">
                    <div className="memory-map-toggle" role="group" aria-label="Aggregation mode">
                        <button
                            type="button"
                            className={aggregation === 'region' ? 'active' : ''}
                            onClick={() => handleToggle('region')}
                        >
                            Region view
                        </button>
                        <button
                            type="button"
                            className={aggregation === 'category' ? 'active' : ''}
                            onClick={() => handleToggle('category')}
                        >
                            Category view
                        </button>
                    </div>
                    {lastRunCompletedAt ? (
                        <span className="summary-updated">Based on {lastRunCompletedAt.toLocaleString()}</span>
                    ) : (
                        <span className="summary-updated">Awaiting first analysis</span>
                    )}
                </div>
            </div>
            <div className="memory-map-content">
                <div className="memory-map-groups">
                    <MemoryMapLegend />
                    {groups.map((group) => (
                        <div key={group.id} className="memory-map-group">
                            <div className="memory-map-group-header">
                                <h3>{group.name}</h3>
                            </div>
                            <div className="memory-map-banks">
                                {group.banks.map((bank) => (
                                    <MemoryMapBankVisualization
                                        key={`${bank.id}:${aggregation}`}
                                        bankName={bank.name}
                                        spans={bank.spans[aggregation]}
                                        bankStart={bank.start}
                                        bankEnd={bank.end}
                                        aggregation={aggregation}
                                        selectedSpanId={selectedSpanId}
                                        onSelectSpan={setSelectedSpanId}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
                <aside className="memory-map-details">
                    <h3>Selection details</h3>
                    {selectedSpan ? (
                        <dl>
                            <div>
                                <dt>Label</dt>
                                <dd>{selectedSpan.label}</dd>
                            </div>
                            {selectedSpan.regionName ? (
                                <div>
                                    <dt>Region</dt>
                                    <dd>{selectedSpan.regionName}</dd>
                                </div>
                            ) : null}
                            {selectedSpan.category ? (
                                <div>
                                    <dt>Category</dt>
                                    <dd>{selectedSpan.categoryLabel ?? selectedSpan.category}</dd>
                                </div>
                            ) : null}
                            <div>
                                <dt>Size</dt>
                                <dd>
                                    <SizeValue value={selectedSpan.size} />
                                </dd>
                            </div>
                            <div>
                                <dt>Start</dt>
                                <dd>
                                    <AddressValue value={selectedSpan.start} />
                                </dd>
                            </div>
                            <div>
                                <dt>End</dt>
                                <dd>
                                    <AddressValue value={selectedSpan.end} />
                                </dd>
                            </div>
                            <div>
                                <dt>Type</dt>
                                <dd>
                                    {selectedSpan.type === 'occupied'
                                        ? 'Occupied'
                                        : selectedSpan.type === 'reserved'
                                            ? 'Reserved'
                                            : 'Free'}
                                </dd>
                            </div>
                        </dl>
                    ) : (
                        <p>Select a span to inspect its address range and size.</p>
                    )}
                </aside>
            </div>
        </section>
    );
};

export default MemoryMapCard;
