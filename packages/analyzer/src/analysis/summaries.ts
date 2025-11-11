import { AddressUsageKind, Analysis, HardwareBankSummary, Summaries, TagUsageSummary, WindowSummary } from '../model';

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
): HardwareBankSummary[] =>
  analysis.config.hardwareBanks.map((bank) => {
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

    const freeBytes = Math.max(bank.capacityBytes - adjustedUsedBytes, 0);

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

    const blocksByWindow = new Map<string, string[]>();
    analysis.config.logicalBlocks.forEach((block) => {
      const existing = blocksByWindow.get(block.windowId);
      if (existing) {
        existing.push(block.id);
      } else {
        blocksByWindow.set(block.windowId, [block.id]);
      }
    });

    const layoutSpans = [] as HardwareBankSummary['layout']['spans'];
    let cursor = 0;
    let occupiedTotal = 0;

    bank.windowIds.forEach((windowId) => {
      const bytes = windowUsage.get(windowId) ?? 0;
      if (bytes <= 0) {
        return;
      }

      const windowMeta = analysis.config.addressWindows.find((window) => window.id === windowId);
      const label = windowMeta?.name ?? windowId;
      const startOffset = cursor;
      const endOffset = cursor + bytes;

      layoutSpans.push({
        id: `${bank.id}:${windowId}`,
        label,
        kind: 'occupied',
        sizeBytes: bytes,
        startOffset,
        endOffset,
        windowId,
        blockIds: blocksByWindow.get(windowId),
      });

      cursor = endOffset;
      occupiedTotal += bytes;
    });

    const layoutFreeBytes = Math.max(bank.capacityBytes - occupiedTotal, 0);
    if (layoutFreeBytes > 0) {
      layoutSpans.push({
        id: `${bank.id}:free`,
        label: 'Free',
        kind: 'free',
        sizeBytes: layoutFreeBytes,
        startOffset: cursor,
        endOffset: cursor + layoutFreeBytes,
      });
    }

    const layout = {
      totalBytes: bank.capacityBytes,
      spans: layoutSpans,
    } satisfies HardwareBankSummary['layout'];

    return {
      hardwareBankId: bank.id,
      name: bank.name,
      description: bank.description,
      capacityBytes: bank.capacityBytes,
      rawUsedBytes,
      adjustedUsedBytes,
      freeBytes,
      rounding: roundingDetails,
      windowBreakdown,
      blockBreakdown,
      layout,
    };
  });

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
