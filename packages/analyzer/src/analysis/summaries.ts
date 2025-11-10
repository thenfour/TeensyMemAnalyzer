import {
  Region,
  Section,
  SectionCategory,
  Summaries,
  TotalsSummary,
  RegionSummary,
  FileOnlySummary,
} from '../model';

const zeroTotals = (): TotalsSummary => ({
  flashUsed: 0,
  flashCode: 0,
  flashConst: 0,
  flashInitImages: 0,
  ramUsed: 0,
  ramCode: 0,
  ramDataInit: 0,
  ramBss: 0,
  ramDma: 0,
});

const createCategoryAccumulator = (): Partial<Record<SectionCategory, number>> => ({
  code: 0,
  code_fast: 0,
  rodata: 0,
  data_init: 0,
  bss: 0,
  dma: 0,
  other: 0,
});

const addToCategoryMap = (
  map: Partial<Record<SectionCategory, number>>,
  category: SectionCategory,
  size: number,
): void => {
  const current = map[category] ?? 0;
  map[category] = current + size;
};

const accumulateTotals = (
  totals: TotalsSummary,
  regionKind: Region['kind'],
  category: SectionCategory,
  size: number,
): void => {
  if (size === 0) {
    return;
  }

  switch (regionKind) {
    case 'flash':
      totals.flashUsed += size;
      if (category === 'code' || category === 'code_fast') {
        totals.flashCode += size;
      } else if (category === 'rodata') {
        totals.flashConst += size;
      }
      break;
    case 'code_ram':
      totals.ramUsed += size;
      if (category === 'code' || category === 'code_fast') {
        totals.ramCode += size;
      } else if (category === 'data_init') {
        totals.ramDataInit += size;
      } else if (category === 'bss') {
        totals.ramBss += size;
      }
      break;
    case 'data_ram':
      totals.ramUsed += size;
      if (category === 'data_init') {
        totals.ramDataInit += size;
      } else if (category === 'bss') {
        totals.ramBss += size;
      }
      break;
    case 'dma_ram':
      totals.ramUsed += size;
      totals.ramDma += size;
      break;
    case 'ext_ram':
    case 'other':
      totals.ramUsed += size;
      break;
  }
};

const sumReservedBytes = (region: Region): number =>
  (region.reserved ?? []).reduce((acc, reserve) => acc + reserve.size, 0);

export const calculateSummaries = (regions: Region[], sections: Section[]): Summaries => {
  const totals = zeroTotals();
  const globalCategoryTotals = createCategoryAccumulator();
  const fileOnlyCategoryTotals = createCategoryAccumulator();
  let fileOnlyBytes = 0;

  const byRegion: RegionSummary[] = regions.map((region) => ({
    regionId: region.id,
    size: region.size,
    reserved: sumReservedBytes(region),
    usedStatic: 0,
    usedByCategory: createCategoryAccumulator(),
    freeForDynamic: 0,
    paddingBytes: 0,
    largestGapBytes: 0,
  }));

  const regionMap = new Map<string, Region>();
  regions.forEach((region) => regionMap.set(region.id, region));

  const regionSummaryMap = new Map<string, RegionSummary>();
  byRegion.forEach((summary) => regionSummaryMap.set(summary.regionId, summary));

  const regionExtents = new Map<string, { start: number; size: number }[]>();

  const recordExtent = (regionId: string | undefined, start: number | undefined, size: number): void => {
    if (!regionId || start === undefined || size === 0) {
      return;
    }

    if (!regionExtents.has(regionId)) {
      regionExtents.set(regionId, []);
    }

    regionExtents.get(regionId)!.push({ start, size });
  };

  sections.forEach((section) => {
    if (section.size === 0 || !section.flags.alloc) {
      if (section.size > 0 && !section.flags.alloc) {
        addToCategoryMap(fileOnlyCategoryTotals, section.category, section.size);
        fileOnlyBytes += section.size;
      }
      return;
    }

    const execRegion = section.execRegionId ? regionMap.get(section.execRegionId) : undefined;
    const execSummary = section.execRegionId ? regionSummaryMap.get(section.execRegionId) : undefined;

    if (execRegion && execSummary) {
      execSummary.usedStatic += section.size;
      addToCategoryMap(execSummary.usedByCategory, section.category, section.size);
      accumulateTotals(totals, execRegion.kind, section.category, section.size);
      addToCategoryMap(globalCategoryTotals, section.category, section.size);
      recordExtent(section.execRegionId, section.vmaStart, section.size);
    }

    const shouldApplyLoadContribution = Boolean(
      section.loadRegionId && (section.isCopySection || !section.execRegionId),
    );

    if (shouldApplyLoadContribution) {
      const loadRegion = section.loadRegionId ? regionMap.get(section.loadRegionId) : undefined;
      const loadSummary = section.loadRegionId ? regionSummaryMap.get(section.loadRegionId) : undefined;

      if (loadRegion && loadSummary) {
        loadSummary.usedStatic += section.size;
        addToCategoryMap(loadSummary.usedByCategory, section.category, section.size);

        if (loadRegion.kind === 'flash') {
          totals.flashUsed += section.size;
          totals.flashInitImages += section.size;
        }

        recordExtent(section.loadRegionId, section.lmaStart ?? section.vmaStart, section.size);
      }
    }
  });

  byRegion.forEach((summary) => {
    const reserved = summary.reserved;
    const free = summary.size - summary.usedStatic - reserved;
    summary.freeForDynamic = free > 0 ? free : 0;

    const extents = regionExtents.get(summary.regionId) ?? [];
    if (extents.length === 0) {
      summary.paddingBytes = 0;
      summary.largestGapBytes = 0;
      return;
    }

    const sorted = extents.slice().sort((a, b) => a.start - b.start);
    let totalSize = 0;
    let largestGap = 0;
    let currentStart = sorted[0].start;
    let currentEnd = currentStart + sorted[0].size;
    totalSize += sorted[0].size;

    for (let i = 1; i < sorted.length; i += 1) {
      const { start, size } = sorted[i];
      const end = start + size;
      totalSize += size;

      if (start > currentEnd) {
        const gap = start - currentEnd;
        if (gap > largestGap) {
          largestGap = gap;
        }
        currentEnd = end;
      } else {
        if (end > currentEnd) {
          currentEnd = end;
        }
      }
    }

    const span = currentEnd - currentStart;
    const padding = span > totalSize ? span - totalSize : 0;
    summary.paddingBytes = padding;
    summary.largestGapBytes = largestGap;
  });

  const byCategory = Object.entries(globalCategoryTotals).map(([category, bytes]) => ({
    category: category as SectionCategory,
    bytes: bytes ?? 0,
  }));

  const fileOnlyByCategory = Object.entries(fileOnlyCategoryTotals).map(([category, bytes]) => ({
    category: category as SectionCategory,
    bytes: bytes ?? 0,
  }));

  const fileOnly: FileOnlySummary = {
    totalBytes: fileOnlyBytes,
    byCategory: fileOnlyByCategory,
  };

  return {
    totals,
    byRegion,
    byCategory,
    fileOnly,
  };
};
