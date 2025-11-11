import { useMemo } from 'react';
import type { Analysis, Summaries } from '@teensy-mem-explorer/analyzer';
import { hashColor } from '../utils/color';

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
    color: string;
    blockIds?: string[];
    blockNames?: string[];
    reservationId?: string;
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

const FREE_COLOR = 'hsl(215 30% 88%)';
const RESERVED_COLOR = "#f80";//'hsl(24 92% 82%)';

export const useMemoryMapData = (
    analysis: Analysis | null,
    summaries: Summaries | null,
): {
    groups: MemoryMapGroup[];
    spansById: Map<string, MemoryMapSpan>;
} =>
    useMemo(() => {
        if (!summaries) {
            return { groups: [], spansById: new Map() };
        }

        const windowLabelById = new Map(
            analysis?.config.addressWindows.map((window) => [window.id, window.name ?? window.id] as const) ?? [],
        );
        const blockNameById = new Map(
            analysis?.config.logicalBlocks.map((block) => [block.id, block.name ?? block.id] as const) ?? [],
        );

        const spansById = new Map<string, MemoryMapSpan>();
        const groups: MemoryMapGroup[] = summaries.hardwareBanks.map((bankSummary) => {
            const bankId = bankSummary.hardwareBankId;
            const bankLabel = bankSummary.name ?? bankId;

            const spans: MemoryMapSpan[] = bankSummary.layout.spans.map((span) => {
                let color: string;
                if (span.kind === 'free') {
                    color = FREE_COLOR;
                } else if (span.kind === 'reserved') {
                    color = RESERVED_COLOR;
                } else {
                    color = hashColor(`bank:${bankId}:${span.windowId ?? span.id}`);
                }

                const regionName = span.windowId ? windowLabelById.get(span.windowId) : undefined;
                const blockIds = span.blockIds ?? [];
                const blockNames = blockIds.map((blockId) => blockNameById.get(blockId) ?? blockId);
                const memorySpan: MemoryMapSpan = {
                    id: `${bankId}:${span.id}`,
                    bankId,
                    groupId: bankId,
                    type: span.kind,
                    label: span.label,
                    start: span.startOffset,
                    end: span.endOffset,
                    size: span.sizeBytes,
                    regionId: span.windowId,
                    regionName,
                    color,
                    blockIds: blockIds.length > 0 ? blockIds : undefined,
                    blockNames: blockNames.length > 0 ? blockNames : undefined,
                    reservationId: span.reservationId,
                } satisfies MemoryMapSpan;

                spansById.set(memorySpan.id, memorySpan);
                return memorySpan;
            });

            const bank: MemoryMapBank = {
                id: bankId,
                name: bankLabel,
                start: 0,
                end: bankSummary.layout.totalBytes,
                size: bankSummary.layout.totalBytes,
                spans,
            } satisfies MemoryMapBank;

            return {
                id: bankId,
                name: bankLabel,
                banks: [bank],
            } satisfies MemoryMapGroup;
        });

        return { groups, spansById };
    }, [analysis, summaries]);
