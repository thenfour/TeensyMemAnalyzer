import type {
    AddressWindow,
    Analysis,
    LogicalBlock,
    Section,
    Symbol,
} from '@analyzer';
import type { TreemapNode, TreemapTree } from './types';

export type MemoryTreemapNodeKind = 'root' | 'window' | 'block' | 'section' | 'symbol' | 'unused';

export interface MemoryTreemapRootMeta {
    nodeKind: 'root';
    targetId: string;
    targetName: string;
}

export interface MemoryTreemapWindowMeta {
    nodeKind: 'window';
    windowId: string;
    windowName: string;
    addressWindow?: AddressWindow;
    symbolCount: number;
}

export interface MemoryTreemapBlockMeta {
    nodeKind: 'block';
    blockId: string;
    blockName: string;
    windowId: string;
    logicalBlock?: LogicalBlock;
    symbolCount: number;
}

export interface MemoryTreemapSectionMeta {
    nodeKind: 'section';
    sectionId: string;
    sectionName: string;
    windowId?: string;
    blockId?: string;
    section?: Section;
    symbolCount: number;
}

export interface MemoryTreemapSymbolMeta {
    nodeKind: 'symbol';
    symbolId: string;
    symbolName: string;
    symbolSize: number;
    symbolKind: Symbol['kind'];
    windowId?: string;
    blockId?: string;
    sectionId?: string;
    mangledName?: string;
}

export interface MemoryTreemapUnusedMeta {
    nodeKind: 'unused';
    windowId: string;
    windowName: string;
    windowCapacity: number;
    usedBytes: number;
    unusedBytes: number;
}

export type MemoryTreemapNodeMeta =
    | MemoryTreemapRootMeta
    | MemoryTreemapWindowMeta
    | MemoryTreemapBlockMeta
    | MemoryTreemapSectionMeta
    | MemoryTreemapSymbolMeta
    | MemoryTreemapUnusedMeta;

export type MemoryTreemapNode = TreemapNode<MemoryTreemapNodeKind, MemoryTreemapNodeMeta>;
export type MemoryTreemapTree = TreemapTree<MemoryTreemapNodeKind, MemoryTreemapNodeMeta>;

interface AccumulatorNode {
    id: string;
    label: string;
    kind: MemoryTreemapNodeKind;
    value: number;
    symbolCount: number;
    meta: Partial<MemoryTreemapNodeMeta>;
    children: Map<string, AccumulatorNode>;
}

const UNKNOWN_WINDOW_ID = '__unknown_window__';
const UNKNOWN_BLOCK_ID = '__unknown_block__';
const UNKNOWN_SECTION_ID = '__unknown_section__';

const NUMBER_FORMATTER = new Intl.NumberFormat();

const formatSymbolLabel = (symbol: Symbol): string => {
    if (symbol.name) {
        return symbol.name;
    }
    return `Symbol ${symbol.id}`;
};

const normalizeSize = (value: number | undefined): number => {
    if (!Number.isFinite(value)) {
        return 0;
    }
    const size = Number(value);
    return size > 0 ? size : 0;
};

const createAccumulator = (
    id: string,
    label: string,
    kind: MemoryTreemapNodeKind,
    meta: Partial<MemoryTreemapNodeMeta>,
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

const addNodeValue = (node: AccumulatorNode, size: number): void => {
    node.value += size;
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

const finalizeNode = (node: AccumulatorNode): MemoryTreemapNode => {
    const children = node.children.size > 0
        ? Array.from(node.children.values()).map(finalizeNode)
        : undefined;

    const baseMeta = node.meta;

    if (node.kind === 'window') {
        (baseMeta as MemoryTreemapWindowMeta).symbolCount = node.symbolCount;
    } else if (node.kind === 'block') {
        (baseMeta as MemoryTreemapBlockMeta).symbolCount = node.symbolCount;
    } else if (node.kind === 'section') {
        (baseMeta as MemoryTreemapSectionMeta).symbolCount = node.symbolCount;
    }

    return {
        id: node.id,
        label: node.label,
        kind: node.kind,
        value: node.value,
        meta: baseMeta as MemoryTreemapNodeMeta,
        children,
    } satisfies MemoryTreemapNode;
};

const describeUnknown = (label: string, count: number): string => {
    if (count === 0) {
        return label;
    }
    return `${label} (${NUMBER_FORMATTER.format(count)})`;
};

export const buildMemoryTreemap = (analysis: Analysis | null | undefined): MemoryTreemapTree | null => {
    if (!analysis) {
        return null;
    }

    const windowConfigById = new Map<string, AddressWindow>();
    analysis.config.addressWindows.forEach((window) => {
        windowConfigById.set(window.id, window);
    });

    const logicalBlockById = new Map<string, LogicalBlock>();
    analysis.config.logicalBlocks.forEach((block) => {
        logicalBlockById.set(block.id, block);
    });

    const sectionById = new Map<string, Section>();
    analysis.sections.forEach((section) => {
        sectionById.set(section.id, section);
    });

    const targetName = analysis.target?.name ?? 'Unknown target';
    const targetId = analysis.config.targetId ?? targetName;

    const root = createAccumulator(
        'memory-root',
        targetName ? `${targetName} memory usage` : 'Memory usage',
        'root',
        {
            nodeKind: 'root',
            targetId,
            targetName,
        },
    );

    analysis.symbols.forEach((symbol) => {
        const symbolSize = normalizeSize(symbol.size);
        if (symbolSize <= 0) {
            return;
        }

        const primaryLocation = symbol.primaryLocation ?? symbol.locations?.[0] ?? null;
        const windowId = primaryLocation?.windowId ?? symbol.windowId ?? UNKNOWN_WINDOW_ID;
        const blockId = primaryLocation?.blockId ?? symbol.blockId ?? UNKNOWN_BLOCK_ID;
        const sectionId = symbol.sectionId ?? UNKNOWN_SECTION_ID;

        const windowConfig = windowConfigById.get(windowId);
        const windowLabel = windowConfig?.name ?? (windowId === UNKNOWN_WINDOW_ID ? 'Unassigned window' : windowId);

        const windowNode = ensureChild(root, `window:${windowId}`, () => createAccumulator(
            `window:${windowId}`,
            windowLabel,
            'window',
            {
                nodeKind: 'window',
                windowId,
                windowName: windowLabel,
                addressWindow: windowConfig,
                symbolCount: 0,
            },
        ));
        incrementNode(root, symbolSize);
        incrementNode(windowNode, symbolSize);

        const blockConfig = blockId !== UNKNOWN_BLOCK_ID ? logicalBlockById.get(blockId) : undefined;
        const blockLabel = blockConfig?.name
            ?? (blockId === UNKNOWN_BLOCK_ID ? 'Unassigned block' : blockId);

        const blockNode = ensureChild(windowNode, `block:${blockId}`, () => createAccumulator(
            `block:${blockId}`,
            blockLabel,
            'block',
            {
                nodeKind: 'block',
                blockId,
                blockName: blockLabel,
                windowId,
                logicalBlock: blockConfig,
                symbolCount: 0,
            },
        ));
        incrementNode(blockNode, symbolSize);

        const sectionConfig = sectionId !== UNKNOWN_SECTION_ID ? sectionById.get(sectionId) : undefined;
        const sectionLabel = sectionConfig?.name
            ?? (sectionId === UNKNOWN_SECTION_ID ? 'Unassigned section' : sectionId);

        const sectionNode = ensureChild(blockNode, `section:${sectionId}`, () => createAccumulator(
            `section:${sectionId}`,
            sectionLabel,
            'section',
            {
                nodeKind: 'section',
                sectionId,
                sectionName: sectionLabel,
                blockId: blockId !== UNKNOWN_BLOCK_ID ? blockId : undefined,
                windowId: windowId !== UNKNOWN_WINDOW_ID ? windowId : undefined,
                section: sectionConfig,
                symbolCount: 0,
            },
        ));
        incrementNode(sectionNode, symbolSize);

        const symbolNode = ensureChild(sectionNode, `symbol:${symbol.id}`, () => {
            const label = formatSymbolLabel(symbol);
            return createAccumulator(
                `symbol:${symbol.id}`,
                label,
                'symbol',
                {
                    nodeKind: 'symbol',
                    symbolId: symbol.id,
                    symbolName: label,
                    symbolSize,
                    symbolKind: symbol.kind,
                    windowId: windowId !== UNKNOWN_WINDOW_ID ? windowId : undefined,
                    blockId: blockId !== UNKNOWN_BLOCK_ID ? blockId : undefined,
                    sectionId: sectionId !== UNKNOWN_SECTION_ID ? sectionId : undefined,
                    mangledName: symbol.nameMangled !== symbol.name ? symbol.nameMangled : undefined,
                },
            );
        });
        // Symbol nodes represent a single symbol; ensure the aggregate reflects its value directly.
        symbolNode.value = symbolSize;
        symbolNode.symbolCount = 1;
    });

    // analysis.config.addressWindows.forEach((window) => {
    //     const windowId = window.id;
    //     if (!windowId) {
    //         return;
    //     }

    //     const windowLabel = window.name ?? windowId;
    //     const windowNode = ensureChild(root, `window:${windowId}`, () => createAccumulator(
    //         `window:${windowId}`,
    //         windowLabel,
    //         'window',
    //         {
    //             nodeKind: 'window',
    //             windowId,
    //             windowName: windowLabel,
    //             addressWindow: window,
    //             symbolCount: 0,
    //         },
    //     ));

    //     const capacity = normalizeSize(window.sizeBytes);
    //     if (capacity <= 0) {
    //         return;
    //     }

    //     const usedBytes = windowNode.value;
    //     const unusedBytes = Math.max(capacity - usedBytes, 0);
    //     if (unusedBytes <= 0) {
    //         return;
    //     }

    //     const unusedNode = ensureChild(windowNode, 'unused', () => createAccumulator(
    //         `${windowNode.id}:unused`,
    //         'Unused space',
    //         'unused',
    //         {
    //             nodeKind: 'unused',
    //             windowId,
    //             windowName: windowLabel,
    //             windowCapacity: capacity,
    //             usedBytes,
    //             unusedBytes,
    //         },
    //     ));

    //     unusedNode.value = unusedBytes;
    //     unusedNode.symbolCount = 0;
    //     unusedNode.meta = {
    //         nodeKind: 'unused',
    //         windowId,
    //         windowName: windowLabel,
    //         windowCapacity: capacity,
    //         usedBytes,
    //         unusedBytes,
    //     } satisfies MemoryTreemapUnusedMeta;

    //     addNodeValue(windowNode, unusedBytes);
    //     addNodeValue(root, unusedBytes);
    // });

    if (root.children.size === 0) {
        root.label = describeUnknown('No symbol data available', 0);
    }

    return finalizeNode(root);
};
