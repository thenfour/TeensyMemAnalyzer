import type { Analysis, Symbol as AnalyzerSymbol } from '@analyzer';
import SymbolValue from '../SymbolValue';
import { SizeValue } from '../SizeValue';
import { hashColor } from '../../utils/color';
import type {
    ScopeTreemapNodeKind,
    ScopeTreemapNodeMeta,
    TreemapLayoutNode,
    TreemapSymbolFilters,
} from '../../treemap';
import { buildScopeTreemap } from '../../treemap';
import type { TreemapCardConfig, TreemapDetailRow } from './TreemapCardBase';

const formatNodeKindLabel = (meta: ScopeTreemapNodeMeta | undefined): string => {
    switch (meta?.nodeKind) {
        case 'root':
            return 'Target summary';
        case 'scope':
            return 'Scope';
        case 'symbol':
            return 'Symbol';
        default:
            return 'Node';
    }
};

const getNodeColor = (node: TreemapLayoutNode<ScopeTreemapNodeKind, ScopeTreemapNodeMeta>) => {
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
    node: TreemapLayoutNode<ScopeTreemapNodeKind, ScopeTreemapNodeMeta>,
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

const getEmptyStateMessage = ({ analysis, hasFiltersApplied }: { analysis: Analysis | null; hasFiltersApplied: boolean }): string => {
    if (!analysis) {
        return 'Load an analysis to explore symbol scopes.';
    }
    if (hasFiltersApplied) {
        return 'No symbols match the current filters.';
    }
    return 'No symbols with size information are available to build the scope treemap.';
};

export const scopeTreemapConfig: TreemapCardConfig<ScopeTreemapNodeKind, ScopeTreemapNodeMeta> = {
    title: 'Scope Treemap',
    description:
        'Groups symbol sizes by C++ namespaces, classes, and function scopes. Use this view to locate large contributions within your code structure.',
    svgTitle: 'Symbol scope treemap',
    buildTreemap: (analysis: Analysis | null, filters?: TreemapSymbolFilters) => buildScopeTreemap(analysis, filters),
    layoutOptions: {
        paddingInner: 2,
    },
    formatNodeKindLabel,
    buildDetailRows,
    getNodeColor,
    getEmptyStateMessage,
};
