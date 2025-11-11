import { useMemo } from 'react';
import type { Analysis, Summaries } from '@teensy-mem-explorer/analyzer';
import { hashColor } from '../utils/color';

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
    spans: MemoryMapSpan[];
}

export interface MemoryMapGroup {
    id: string;
    name: string;
    banks: MemoryMapBank[];
}

const GAP_COLOR = 'hsl(215 30% 88%)';
const FREE_COLOR = 'hsl(142 35% 78%)';

const buildSpansForWindow = (
    groupId: string,
    windowId: string,
    windowLabel: string,
    windowSummary: Summaries['byWindow'][number] | undefined,
    blockNameById: Map<string, string>,
    freeBytes: number,
): MemoryMapBank => {
    const placements = windowSummary?.placements ?? [];

    if (placements.length === 0) {
        const spans: MemoryMapSpan[] = [];
        if (freeBytes > 0) {
            spans.push({
                id: `${windowId}:free`,
                bankId: windowId,
                groupId,
                type: 'free',
                label: 'Free',
                start: 0,
                end: freeBytes,
                size: freeBytes,
                regionId: windowId,
                regionName: windowLabel,
                color: FREE_COLOR,
            });
        }

        const end = spans.length > 0 ? spans[0].end : 0;
        return {
            id: windowId,
            name: windowLabel,
            start: spans.length > 0 ? spans[0].start : 0,
            end,
            size: end,
            spans,
        } satisfies MemoryMapBank;
    }

    const sortedPlacements = placements
        .slice()
        .sort((a, b) => a.start - b.start || a.size - b.size);

    const spans: MemoryMapSpan[] = [];
    let cursor = sortedPlacements[0].start;
    const bankStart = cursor;
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
                color: GAP_COLOR,
            } satisfies MemoryMapSpan;
            spans.push(gapSpan);
            cursor = placement.start;
        }

        const placementEnd = placement.start + placement.size;
        const blockId = placement.blockId ?? placement.sectionId ?? `block-${index}`;
        const blockLabel =
            blockNameById.get(placement.blockId ?? '') ?? placement.blockId ?? placement.sectionId ?? `Section ${index + 1}`;
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
        spans.push(regionSpan);

        cursor = Math.max(cursor, placementEnd);
        bankEnd = Math.max(bankEnd, placementEnd);
    });

    if (freeBytes > 0) {
        const freeSpan: MemoryMapSpan = {
            id: `${windowId}:free`,
            bankId: windowId,
            groupId,
            type: 'free',
            label: 'Free',
            start: bankEnd,
            end: bankEnd + freeBytes,
            size: freeBytes,
            regionId: windowId,
            regionName: windowLabel,
            color: FREE_COLOR,
        } satisfies MemoryMapSpan;
        spans.push(freeSpan);
        bankEnd = freeSpan.end;
    }

    const sortedSpans = spans.sort((a, b) => a.start - b.start);
    const start = sortedSpans.length > 0 ? sortedSpans[0].start : bankStart;

    return {
        id: windowId,
        name: windowLabel,
        start,
        end: bankEnd,
        size: Math.max(bankEnd - start, 0),
        spans: sortedSpans,
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
        const windowSummaryById = new Map(summaries.byWindow.map((entry) => [entry.windowId, entry] as const));
        const hardwareBankSummaryById = new Map(
            summaries.hardwareBanks.map((entry) => [entry.hardwareBankId, entry] as const),
        );

        const spansById = new Map<string, MemoryMapSpan>();
        const groups: MemoryMapGroup[] = [];

        analysis.config.hardwareBanks.forEach((hardwareBank) => {
            const bankSummary = hardwareBankSummaryById.get(hardwareBank.id);
            const banks: MemoryMapBank[] = hardwareBank.windowIds.map((windowId, index, windowIds) => {
                const windowSummary = windowSummaryById.get(windowId);
                const windowLabel = windowLabelById.get(windowId) ?? windowId;
                const isLastWindow = index === windowIds.length - 1;
                const freeBytes = bankSummary && isLastWindow ? bankSummary.freeBytes : 0;
                const bank = buildSpansForWindow(
                    hardwareBank.id,
                    windowId,
                    windowLabel,
                    windowSummary,
                    blockNameById,
                    freeBytes,
                );

                bank.spans.forEach((span) => spansById.set(span.id, span));
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
