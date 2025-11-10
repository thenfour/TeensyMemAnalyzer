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

const computeTeensySizeSummary = (analysis: Analysis): TeensySizeSummary => {
  const regionSummaries = new Map<string, RegionSummary>();
  analysis.summaries.byRegion.forEach((summary) => {
    regionSummaries.set(summary.regionId, summary);
  });

  const sectionSizes = createSectionSizeMap(analysis.sections);
  const getSectionSize = (name: string): number => sectionSizes.get(name) ?? 0;

  const summaries: TeensySizeSummary = {};

  const flashSummary = regionSummaries.get('FLASH');
  if (flashSummary) {
    const flashRegion = analysis.regions.find((entry) => entry.id === 'FLASH');
    const reservedUnused = computeReservedUnusedBytes(flashRegion, analysis.sections);
    const flashAvailable = flashSummary.size - reservedUnused;

  // Mirrors teensy_size.c flash bucket computation for IMXRT-based boards.
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

  const itcmSummary = regionSummaries.get('ITCM');
  const dtcmSummary = regionSummaries.get('DTCM');
  if (itcmSummary && dtcmSummary) {
    const itcmSections = analysis.sections.filter((section) => section.execRegionId === 'ITCM');
    const dtcmSections = analysis.sections.filter((section) => section.execRegionId === 'DTCM');

    const textItcm = sumSections(
      itcmSections,
      (section) => section.flags.alloc && (section.category === 'code' || section.category === 'code_fast'),
    );
    const armExidx = sumSections(itcmSections, (section) => section.flags.alloc && section.name === '.ARM.exidx');
    const itcmBytes = textItcm + armExidx;

  // Mirrors teensy_size.c: ITCM consumption is rounded to 32 KiB blocks before reporting.
  const TCM_GRANULE = 32 * 1024;
    const RAM1_TOTAL_BYTES = 512 * 1024;
    const itcmBlocks = itcmBytes === 0 ? 0 : Math.ceil(itcmBytes / TCM_GRANULE);
    const itcmTotal = itcmBlocks * TCM_GRANULE;
    const itcmPadding = itcmTotal - itcmBytes;

    const dtcmBytes = sumSections(
      dtcmSections,
      (section) => section.flags.alloc && (section.category === 'data_init' || section.category === 'bss'),
    );

    const freeForLocalVariables = RAM1_TOTAL_BYTES - itcmTotal - dtcmBytes;

    summaries.ram1 = {
      code: itcmBytes,
      variables: dtcmBytes,
      padding: itcmPadding > 0 ? itcmPadding : 0,
      freeForLocalVariables,
    };
  }

  const dmaSummary = regionSummaries.get('DMAMEM');
  if (dmaSummary) {
    const variableBytes = sumRegionCategories(dmaSummary, ['data_init', 'bss', 'dma', 'other']);

    summaries.ram2 = {
      variables: variableBytes,
      freeForMalloc: dmaSummary.freeForDynamic,
    };
  }

  return summaries;
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
