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

const computeReservedUnusedBytes = (region: Region | undefined, sections: Section[]): number => {
  if (!region?.reserved?.length) {
    return 0;
  }

  const ranges = sections.flatMap((section) => {
    if (section.size === 0 || !section.flags.alloc) {
      return [] as { start: number; end: number }[];
    }

    const regionRanges: { start: number; end: number }[] = [];

    if (section.execRegionId === region.id && section.vmaStart !== undefined) {
      regionRanges.push({ start: section.vmaStart, end: section.vmaStart + section.size });
    }

    const shouldTrackLoad =
      section.loadRegionId === region.id && (section.isCopySection || section.execRegionId !== section.loadRegionId);

    if (shouldTrackLoad) {
      const loadStart = section.lmaStart ?? section.vmaStart;
      if (loadStart !== undefined) {
        regionRanges.push({ start: loadStart, end: loadStart + section.size });
      }
    }

    return regionRanges;
  });

  const computeOverlap = (reserveStart: number, reserveEnd: number): number => {
    let covered = 0;
    ranges.forEach(({ start, end }) => {
      const overlapStart = Math.max(start, reserveStart);
      const overlapEnd = Math.min(end, reserveEnd);
      if (overlapEnd > overlapStart) {
        covered += overlapEnd - overlapStart;
      }
    });
    return covered;
  };

  let unused = 0;
  region.reserved.forEach((reserve) => {
    const reserveStart = reserve.start;
    const reserveEnd = reserve.start + reserve.size;
    const covered = computeOverlap(reserveStart, reserveEnd);
    const uncovered = reserve.size - Math.min(reserve.size, covered);
    unused += uncovered > 0 ? uncovered : 0;
  });

  return unused;
};

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

const computeLegacy = (analysis: Analysis): TeensySizeReportSummary => {
  const sectionSizes = createSectionSizeMap(analysis.sections);

  const regionSummaries = new Map<string, RegionSummary>();
  analysis.summaries.byRegion.forEach((regionSummary) => {
    regionSummaries.set(regionSummary.regionId, regionSummary);
  });

  const regionMap = new Map<string, Region>();
  analysis.regions.forEach((region) => {
    regionMap.set(region.id, region);
  });

  const runtimeGroupMap = new Map<string, RuntimeGroupSummary>();
  const runtimeGroupLookup = new Map<string, RuntimeGroupSummary>();
  analysis.summaries.runtimeGroups.forEach((group) => {
    runtimeGroupMap.set(group.groupId, group);
    runtimeGroupLookup.set(group.groupId.toLowerCase(), group);
    runtimeGroupLookup.set(group.name.toLowerCase(), group);
  });

  const runtimeBankMap = new Map<string, RuntimeBankSummary>();
  const runtimeBankLookup = new Map<string, RuntimeBankSummary>();
  analysis.summaries.runtimeBanks.forEach((bank) => {
    runtimeBankMap.set(bank.bankId, bank);
    runtimeBankLookup.set(bank.bankId.toLowerCase(), bank);
    runtimeBankLookup.set(bank.name.toLowerCase(), bank);
  });

  const resolveGroup = (...keys: string[]): RuntimeGroupSummary | undefined => {
    for (const key of keys) {
      if (!key) {
        continue;
      }
      const direct = runtimeGroupMap.get(key);
      if (direct) {
        return direct;
      }
      const normalized = key.toLowerCase();
      const lookup = runtimeGroupLookup.get(normalized);
      if (lookup) {
        return lookup;
      }
    }
    return undefined;
  };

  const resolveBank = (...keys: string[]): RuntimeBankSummary | undefined => {
    for (const key of keys) {
      if (!key) {
        continue;
      }
      const direct = runtimeBankMap.get(key);
      if (direct) {
        return direct;
      }
      const normalized = key.toLowerCase();
      const lookup = runtimeBankLookup.get(normalized);
      if (lookup) {
        return lookup;
      }
    }
    return undefined;
  };

  const groupBanks = (group: RuntimeGroupSummary | undefined): RuntimeBankSummary[] => {
    if (!group) {
      return [];
    }
    return group.bankIds
      .map((bankId) => resolveBank(bankId))
      .filter((bank): bank is RuntimeBankSummary => Boolean(bank));
  };

  const collectRegionIds = (banks: RuntimeBankSummary[], predicate?: (region: Region) => boolean): string[] => {
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

  const summaries: TeensySizeReportSummary = {};

  const flashGroup = resolveGroup('flash');
  const flashBanks = groupBanks(flashGroup).length > 0
    ? groupBanks(flashGroup)
    : analysis.summaries.runtimeBanks.filter((bank) => bank.kind === 'flash');

  if (flashBanks.length > 0) {
    const flashRegionIds = collectRegionIds(flashBanks);
    let flashAvailable = 0;

    flashRegionIds.forEach((regionId) => {
      const region = regionMap.get(regionId);
      const summary = regionSummaries.get(regionId);
      if (!region || !summary) {
        return;
      }
      const reservedUnused = computeReservedUnusedBytes(region, analysis.sections);
      flashAvailable += summary.size - reservedUnused;
    });

    if (flashAvailable === 0) {
      const fallback = regionSummaries.get('FLASH');
      const fallbackRegion = regionMap.get('FLASH');
      if (fallback && fallbackRegion) {
        const reservedUnused = computeReservedUnusedBytes(fallbackRegion, analysis.sections);
        flashAvailable = fallback.size - reservedUnused;
      }
    }

    if (flashAvailable > 0) {
      const textHeaders = sumSectionNames(sectionSizes, ['.text.headers']);
      const textCode = sumSectionNames(sectionSizes, ['.text.code']);
      const textProgmem = sumSectionNames(sectionSizes, ['.text.progmem']);
      const textItcm = sumSectionNames(sectionSizes, ['.text.itcm']);
      const armExidx = sumSectionNames(sectionSizes, ['.ARM.exidx']);
      const data = sumSectionNames(sectionSizes, ['.data']);
      const textCsf = sumSectionNames(sectionSizes, ['.text.csf']);

      const headers = textHeaders + textCsf;
      const code = textCode + textItcm + armExidx;
      const flashData = textProgmem + data;
      const flashTotal = headers + code + flashData;
      const freeForFiles = Math.max(flashAvailable - flashTotal, 0);

      summaries.flash = {
        code,
        data: flashData,
        headers,
        freeForFiles,
      };
    }
  }

  const ram1Group = resolveGroup('ram1');
  const ram1Banks = groupBanks(ram1Group);
  const itcmBanks = ram1Banks.length > 0
    ? ram1Banks.filter((bank) => collectRegionIds([bank], (region) => region.kind === 'code_ram').length > 0)
    : analysis.summaries.runtimeBanks.filter((bank) => collectRegionIds([bank], (region) => region.kind === 'code_ram').length > 0);
  const dtcmBanks = ram1Banks.length > 0
    ? ram1Banks.filter((bank) => collectRegionIds([bank], (region) => region.kind === 'data_ram').length > 0)
    : analysis.summaries.runtimeBanks.filter((bank) => collectRegionIds([bank], (region) => region.kind === 'data_ram').length > 0);

  const itcmRegionIds = collectRegionIds(itcmBanks);
  const dtcmRegionIds = collectRegionIds(dtcmBanks);

  if (itcmRegionIds.length > 0 && dtcmRegionIds.length > 0) {
    const itcmSections = sectionsForRegionIds(analysis, itcmRegionIds);
    const dtcmSections = sectionsForRegionIds(analysis, dtcmRegionIds);

    const textItcm = sumSections(
      itcmSections,
      (section) => section.flags.alloc && (section.category === 'code' || section.category === 'code_fast'),
    );
    const armExidx = sumSections(itcmSections, (section) => section.flags.alloc && section.name === '.ARM.exidx');
    const itcmBytes = textItcm + armExidx;

    const TCM_GRANULE_BYTES = 32 * 1024;
    const itcmBlocks = itcmBytes === 0 ? 0 : Math.ceil(itcmBytes / TCM_GRANULE_BYTES);
    const itcmTotal = itcmBlocks * TCM_GRANULE_BYTES;
    const itcmPadding = itcmTotal - itcmBytes;

    const dtcmBytes = sumSections(
      dtcmSections,
      (section) => section.flags.alloc && (section.category === 'data_init' || section.category === 'bss'),
    );

    const dtcmCapacity = dtcmRegionIds.reduce((acc, regionId) => {
      const summary = regionSummaries.get(regionId);
      return acc + (summary?.size ?? 0);
    }, 0);
    const ram1Capacity = dtcmCapacity > 0 ? dtcmCapacity : 512 * 1024;
    const freeForLocalVariables = ram1Capacity - itcmTotal - dtcmBytes;

    summaries.ram1 = {
      code: itcmBytes,
      variables: dtcmBytes,
      padding: itcmPadding > 0 ? itcmPadding : 0,
      freeForLocalVariables,
    };
  }

  const ram2Group = resolveGroup('ram2');
  const ram2Banks = groupBanks(ram2Group).length > 0
    ? groupBanks(ram2Group)
    : analysis.summaries.runtimeBanks.filter((bank) => collectRegionIds([bank], (region) => region.kind === 'dma_ram').length > 0);

  const ram2RegionIds = collectRegionIds(ram2Banks, (region) => region.kind === 'dma_ram');

  if (ram2RegionIds.length > 0) {
    const variableBytes = ram2RegionIds.reduce((total, regionId) => {
      const summary = regionSummaries.get(regionId);
      return total + sumRegionCategories(summary, ['data_init', 'bss', 'dma', 'other']);
    }, 0);

    const freeForMalloc = ram2RegionIds.reduce((total, regionId) => {
      const summary = regionSummaries.get(regionId);
      return total + (summary?.freeForDynamic ?? 0);
    }, 0);

    summaries.ram2 = {
      variables: variableBytes,
      freeForMalloc,
    };
  }

  return summaries;
};

export const calculateTeensySizeReport = (analysis: Analysis): TeensySizeReportSummary => {
  const config = analysis.reporting?.teensySize;
  if (!config) {
    return computeLegacy(analysis);
  }

  const hasExplicitConfig = Boolean(config.flash || config.ram1 || config.ram2);
  if (!hasExplicitConfig) {
    return computeLegacy(analysis);
  }

  const configured = computeFromConfig(analysis, config);
  const legacy = computeLegacy(analysis);

  return {
    flash: configured.flash ?? legacy.flash,
    ram1: configured.ram1 ?? legacy.ram1,
    ram2: configured.ram2 ?? legacy.ram2,
  };
};
