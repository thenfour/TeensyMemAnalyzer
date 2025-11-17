import type {
    AddressWindow,
    Analysis,
    HardwareBank,
    LogicalBlock,
    Section,
    Symbol,
} from '@analyzer';
import type { TreemapNode, TreemapTree, TreemapSymbolFilters } from './types';
import {
    coerceBlockId,
    coerceSectionId,
    coerceWindowId,
    isUnknownBlockId,
    isUnknownHardwareBankId,
    isUnknownSectionId,
    isUnknownWindowId,
    resolveBlockLabel,
    resolveHardwareBankLabel,
    resolveScopePath,
    resolveSectionLabel,
    resolveSymbolLabel,
    resolveWindowLabel,
    symbolPassesFilters,
    UNKNOWN_HARDWARE_BANK_ID,
} from './filtering';

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
    windowId?: string;
    windowName?: string;
    blockId?: string;
    blockName?: string;
    sectionId?: string;
    sectionName?: string;
    hardwareBankId?: string;
    hardwareBankName?: string;
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

const splitQualifiedName = (input: string): string[] => {
    const segments: string[] = [];
    let current = '';
    let angleDepth = 0;
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;

    const flush = (): void => {
        const trimmed = current.trim();
        if (trimmed.length > 0) {
            segments.push(trimmed);
        }
        current = '';
    };

    for (let index = 0; index < input.length; index += 1) {
        const char = input[index];
        const next = index + 1 < input.length ? input[index + 1] : '';

        const isScopeSeparator = char === ':' && next === ':'
            && angleDepth === 0
            && parenDepth === 0
            && braceDepth === 0
            && bracketDepth === 0;

        if (isScopeSeparator) {
            flush();
            index += 1; // Skip the second ':'
            continue;
        }

        current += char;

        switch (char) {
            case '<':
                angleDepth += 1;
                break;
            case '>':
                if (angleDepth > 0) {
                    angleDepth -= 1;
                }
                break;
            case '(': {
                parenDepth += 1;
                break;
            }
            case ')':
                if (parenDepth > 0) {
                    parenDepth -= 1;
                }
                break;
            case '{':
                braceDepth += 1;
                break;
            case '}':
                if (braceDepth > 0) {
                    braceDepth -= 1;
                }
                break;
            case '[':
                bracketDepth += 1;
                break;
            case ']':
                if (bracketDepth > 0) {
                    bracketDepth -= 1;
                }
                break;
            default:
                break;
        }
    }

    flush();
    return segments;
};

const normalizeScopeSegments = (symbol: Symbol): string[] => {
    if (symbol.logicalPath && symbol.logicalPath.length > 0) {
        return symbol.logicalPath.filter((segment) => segment.length > 0);
    }

    const name = symbol.name ?? symbol.nameMangled ?? symbol.id;
    return splitQualifiedName(name);
};

const SYMBOL_SIZE_GUARD = (size: number | undefined): number => {
    if (!Number.isFinite(size)) {
        return 0;
    }
    const asNumber = Number(size);
    return asNumber > 0 ? asNumber : 0;
};

export const buildScopeTreemap = (
    analysis: Analysis | null | undefined,
    filters?: TreemapSymbolFilters,
): ScopeTreemapTree | null => {
    if (!analysis) {
        return null;
    }

    const targetName = analysis.target?.name ?? 'Unknown target';
    const targetId = analysis.config.targetId ?? targetName;

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

    const hardwareBankById = new Map<string, HardwareBank>();
    const hardwareBankIdByWindowId = new Map<string, string>();
    analysis.config.hardwareBanks.forEach((bank) => {
        hardwareBankById.set(bank.id, bank);
        bank.windowIds.forEach((windowId) => {
            if (!hardwareBankIdByWindowId.has(windowId)) {
                hardwareBankIdByWindowId.set(windowId, bank.id);
            }
        });
    });

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

        const primaryLocation = symbol.primaryLocation ?? symbol.locations?.[0] ?? null;
        const windowId = coerceWindowId(primaryLocation?.windowId ?? symbol.windowId);
        const blockId = coerceBlockId(primaryLocation?.blockId ?? symbol.blockId);
        const sectionId = coerceSectionId(symbol.sectionId);
        const hardwareBankId = hardwareBankIdByWindowId.get(windowId) ?? UNKNOWN_HARDWARE_BANK_ID;

        if (!symbolPassesFilters(filters, {
            hardwareBankId,
            windowId,
            blockId,
            sectionId,
        })) {
            return;
        }

        const windowConfig = windowConfigById.get(windowId);
        const windowLabel = resolveWindowLabel(windowId, windowConfig?.name);
        const blockConfig = !isUnknownBlockId(blockId) ? logicalBlockById.get(blockId) : undefined;
        const blockLabel = resolveBlockLabel(blockId, blockConfig?.name);
        const sectionConfig = !isUnknownSectionId(sectionId) ? sectionById.get(sectionId) : undefined;
        const sectionLabel = resolveSectionLabel(sectionId, sectionConfig?.name);
        const hardwareBank = isUnknownHardwareBankId(hardwareBankId) ? undefined : hardwareBankById.get(hardwareBankId);
        const hardwareBankLabel = !isUnknownHardwareBankId(hardwareBankId)
            ? resolveHardwareBankLabel(hardwareBankId, hardwareBank?.name)
            : undefined;

        const segments = normalizeScopeSegments(symbol);
        const scopeSegments = segments.length > 1 ? segments.slice(0, -1) : [];
        const symbolLabel = segments.length > 0 ? segments[segments.length - 1] : resolveSymbolLabel(symbol.name, symbol.id);
        const path = resolveScopePath(scopeSegments);

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
                windowId: isUnknownWindowId(windowId) ? undefined : windowId,
                windowName: isUnknownWindowId(windowId) ? undefined : windowLabel,
                blockId: isUnknownBlockId(blockId) ? undefined : blockId,
                blockName: isUnknownBlockId(blockId) ? undefined : blockLabel,
                sectionId: isUnknownSectionId(sectionId) ? undefined : sectionId,
                sectionName: isUnknownSectionId(sectionId) ? undefined : sectionLabel,
                hardwareBankId: isUnknownHardwareBankId(hardwareBankId) ? undefined : hardwareBankId,
                hardwareBankName: hardwareBankLabel,
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
