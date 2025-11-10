#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import {
  analyzeBuild,
  AnalyzeBuildParams,
  Analysis,
  SourceLocation,
  Symbol as AnalysisSymbol,
  RegionSummary,
  calculateTeensySizeReport,
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

const swapExtension = (filePath: string, nextExtension: string): string => {
  const directory = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  return path.join(directory, `${base}${nextExtension}`);
};

const formatBytes = (bytes: number): string => `${bytes} B`;

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

  const teensySizeSummary = calculateTeensySizeReport(analysis);
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

    const originalMapPath = options.mapPath;
    let { targetId, toolchainDir, toolchainPrefix, outputFormat } = options;
    let elfPath = options.elfPath;
    let mapPath = options.mapPath;

    if (!elfPath && mapPath) {
      const inferredElf = swapExtension(mapPath, '.elf');
      if (fs.existsSync(inferredElf)) {
        elfPath = inferredElf;
      }
    }

    if (!mapPath && elfPath) {
      const inferredMap = swapExtension(elfPath, '.map');
      if (fs.existsSync(inferredMap)) {
        mapPath = inferredMap;
      }
    }

    if (!targetId) {
      throw new Error('Missing required --target <id>.');
    }

    if (!elfPath) {
      const attempted = originalMapPath ? swapExtension(originalMapPath, '.elf') : undefined;
      const detail = attempted ? ` Tried to infer ${attempted}.` : '';
      throw new Error(`Missing required --elf <path>.${detail}`);
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
