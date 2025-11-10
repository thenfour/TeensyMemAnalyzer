import {
  Region,
  Section,
  SectionCategory,
  Summaries,
  TotalsSummary,
  RegionSummary,
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

  const byRegion: RegionSummary[] = regions.map((region) => ({
    regionId: region.id,
    size: region.size,
    reserved: sumReservedBytes(region),
    usedStatic: 0,
    usedByCategory: createCategoryAccumulator(),
    freeForDynamic: 0,
  }));

  const regionMap = new Map<string, Region>();
  regions.forEach((region) => regionMap.set(region.id, region));

  const regionSummaryMap = new Map<string, RegionSummary>();
  byRegion.forEach((summary) => regionSummaryMap.set(summary.regionId, summary));

  sections.forEach((section) => {
    if (section.size === 0) {
      return;
    }

    const execRegion = section.execRegionId ? regionMap.get(section.execRegionId) : undefined;
    const execSummary = section.execRegionId ? regionSummaryMap.get(section.execRegionId) : undefined;

    if (execRegion && execSummary) {
      execSummary.usedStatic += section.size;
      addToCategoryMap(execSummary.usedByCategory, section.category, section.size);
      accumulateTotals(totals, execRegion.kind, section.category, section.size);
      addToCategoryMap(globalCategoryTotals, section.category, section.size);
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
      }
    }
  });

  byRegion.forEach((summary) => {
    const reserved = summary.reserved;
    const free = summary.size - summary.usedStatic - reserved;
    summary.freeForDynamic = free > 0 ? free : 0;
  });

  const byCategory = Object.entries(globalCategoryTotals).map(([category, bytes]) => ({
    category: category as SectionCategory,
    bytes: bytes ?? 0,
  }));

  return {
    totals,
    byRegion,
    byCategory,
  };
};
