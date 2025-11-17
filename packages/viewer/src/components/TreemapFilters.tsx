import { useMemo, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import type { Analysis } from '@analyzer';
import {
    coerceBlockId,
    coerceSectionId,
    coerceWindowId,
    hasActiveFilters,
    resolveBlockLabel,
    resolveHardwareBankLabel,
    resolveSectionLabel,
    resolveWindowLabel,
    tokenizeSymbolQuery,
    type TreemapSymbolFilters,
    UNKNOWN_BLOCK_ID,
    UNKNOWN_HARDWARE_BANK_ID,
    UNKNOWN_SECTION_ID,
    UNKNOWN_WINDOW_ID,
} from '../treemap';

interface TreemapFiltersProps {
    analysis: Analysis | null;
    filters: TreemapSymbolFilters;
    onFiltersChange: Dispatch<SetStateAction<TreemapSymbolFilters>>;
}

interface FilterOption {
    id: string;
    label: string;
}

type FilterKey = 'hardwareBanks' | 'windows' | 'logicalBlocks' | 'sections';

interface FilterGroup {
    key: FilterKey;
    title: string;
    options: FilterOption[];
}

interface SymbolLocationStats {
    hardwareBanks: Set<string>;
    windows: Set<string>;
    logicalBlocks: Set<string>;
    sections: Set<string>;
}

const buildOptionList = (
    usedIds: Set<string>,
    knownItems: Array<{ id: string; name?: string | null }>,
    resolveLabel: (id: string, name?: string | null) => string,
): FilterOption[] => {
    const options: FilterOption[] = [];
    const added = new Set<string>();

    knownItems.forEach((item) => {
        options.push({ id: item.id, label: resolveLabel(item.id, item.name) });
        added.add(item.id);
    });

    usedIds.forEach((id) => {
        if (added.has(id)) {
            return;
        }
        options.push({ id, label: resolveLabel(id, undefined) });
        added.add(id);
    });

    options.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    return options;
};

const TreemapFilters = ({ analysis, filters, onFiltersChange }: TreemapFiltersProps): JSX.Element | null => {
    const filterState = filters ?? {};
    const symbolQueryValue = filterState.symbolQuery ?? '';

    const symbolStats = useMemo<SymbolLocationStats>(() => {
        if (!analysis) {
            return {
                hardwareBanks: new Set<string>(),
                windows: new Set<string>(),
                logicalBlocks: new Set<string>(),
                sections: new Set<string>(),
            } satisfies SymbolLocationStats;
        }

        const hardwareBankIdByWindowId = new Map<string, string>();
        analysis.config.hardwareBanks.forEach((bank) => {
            bank.windowIds.forEach((windowId) => {
                if (!hardwareBankIdByWindowId.has(windowId)) {
                    hardwareBankIdByWindowId.set(windowId, bank.id);
                }
            });
        });

        const stats: SymbolLocationStats = {
            hardwareBanks: new Set<string>(),
            windows: new Set<string>(),
            logicalBlocks: new Set<string>(),
            sections: new Set<string>(),
        };

        analysis.symbols.forEach((symbol) => {
            const size = Number(symbol.size);
            if (!Number.isFinite(size) || size <= 0) {
                return;
            }

            const primaryLocation = symbol.primaryLocation ?? symbol.locations?.[0] ?? null;
            const windowId = coerceWindowId(primaryLocation?.windowId ?? symbol.windowId);
            const blockId = coerceBlockId(primaryLocation?.blockId ?? symbol.blockId);
            const sectionId = coerceSectionId(symbol.sectionId);
            const hardwareBankId = hardwareBankIdByWindowId.get(windowId) ?? UNKNOWN_HARDWARE_BANK_ID;

            stats.hardwareBanks.add(hardwareBankId);
            stats.windows.add(windowId);
            stats.logicalBlocks.add(blockId);
            stats.sections.add(sectionId);
        });

        return stats;
    }, [analysis]);

    const hardwareBankOptions = useMemo<FilterOption[]>(() => {
        if (!analysis) {
            return [];
        }
        const known = analysis.config.hardwareBanks.map((bank) => ({ id: bank.id, name: bank.name }));
        return buildOptionList(symbolStats.hardwareBanks, known, resolveHardwareBankLabel);
    }, [analysis, symbolStats.hardwareBanks]);

    const windowOptions = useMemo<FilterOption[]>(() => {
        if (!analysis) {
            return [];
        }
        const known = analysis.config.addressWindows.map((window) => ({ id: window.id, name: window.name }));
        return buildOptionList(symbolStats.windows, known, resolveWindowLabel);
    }, [analysis, symbolStats.windows]);

    const blockOptions = useMemo<FilterOption[]>(() => {
        if (!analysis) {
            return [];
        }
        const known = analysis.config.logicalBlocks.map((block) => ({ id: block.id, name: block.name }));
        return buildOptionList(symbolStats.logicalBlocks, known, resolveBlockLabel);
    }, [analysis, symbolStats.logicalBlocks]);

    const sectionOptions = useMemo<FilterOption[]>(() => {
        if (!analysis) {
            return [];
        }
        const known = analysis.sections.map((section) => ({ id: section.id, name: section.name }));
        return buildOptionList(symbolStats.sections, known, resolveSectionLabel);
    }, [analysis, symbolStats.sections]);

    const groups = useMemo<FilterGroup[]>(() => {
        const result: FilterGroup[] = [];
        if (hardwareBankOptions.length > 0 || symbolStats.hardwareBanks.has(UNKNOWN_HARDWARE_BANK_ID)) {
            result.push({ key: 'hardwareBanks', title: 'Hardware banks', options: hardwareBankOptions });
        }
        if (windowOptions.length > 0 || symbolStats.windows.has(UNKNOWN_WINDOW_ID)) {
            result.push({ key: 'windows', title: 'Address windows', options: windowOptions });
        }
        if (blockOptions.length > 0 || symbolStats.logicalBlocks.has(UNKNOWN_BLOCK_ID)) {
            result.push({ key: 'logicalBlocks', title: 'Logical blocks', options: blockOptions });
        }
        if (sectionOptions.length > 0 || symbolStats.sections.has(UNKNOWN_SECTION_ID)) {
            result.push({ key: 'sections', title: 'Sections', options: sectionOptions });
        }
        return result;
    }, [hardwareBankOptions, windowOptions, blockOptions, sectionOptions, symbolStats]);

    const hasFiltersApplied = hasActiveFilters(filterState);

    const activeSummary = useMemo(() => {
        if (!hasFiltersApplied) {
            return null;
        }
        const parts: string[] = [];
        if (filterState.symbolQueryTokens && filterState.symbolQueryTokens.length > 0 && filterState.symbolQuery) {
            parts.push(`Symbol name contains: "${filterState.symbolQuery}"`);
        }
        groups.forEach((group) => {
            const activeSet = filterState[group.key];
            if (!activeSet || activeSet.size === 0) {
                return;
            }
            const labels = group.options
                .filter((option) => activeSet.has(option.id))
                .map((option) => option.label);
            if (labels.length > 0) {
                parts.push(`${group.title}: ${labels.join(', ')}`);
            }
        });
        return parts.length > 0 ? parts.join(' • ') : null;
    }, [filterState, groups, hasFiltersApplied]);

    if (!analysis) {
        return null;
    }

    const handleToggle = (key: FilterKey, optionId: string): void => {
        onFiltersChange((prev) => {
            const previousSet = prev[key];
            const nextSet = new Set<string>(previousSet ?? []);
            if (nextSet.has(optionId)) {
                nextSet.delete(optionId);
            } else {
                nextSet.add(optionId);
            }

            const next: TreemapSymbolFilters = { ...prev };
            if (nextSet.size === 0) {
                delete next[key];
            } else {
                next[key] = nextSet;
            }
            return next;
        });
    };

    const handleQueryChange = (event: ChangeEvent<HTMLInputElement>): void => {
        const { value } = event.target;
        onFiltersChange((prev) => {
            const tokens = tokenizeSymbolQuery(value);
            if (tokens.length === 0) {
                const { symbolQuery: _omitQuery, symbolQueryTokens: _omitTokens, ...rest } = prev;
                return rest;
            }
            return {
                ...prev,
                symbolQuery: value,
                symbolQueryTokens: tokens,
            } satisfies TreemapSymbolFilters;
        });
    };

    const handleReset = (): void => {
        onFiltersChange(() => ({}));
    };

    return (
        <section className="summary-card treemap-filters-card">
            <div className="summary-header">
                <h2>Treemap Filters</h2>
                {hasFiltersApplied ? (
                    <button type="button" className="treemap-filter-reset" onClick={handleReset}>
                        Clear filters
                    </button>
                ) : null}
            </div>
            <p className="summary-description">
                Toggle memory dimensions or search by name to focus the memory and scope treemaps on specific regions.
            </p>
            <div className="treemap-filter-query">
                <label className="treemap-filter-label" htmlFor="treemap-symbol-query">
                    Symbol name contains
                </label>
                <input
                    id="treemap-symbol-query"
                    className="treemap-filter-input"
                    type="text"
                    value={symbolQueryValue}
                    onChange={handleQueryChange}
                    placeholder="Filter symbols by name"
                    spellCheck={false}
                />
            </div>
            <div className="treemap-filter-groups">
                {groups.map((group) => (
                    <div key={group.key} className="treemap-filter-group">
                        <span className="treemap-filter-label">{group.title}</span>
                        <div className="treemap-filter-chips">
                            {group.options.map((option) => {
                                const isActive = Boolean(filterState[group.key]?.has(option.id));
                                return (
                                    <button
                                        key={option.id}
                                        type="button"
                                        className={`treemap-filter-chip${isActive ? ' treemap-filter-chip--active' : ''}`}
                                        aria-pressed={isActive}
                                        onClick={() => handleToggle(group.key, option.id)}
                                    >
                                        {option.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
            <p className={`treemap-filter-summary${hasFiltersApplied ? '' : ' treemap-filter-summary--muted'}`}>
                {hasFiltersApplied && activeSummary ? `Active filters: ${activeSummary}` : 'All symbols are currently included.'}
            </p>
        </section>
    );
};

export default TreemapFilters;
