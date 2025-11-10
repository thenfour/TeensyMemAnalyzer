import {
  Analysis,
  Region,
  RegionSummary,
  RuntimeBankSummary,
  RuntimeGroupSummary,
  Section,
  SectionCategory,
  TeensySizeReportConfig,
  TeensySizeReportSummary,
} from '../../model';

const sumRegionCategories = (
  summary: RegionSummary | undefined,
  categories: SectionCategory[],
): number => {
  if (!summary) {
    return 0;
  }

  return categories.reduce((total, category) => total + (summary.usedByCategory[category] ?? 0), 0);
};

const createSectionSizeMap = (sections: Section[]): Map<string, number> => {
  const map = new Map<string, number>();
  sections.forEach((section) => {
    const previous = map.get(section.name) ?? 0;
    map.set(section.name, previous + section.size);
  });
  return map;
};

const sumSectionNames = (sectionSizes: Map<string, number>, names: string[]): number =>
  names.reduce((total, name) => total + (sectionSizes.get(name) ?? 0), 0);

const sumSections = (sections: Section[], predicate: (section: Section) => boolean): number =>
  sections.reduce((total, section) => (predicate(section) ? total + section.size : total), 0);

const dedupeBanks = (banks: RuntimeBankSummary[]): RuntimeBankSummary[] => {
  const seen = new Map<string, RuntimeBankSummary>();
  banks.forEach((bank) => {
    if (!seen.has(bank.bankId)) {
      seen.set(bank.bankId, bank);
    }
  });
  return Array.from(seen.values());
};

const collectBanksFromIds = (
  ids: string[] | undefined,
  bankMap: Map<string, RuntimeBankSummary>,
): RuntimeBankSummary[] => {
  if (!ids || ids.length === 0) {
    return [];
  }
  return ids
    .map((id) => bankMap.get(id))
    .filter((bank): bank is RuntimeBankSummary => Boolean(bank));
};

const collectBanksFromGroup = (
  groupId: string | undefined,
  groupMap: Map<string, RuntimeGroupSummary>,
  bankMap: Map<string, RuntimeBankSummary>,
): RuntimeBankSummary[] => {
  if (!groupId) {
    return [];
  }
  const group = groupMap.get(groupId);
  if (!group) {
    return [];
  }
  return collectBanksFromIds(group.bankIds, bankMap);
};

const collectRegionIds = (
  banks: RuntimeBankSummary[],
  regionMap: Map<string, Region>,
  predicate?: (region: Region) => boolean,
): string[] => {
  if (banks.length === 0) {
    return [];
  }
  const ids = new Set<string>();
  banks.forEach((bank) => {
    bank.contributors.forEach((contributor) => {
      const region = regionMap.get(contributor.regionId);
      if (!region) {
        return;
      }
      if (predicate && !predicate(region)) {
        return;
      }
      ids.add(region.id);
    });
  });
  return Array.from(ids);
};

const sectionsForRegionIds = (analysis: Analysis, regionIds: string[]): Section[] => {
  if (regionIds.length === 0) {
    return [];
  }
  const regionSet = new Set(regionIds);
  return analysis.sections.filter((section) => section.execRegionId && regionSet.has(section.execRegionId));
};

const computeFromConfig = (
  analysis: Analysis,
  config: TeensySizeReportConfig,
): TeensySizeReportSummary => {
  const summary: TeensySizeReportSummary = {};
  const sectionSizes = createSectionSizeMap(analysis.sections);

  const regionMap = new Map<string, Region>();
  analysis.regions.forEach((region) => regionMap.set(region.id, region));

  const regionSummaryMap = new Map<string, RegionSummary>();
  analysis.summaries.byRegion.forEach((regionSummary) => regionSummaryMap.set(regionSummary.regionId, regionSummary));

  const bankMap = new Map<string, RuntimeBankSummary>();
  analysis.summaries.runtimeBanks.forEach((bank) => bankMap.set(bank.bankId, bank));

  const groupMap = new Map<string, RuntimeGroupSummary>();
  analysis.summaries.runtimeGroups.forEach((group) => groupMap.set(group.groupId, group));

  if (config.flash) {
    const flashBanks = dedupeBanks([
      ...collectBanksFromGroup(config.flash.groupId, groupMap, bankMap),
      ...collectBanksFromIds(config.flash.bankIds, bankMap),
    ]);

    if (flashBanks.length > 0) {
      const breakdown = config.flash.sectionBreakdown;
      const headers = sumSectionNames(sectionSizes, breakdown.headers);
      const code = sumSectionNames(sectionSizes, breakdown.code);
      const data = sumSectionNames(sectionSizes, breakdown.data);
      const flashTotal = headers + code + data;
      const totalCapacity = flashBanks.reduce((total, bank) => total + bank.capacityBytes, 0);
      const totalReserved = flashBanks.reduce((total, bank) => total + bank.reservedBytes, 0);
      const flashAvailable = Math.max(totalCapacity - totalReserved, 0);
      const freeForFiles = Math.max(flashAvailable - flashTotal, 0);

      summary.flash = {
        code,
        data,
        headers,
        freeForFiles,
      };
    }
  }

  if (config.ram1) {
    const codeBanks = dedupeBanks(collectBanksFromIds(config.ram1.codeBankIds, bankMap));
    const dataBanks = dedupeBanks(collectBanksFromIds(config.ram1.dataBankIds, bankMap));
    const poolBanks = dedupeBanks([
      ...collectBanksFromGroup(config.ram1.groupId, groupMap, bankMap),
      ...codeBanks,
      ...dataBanks,
    ]);

    if (codeBanks.length > 0 && dataBanks.length > 0 && poolBanks.length > 0) {
      const codeRegionIds = collectRegionIds(codeBanks, regionMap);
      const dataRegionIds = collectRegionIds(dataBanks, regionMap);

      const codeSections = sectionsForRegionIds(analysis, codeRegionIds);
      const dataSections = sectionsForRegionIds(analysis, dataRegionIds);

      const textFast = sumSections(
        codeSections,
        (section) => section.flags.alloc && (section.category === 'code' || section.category === 'code_fast'),
      );
      const armExidx = sumSections(
        codeSections,
        (section) => section.flags.alloc && section.name === '.ARM.exidx',
      );
      const codeBytes = textFast + armExidx;

      const granule = config.ram1.codeRoundingGranuleBytes ?? 0;
      const roundedCodeBytes = granule > 0 && codeBytes > 0 ? Math.ceil(codeBytes / granule) * granule : codeBytes;
      const padding = Math.max(roundedCodeBytes - codeBytes, 0);

      const dataCategories = config.ram1.dataCategories ?? ['data_init', 'bss'];
      const dataCategorySet = new Set<SectionCategory>(dataCategories);
      const variableBytes = sumSections(
        dataSections,
        (section) => section.flags.alloc && dataCategorySet.has(section.category),
      );

      const poolCapacity =
        config.ram1.sharedCapacityBytes ?? poolBanks.reduce((total, bank) => total + bank.capacityBytes, 0);
      const poolReserved =
        config.ram1.sharedCapacityBytes !== undefined
          ? 0
          : poolBanks.reduce((total, bank) => total + bank.reservedBytes, 0);
      const freeForLocalVariables = poolCapacity - poolReserved - roundedCodeBytes - variableBytes;

      summary.ram1 = {
        code: codeBytes,
        variables: variableBytes,
        padding,
        freeForLocalVariables,
      };
    }
  }

  if (config.ram2) {
    const ram2Banks = dedupeBanks([
      ...collectBanksFromGroup(config.ram2.groupId, groupMap, bankMap),
      ...collectBanksFromIds(config.ram2.bankIds, bankMap),
    ]);

    if (ram2Banks.length > 0) {
      const regionIds = collectRegionIds(ram2Banks, regionMap);
      const categories = config.ram2.variableCategories ?? ['data_init', 'bss', 'dma', 'other'];
      const variableBytes = regionIds.reduce((total, regionId) => {
        const regionSummary = regionSummaryMap.get(regionId);
        return total + sumRegionCategories(regionSummary, categories);
      }, 0);
      const freeForMalloc = ram2Banks.reduce((total, bank) => total + bank.freeBytes, 0);

      summary.ram2 = {
        variables: variableBytes,
        freeForMalloc,
      };
    }
  }

  return summary;
};

export const calculateTeensySizeReport = (analysis: Analysis): TeensySizeReportSummary => {
  const config = analysis.reporting?.teensySize;
  if (!config) {
    return {};
  }

  return computeFromConfig(analysis, config);
};
