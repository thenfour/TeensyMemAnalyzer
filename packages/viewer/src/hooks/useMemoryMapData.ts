import { useMemo } from 'react';
import type {
    Analysis,
    Region,
    RegionSummary,
    RuntimeBankSummary,
    RuntimeGroupSummary,
    Section,
    SectionCategory,
} from '@teensy-mem-explorer/analyzer';
import { hashColor } from '../utils/color';

export type MemoryMapAggregation = 'region' | 'category';

export type MemoryMapSpanType = 'occupied' | 'free' | 'reserved';

export interface MemoryMapSpan {
    id: string;
    bankId: string;
    groupId: string;
    type: MemoryMapSpanType;
    label: string;
    start: number;
    end: number;
    size: number;
    regionId?: string;
    regionName?: string;
    category?: SectionCategory;
    categoryLabel?: string;
    reservedName?: string;
    mergedPaddingBytes?: number;
    color: string;
}

export interface MemoryMapBank {
    id: string;
    name: string;
    start: number;
    end: number;
    size: number;
    spans: Record<MemoryMapAggregation, MemoryMapSpan[]>;
}

export interface MemoryMapGroup {
    id: string;
    name: string;
    banks: MemoryMapBank[];
}

interface RegionContext {
    region: Region;
    summary?: RegionSummary;
    sections: Section[];
}

interface OccupiedSlice {
    id: string;
    start: number;
    end: number;
    label: string;
    category?: SectionCategory;
    regionId: string;
    regionName?: string;
    mergedPaddingBytes: number;
}

const GAP_MERGE_THRESHOLD = 256; // bytes

const humanizeCategory = (category: SectionCategory): string => {
    switch (category) {
        case 'code':
            return 'Code';
        case 'code_fast':
            return 'Fast Code';
        case 'rodata':
            return 'Const Data';
        case 'data_init':
            return 'Init Data';
        case 'bss':
            return 'BSS';
        case 'dma':
            return 'DMA';
        case 'other':
        default:
            return 'Other';
    }
};

const clampSpan = (start: number, end: number, region: Region): { start: number; end: number } => {
    const regionStart = region.start;
    const regionEnd = region.start + region.size;
    return {
        start: Math.max(start, regionStart),
        end: Math.min(end, regionEnd),
    };
};

const buildCategorySlices = (region: Region, sections: Section[]): OccupiedSlice[] => {
    const allocSections = sections
        .filter((section) => section.execRegionId === region.id && section.flags.alloc && section.size > 0)
        .filter((section) => section.vmaStart !== undefined && Number.isFinite(section.vmaStart));

    if (allocSections.length === 0) {
        return [];
    }

    const sorted = [...allocSections].sort((a, b) => (a.vmaStart ?? 0) - (b.vmaStart ?? 0));

    const slices: OccupiedSlice[] = [];
    let current: OccupiedSlice | null = null;

    sorted.forEach((section, index) => {
        const start = section.vmaStart ?? region.start;
        const end = start + section.size;
        const category = section.category;
        const label = humanizeCategory(category);

        if (!current) {
            current = {
                id: `${region.id}:cat:${category}:${index}`,
                start,
                end,
                label,
                category,
                regionId: region.id,
                regionName: region.name,
                mergedPaddingBytes: 0,
            };
            return;
        }

        if (current.category === category) {
            const gap = start - current.end;
            if (gap <= GAP_MERGE_THRESHOLD) {
                if (gap > 0) {
                    current.mergedPaddingBytes += gap;
                }
                current.end = Math.max(current.end, end);
                return;
            }
        }

        slices.push(current);
        current = {
            id: `${region.id}:cat:${category}:${index}`,
            start,
            end,
            label,
            category,
            regionId: region.id,
            regionName: region.name,
            mergedPaddingBytes: 0,
        };
    });

    if (current) {
        slices.push(current);
    }

    return slices;
};

const buildRegionSlice = (
    region: Region,
    occupiedSlices: OccupiedSlice[],
    reservedSlices: OccupiedSlice[],
    groupId: string,
    bankId: string,
    aggregation: MemoryMapAggregation,
): MemoryMapSpan[] => {
    const regionStart = region.start;
    const regionEnd = region.start + region.size;
    const reservedIds = new Set(reservedSlices.map((slice) => slice.id));

    const slices = [...occupiedSlices, ...reservedSlices].map((slice) => {
        const { start, end } = clampSpan(slice.start, slice.end, region);
        return {
            ...slice,
            start,
            end,
        };
    });

    const sorted = slices.sort((a, b) => a.start - b.start);

    const spans: MemoryMapSpan[] = [];
    let cursor = regionStart;

    sorted.forEach((slice) => {
        if (slice.start > regionEnd) {
            return;
        }
        if (slice.end <= cursor) {
            return;
        }

        if (slice.start > cursor) {
            spans.push({
                id: `${bankId}:${region.id}:free:${aggregation}:${cursor}`,
                bankId,
                groupId,
                type: 'free',
                label: 'Free',
                start: cursor,
                end: slice.start,
                size: slice.start - cursor,
                regionId: region.id,
                regionName: region.name,
                color: 'hsl(215 30% 88%)',
            });
        }

        const sliceEnd = Math.min(slice.end, regionEnd);
    const sliceType = reservedIds.has(slice.id) ? 'reserved' : 'occupied';
    const label = slice.label;
    const colorKey = sliceType === 'reserved' ? `reserved:${slice.label}` : `occupied:${slice.label}`;

        spans.push({
            id: `${bankId}:${slice.id}:${aggregation}`,
            bankId,
            groupId,
            type: sliceType,
            label,
            start: slice.start,
            end: sliceEnd,
            size: sliceEnd - slice.start,
            regionId: slice.regionId,
            regionName: slice.regionName,
            category: slice.category,
            categoryLabel: slice.category ? humanizeCategory(slice.category) : undefined,
            reservedName: sliceType === 'reserved' ? slice.label : undefined,
            mergedPaddingBytes: slice.mergedPaddingBytes > 0 ? slice.mergedPaddingBytes : undefined,
            color: sliceType === 'reserved' ? 'hsl(43 93% 70%)' : hashColor(colorKey),
        });

        cursor = Math.max(cursor, sliceEnd);
    });

    if (cursor < regionEnd) {
        spans.push({
            id: `${bankId}:${region.id}:free:${aggregation}:${cursor}`,
            bankId,
            groupId,
            type: 'free',
            label: 'Free',
            start: cursor,
            end: regionEnd,
            size: regionEnd - cursor,
            regionId: region.id,
            regionName: region.name,
            color: 'hsl(215 30% 88%)',
        });
    }

    return spans;
};

const buildReservedSlices = (region: Region): OccupiedSlice[] => {
    if (!region.reserved || region.reserved.length === 0) {
        return [];
    }

    return region.reserved.map((entry, index) => ({
        id: `${region.id}:reserved:${index}`,
        start: entry.start,
        end: entry.start + entry.size,
        label: entry.name,
        regionId: region.id,
        regionName: region.name,
        mergedPaddingBytes: 0,
    }));
};

const buildRegionAggregation = (
    regionContext: RegionContext,
    groupId: string,
    bankId: string,
): MemoryMapSpan[] => {
    const { region, sections } = regionContext;
    const occupiedSlices = buildCategorySlices(region, sections);
    const reservedSlices = buildReservedSlices(region);

    if (occupiedSlices.length === 0 && reservedSlices.length === 0) {
        const regionStart = region.start;
        const regionEnd = region.start + region.size;
        return [
            {
                id: `${bankId}:${region.id}:free-all:region`,
                bankId,
                groupId,
                type: 'free',
                label: 'Free',
                start: regionStart,
                end: regionEnd,
                size: region.size,
                regionId: region.id,
                regionName: region.name,
                color: 'hsl(215 30% 88%)',
            },
        ];
    }

    return buildRegionSlice(region, occupiedSlices, reservedSlices, groupId, bankId, 'region');
};

const buildCategoryAggregation = (
    regionContext: RegionContext,
    groupId: string,
    bankId: string,
): MemoryMapSpan[] => {
    const { region, sections } = regionContext;
    const categorySlices = buildCategorySlices(region, sections);
    const reservedSlices = buildReservedSlices(region);

    const spans = buildRegionSlice(region, categorySlices, reservedSlices, groupId, bankId, 'category');

    return spans;
};

const collectSectionsByRegion = (sections: Section[]): Map<string, Section[]> => {
    const byRegion = new Map<string, Section[]>();
    sections.forEach((section) => {
        if (!section.execRegionId) {
            return;
        }
        const list = byRegion.get(section.execRegionId) ?? [];
        list.push(section);
        byRegion.set(section.execRegionId, list);
    });
    return byRegion;
};

const createRegionContext = (
    region: Region,
    regionSummaryMap: Map<string, RegionSummary>,
    sectionsByRegion: Map<string, Section[]>,
): RegionContext => ({
    region,
    summary: regionSummaryMap.get(region.id),
    sections: sectionsByRegion.get(region.id) ?? [],
});

const uniqueRegionIdsForBank = (bank: RuntimeBankSummary): string[] => {
    const ids = new Set<string>();
    bank.contributors.forEach((contributor) => {
        ids.add(contributor.regionId);
    });
    return Array.from(ids.values());
};

const sortRegions = (regions: Region[]): Region[] => [...regions].sort((a, b) => a.start - b.start);

export const useMemoryMapData = (analysis: Analysis | null): {
    groups: MemoryMapGroup[];
    spansById: Map<string, MemoryMapSpan>;
} =>
    useMemo(() => {
        if (!analysis) {
            return { groups: [], spansById: new Map() };
        }

        const regionSummaryEntries: Array<[string, RegionSummary]> = (analysis.summaries.byRegion ?? []).map(
            (summary) => [summary.regionId, summary],
        );
        const regionSummaryMap = new Map<string, RegionSummary>(regionSummaryEntries);

        const regionMap = new Map<string, Region>();
        analysis.regions.forEach((region) => {
            regionMap.set(region.id, region);
        });

        const sectionsByRegion = collectSectionsByRegion(analysis.sections ?? []);

        const bankSummaries = new Map<string, RuntimeBankSummary>();
        (analysis.summaries.runtimeBanks ?? []).forEach((bank) => {
            bankSummaries.set(bank.bankId, bank);
        });

        const spansById = new Map<string, MemoryMapSpan>();
        const groups: MemoryMapGroup[] = [];

    const runtimeGroups = (analysis.summaries.runtimeGroups ?? []).slice();
    runtimeGroups.sort((a, b) => a.name.localeCompare(b.name));

        runtimeGroups.forEach((group) => {
            const memberBanks = group.bankIds
                .map((bankId) => bankSummaries.get(bankId))
                .filter((value): value is RuntimeBankSummary => Boolean(value));

            if (memberBanks.length === 0) {
                return;
            }

            const banks: MemoryMapBank[] = memberBanks.map((bank) => {
                const regionIds = uniqueRegionIdsForBank(bank).filter((id) => regionMap.has(id));
                const regions = sortRegions(regionIds.map((id) => regionMap.get(id) as Region));

                if (regions.length === 0) {
                    return {
                        id: bank.bankId,
                        name: bank.name,
                        start: 0,
                        end: 0,
                        size: 0,
                        spans: {
                            region: [],
                            category: [],
                        },
                    };
                }

                const regionContexts = regions.map((region) =>
                    createRegionContext(region, regionSummaryMap, sectionsByRegion),
                );
                const start = Math.min(...regions.map((region) => region.start));
                const end = Math.max(...regions.map((region) => region.start + region.size));

                const regionSpans: MemoryMapSpan[] = [];
                const categorySpans: MemoryMapSpan[] = [];

                regionContexts.forEach((context) => {
                    const contextRegionSpans = buildRegionAggregation(context, group.groupId, bank.bankId);
                    const contextCategorySpans = buildCategoryAggregation(context, group.groupId, bank.bankId);

                    contextRegionSpans.forEach((span) => {
                        regionSpans.push(span);
                        spansById.set(span.id, span);
                    });
                    contextCategorySpans.forEach((span) => {
                        categorySpans.push(span);
                        spansById.set(span.id, span);
                    });
                });

                const sortedRegionSpans = [...regionSpans].sort((a, b) => a.start - b.start);
                const sortedCategorySpans = [...categorySpans].sort((a, b) => a.start - b.start);

                return {
                    id: bank.bankId,
                    name: bank.name,
                    start,
                    end,
                    size: end - start,
                    spans: {
                        region: sortedRegionSpans,
                        category: sortedCategorySpans,
                    },
                };
            });

            groups.push({
                id: group.groupId,
                name: group.name,
                banks,
            });
        });

        return { groups, spansById };
    }, [analysis]);
