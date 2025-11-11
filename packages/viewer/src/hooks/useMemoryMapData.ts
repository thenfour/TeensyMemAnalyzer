import { useMemo } from 'react';
import type { Analysis, Summaries } from '@teensy-mem-explorer/analyzer';
import { hashColor } from '../utils/color';

export type MemoryMapSpanType = 'occupied' | 'free' | 'reserved' | 'block' | 'padding';
export type MemoryMapColumn = 'bank' | 'block';

export interface MemoryMapSpan {
    id: string;
    bankId: string;
    groupId: string;
    column: MemoryMapColumn;
    type: MemoryMapSpanType;
    label: string;
    start: number;
    end: number;
    size: number;
    startAddress?: number;
    endAddress?: number;
    regionId?: string;
    regionName?: string;
    color: string;
    blockIds?: string[];
    blockNames?: string[];
    blockId?: string;
    blockName?: string;
    sectionIds?: string[];
    reservationId?: string;
    parentSpanId?: string;
}

export interface MemoryMapColumnData {
    id: string;
    label: string;
    spans: MemoryMapSpan[];
}

export interface MemoryMapBank {
    id: string;
    name: string;
    start: number;
    end: number;
    size: number;
    columns: MemoryMapColumnData[];
}

export interface MemoryMapGroup {
    id: string;
    name: string;
    banks: MemoryMapBank[];
}

const FREE_COLOR = 'hsl(215 30% 88%)';
const RESERVED_COLOR = 'hsl(24 92% 82%)';
const PADDING_COLOR = 'hsl(200 16% 85%)';

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

            const bankSpans: MemoryMapSpan[] = bankSummary.layout.spans.map((span) => {
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
                const spanId = span.id;
                const memorySpan: MemoryMapSpan = {
                    id: spanId,
                    bankId,
                    groupId: bankId,
                    column: 'bank',
                    type: span.kind,
                    label: span.label,
                    start: span.startOffset,
                    end: span.endOffset,
                    size: span.sizeBytes,
                    startAddress: span.startAddress,
                    endAddress: span.endAddress,
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

            const blockSpans: MemoryMapSpan[] = bankSummary.blockLayout.spans.map((span) => {
                let color: string;
                switch (span.kind) {
                    case 'free':
                        color = FREE_COLOR;
                        break;
                    case 'reserved':
                        color = RESERVED_COLOR;
                        break;
                    case 'padding':
                        color = PADDING_COLOR;
                        break;
                    case 'block':
                    default:
                        color = hashColor(`block:${bankId}:${span.blockId ?? span.id}`);
                        break;
                }

                const regionName = span.windowId ? windowLabelById.get(span.windowId) : undefined;
                const blockName = span.blockId ? blockNameById.get(span.blockId) ?? span.blockId : undefined;
                const memorySpan: MemoryMapSpan = {
                    id: span.id,
                    bankId,
                    groupId: bankId,
                    column: 'block',
                    type: span.kind === 'block' ? 'block' : span.kind,
                    label: span.label,
                    start: span.startOffset,
                    end: span.endOffset,
                    size: span.sizeBytes,
                    startAddress: span.startAddress,
                    endAddress: span.endAddress,
                    regionId: span.windowId,
                    regionName,
                    color,
                    blockId: span.blockId,
                    blockName,
                    sectionIds: span.sectionIds,
                    reservationId: span.reservationId,
                    parentSpanId: span.parentSpanId,
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
                columns: [
                    {
                        id: `${bankId}:bank` as const,
                        label: 'Usage',
                        spans: bankSpans,
                    },
                    ...(blockSpans.length > 0
                        ? ([
                              {
                                  id: `${bankId}:blocks` as const,
                                  label: 'Blocks',
                                  spans: blockSpans,
                              },
                          ] as MemoryMapColumnData[])
                        : []),
                ],
            } satisfies MemoryMapBank;

            return {
                id: bankId,
                name: bankLabel,
                banks: [bank],
            } satisfies MemoryMapGroup;
        });

        return { groups, spansById };
    }, [analysis, summaries]);
