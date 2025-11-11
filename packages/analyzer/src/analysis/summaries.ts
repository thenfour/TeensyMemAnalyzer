import {
  AddressUsageKind,
  AddressWindowReservation,
  Analysis,
  HardwareBankSummary,
  Summaries,
  TagUsageSummary,
  WindowSummary,
} from '../model';

import {
  HardwareBankWindowBreakdown,
  HardwareBankBlockBreakdown,
  HardwareBankRoundingDetail,
  WindowCategoryBreakdown,
  WindowBlockBreakdown,
  WindowSectionPlacement,
} from '../model';

interface WindowAccumulator {
  total: number;
  roleMap: Map<AddressUsageKind, number>;
  categoryMap: Map<string, number>;
  blockMap: Map<string, number>;
  placements: WindowSectionPlacement[];
}

interface AssignmentRecord {
  sectionId: string;
  categoryId: string;
  blockId: string;
  windowId: string;
  addressType: AddressUsageKind;
  address: number;
  size: number;
  reportTags: string[];
}

const ensureWindowAccumulator = (map: Map<string, WindowAccumulator>, windowId: string): WindowAccumulator => {
  const existing = map.get(windowId);
  if (existing) {
    return existing;
  }
  const created: WindowAccumulator = {
    total: 0,
    roleMap: new Map(),
    categoryMap: new Map(),
    blockMap: new Map(),
    placements: [],
  };
  map.set(windowId, created);
  return created;
};

const accumulateMap = (map: Map<string, number>, key: string, delta: number): void => {
  map.set(key, (map.get(key) ?? 0) + delta);
};

const accumulateRole = (map: Map<AddressUsageKind, number>, role: AddressUsageKind, delta: number): void => {
  map.set(role, (map.get(role) ?? 0) + delta);
};

const applyRounding = (value: number, granuleBytes: number, mode: string): number => {
  if (granuleBytes <= 0 || value <= 0) {
    return value;
  }

  const factor = value / granuleBytes;
  switch (mode) {
    case 'ceil':
      return Math.ceil(factor) * granuleBytes;
    case 'floor':
      return Math.floor(factor) * granuleBytes;
    case 'nearest':
      return Math.round(factor) * granuleBytes;
    default:
      return value;
  }
};

const computeWindowSpan = (placements: WindowSectionPlacement[]): { span: number; padding: number; largestGap: number } => {
  if (placements.length === 0) {
    return { span: 0, padding: 0, largestGap: 0 };
  }

  const sorted = placements
    .slice()
    .sort((a, b) => a.start - b.start || a.size - b.size);

  let currentStart = sorted[0].start;
  let currentEnd = sorted[0].start + sorted[0].size;
  let totalSize = sorted[0].size;
  let largestGap = 0;

  for (let index = 1; index < sorted.length; index += 1) {
    const placement = sorted[index];
    const start = placement.start;
    const end = placement.start + placement.size;

    totalSize += placement.size;

    if (start > currentEnd) {
      const gap = start - currentEnd;
      if (gap > largestGap) {
        largestGap = gap;
      }
      currentEnd = end;
      continue;
    }

    if (end > currentEnd) {
      currentEnd = end;
    }
  }

  const span = currentEnd - currentStart;
  const padding = span > totalSize ? span - totalSize : 0;
  return {
    span,
    padding,
    largestGap,
  };
};

const buildWindowSummaries = (
  analysis: Analysis,
  windowAccumulators: Map<string, WindowAccumulator>,
): WindowSummary[] =>
  analysis.config.addressWindows.map((window) => {
    const accumulator = windowAccumulators.get(window.id);
    if (!accumulator) {
      return {
        windowId: window.id,
        totalBytes: 0,
        byRole: [],
        byCategory: [],
        byBlock: [],
        spanBytes: 0,
        paddingBytes: 0,
        largestGapBytes: 0,
        placements: [],
      };
    }

    const { span, padding, largestGap } = computeWindowSpan(accumulator.placements);

    const byRole = Array.from(accumulator.roleMap.entries())
      .filter(([, bytes]) => bytes > 0)
      .map(([addressType, bytes]) => ({ addressType, bytes }));

    const byCategory: WindowCategoryBreakdown[] = Array.from(accumulator.categoryMap.entries())
      .filter(([, bytes]) => bytes > 0)
      .map(([categoryId, bytes]) => ({ categoryId, bytes }));

    const byBlock: WindowBlockBreakdown[] = Array.from(accumulator.blockMap.entries())
      .filter(([, bytes]) => bytes > 0)
      .map(([blockId, bytes]) => ({ blockId, bytes }));

    const placements = accumulator.placements
      .slice()
      .sort((a, b) => a.start - b.start || a.size - b.size);

    return {
      windowId: window.id,
      totalBytes: accumulator.total,
      byRole,
      byCategory,
      byBlock,
      spanBytes: span,
      paddingBytes: padding,
      largestGapBytes: largestGap,
      placements,
    };
  });

const buildHardwareBankSummaries = (
  analysis: Analysis,
  assignmentRecords: AssignmentRecord[],
): HardwareBankSummary[] => {
  const reservationsByWindow = new Map<string, AddressWindowReservation[]>(
    analysis.config.addressWindows.map((window) => [window.id, window.reservations ?? []]),
  );

  return analysis.config.hardwareBanks.map((bank) => {
    const windowSet = new Set(bank.windowIds);
    const relevantAssignments = assignmentRecords.filter((record) => windowSet.has(record.windowId));

    const rawUsedBytes = relevantAssignments.reduce((total, record) => total + record.size, 0);

    const windowBreakdownMap = new Map<string, number>();
    relevantAssignments.forEach((record) => accumulateMap(windowBreakdownMap, record.windowId, record.size));

    const blockBreakdownMap = new Map<string, number>();
    relevantAssignments.forEach((record) => accumulateMap(blockBreakdownMap, record.blockId, record.size));

    const roundingDetails: HardwareBankRoundingDetail[] = [];
    let adjustedUsedBytes = rawUsedBytes;
    const windowRoundingAdjustments = new Map<string, number>();
    const blockToWindow = new Map(analysis.config.logicalBlocks.map((block) => [block.id, block.windowId] as const));

    (bank.roundingRules ?? []).forEach((rule) => {
      const rawBytes = rule.logicalBlockIds.reduce((total, blockId) => total + (blockBreakdownMap.get(blockId) ?? 0), 0);
      const adjustedBytes = applyRounding(rawBytes, rule.granuleBytes, rule.mode);
      const deltaBytes = adjustedBytes - rawBytes;
      adjustedUsedBytes += deltaBytes;

      if (deltaBytes !== 0) {
        const targetWindows = new Set<string>();
        rule.logicalBlockIds.forEach((blockId) => {
          const windowId = blockToWindow.get(blockId);
          if (windowId) {
            targetWindows.add(windowId);
          }
        });

        if (targetWindows.size > 0) {
          const share = deltaBytes / targetWindows.size;
          targetWindows.forEach((windowId) => {
            windowRoundingAdjustments.set(windowId, (windowRoundingAdjustments.get(windowId) ?? 0) + share);
          });
        }
      }

      roundingDetails.push({
        logicalBlockIds: [...rule.logicalBlockIds],
        granuleBytes: rule.granuleBytes,
        mode: rule.mode,
        rawBytes,
        adjustedBytes,
        deltaBytes,
      });
    });

    const bankReservations = bank.windowIds.flatMap((windowId) =>
      (reservationsByWindow.get(windowId) ?? []).map((reservation) => ({ ...reservation, windowId })),
    );

    const totalReservedBytes = bankReservations.reduce((total, reservation) => total + reservation.sizeBytes, 0);
    const earliestReservationOffset = bankReservations.reduce(
      (min, reservation) => Math.min(min, reservation.startOffset),
      bank.capacityBytes,
    );

    const freeCapacity = Math.max(bank.capacityBytes - adjustedUsedBytes - totalReservedBytes, 0);

    const windowBreakdown: HardwareBankWindowBreakdown[] = Array.from(windowBreakdownMap.entries()).map(
      ([windowId, bytes]) => ({ windowId, bytes }),
    );

    const blockBreakdown: HardwareBankBlockBreakdown[] = Array.from(blockBreakdownMap.entries()).map(
      ([blockId, bytes]) => ({ blockId, bytes }),
    );

    const windowUsage = new Map<string, number>();
    windowBreakdown.forEach(({ windowId, bytes }) => {
      windowUsage.set(windowId, bytes);
    });
    windowRoundingAdjustments.forEach((delta, windowId) => {
      windowUsage.set(windowId, (windowUsage.get(windowId) ?? 0) + delta);
    });

    const assignmentsByWindow = new Map<string, AssignmentRecord[]>();
    relevantAssignments.forEach((record) => {
      const entries = assignmentsByWindow.get(record.windowId);
      if (entries) {
        entries.push(record);
      } else {
        assignmentsByWindow.set(record.windowId, [record]);
      }
    });

    const blocksByWindow = new Map<string, string[]>();
    const blockNameById = new Map(
      analysis.config.logicalBlocks.map((block) => [block.id, block.name ?? block.id] as const),
    );
    analysis.config.logicalBlocks.forEach((block) => {
      const existing = blocksByWindow.get(block.windowId);
      if (existing) {
        existing.push(block.id);
      } else {
        blocksByWindow.set(block.windowId, [block.id]);
      }
    });

    const layoutSpans = [] as HardwareBankSummary['layout']['spans'];
    const blockLayoutSpans = [] as HardwareBankSummary['blockLayout']['spans'];

  let cursor = 0;
  let blockSpanCounter = 0;
  let lastWindowEndAddress: number | undefined;

  const windowMetaById = new Map(analysis.config.addressWindows.map((window) => [window.id, window] as const));
  const windowAddressAnchors = new Map<string, { startOffset: number; startAddress?: number }>();

    bank.windowIds.forEach((windowId) => {
      const allocatedBytes = windowUsage.get(windowId) ?? 0;
      const startOffset = cursor;
      if (allocatedBytes <= 0) {
        const windowMeta = windowMetaById.get(windowId);
        windowAddressAnchors.set(windowId, {
          startOffset,
          startAddress: windowMeta?.baseAddress,
        });
        return;
      }

      const windowMeta = windowMetaById.get(windowId);
      const label = windowMeta?.name ?? windowId;
      const endOffset = startOffset + allocatedBytes;
      const windowSpanId = `${bank.id}:${windowId}`;

      const assignments = (assignmentsByWindow.get(windowId) ?? [])
        .slice()
        .sort((a, b) => a.address - b.address || a.size - b.size);

      const firstAssignment = assignments[0];
      const lastAssignment = assignments.length > 0 ? assignments[assignments.length - 1] : undefined;
      const lastAssignmentEndAddress = lastAssignment ? lastAssignment.address + lastAssignment.size : undefined;

      let windowStartAddress = windowMeta?.baseAddress ?? firstAssignment?.address;
      if (windowStartAddress !== undefined && Number.isFinite(windowStartAddress)) {
        windowStartAddress = Math.trunc(windowStartAddress);
      }

      windowAddressAnchors.set(windowId, { startOffset, startAddress: windowStartAddress });

      let windowEndAddress: number | undefined = windowStartAddress !== undefined ? windowStartAddress + allocatedBytes : undefined;
      if (windowEndAddress === undefined) {
        windowEndAddress = lastAssignmentEndAddress;
      } else if (lastAssignmentEndAddress !== undefined) {
        windowEndAddress = Math.max(windowEndAddress, lastAssignmentEndAddress);
      }

      const offsetToAddress = (absoluteOffset: number): number | undefined => {
        if (windowStartAddress === undefined) {
          return undefined;
        }
        return windowStartAddress + (absoluteOffset - startOffset);
      };

      const windowEndAddressFromOffset = offsetToAddress(endOffset);
      if (windowEndAddressFromOffset !== undefined) {
        windowEndAddress = windowEndAddress === undefined ? windowEndAddressFromOffset : Math.max(windowEndAddress, windowEndAddressFromOffset);
      }

      const windowLayoutSpan: HardwareBankSummary['layout']['spans'][number] = {
        id: windowSpanId,
        label,
        kind: 'occupied',
        sizeBytes: allocatedBytes,
        startOffset,
        endOffset,
        startAddress: windowStartAddress,
        endAddress: windowEndAddress,
        windowId,
        blockIds: blocksByWindow.get(windowId),
      } satisfies HardwareBankSummary['layout']['spans'][number];
      layoutSpans.push(windowLayoutSpan);

      let windowCursor = startOffset;
      let currentSpan: HardwareBankSummary['blockLayout']['spans'][number] | null = null;
      let windowLastKnownAddress = firstAssignment?.address;

      assignments.forEach((assignment) => {
        const spanSize = Math.max(assignment.size, 0);
        if (spanSize === 0) {
          return;
        }

        const spanStart = windowCursor;
        const spanEnd = spanStart + spanSize;
        const spanStartAddress = assignment.address;
        const spanEndAddress = assignment.address + spanSize;

        if (currentSpan && currentSpan.blockId === assignment.blockId) {
          currentSpan.sizeBytes += spanSize;
          currentSpan.endOffset = spanEnd;
          if (assignment.sectionId) {
            (currentSpan.sectionIds ??= []).push(assignment.sectionId);
          }
          if (spanEndAddress > (currentSpan.endAddress ?? Number.NEGATIVE_INFINITY)) {
            currentSpan.endAddress = spanEndAddress;
          }
        } else {
          currentSpan = {
            id: `${windowSpanId}:block:${blockSpanCounter}`,
            label: blockNameById.get(assignment.blockId) ?? assignment.blockId,
            kind: 'block',
            sizeBytes: spanSize,
            startOffset: spanStart,
            endOffset: spanEnd,
            startAddress: spanStartAddress,
            endAddress: spanEndAddress,
            windowId,
            blockId: assignment.blockId,
            parentSpanId: windowSpanId,
            sectionIds: assignment.sectionId ? [assignment.sectionId] : undefined,
          } satisfies HardwareBankSummary['blockLayout']['spans'][number];
          blockLayoutSpans.push(currentSpan);
          blockSpanCounter += 1;
        }

        windowCursor = spanEnd;
        windowLastKnownAddress = spanEndAddress;
      });

      if (windowCursor < endOffset) {
        const paddingSize = endOffset - windowCursor;
        blockLayoutSpans.push({
          id: `${windowSpanId}:padding:${blockSpanCounter}`,
          label: 'Rounding adjustment',
          kind: 'padding',
          sizeBytes: paddingSize,
          startOffset: windowCursor,
          endOffset,
          startAddress: (() => {
            const derived = offsetToAddress(windowCursor);
            if (derived !== undefined) {
              return derived;
            }
            return windowLastKnownAddress;
          })(),
          endAddress: (() => {
            const derivedStart = offsetToAddress(windowCursor);
            if (derivedStart !== undefined) {
              return derivedStart + paddingSize;
            }
            if (windowLastKnownAddress !== undefined) {
              return windowLastKnownAddress + paddingSize;
            }
            return undefined;
          })(),
          windowId,
          parentSpanId: windowSpanId,
        });
        blockSpanCounter += 1;
        windowCursor = endOffset;
        const derivedEndAddress = offsetToAddress(endOffset);
        if (derivedEndAddress !== undefined) {
          windowLastKnownAddress = derivedEndAddress;
        } else if (windowLastKnownAddress !== undefined) {
          windowLastKnownAddress += paddingSize;
        }
      }

      cursor = endOffset;
      currentSpan = null;
      if (windowLastKnownAddress !== undefined) {
        windowEndAddress = windowEndAddress === undefined ? windowLastKnownAddress : Math.max(windowEndAddress, windowLastKnownAddress);
        windowLayoutSpan.endAddress = windowEndAddress;
      }
      if (windowLayoutSpan.endAddress !== undefined) {
        lastWindowEndAddress = windowLayoutSpan.endAddress;
      }
    });

    const occupiedTotal = cursor;

    const reservationBoundary = Math.min(earliestReservationOffset, bank.capacityBytes);
    const potentialFreeBytes = Math.max(reservationBoundary - occupiedTotal, 0);
    const freeSpanBytes = Math.min(freeCapacity, potentialFreeBytes);

    if (freeSpanBytes > 0) {
      const startOffset = cursor;
      const endOffset = startOffset + freeSpanBytes;
      const freeSpanId = `${bank.id}:free`;
      const freeSpanStartAddress = lastWindowEndAddress;
      const freeSpanEndAddress = freeSpanStartAddress !== undefined ? freeSpanStartAddress + freeSpanBytes : undefined;

      layoutSpans.push({
        id: freeSpanId,
        label: 'Free',
        kind: 'free',
        sizeBytes: freeSpanBytes,
        startOffset,
        endOffset,
        startAddress: freeSpanStartAddress,
        endAddress: freeSpanEndAddress,
      });

      blockLayoutSpans.push({
        id: `${freeSpanId}:detail`,
        label: 'Free',
        kind: 'free',
        sizeBytes: freeSpanBytes,
        startOffset,
        endOffset,
        startAddress: freeSpanStartAddress,
        endAddress: freeSpanEndAddress,
        parentSpanId: freeSpanId,
      });
      blockSpanCounter += 1;
      cursor = endOffset;
      lastWindowEndAddress = freeSpanEndAddress;
    }

    let reservedCursor = cursor;
    const sortedReservations = bankReservations
      .slice()
      .sort((a, b) => a.startOffset - b.startOffset);

    sortedReservations.forEach((reservation, index) => {
      const reservationStart = Math.max(reservation.startOffset, reservedCursor);
      const reservationEnd = reservationStart + reservation.sizeBytes;
      const reservationSpanId = `${bank.id}:${reservation.id ?? `reservation-${index}`}`;

  const reservationWindowMeta = windowMetaById.get(reservation.windowId);
  const anchor = windowAddressAnchors.get(reservation.windowId);
      let reservationStartAddress: number | undefined;
      if (anchor?.startAddress !== undefined) {
        reservationStartAddress = anchor.startAddress + (reservationStart - anchor.startOffset);
      } else if (reservationWindowMeta?.baseAddress !== undefined) {
        reservationStartAddress = reservationWindowMeta.baseAddress + reservation.startOffset;
      } else if (lastWindowEndAddress !== undefined) {
        reservationStartAddress = lastWindowEndAddress;
      }
      const reservationEndAddress = reservationStartAddress !== undefined ? reservationStartAddress + reservation.sizeBytes : undefined;

      layoutSpans.push({
        id: reservationSpanId,
        label: reservation.label,
        kind: 'reserved',
        sizeBytes: reservation.sizeBytes,
        startOffset: reservationStart,
        endOffset: reservationEnd,
        startAddress: reservationStartAddress,
        endAddress: reservationEndAddress,
        windowId: reservation.windowId,
        reservationId: reservation.id,
      });

      blockLayoutSpans.push({
        id: `${reservationSpanId}:detail`,
        label: reservation.label,
        kind: 'reserved',
        sizeBytes: reservation.sizeBytes,
        startOffset: reservationStart,
        endOffset: reservationEnd,
        startAddress: reservationStartAddress,
        endAddress: reservationEndAddress,
        windowId: reservation.windowId,
        reservationId: reservation.id,
        parentSpanId: reservationSpanId,
      });
      blockSpanCounter += 1;

      reservedCursor = reservationEnd;
      if (reservationEndAddress !== undefined) {
        lastWindowEndAddress = reservationEndAddress;
      }
    });

    layoutSpans.sort((a, b) => a.startOffset - b.startOffset);
    blockLayoutSpans.sort((a, b) => a.startOffset - b.startOffset);

    const layout = {
      totalBytes: bank.capacityBytes,
      spans: layoutSpans,
    } satisfies HardwareBankSummary['layout'];

    const blockLayout = {
      totalBytes: bank.capacityBytes,
      spans: blockLayoutSpans,
    } satisfies HardwareBankSummary['blockLayout'];

    return {
      hardwareBankId: bank.id,
      name: bank.name,
      description: bank.description,
      capacityBytes: bank.capacityBytes,
      rawUsedBytes,
      adjustedUsedBytes,
      freeBytes: freeCapacity,
      reservedBytes: totalReservedBytes,
      rounding: roundingDetails,
      windowBreakdown,
      blockBreakdown,
      layout,
      blockLayout,
    };
  });
};

export const generateSummaries = (analysis: Analysis): Summaries => {
  const { sections, config } = analysis;
  let runtimeBytes = 0;
  let loadImageBytes = 0;
  let fileOnlyBytes = 0;

  const fileOnlySections: { sectionId: string; name: string; size: number }[] = [];
  const categoryRuntimeTotals = new Map<string, number>();
  const categoryLoadTotals = new Map<string, number>();
  const windowAccumulators = new Map<string, WindowAccumulator>();
  const tagTotals = new Map<string, number>();
  const assignmentRecords: AssignmentRecord[] = [];

  sections.forEach((section) => {
    if (!section.flags.alloc || section.size === 0 || section.blockAssignments.length === 0) {
      if (section.size > 0 && !section.flags.alloc) {
        fileOnlyBytes += section.size;
        fileOnlySections.push({
          sectionId: section.id,
          name: section.name,
          size: section.size,
        });
      }
      return;
    }

    const categoryId = section.categoryId ?? 'unknown';

    section.blockAssignments.forEach((assignment) => {
      assignmentRecords.push({
        sectionId: section.id,
        categoryId,
        blockId: assignment.blockId,
        windowId: assignment.windowId,
        addressType: assignment.addressType,
        address: assignment.address,
        size: assignment.size,
        reportTags: assignment.reportTags,
      });

      const windowAccumulator = ensureWindowAccumulator(windowAccumulators, assignment.windowId);
      windowAccumulator.total += assignment.size;
      accumulateRole(windowAccumulator.roleMap, assignment.addressType, assignment.size);
      accumulateMap(windowAccumulator.categoryMap, categoryId, assignment.size);
      accumulateMap(windowAccumulator.blockMap, assignment.blockId, assignment.size);
      windowAccumulator.placements.push({
        sectionId: section.id,
        blockId: assignment.blockId,
        addressType: assignment.addressType,
        start: assignment.address,
        size: assignment.size,
      });

      if (assignment.addressType === 'load') {
        loadImageBytes += assignment.size;
        accumulateMap(categoryLoadTotals, categoryId, assignment.size);
      } else {
        runtimeBytes += assignment.size;
        accumulateMap(categoryRuntimeTotals, categoryId, assignment.size);
      }

      assignment.reportTags.forEach((tag) => accumulateMap(tagTotals, tag, assignment.size));
    });
  });

  const categorySummary = config.sectionCategories.map((category) => ({
    categoryId: category.id,
    runtimeBytes: categoryRuntimeTotals.get(category.id) ?? 0,
    loadImageBytes: categoryLoadTotals.get(category.id) ?? 0,
  }));

  const byWindow = buildWindowSummaries(analysis, windowAccumulators);
  const hardwareBanks = buildHardwareBankSummaries(analysis, assignmentRecords);

  const tagTotalsSummary: TagUsageSummary[] = Array.from(tagTotals.entries()).map(([tag, bytes]) => ({
    tag,
    bytes,
  }));

  return {
    totals: {
      runtimeBytes,
      loadImageBytes,
      fileOnlyBytes,
    },
    byCategory: categorySummary,
    byWindow,
    hardwareBanks,
    fileOnly: {
      totalBytes: fileOnlyBytes,
      sections: fileOnlySections,
    },
    tagTotals: tagTotalsSummary,
  };
};
