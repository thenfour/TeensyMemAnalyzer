#!/usr/bin/env node

import path from 'path';
import {
  analyzeBuild,
  AnalyzeBuildParams,
  Analysis,
  SourceLocation,
  Symbol as AnalysisSymbol,
  Region,
  RegionSummary,
  Section,
  SectionCategory,
  RuntimeBankSummary,
  RuntimeGroupSummary,
  TeensySizeReportConfig,
  resolveSymbolSource,
} from '@teensy-mem-explorer/analyzer';

interface CliOptions {
  targetId?: string;
  elfPath?: string;
  mapPath?: string;
  toolchainDir?: string;
  toolchainPrefix?: string;
  outputFormat: 'text' | 'json';
}

const defaultOptions: CliOptions = {
  outputFormat: 'text',
};

const printUsage = (): void => {
  const scriptName = path.basename(process.argv[1] ?? 'teensy-mem-explorer');
  console.log(`Usage: ${scriptName} --target <targetId> --elf <path> [options]

Options:
  --target <id>            Target identifier (e.g. teensy40, teensy41)
  --elf <path>             Path to ELF file to analyze
  --map <path>             Optional path to MAP file
  --toolchain-dir <path>   Optional directory containing arm-none-eabi-* tools
  --toolchain-prefix <pfx> Optional prefix for toolchain commands (default: arm-none-eabi-)
  --json                   Output full analysis as JSON
  --help                   Show this help message
`);
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = { ...defaultOptions };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--json') {
      options.outputFormat = 'json';
      continue;
    }

    const expectValue = (flag: string): string => {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Flag ${flag} requires a value.`);
      }
      i += 1;
      return value;
    };

    switch (arg) {
      case '--target':
        options.targetId = expectValue(arg);
        break;
      case '--elf':
        options.elfPath = expectValue(arg);
        break;
      case '--map':
        options.mapPath = expectValue(arg);
        break;
      case '--toolchain-dir':
        options.toolchainDir = expectValue(arg);
        break;
      case '--toolchain-prefix':
        options.toolchainPrefix = expectValue(arg);
        break;
      default:
        console.warn(`Unknown argument ignored: ${arg}`);
    }
  }

  return options;
};

const formatBytes = (bytes: number): string => `${bytes} B`;

const sumRegionCategories = (
  summary: RegionSummary | undefined,
  categories: SectionCategory[],
): number => {
  if (!summary) {
    return 0;
  }

  return categories.reduce((total, category) => total + (summary.usedByCategory[category] ?? 0), 0);
};

const sumSections = (sections: Section[], predicate: (section: Section) => boolean): number =>
  sections.reduce((total, section) => (predicate(section) ? total + section.size : total), 0);

type SymbolSourceLookup = (symbol: AnalysisSymbol) => Promise<SourceLocation | undefined>;

interface SourceLookupOptions {
  toolchainDir?: string;
  toolchainPrefix?: string;
}

const createSymbolSourceLookup = (analysis: Analysis, options: SourceLookupOptions): SymbolSourceLookup => {
  const cache = new Map<string, Promise<SourceLocation | undefined>>();

  return async (symbol: AnalysisSymbol): Promise<SourceLocation | undefined> => {
    if (symbol.source) {
      return symbol.source;
    }

    const cached = cache.get(symbol.id);
    if (cached) {
      return cached;
    }

    const lookupPromise = resolveSymbolSource({
      analysis,
      symbol,
      toolchainDir: options.toolchainDir,
      toolchainPrefix: options.toolchainPrefix,
    }).catch(() => undefined);

    cache.set(symbol.id, lookupPromise);
    return lookupPromise;
  };
};

const formatSourceLocationSuffix = (location: SourceLocation | undefined): string => {
  if (!location) {
    return '';
  }

  const basePath = path.isAbsolute(location.file)
    ? path.relative(process.cwd(), location.file) || location.file
    : location.file;

  const normalizedPath = basePath.replace(/\\/g, '/');
  return `  [${normalizedPath}:${location.line}]`;
};

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
      section.loadRegionId === region.id && (section.isCopySection || section.execRegionId !== region.id);

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

const computeTopSymbolsByRegion = (symbols: AnalysisSymbol[], limit: number): Map<string, AnalysisSymbol[]> => {
  const grouped = new Map<string, AnalysisSymbol[]>();

  symbols.forEach((symbol) => {
    if (!symbol.regionId || symbol.size <= 0) {
      return;
    }

    const list = grouped.get(symbol.regionId);
    if (list) {
      list.push(symbol);
    } else {
      grouped.set(symbol.regionId, [symbol]);
    }
  });

  const result = new Map<string, AnalysisSymbol[]>();
  grouped.forEach((list, regionId) => {
    const sorted = [...list].sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
    result.set(regionId, sorted.slice(0, limit));
  });

  return result;
};

interface TeensySizeFlashSummary {
  code: number;
  data: number;
  headers: number;
  freeForFiles: number;
}

interface TeensySizeRam1Summary {
  code: number;
  variables: number;
  padding: number;
  freeForLocalVariables: number;
}

interface TeensySizeRam2Summary {
  variables: number;
  freeForMalloc: number;
}

interface TeensySizeSummary {
  flash?: TeensySizeFlashSummary;
  ram1?: TeensySizeRam1Summary;
  ram2?: TeensySizeRam2Summary;
}

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

const computeTeensySizeSummaryFromConfig = (
  analysis: Analysis,
  config: TeensySizeReportConfig,
): TeensySizeSummary => {
  const summaries: TeensySizeSummary = {};
  if (!config) {
    return summaries;
  }

  const sectionSizes = createSectionSizeMap(analysis.sections);

  const regionMap = new Map<string, Region>();
  analysis.regions.forEach((region) => {
    regionMap.set(region.id, region);
  });

  const regionSummaryMap = new Map<string, RegionSummary>();
  analysis.summaries.byRegion.forEach((summary) => {
    regionSummaryMap.set(summary.regionId, summary);
  });

  const bankMap = new Map<string, RuntimeBankSummary>();
  analysis.summaries.runtimeBanks.forEach((bank) => {
    bankMap.set(bank.bankId, bank);
  });

  const groupMap = new Map<string, RuntimeGroupSummary>();
  analysis.summaries.runtimeGroups.forEach((group) => {
    groupMap.set(group.groupId, group);
  });

  const dedupeBanks = (banks: RuntimeBankSummary[]): RuntimeBankSummary[] => {
    const seen = new Map<string, RuntimeBankSummary>();
    banks.forEach((bank) => {
      if (!seen.has(bank.bankId)) {
        seen.set(bank.bankId, bank);
      }
    });
    return Array.from(seen.values());
  };

  const getBanksFromIds = (ids?: string[]): RuntimeBankSummary[] => {
    if (!ids || ids.length === 0) {
      return [];
    }
    return ids
      .map((id) => bankMap.get(id))
      .filter((bank): bank is RuntimeBankSummary => Boolean(bank));
  };

  const getBanksFromGroup = (groupId?: string): RuntimeBankSummary[] => {
    if (!groupId) {
      return [];
    }
    const group = groupMap.get(groupId);
    if (!group) {
      return [];
    }
    return getBanksFromIds(group.bankIds);
  };

  const collectBanks = (groupId?: string, ids?: string[]): RuntimeBankSummary[] =>
    dedupeBanks([...getBanksFromGroup(groupId), ...getBanksFromIds(ids)]);

  const collectRegionIds = (
    banks: RuntimeBankSummary[],
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

  const sectionsForRegionIds = (regionIds: string[]): Section[] => {
    if (regionIds.length === 0) {
      return [];
    }
    const regionSet = new Set(regionIds);
    return analysis.sections.filter(
      (section) => section.execRegionId && regionSet.has(section.execRegionId),
    );
  };

  if (config.flash) {
    const flashBanks = collectBanks(config.flash.groupId, config.flash.bankIds);
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

      summaries.flash = {
        code,
        data,
        headers,
        freeForFiles,
      };
    }
  }

  if (config.ram1) {
    const codeBanks = dedupeBanks(getBanksFromIds(config.ram1.codeBankIds));
    const dataBanks = dedupeBanks(getBanksFromIds(config.ram1.dataBankIds));
    const poolBanks = dedupeBanks([
      ...getBanksFromGroup(config.ram1.groupId),
      ...codeBanks,
      ...dataBanks,
    ]);

    if (codeBanks.length > 0 && dataBanks.length > 0 && poolBanks.length > 0) {
      const codeRegionIds = collectRegionIds(codeBanks);
      const dataRegionIds = collectRegionIds(dataBanks);

      const codeSections = sectionsForRegionIds(codeRegionIds);
      const dataSections = sectionsForRegionIds(dataRegionIds);

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
      const roundedCodeBytes =
        granule > 0 && codeBytes > 0 ? Math.ceil(codeBytes / granule) * granule : codeBytes;
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

      summaries.ram1 = {
        code: codeBytes,
        variables: variableBytes,
        padding,
        freeForLocalVariables,
      };
    }
  }

  if (config.ram2) {
    const ram2Banks = collectBanks(config.ram2.groupId, config.ram2.bankIds);
    if (ram2Banks.length > 0) {
      const regionIds = collectRegionIds(ram2Banks);
      const categories = config.ram2.variableCategories ?? ['data_init', 'bss', 'dma', 'other'];
      const variableBytes = regionIds.reduce((total, regionId) => {
        const summary = regionSummaryMap.get(regionId);
        return total + sumRegionCategories(summary, categories);
      }, 0);
      const freeForMalloc = ram2Banks.reduce((total, bank) => total + bank.freeBytes, 0);

      summaries.ram2 = {
        variables: variableBytes,
        freeForMalloc,
      };
    }
  }

  return summaries;
};

const computeTeensySizeSummaryLegacy = (analysis: Analysis): TeensySizeSummary => {
  const regionSummaries = new Map<string, RegionSummary>();
  analysis.summaries.byRegion.forEach((summary) => {
    regionSummaries.set(summary.regionId, summary);
  });

  const regionMap = new Map<string, Region>();
  analysis.regions.forEach((region) => {
    regionMap.set(region.id, region);
  });

  const sectionSizes = createSectionSizeMap(analysis.sections);
  const getSectionSize = (name: string): number => sectionSizes.get(name) ?? 0;

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

  const sectionsForRegionIds = (regionIds: string[]): Section[] => {
    if (regionIds.length === 0) {
      return [];
    }
    const regionSet = new Set(regionIds);
    return analysis.sections.filter((section) => section.execRegionId && regionSet.has(section.execRegionId));
  };

  const summaries: TeensySizeSummary = {};

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
      const textHeaders = getSectionSize('.text.headers');
      const textCode = getSectionSize('.text.code');
      const textProgmem = getSectionSize('.text.progmem');
      const textItcm = getSectionSize('.text.itcm');
      const armExidx = getSectionSize('.ARM.exidx');
      const data = getSectionSize('.data');
      const textCsf = getSectionSize('.text.csf');

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
    const itcmSections = sectionsForRegionIds(itcmRegionIds);
    const dtcmSections = sectionsForRegionIds(dtcmRegionIds);

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

const computeTeensySizeSummary = (analysis: Analysis): TeensySizeSummary => {
  const config = analysis.reporting?.teensySize;
  if (!config) {
    return computeTeensySizeSummaryLegacy(analysis);
  }

  const hasExplicitConfig = Boolean(config.flash || config.ram1 || config.ram2);
  if (!hasExplicitConfig) {
    return computeTeensySizeSummaryLegacy(analysis);
  }

  const configSummary = computeTeensySizeSummaryFromConfig(analysis, config);
  const result: TeensySizeSummary = { ...configSummary };
  let legacySummary: TeensySizeSummary | undefined;

  const getLegacy = (): TeensySizeSummary => {
    if (!legacySummary) {
      legacySummary = computeTeensySizeSummaryLegacy(analysis);
    }
    return legacySummary;
  };

  if (!result.flash) {
    result.flash = getLegacy().flash;
  }
  if (!result.ram1) {
    result.ram1 = getLegacy().ram1;
  }
  if (!result.ram2) {
    result.ram2 = getLegacy().ram2;
  }

  return result;
};

const printRegionSummary = async (
  regionSummary: RegionSummary,
  analysis: Analysis,
  topSymbols: AnalysisSymbol[],
  lookupSource: SymbolSourceLookup,
): Promise<void> => {
  const region = analysis.regions.find((entry) => entry.id === regionSummary.regionId);
  if (!region) {
    return;
  }

  console.log(`\nRegion ${region.name} (${region.id})`);
  console.log(`  Size:            ${formatBytes(regionSummary.size)}`);
  console.log(`  Reserved:        ${formatBytes(regionSummary.reserved)}`);
  console.log(`  Used (static):   ${formatBytes(regionSummary.usedStatic)}`);
  console.log(`  Free (dynamic):  ${formatBytes(regionSummary.freeForDynamic)}`);

  console.log('  By category:');
  Object.entries(regionSummary.usedByCategory)
    .filter(([, value]) => (value ?? 0) > 0)
    .forEach(([category, value]) => {
      console.log(`    ${category.padEnd(12)} ${formatBytes(value ?? 0)}`);
    });

  if (regionSummary.paddingBytes > 0 || regionSummary.largestGapBytes > 0) {
    console.log('  Alignment padding:');
    console.log(`    Total          ${formatBytes(regionSummary.paddingBytes)}`);
    if (regionSummary.largestGapBytes > 0) {
      console.log(`    Largest gap    ${formatBytes(regionSummary.largestGapBytes)}`);
    }
  }

  if (topSymbols.length > 0) {
    console.log('  Worst offenders:');
    const locations = await Promise.all(topSymbols.map((symbol) => lookupSource(symbol)));
    topSymbols.forEach((symbol, index) => {
      const rankLabel = `${index + 1}.`;
      const locationSuffix = formatSourceLocationSuffix(locations[index]);
      console.log(
        `    ${rankLabel.padEnd(4)}${formatBytes(symbol.size).padStart(10)}  ${symbol.name}${locationSuffix}`,
      );
    });
  }
};

const printAnalysis = async (
  analysis: Analysis,
  lookupSource: SymbolSourceLookup,
): Promise<void> => {
  console.log(`Target: ${analysis.target.name}`);
  console.log(`ELF:    ${analysis.build.elfPath}`);
  if (analysis.build.mapPath) {
    console.log(`MAP:    ${analysis.build.mapPath}`);
  }

  console.log('\nTotals:');
  console.log(`  Flash used:          ${formatBytes(analysis.summaries.totals.flashUsed)}`);
  console.log(`    - Code:            ${formatBytes(analysis.summaries.totals.flashCode)}`);
  console.log(`    - Const:           ${formatBytes(analysis.summaries.totals.flashConst)}`);
  console.log(`    - Init images:     ${formatBytes(analysis.summaries.totals.flashInitImages)}`);
  console.log(`  RAM used:            ${formatBytes(analysis.summaries.totals.ramUsed)}`);
  console.log(`    - Code:            ${formatBytes(analysis.summaries.totals.ramCode)}`);
  console.log(`    - Data init:       ${formatBytes(analysis.summaries.totals.ramDataInit)}`);
  console.log(`    - BSS:             ${formatBytes(analysis.summaries.totals.ramBss)}`);
  console.log(`    - DMA:             ${formatBytes(analysis.summaries.totals.ramDma)}`);

  if (analysis.summaries.fileOnly.totalBytes > 0) {
    console.log(`  File-only (non-alloc): ${formatBytes(analysis.summaries.fileOnly.totalBytes)}`);
  }

  const teensySizeSummary = computeTeensySizeSummary(analysis);
  if (teensySizeSummary.flash || teensySizeSummary.ram1 || teensySizeSummary.ram2) {
    console.log('\nTeensy-size fields:');
    if (teensySizeSummary.flash) {
      const flash = teensySizeSummary.flash;
      console.log(
        `  FLASH: code ${formatBytes(flash.code)}, data ${formatBytes(flash.data)}, headers ${formatBytes(
          flash.headers,
        )}  free for files: ${formatBytes(flash.freeForFiles)}`,
      );
    }

    if (teensySizeSummary.ram1) {
      const ram1 = teensySizeSummary.ram1;
      console.log(
        `  RAM1: variables ${formatBytes(ram1.variables)}, code ${formatBytes(ram1.code)}, padding ${formatBytes(
          ram1.padding,
        )}  free for local variables: ${formatBytes(ram1.freeForLocalVariables)}`,
      );
    }

    if (teensySizeSummary.ram2) {
      const ram2 = teensySizeSummary.ram2;
      console.log(
        `  RAM2: variables ${formatBytes(ram2.variables)}  free for malloc/new: ${formatBytes(ram2.freeForMalloc)}`,
      );
    }
  }

  const topSymbolsByRegion = computeTopSymbolsByRegion(analysis.symbols, 3);

  for (const regionSummary of analysis.summaries.byRegion) {
    const offenders = topSymbolsByRegion.get(regionSummary.regionId) ?? [];
    await printRegionSummary(regionSummary, analysis, offenders, lookupSource);
  }

  console.log('\nTop symbols (region id) by size:');
  const topSymbols = [...analysis.symbols]
    .filter((symbol) => symbol.size > 0)
    .sort((a, b) => b.size - a.size)
    .slice(0, 10);

  for (const symbol of topSymbols) {
    const locationSuffix = formatSourceLocationSuffix(await lookupSource(symbol));
    console.log(
      `  ${formatBytes(symbol.size).padStart(10)}  ${symbol.name}  (${symbol.regionId ?? 'unknown'})${locationSuffix}`,
    );
  }
};

const main = async (): Promise<void> => {
  try {
    const options = parseArgs(process.argv.slice(2));

    const { targetId, elfPath, mapPath, toolchainDir, toolchainPrefix, outputFormat } = options;

    if (!targetId) {
      throw new Error('Missing required --target <id>.');
    }

    if (!elfPath) {
      throw new Error('Missing required --elf <path>.');
    }

    const params: AnalyzeBuildParams = {
      targetId,
      elfPath,
      mapPath,
      toolchainDir,
      toolchainPrefix,
    };

    const analysis = await analyzeBuild(params);

    const lookupSource = createSymbolSourceLookup(analysis, {
      toolchainDir,
      toolchainPrefix,
    });

    if (outputFormat === 'json') {
      console.log(JSON.stringify(analysis, null, 2));
    } else {
      await printAnalysis(analysis, lookupSource);
    }
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
};

main();
