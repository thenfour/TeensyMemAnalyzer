import { useMemo } from 'react';
import type { Analysis, Summaries } from '@teensy-mem-explorer/analyzer';
import type { UsageBarData } from '../types/usage';
import { computeUsagePercent } from '../utils/usage';

interface UseRegionUsageParams {
    analysis: Analysis | null;
    summaries: Summaries | null;
    formatValue: (value: number | undefined) => string;
}

const buildHardwareBankUsage = (summaries: Summaries, formatValue: (value: number | undefined) => string): UsageBarData[] =>
    (summaries.hardwareBanks ?? []).map((bank) => {
        const descriptionParts: string[] = [];

        if (bank.description) {
            descriptionParts.push(bank.description);
        }

        const adjustments = bank.rounding.filter((entry) => entry.deltaBytes !== 0);
        if (adjustments.length > 0) {
            const formatted = adjustments
                .map(
                    (entry) =>
                        `${entry.logicalBlockIds.join(', ')} → ${formatValue(entry.adjustedBytes)} (${entry.mode} granule ${formatValue(entry.granuleBytes)})`,
                )
                .join('; ');
            descriptionParts.push(`Rounding: ${formatted}`);
        }

        return {
            id: bank.hardwareBankId,
            label: bank.name ?? bank.hardwareBankId,
            total: bank.capacityBytes,
            used: bank.adjustedUsedBytes,
            free: bank.freeBytes,
            percent: computeUsagePercent(bank.adjustedUsedBytes, bank.capacityBytes),
            description: descriptionParts.join(' • '),
        } satisfies UsageBarData;
    });

const buildWindowUsage = (
    analysis: Analysis,
    summaries: Summaries,
    formatValue: (value: number | undefined) => string,
): UsageBarData[] => {
    const windowConfigMap = new Map(analysis.config.addressWindows.map((window) => [window.id, window] as const));
    const categoryNameById = new Map(
        analysis.config.sectionCategories.map((category) => [category.id, category.name ?? category.id] as const),
    );

    return (summaries.byWindow ?? []).map((windowSummary) => {
        const config = windowConfigMap.get(windowSummary.windowId);
        const label = config?.name ?? windowSummary.windowId;
        const configuredSize = config?.sizeBytes;
        const spanBytes = windowSummary.spanBytes > 0 ? windowSummary.spanBytes : windowSummary.totalBytes;
        const totalCapacity = configuredSize ?? spanBytes ?? windowSummary.totalBytes;
        const free = totalCapacity !== undefined ? Math.max(totalCapacity - windowSummary.totalBytes, 0) : undefined;
        const percent = computeUsagePercent(windowSummary.totalBytes, totalCapacity);

        const descriptionParts: string[] = [];
        if (config?.description) {
            descriptionParts.push(config.description);
        }
        if (windowSummary.paddingBytes > 0) {
            descriptionParts.push(`Padding ${formatValue(windowSummary.paddingBytes)}`);
        }
        if (windowSummary.largestGapBytes > 0) {
            descriptionParts.push(`Largest gap ${formatValue(windowSummary.largestGapBytes)}`);
        }

        const topCategories = windowSummary.byCategory
            .filter((entry) => entry.bytes > 0)
            .sort((a, b) => b.bytes - a.bytes)
            .slice(0, 3)
            .map((entry) => `${categoryNameById.get(entry.categoryId) ?? entry.categoryId} (${formatValue(entry.bytes)})`);
        if (topCategories.length > 0) {
            descriptionParts.push(`Top categories: ${topCategories.join(', ')}`);
        }

        const placements = windowSummary.placements ?? [];
        const starts = placements.map((placement) => placement.start);
        const ends = placements.map((placement) => placement.start + placement.size);
        const rangeStart = starts.length > 0 ? Math.min(...starts) : undefined;
        const rangeEnd = ends.length > 0 ? Math.max(...ends) : undefined;

        const totalRange = (() => {
            if (config?.baseAddress !== undefined && totalCapacity !== undefined) {
                return {
                    start: config.baseAddress,
                    end: config.baseAddress + totalCapacity - 1,
                };
            }
            return undefined;
        })();

        const occupiedRange =
            rangeStart !== undefined && rangeEnd !== undefined
                ? {
                      start: rangeStart,
                      end: rangeEnd - 1,
                  }
                : undefined;

        return {
            id: windowSummary.windowId,
            label,
            total: totalCapacity,
            used: windowSummary.totalBytes,
            free,
            percent,
            description: descriptionParts.join(' • '),
            addressRange:
                totalRange || occupiedRange
                    ? {
                          total: totalRange ?? occupiedRange!,
                          occupied: occupiedRange,
                          regionId: windowSummary.windowId,
                          regionName: config?.name,
                          regionKind: 'window',
                          regionKindLabel: 'Address Window',
                      }
                    : undefined,
        } satisfies UsageBarData;
    });
};

export const useRegionUsage = ({ analysis, summaries, formatValue }: UseRegionUsageParams): {
    runtimeBanks: UsageBarData[];
    regions: UsageBarData[];
} =>
    useMemo(() => {
        if (!analysis || !summaries) {
            return { runtimeBanks: [], regions: [] };
        }

        const runtimeBanks = buildHardwareBankUsage(summaries, formatValue).sort((a, b) =>
            a.label.localeCompare(b.label),
        );
        const regions = buildWindowUsage(analysis, summaries, formatValue).sort((a, b) =>
            a.label.localeCompare(b.label),
        );

        return {
            runtimeBanks,
            regions,
        };
    }, [analysis, summaries, formatValue]);