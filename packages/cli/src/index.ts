#!/usr/bin/env node

import path from 'path';
import { analyzeBuild, AnalyzeBuildParams, Analysis, RegionSummary } from '@teensy-mem-explorer/analyzer';

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

const printRegionSummary = (regionSummary: RegionSummary, analysis: Analysis): void => {
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
};

const printAnalysis = (analysis: Analysis): void => {
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

  analysis.summaries.byRegion.forEach((regionSummary) => {
    printRegionSummary(regionSummary, analysis);
  });

  console.log('\nTop symbols (region id) by size:');
  const topSymbols = [...analysis.symbols]
    .filter((symbol) => symbol.size > 0)
    .sort((a, b) => b.size - a.size)
    .slice(0, 10);

  topSymbols.forEach((symbol) => {
    console.log(
      `  ${formatBytes(symbol.size).padStart(10)}  ${symbol.name}  (${symbol.regionId ?? 'unknown'})`,
    );
  });
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

    if (outputFormat === 'json') {
      console.log(JSON.stringify(analysis, null, 2));
    } else {
      printAnalysis(analysis);
    }
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
};

main();
