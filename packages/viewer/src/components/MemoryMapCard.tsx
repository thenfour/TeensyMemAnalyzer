import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Analysis, Summaries } from '@teensy-mem-explorer/analyzer';
import { SizeValue } from './SizeValue';
import AddressValue from './AddressValue';
import { useMemoryMapData, type MemoryMapSpan } from '../hooks/useMemoryMapData';
import { computeMemoryMapSpanLayout } from '../utils/memoryMapLayout';

interface MemoryMapCardProps {
    analysis: Analysis | null;
    summaries: Summaries | null;
    lastRunCompletedAt: Date | null;
}

interface MemoryMapBankVisualizationProps {
    bankName: string;
    spans: MemoryMapSpan[];
    bankStart: number;
    bankEnd: number;
    selectedSpanId: string | null;
    onSelectSpan: (spanId: string) => void;
}

const MEMORY_MAP_DIMENSIONS = {
    width: 280,
    height: 900,
    padding: 0,
    minSpanHeight: 12,
};

type MemoryMapStyle = CSSProperties & {
    '--memory-map-bank-width': string;
    '--memory-map-bank-height': string;
    '--memory-map-bank-padding': string;
    '--memory-map-min-span-height': string;
};

const MemoryMapBankVisualization = ({
    bankName,
    spans,
    bankStart,
    bankEnd,
    selectedSpanId,
    onSelectSpan,
}: MemoryMapBankVisualizationProps): JSX.Element => {
    const { width, height, padding, minSpanHeight } = MEMORY_MAP_DIMENSIONS;

    const layouts = useMemo(
        () =>
            computeMemoryMapSpanLayout(spans, {
                bankStart,
                bankEnd,
                totalHeight: height,
                padding,
                minSpanHeight,
            }),
        [spans, bankStart, bankEnd, height, padding, minSpanHeight],
    );

    const trackWidth = Math.max(40, width * 0.46);
    const trackX = (width - trackWidth) / 2;
    const trackHeight = height - padding;
    const spanWidth = Math.max(32, trackWidth - 4);
    const spanX = (width - spanWidth) / 2;

    return (
        <div className="memory-map-bank">
            <div className="memory-map-bank-header">
                <span className="memory-map-bank-name">{bankName}</span>
            </div>
            <svg className="memory-map-svg" viewBox={`0 0 ${width} ${height}`} role="presentation">
                <rect
                    className="memory-map-track"
                    x={trackX}
                    y={padding / 2}
                    width={trackWidth}
                    height={trackHeight}
                    rx={10}
                    fill="#f8fafc"
                    stroke="#cbd5e1"
                    strokeWidth={1}
                />
                {layouts.map(({ span, y, height: spanHeight }) => {
                    if (spanHeight <= 0) {
                        return null;
                    }

                    const isSelected = selectedSpanId === span.id;
                    const textY = y + spanHeight / 2 + 4;
                    const fontSize = Math.min(12, Math.max(10, spanHeight / 4 + 8));

                    return (
                        <g
                            key={span.id}
                            className="memory-map-span"
                            onClick={() => onSelectSpan(span.id)}
                        >
                            <rect
                                className="memory-map-span-rect"
                                x={spanX}
                                y={y}
                                width={spanWidth}
                                height={Math.max(spanHeight, 0)}
                                rx={6}
                                fill={span.color}
                                stroke={isSelected ? '#2563eb' : '#0f172a33'}
                                strokeWidth={isSelected ? 2 : 1}
                            />
                            <text
                                x={width / 2}
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
            </svg>
        </div>
    );
};

const MemoryMapCard = ({ analysis, summaries, lastRunCompletedAt }: MemoryMapCardProps): JSX.Element | null => {
    const { groups, spansById } = useMemoryMapData(analysis, summaries);
    console.log(groups);
    const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

    const memoryMapStyle = useMemo<MemoryMapStyle>(() => ({
        '--memory-map-bank-width': `${MEMORY_MAP_DIMENSIONS.width}px`,
        '--memory-map-bank-height': `${MEMORY_MAP_DIMENSIONS.height}px`,
        '--memory-map-bank-padding': `${MEMORY_MAP_DIMENSIONS.padding}px`,
        '--memory-map-min-span-height': `${MEMORY_MAP_DIMENSIONS.minSpanHeight}px`,
    }), []);

    const selectedSpan = selectedSpanId ? spansById.get(selectedSpanId) ?? null : null;

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
                                        spans={bank.spans}
                                        bankStart={bank.start}
                                        bankEnd={bank.end}
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
                            {selectedSpan.blockNames ? (
                                <div>
                                    <dt>Blocks</dt>
                                    <dd>{selectedSpan.blockNames.join(', ')}</dd>
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
                                <dd>{selectedSpan.type === 'occupied' ? 'Occupied' : 'Free'}</dd>
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
