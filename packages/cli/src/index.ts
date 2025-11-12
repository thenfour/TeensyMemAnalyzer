#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import {
  analyzeBuild,
  AnalyzeBuildParams,
  Symbol as AnalysisSymbol,
  calculateTeensySizeReport,
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

const formatSourceLocationSuffix = (location: AnalysisSymbol['source']): string => {
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

const formatReportNumber = (value: number | undefined): string => (value ?? 0).toString();

const getBucketValue = (entry: NonNullable<TeensySizeReportSummary[string]>, bucket: string): number =>
  entry.bucketTotals?.[bucket] ?? 0;

const sumBucketValues = (entry: NonNullable<TeensySizeReportSummary[string]>, buckets: string[]): number =>
  buckets.reduce((total, bucket) => total + getBucketValue(entry, bucket), 0);

const printTeensySizeReport = (context: PrintContext): void => {
  const report = context.report;
  if (!report || Object.keys(report).length === 0) {
    return;
  }

  console.log(`\nteensy_size: Memory Usage on ${context.analysis.target.name}:`);

  const flash = report.flash;
  if (flash) {
    const flashCode = getBucketValue(flash, 'code');
    const flashData = getBucketValue(flash, 'data');
    const flashHeaders = getBucketValue(flash, 'headers');
    console.log(
      `teensy_size:   FLASH: code:${formatReportNumber(flashCode)}, data:${formatReportNumber(
        flashData,
      )}, headers:${formatReportNumber(flashHeaders)}   free for files:${formatReportNumber(flash.freeBytes)}`,
    );
  }

  const ram1 = report.ram1;
  if (ram1) {
    const variables = sumBucketValues(ram1, ['data', 'bss', 'noinit']);
    const codeBytes = ram1.codeBytes ?? getBucketValue(ram1, 'code');
    const padding = Math.max(ram1.adjustedUsedBytes - ram1.rawUsedBytes, 0);
    console.log(
      `teensy_size:    RAM1: variables:${formatReportNumber(variables)}, code:${formatReportNumber(
        codeBytes,
      )}, padding:${formatReportNumber(padding)}   free for local variables:${formatReportNumber(ram1.freeBytes)}`,
    );
  }

  const ram2 = report.ram2;
  if (ram2) {
    const variables = sumBucketValues(ram2, ['data', 'bss', 'noinit']);
    console.log(
      `teensy_size:    RAM2: variables:${formatReportNumber(variables)}  free for malloc/new:${formatReportNumber(
        ram2.freeBytes,
      )}`,
    );
  }
};

const printTopSymbols = (context: PrintContext): void => {
  const topSymbols = selectTopSymbols(context.analysis.symbols, 10);
  if (topSymbols.length === 0) {
    return;
  }

  console.log('\nTop symbols (window/block):');
  for (const symbol of topSymbols) {
    const extendedSymbol = symbol as AnalysisSymbol & {
      primaryLocation?: {
        windowId?: string;
        blockId?: string;
      };
      locations?: Array<{
        windowId?: string;
        blockId?: string;
      }>;
    };

    const location = symbol.source;
    const locationSuffix = formatSourceLocationSuffix(location);
    const primaryLocation = extendedSymbol.primaryLocation ?? extendedSymbol.locations?.[0];
    const windowLabel = primaryLocation?.windowId ?? symbol.windowId ?? 'unknown-window';
    const blockId = primaryLocation?.blockId ?? symbol.blockId;
    const blockLabel = blockId ? `/${blockId}` : '';
    console.log(
      `  ${formatBytes(symbol.size).padStart(10)}  ${symbol.name}  (${windowLabel}${blockLabel})${locationSuffix}`,
    );
  }
};

const printAnalysis = (context: PrintContext): void => {
  printHeader(context);
  printSummaryTotals(context);
  printHardwareBanks(context);
  printWindows(context);
  printTagTotals(context);
  printFileOnlySections(context);
  printTeensySizeReport(context);
  printTopSymbols(context);
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

    if (outputFormat === 'json') {
      console.log(JSON.stringify({ analysis, summaries, report }, null, 2));
    } else {
      const context: PrintContext = {
        analysis,
        summaries,
        report,
      };
      printAnalysis(context);
    }
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
};

main();
