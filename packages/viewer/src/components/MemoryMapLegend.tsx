import { hashColor } from '../utils/color';

const MEMORY_CATEGORIES = [
    { key: 'Code', label: 'Code sections' },
    { key: 'Fast Code', label: 'Fast code (ITCM)' },
    { key: 'Const Data', label: 'Const/Progmem' },
    { key: 'Init Data', label: 'Initialized data' },
    { key: 'BSS', label: 'Zero-init data' },
    { key: 'DMA', label: 'DMA sections' },
    { key: 'Other', label: 'Other allocated' },
];

const MemoryMapLegend = (): JSX.Element => (
    <div className="memory-map-legend">
        <div className="memory-map-legend-item">
            <span className="memory-map-color" style={{ backgroundColor: '#e2e8f0' }} />
            <span className="memory-map-legend-label">Free / unassigned</span>
        </div>
        <div className="memory-map-legend-item">
            <span className="memory-map-color" style={{ backgroundColor: 'hsl(43 93% 70%)' }} />
            <span className="memory-map-legend-label">Reserved</span>
        </div>
        {MEMORY_CATEGORIES.map((entry) => (
            <div className="memory-map-legend-item" key={entry.key}>
                <span className="memory-map-color" style={{ backgroundColor: hashColor(`occupied:${entry.key}`) }} />
                <span className="memory-map-legend-label">{entry.label}</span>
            </div>
        ))}
    </div>
);

export default MemoryMapLegend;
