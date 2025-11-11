#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import {
  analyzeBuild,
  AnalyzeBuildParams,
  Analysis,
  SourceLocation,
  Symbol as AnalysisSymbol,
  calculateTeensySizeReport,
  resolveSymbolSource,
  generateSummaries,
  Summaries,
  TeensySizeReportSummary,
} from '@teensy-mem-explorer/analyzer';
import {
  printHeader,
  printSummaryTotals,
  printHardwareBanks,
  printWindows,
  printTagTotals,
  printFileOnlySections,
  PrintContext,
  formatBytes,
} from './formatters';

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

const selectTopSymbols = (symbols: AnalysisSymbol[], limit: number): AnalysisSymbol[] =>
  [...symbols]
    .filter((symbol) => symbol.size > 0)
    .sort((a, b) => b.size - a.size || a.name.localeCompare(b.name))
    .slice(0, limit);

const printTeensySizeReport = (report: TeensySizeReportSummary | undefined): void => {
  if (!report || Object.keys(report).length === 0) {
    return;
  }

  console.log('\nTeensy-size fields:');
  Object.entries(report).forEach(([name, entry]) => {
    console.log(`  ${name}:`);
    console.log(`    Capacity:   ${formatBytes(entry.capacityBytes)}`);
    console.log(`    Raw used:   ${formatBytes(entry.rawUsedBytes)}`);
    console.log(`    Adjusted:   ${formatBytes(entry.adjustedUsedBytes)}`);
    console.log(`    Free:       ${formatBytes(entry.freeBytes)}`);

    if (entry.codeBytes !== undefined) {
      console.log(`    Code bytes: ${formatBytes(entry.codeBytes)}`);
    }
    if (entry.dataBytes !== undefined) {
      console.log(`    Data bytes: ${formatBytes(entry.dataBytes)}`);
    }
    if (entry.blockBytes !== undefined) {
      console.log(`    Block bytes:${formatBytes(entry.blockBytes)}`);
    }

    const bucketEntries = Object.entries(entry.bucketTotals ?? {});
    if (bucketEntries.length > 0) {
      console.log('    Buckets:');
      bucketEntries.forEach(([bucket, bytes]) => {
        console.log(`      ${bucket}: ${formatBytes(bytes)}`);
      });
    }
  });
};

const printTopSymbols = async (context: PrintContext): Promise<void> => {
  const topSymbols = selectTopSymbols(context.analysis.symbols, 10);
  if (topSymbols.length === 0) {
    return;
  }

  console.log('\nTop symbols (window/block):');
  for (const symbol of topSymbols) {
    const location = await context.lookupSymbolSource(symbol);
    const locationSuffix = formatSourceLocationSuffix(location);
    const windowLabel = symbol.windowId ?? 'unknown-window';
    const blockLabel = symbol.blockId ? `/${symbol.blockId}` : '';
    console.log(
      `  ${formatBytes(symbol.size).padStart(10)}  ${symbol.name}  (${windowLabel}${blockLabel})${locationSuffix}`,
    );
  }
};

const printAnalysis = async (context: PrintContext): Promise<void> => {
  printHeader(context);
  printSummaryTotals(context);
  printHardwareBanks(context);
  printWindows(context);
  printTagTotals(context);
  printFileOnlySections(context);
  printTeensySizeReport(context.report);
  await printTopSymbols(context);
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
    const summaries = generateSummaries(analysis);
    const report = calculateTeensySizeReport(analysis, { summaries });

    const lookupSource = createSymbolSourceLookup(analysis, {
      toolchainDir,
      toolchainPrefix,
    });

    if (outputFormat === 'json') {
      console.log(JSON.stringify({ analysis, summaries, report }, null, 2));
    } else {
      const context: PrintContext = {
        analysis,
        summaries,
        report,
        lookupSymbolSource: lookupSource,
      };
      await printAnalysis(context);
    }
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
};

main();
