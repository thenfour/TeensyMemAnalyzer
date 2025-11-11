import { useMemo } from 'react';
import type { Analysis, Summaries } from '@teensy-mem-explorer/analyzer';
import { hashColor } from '../utils/color';

export type MemoryMapAggregation = 'region' | 'category';

export type MemoryMapSpanType = 'occupied' | 'free';

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
    category?: string;
    categoryLabel?: string;
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

const buildSpansForWindow = (
    groupId: string,
    windowId: string,
    windowLabel: string,
    windowSummary: Summaries['byWindow'][number] | undefined,
    blockNameById: Map<string, string>,
): MemoryMapBank => {
    if (!windowSummary || windowSummary.placements.length === 0) {
        return {
            id: windowId,
            name: windowLabel,
            start: 0,
            end: 0,
            size: 0,
            spans: {
                region: [],
                category: [],
            },
        } satisfies MemoryMapBank;
    }

    const sortedPlacements = windowSummary.placements
        .slice()
        .sort((a, b) => a.start - b.start || a.size - b.size);

    const regionSpans: MemoryMapSpan[] = [];
    const categorySpans: MemoryMapSpan[] = [];

    let cursor = sortedPlacements[0].start;
    let bankStart = cursor;
    let bankEnd = cursor;

    sortedPlacements.forEach((placement, index) => {
        if (placement.start > cursor) {
            const gapSpan: MemoryMapSpan = {
                id: `${windowId}:gap:${index}`,
                bankId: windowId,
                groupId,
                type: 'free',
                label: 'Gap',
                start: cursor,
                end: placement.start,
                size: placement.start - cursor,
                regionId: windowId,
                regionName: windowLabel,
                color: 'hsl(215 30% 88%)',
            } satisfies MemoryMapSpan;
            regionSpans.push(gapSpan);
            cursor = placement.start;
        }

        const placementEnd = placement.start + placement.size;
        const blockId = placement.blockId ?? placement.sectionId ?? `block-${index}`;
        const blockLabel = blockNameById.get(placement.blockId ?? '') ?? placement.blockId ?? placement.sectionId ?? `Section ${index + 1}`;
        const regionSpan: MemoryMapSpan = {
            id: `${windowId}:placement:${index}`,
            bankId: windowId,
            groupId,
            type: 'occupied',
            label: blockLabel,
            start: placement.start,
            end: placementEnd,
            size: placement.size,
            regionId: windowId,
            regionName: windowLabel,
            category: placement.blockId,
            categoryLabel: placement.blockId ? blockLabel : undefined,
            color: hashColor(`block:${blockId}`),
        } satisfies MemoryMapSpan;
        regionSpans.push(regionSpan);

        const categoryLabel = placement.addressType === 'load' ? 'Load' : blockLabel;
        categorySpans.push({
            ...regionSpan,
            id: `${windowId}:category:${index}`,
            label: categoryLabel,
            color: hashColor(`category:${categoryLabel}`),
        });

        cursor = Math.max(cursor, placementEnd);
        bankEnd = Math.max(bankEnd, placementEnd);
    });

    const sortedRegionSpans = regionSpans.sort((a, b) => a.start - b.start);
    const sortedCategorySpans = categorySpans.sort((a, b) => a.start - b.start);

    return {
    id: windowId,
        name: windowLabel,
        start: bankStart,
        end: bankEnd,
        size: Math.max(bankEnd - bankStart, 0),
        spans: {
            region: sortedRegionSpans,
            category: sortedCategorySpans,
        },
    } satisfies MemoryMapBank;
};

export const useMemoryMapData = (
    analysis: Analysis | null,
    summaries: Summaries | null,
): {
    groups: MemoryMapGroup[];
    spansById: Map<string, MemoryMapSpan>;
} =>
    useMemo(() => {
        if (!analysis || !summaries) {
            return { groups: [], spansById: new Map() };
        }

        const windowLabelById = new Map(
            analysis.config.addressWindows.map((window) => [window.id, window.name ?? window.id] as const),
        );
        const blockNameById = new Map(
            analysis.config.logicalBlocks.map((block) => [block.id, block.name ?? block.id] as const),
        );
        const windowSummaryById = new Map(
            summaries.byWindow.map((entry) => [entry.windowId, entry] as const),
        );

        const spansById = new Map<string, MemoryMapSpan>();
        const groups: MemoryMapGroup[] = [];

        analysis.config.hardwareBanks.forEach((hardwareBank) => {
            const banks: MemoryMapBank[] = hardwareBank.windowIds.map((windowId) => {
                const windowSummary = windowSummaryById.get(windowId);
                const windowLabel = windowLabelById.get(windowId) ?? windowId;
                const bank = buildSpansForWindow(hardwareBank.id, windowId, windowLabel, windowSummary, blockNameById);

                bank.spans.region.forEach((span) => spansById.set(span.id, span));
                bank.spans.category.forEach((span) => spansById.set(span.id, span));

                return bank;
            });

            groups.push({
                id: hardwareBank.id,
                name: hardwareBank.name ?? hardwareBank.id,
                banks,
            });
        });

        return { groups, spansById };
    }, [analysis, summaries]);
