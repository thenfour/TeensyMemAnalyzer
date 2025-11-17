import type { Analysis, Symbol } from '@analyzer';
import type { TreemapNode, TreemapTree } from './types';

export type ScopeTreemapNodeKind = 'root' | 'scope' | 'symbol';

export interface ScopeTreemapRootMeta {
    nodeKind: 'root';
    targetId: string;
    targetName: string;
}

export interface ScopeTreemapScopeMeta {
    nodeKind: 'scope';
    segment: string;
    scopePath: string[];
    fullName: string;
    symbolCount: number;
}

export interface ScopeTreemapSymbolMeta {
    nodeKind: 'symbol';
    symbolId: string;
    symbolName: string;
    symbolSize: number;
    fullScope: string[];
    mangledName?: string;
}

export type ScopeTreemapNodeMeta = ScopeTreemapRootMeta | ScopeTreemapScopeMeta | ScopeTreemapSymbolMeta;
export type ScopeTreemapNode = TreemapNode<ScopeTreemapNodeKind, ScopeTreemapNodeMeta>;
export type ScopeTreemapTree = TreemapTree<ScopeTreemapNodeKind, ScopeTreemapNodeMeta>;

interface AccumulatorNode {
    id: string;
    label: string;
    kind: ScopeTreemapNodeKind;
    value: number;
    symbolCount: number;
    meta: Partial<ScopeTreemapNodeMeta>;
    children: Map<string, AccumulatorNode>;
}

const createAccumulator = (
    id: string,
    label: string,
    kind: ScopeTreemapNodeKind,
    meta: Partial<ScopeTreemapNodeMeta>,
): AccumulatorNode => ({
    id,
    label,
    kind,
    value: 0,
    symbolCount: 0,
    meta,
    children: new Map<string, AccumulatorNode>(),
});

const incrementNode = (node: AccumulatorNode, size: number): void => {
    node.value += size;
    node.symbolCount += 1;
};

const ensureChild = (
    parent: AccumulatorNode,
    childKey: string,
    factory: () => AccumulatorNode,
): AccumulatorNode => {
    let child = parent.children.get(childKey);
    if (!child) {
        child = factory();
        parent.children.set(childKey, child);
    }
    return child;
};

const finalizeNode = (node: AccumulatorNode): ScopeTreemapNode => {
    const children = node.children.size > 0
        ? Array.from(node.children.values()).map(finalizeNode)
        : undefined;

    const baseMeta = node.meta;
    if (node.kind === 'scope') {
        (baseMeta as ScopeTreemapScopeMeta).symbolCount = node.symbolCount;
    }

    return {
        id: node.id,
        label: node.label,
        kind: node.kind,
        value: node.value,
        meta: baseMeta as ScopeTreemapNodeMeta,
        children,
    } satisfies ScopeTreemapNode;
};

const normalizeScopeSegments = (symbol: Symbol): string[] => {
    if (symbol.logicalPath && symbol.logicalPath.length > 0) {
        return symbol.logicalPath.filter((segment) => segment.length > 0);
    }

    const name = symbol.name ?? symbol.nameMangled ?? symbol.id;
    return name
        .split('::')
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);
};

const SYMBOL_SIZE_GUARD = (size: number | undefined): number => {
    if (!Number.isFinite(size)) {
        return 0;
    }
    const asNumber = Number(size);
    return asNumber > 0 ? asNumber : 0;
};

const GLOBAL_SCOPE_LABEL = '(global namespace)';

export const buildScopeTreemap = (analysis: Analysis | null | undefined): ScopeTreemapTree | null => {
    if (!analysis) {
        return null;
    }

    const targetName = analysis.target?.name ?? 'Unknown target';
    const targetId = analysis.config.targetId ?? targetName;

    const root = createAccumulator(
        'scope-root',
        targetName ? `${targetName} symbol scopes` : 'Symbol scopes',
        'root',
        {
            nodeKind: 'root',
            targetId,
            targetName,
        },
    );

    analysis.symbols.forEach((symbol) => {
        const size = SYMBOL_SIZE_GUARD(symbol.size);
        if (size <= 0) {
            return;
        }

        const segments = normalizeScopeSegments(symbol);
        const scopeSegments = segments.length > 1 ? segments.slice(0, -1) : [];
        const symbolLabel = segments.length > 0 ? segments[segments.length - 1] : symbol.name ?? symbol.id;
        const path = scopeSegments.length > 0 ? scopeSegments : [GLOBAL_SCOPE_LABEL];

        let current = root;
        incrementNode(root, size);

        const accumulatedSegments: string[] = [];
        path.forEach((segment, index) => {
            accumulatedSegments.push(segment);
            const scopeId = `scope:${accumulatedSegments.join('::')}`;
            current = ensureChild(current, scopeId, () => createAccumulator(
                scopeId,
                segment,
                'scope',
                {
                    nodeKind: 'scope',
                    segment,
                    scopePath: [...accumulatedSegments],
                    fullName: accumulatedSegments.join('::'),
                    symbolCount: 0,
                },
            ));
            incrementNode(current, size);
        });

        const fullScope = [...path];
        const symbolNodeId = `symbol:${symbol.id}`;
        const symbolNode = ensureChild(current, symbolNodeId, () => createAccumulator(
            symbolNodeId,
            symbolLabel,
            'symbol',
            {
                nodeKind: 'symbol',
                symbolId: symbol.id,
                symbolName: symbolLabel,
                symbolSize: size,
                fullScope,
                mangledName: symbol.nameMangled !== symbol.name ? symbol.nameMangled : undefined,
            },
        ));
        symbolNode.value = size;
        symbolNode.symbolCount = 1;
    });

    if (root.children.size === 0) {
        return null;
    }

    return finalizeNode(root);
};
