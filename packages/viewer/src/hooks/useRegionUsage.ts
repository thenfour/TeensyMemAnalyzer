import { useMemo } from 'react';
import type {
    Analysis,
    Region,
    RegionKind,
    RegionSummary,
    RuntimeBankSummary,
    Section,
    Symbol,
} from '@teensy-mem-explorer/analyzer';
import type { UsageBarData } from '../types/usage';
import { computeUsagePercent } from '../utils/usage';

interface UseRegionUsageParams {
    analysis: Analysis | null;
    formatValue: (value: number | undefined) => string;
    includeRuntimeBanks?: boolean;
}

const humanizeRegionKind = (kind: RegionKind): string => {
    switch (kind) {
        case 'flash':
            return 'Flash';
        case 'code_ram':
            return 'Code RAM';
        case 'data_ram':
            return 'Data RAM';
        case 'dma_ram':
            return 'DMA RAM';
        case 'ext_ram':
            return 'External RAM';
        default:
            return 'Other';
    }
};

type RangeMap = Map<string, { min: number; max: number }>;

const updateRange = (rangeByRegion: RangeMap, regionId: string | undefined, start: number | undefined, size = 0): void => {
    if (!regionId || start === undefined || Number.isNaN(start)) {
        return;
    }

    const normalizedSize = size > 0 ? size : 0;
    const end = normalizedSize > 0 ? start + normalizedSize - 1 : start;
    const current = rangeByRegion.get(regionId);

    if (!current) {
        rangeByRegion.set(regionId, { min: start, max: end });
        return;
    }

    rangeByRegion.set(regionId, {
        min: Math.min(current.min, start),
        max: Math.max(current.max, end),
    });
};

const collectRangesFromSections = (rangeByRegion: RangeMap, sections: Section[]): void => {
    sections.forEach((section) => {
        updateRange(rangeByRegion, section.execRegionId, section.vmaStart, section.size);
        if (section.loadRegionId && section.lmaStart !== undefined) {
            updateRange(rangeByRegion, section.loadRegionId, section.lmaStart, section.size);
        }
    });
};

const collectRangesFromSymbols = (rangeByRegion: RangeMap, symbols: Symbol[]): void => {
    symbols.forEach((symbol) => {
        updateRange(rangeByRegion, symbol.regionId, symbol.addr, symbol.size);
    });
};

const buildRuntimeBankUsage = (
    banks: RuntimeBankSummary[],
    includeRuntimeBanks: boolean,
    formatValue: (value: number | undefined) => string,
): UsageBarData[] => {
    if (!includeRuntimeBanks || banks.length === 0) {
        return [];
    }

    return banks.map((bank) => {
        const total = bank.capacityBytes;
        const used = Math.max(total - bank.freeBytes, 0);
        const contributorDetails = bank.contributors
            .map((contributor) => `${contributor.regionName} (${formatValue(contributor.sizeBytes)})`)
            .join(', ');
        const descriptionParts: string[] = [];
        if (bank.description) {
            descriptionParts.push(bank.description);
        }
        if (contributorDetails) {
            descriptionParts.push(`Segments: ${contributorDetails}`);
        }

        return {
            id: `${bank.kind}:${bank.name}`,
            label: bank.name,
            total,
            used,
            free: bank.freeBytes,
            percent: computeUsagePercent(used, total),
            description: descriptionParts.join(' • '),
        } satisfies UsageBarData;
    });
};

const buildRegionUsage = (
    regions: Region[],
    regionSummaryMap: Map<string, RegionSummary>,
    rangeByRegion: RangeMap,
    formatValue: (value: number | undefined) => string,
): UsageBarData[] =>
    regions.map((region) => {
        const summary = regionSummaryMap.get(region.id);
        const size = summary?.size ?? region.size;
        const freeRaw =
            summary?.freeForDynamic !== undefined
                ? summary.freeForDynamic
                : summary
                    ? Math.max(size - summary.usedStatic - (summary.reserved ?? 0), 0)
                    : undefined;
        const free = freeRaw !== undefined ? Math.max(freeRaw, 0) : undefined;
        const used =
            free !== undefined
                ? Math.max(size - free, 0)
                : summary
                    ? Math.max(summary.usedStatic + (summary.reserved ?? 0), 0)
                    : undefined;

        const descriptionParts: string[] = [];
        if (region.name && region.name !== region.id) {
            descriptionParts.push(`${region.name} (${region.id})`);
        } else {
            descriptionParts.push(`Region ${region.id}`);
        }
        descriptionParts.push(`Kind: ${humanizeRegionKind(region.kind)}`);
        if (summary?.reserved) {
            descriptionParts.push(`Reserved ${formatValue(summary.reserved)}`);
        }

        const rangeEntry = rangeByRegion.get(region.id);

        const totalRangeStart = Number.isFinite(region.start) ? region.start : undefined;
        const totalRangeEnd =
            totalRangeStart !== undefined && size !== undefined && Number.isFinite(size)
                ? totalRangeStart + Math.max(size - 1, 0)
                : undefined;

        return {
            id: region.id,
            label: region.name ?? region.id,
            total: size,
            used,
            free,
            percent: computeUsagePercent(used, size),
            description: descriptionParts.join(' • '),
            addressRange:
                totalRangeStart !== undefined && totalRangeEnd !== undefined
                    ? {
                          total: {
                              start: totalRangeStart,
                              end: totalRangeEnd,
                          },
                          occupied:
                              rangeEntry !== undefined
                                  ? {
                                        start: rangeEntry.min,
                                        end: rangeEntry.max,
                                    }
                                  : undefined,
                          regionId: region.id,
                          regionName: region.name,
                          regionKind: region.kind,
                          regionKindLabel: humanizeRegionKind(region.kind),
                      }
                    : undefined,
        };
    });

export const useRegionUsage = ({ analysis, formatValue, includeRuntimeBanks = true }: UseRegionUsageParams): {
    runtimeBanks: UsageBarData[];
    regions: UsageBarData[];
} =>
    useMemo(() => {
        if (!analysis) {
            return { runtimeBanks: [], regions: [] };
        }

        const runtimeBanks = buildRuntimeBankUsage(
            analysis.summaries.runtimeBanks ?? [],
            includeRuntimeBanks,
            formatValue,
        );

        const byRegionSummaries = analysis.summaries.byRegion ?? [];
        const regionSummaryEntries: Array<[string, RegionSummary]> = byRegionSummaries.map(
            (summary: RegionSummary) => [summary.regionId, summary],
        );
        const regionSummaryMap = new Map<string, RegionSummary>(regionSummaryEntries);

        const rangeByRegion: RangeMap = new Map();
        collectRangesFromSections(rangeByRegion, analysis.sections);
        collectRangesFromSymbols(rangeByRegion, analysis.symbols);

        const regions = buildRegionUsage(analysis.regions, regionSummaryMap, rangeByRegion, formatValue);

        return {
            runtimeBanks,
            regions,
        };
    }, [analysis, formatValue, includeRuntimeBanks]);