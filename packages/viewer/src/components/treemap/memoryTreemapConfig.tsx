import type { Analysis, Symbol as AnalyzerSymbol } from '@analyzer';
import SymbolValue from '../SymbolValue';
import { SizeValue } from '../SizeValue';
import { hashColor } from '../../utils/color';
import type {
    MemoryTreemapNodeKind,
    MemoryTreemapNodeMeta,
    TreemapLayoutNode,
    TreemapSymbolFilters,
} from '../../treemap';
import { buildMemoryTreemap } from '../../treemap';
import type { TreemapCardConfig, TreemapDetailRow } from './TreemapCardBase';

const formatNodeKindLabel = (meta: MemoryTreemapNodeMeta | undefined): string => {
    switch (meta?.nodeKind) {
        case 'root':
            return 'Target summary';
        case 'window':
            return 'Address window';
        case 'block':
            return 'Logical block';
        case 'section':
            return 'Section';
        case 'symbol':
            return 'Symbol';
        case 'unused':
            return 'Unused space';
        default:
            return 'Node';
    }
};

const getNodeColor = (node: TreemapLayoutNode<MemoryTreemapNodeKind, MemoryTreemapNodeMeta>) => {
    const meta = node.data.meta;
    if (!meta) {
        return { fill: '#e2e8f0', opacity: 1 };
    }

    switch (meta.nodeKind) {
        case 'root':
            return { fill: '#e2e8f0', opacity: 1 };
        case 'window':
            return { fill: hashColor(`window:${meta.windowId}`), opacity: 0.95 };
        case 'block':
            return { fill: hashColor(`block:${meta.blockId}`), opacity: 0.9 };
        case 'section':
            return { fill: hashColor(`section:${meta.sectionId}`), opacity: 0.85 };
        case 'symbol':
            return { fill: hashColor(`symbol:${meta.symbolId}`), opacity: 0.8 };
        case 'unused':
            return { fill: '#94a3b8', opacity: 0.7 };
        default:
            return { fill: '#cbd5e1', opacity: 0.9 };
    }
};

const buildDetailRows = (
    node: TreemapLayoutNode<MemoryTreemapNodeKind, MemoryTreemapNodeMeta>,
    symbolLookup: Map<string, AnalyzerSymbol>,
): TreemapDetailRow[] => {
    const meta = node.data.meta;
    if (!meta) {
        return [];
    }
    const rows: TreemapDetailRow[] = [];

    if (node.depth > 0) {
        rows.push({ label: 'Node ID', value: node.id });
    }

    if (!node.isLeaf && meta.nodeKind !== 'unused') {
        rows.push({ label: 'Children', value: (node.children?.length ?? 0).toLocaleString() });
    }

    if (meta.nodeKind === 'window' || meta.nodeKind === 'block' || meta.nodeKind === 'section') {
        rows.push({ label: 'Symbols', value: meta.symbolCount.toLocaleString() });
    }

    switch (meta.nodeKind) {
        case 'root':
            rows.push({ label: 'Target', value: meta.targetName });
            rows.push({ label: 'Target ID', value: meta.targetId });
            break;
        case 'window':
            rows.push({ label: 'Window ID', value: meta.windowId });
            if (meta.windowName && meta.windowName !== node.data.label) {
                rows.push({ label: 'Window name', value: meta.windowName });
            }
            if (meta.hardwareBankId) {
                rows.push({ label: 'Hardware bank', value: meta.hardwareBankName ?? meta.hardwareBankId });
            }
            break;
        case 'block':
            rows.push({ label: 'Block ID', value: meta.blockId });
            if (meta.blockName && meta.blockName !== node.data.label) {
                rows.push({ label: 'Block name', value: meta.blockName });
            }
            if (meta.windowId) {
                rows.push({ label: 'Window', value: meta.windowName ?? meta.windowId });
            }
            if (meta.hardwareBankId) {
                rows.push({ label: 'Hardware bank', value: meta.hardwareBankName ?? meta.hardwareBankId });
            }
            break;
        case 'section':
            rows.push({ label: 'Section ID', value: meta.sectionId });
            if (meta.sectionName && meta.sectionName !== node.data.label) {
                rows.push({ label: 'Section name', value: meta.sectionName });
            }
            if (meta.blockId) {
                rows.push({ label: 'Block', value: meta.blockName ?? meta.blockId });
            }
            if (meta.windowId) {
                rows.push({ label: 'Window', value: meta.windowName ?? meta.windowId });
            }
            if (meta.hardwareBankId) {
                rows.push({ label: 'Hardware bank', value: meta.hardwareBankName ?? meta.hardwareBankId });
            }
            break;
        case 'symbol': {
            const symbol = symbolLookup.get(meta.symbolId);
            rows.push({
                label: 'Symbol',
                value: <SymbolValue symbolId={meta.symbolId} symbol={symbol} />,
            });
            rows.push({ label: 'Kind', value: meta.symbolKind });
            if (meta.sectionId) {
                rows.push({ label: 'Section', value: meta.sectionName ?? meta.sectionId });
            }
            if (meta.blockId) {
                rows.push({ label: 'Block', value: meta.blockName ?? meta.blockId });
            }
            if (meta.windowId) {
                rows.push({ label: 'Window', value: meta.windowName ?? meta.windowId });
            }
            if (meta.hardwareBankId) {
                rows.push({ label: 'Hardware bank', value: meta.hardwareBankName ?? meta.hardwareBankId });
            }
            if (meta.mangledName) {
                rows.push({ label: 'Mangled name', value: meta.mangledName });
            }
            rows.push({ label: 'Declared size', value: <SizeValue value={meta.symbolSize} /> });
            break;
        }
        case 'unused':
            rows.push({ label: 'Window ID', value: meta.windowId });
            if (meta.windowName && meta.windowName !== meta.windowId) {
                rows.push({ label: 'Window name', value: meta.windowName });
            }
            rows.push({ label: 'Window capacity', value: <SizeValue value={meta.windowCapacity} /> });
            rows.push({ label: 'Used bytes', value: <SizeValue value={meta.usedBytes} /> });
            rows.push({ label: 'Unused bytes', value: <SizeValue value={meta.unusedBytes} /> });
            break;
        default:
            break;
    }

    return rows;
};

const getEmptyStateMessage = ({ analysis, hasFiltersApplied }: { analysis: Analysis | null; hasFiltersApplied: boolean }): string => {
    if (!analysis) {
        return 'Load an analysis to explore the symbol treemap.';
    }
    if (hasFiltersApplied) {
        return 'No symbols match the current filters.';
    }
    return 'No symbol data with positive size was found in this analysis.';
};

export const memoryTreemapConfig: TreemapCardConfig<MemoryTreemapNodeKind, MemoryTreemapNodeMeta> = {
    title: 'Memory Treemap',
    description:
        'Visualizes analyzed symbols grouped by memory window, logical block, and section. Area corresponds to the total bytes attributed to each group.',
    svgTitle: 'Symbol treemap',
    buildTreemap: (analysis: Analysis | null, filters?: TreemapSymbolFilters) => buildMemoryTreemap(analysis, filters),
    layoutOptions: {
        paddingInner: 3,
    },
    formatNodeKindLabel,
    buildDetailRows,
    getNodeColor,
    getEmptyStateMessage,
};
