import type { TreemapSymbolFilters } from './types';
import {
    GLOBAL_SCOPE_LABEL,
    UNKNOWN_BLOCK_ID,
    UNKNOWN_HARDWARE_BANK_ID,
    UNKNOWN_SECTION_ID,
    UNKNOWN_WINDOW_ID,
} from './constants';

type FilterSet = ReadonlySet<string> | undefined;

const includes = (set: FilterSet, value: string): boolean => {
    if (!set || set.size === 0) {
        return true;
    }
    return set.has(value);
};

export const tokenizeSymbolQuery = (input: string | null | undefined): string[] => {
    if (!input) {
        return [];
    }
    return input
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
};

const matchesSymbolQuery = (symbolName: string, tokens: string[]): boolean => {
    if (tokens.length === 0) {
        return true;
    }

    const haystack = symbolName.toLowerCase();
    let searchIndex = 0;

    for (const token of tokens) {
        const foundIndex = haystack.indexOf(token, searchIndex);
        if (foundIndex === -1) {
            return false;
        }
        searchIndex = foundIndex + token.length;
    }

    return true;
};

export interface SymbolFilterAttributes {
    hardwareBankId: string;
    windowId: string;
    blockId: string;
    sectionId: string;
}

export const symbolPassesFilters = (
    filters: TreemapSymbolFilters | undefined,
    attributes: SymbolFilterAttributes,
    symbolName?: string,
): boolean => {
    if (!filters) {
        return true;
    }

    if (!(
        includes(filters.hardwareBanks, attributes.hardwareBankId)
        && includes(filters.windows, attributes.windowId)
        && includes(filters.logicalBlocks, attributes.blockId)
        && includes(filters.sections, attributes.sectionId)
    )) {
        return false;
    }

    const tokens = filters.symbolQueryTokens ?? [];
    if (tokens.length === 0) {
        return true;
    }

    if (!symbolName) {
        return false;
    }

    return matchesSymbolQuery(symbolName, tokens);
};

export const coerceWindowId = (value: string | undefined | null): string => value ?? UNKNOWN_WINDOW_ID;

export const coerceBlockId = (value: string | undefined | null): string => value ?? UNKNOWN_BLOCK_ID;

export const coerceSectionId = (value: string | undefined | null): string => value ?? UNKNOWN_SECTION_ID;

export const resolveSymbolLabel = (symbolName: string | undefined, symbolId: string): string =>
    symbolName && symbolName.length > 0 ? symbolName : `Symbol ${symbolId}`;

export const resolveScopePath = (segments: string[]): string[] => (segments.length > 0 ? segments : [GLOBAL_SCOPE_LABEL]);

export const isUnknownWindowId = (value: string): boolean => value === UNKNOWN_WINDOW_ID;

export const isUnknownBlockId = (value: string): boolean => value === UNKNOWN_BLOCK_ID;

export const isUnknownSectionId = (value: string): boolean => value === UNKNOWN_SECTION_ID;

export const isUnknownHardwareBankId = (value: string): boolean => value === UNKNOWN_HARDWARE_BANK_ID;

export const resolveWindowLabel = (windowId: string, windowName?: string | null): string => {
    if (windowName && windowName.length > 0) {
        return windowName;
    }
    return isUnknownWindowId(windowId) ? 'Unassigned window' : windowId;
};

export const resolveBlockLabel = (blockId: string, blockName?: string | null): string => {
    if (blockName && blockName.length > 0) {
        return blockName;
    }
    return isUnknownBlockId(blockId) ? 'Unassigned block' : blockId;
};

export const resolveSectionLabel = (sectionId: string, sectionName?: string | null): string => {
    if (sectionName && sectionName.length > 0) {
        return sectionName;
    }
    return isUnknownSectionId(sectionId) ? 'Unassigned section' : sectionId;
};

export const resolveHardwareBankLabel = (hardwareBankId: string, hardwareBankName?: string | null): string => {
    if (hardwareBankName && hardwareBankName.length > 0) {
        return hardwareBankName;
    }
    return isUnknownHardwareBankId(hardwareBankId) ? 'Unassigned hardware bank' : hardwareBankId;
};

export const hasActiveFilters = (filters: TreemapSymbolFilters | undefined): boolean => {
    if (!filters) {
        return false;
    }

    return Boolean(filters.hardwareBanks?.size)
        || Boolean(filters.windows?.size)
        || Boolean(filters.logicalBlocks?.size)
        || Boolean(filters.sections?.size)
        || Boolean(filters.symbolQueryTokens?.length);
};

export { GLOBAL_SCOPE_LABEL, UNKNOWN_BLOCK_ID, UNKNOWN_HARDWARE_BANK_ID, UNKNOWN_SECTION_ID, UNKNOWN_WINDOW_ID };
