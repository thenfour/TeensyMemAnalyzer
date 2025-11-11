import {
  Analysis,
  SourceLocation,
  Summaries,
  Symbol,
  TeensySizeReportSummary,
} from '@teensy-mem-explorer/analyzer';

export const formatBytes = (bytes: number): string => `${bytes} B`;

const formatPercent = (used: number, capacity: number): string => {
  if (capacity <= 0) {
    return 'n/a';
  }
  return `${Math.round((used / capacity) * 1000) / 10}%`;
};

export interface PrintContext {
  analysis: Analysis;
  summaries: Summaries;
  report?: TeensySizeReportSummary;
  lookupSymbolSource: (symbol: Symbol) => Promise<SourceLocation | undefined>;
}

export const printHeader = (context: PrintContext): void => {
  const { analysis } = context;
  console.log(`Target: ${analysis.target.name}`);
  console.log(`ELF:    ${analysis.build.elfPath}`);
  if (analysis.build.mapPath) {
    console.log(`MAP:    ${analysis.build.mapPath}`);
  }
};

export const printSummaryTotals = (context: PrintContext): void => {
  const { totals } = context.summaries;
  console.log('\nRuntime totals:');
  console.log(`  Runtime bytes:    ${formatBytes(totals.runtimeBytes)}`);
  console.log(`  Load image bytes: ${formatBytes(totals.loadImageBytes)}`);
};

export const printHardwareBanks = (context: PrintContext): void => {
  const { hardwareBanks } = context.summaries;
  if (hardwareBanks.length === 0) {
    return;
  }

  console.log('\nHardware banks:');
  hardwareBanks.forEach((bank) => {
    console.log(`  ${bank.name} (${bank.hardwareBankId})`);
    console.log(`    Capacity:   ${formatBytes(bank.capacityBytes)}`);
    console.log(`    Raw used:   ${formatBytes(bank.rawUsedBytes)} (${formatPercent(bank.rawUsedBytes, bank.capacityBytes)})`);
    console.log(
      `    Adjusted:  ${formatBytes(bank.adjustedUsedBytes)} (${formatPercent(
        bank.adjustedUsedBytes,
        bank.capacityBytes,
      )})`,
    );
    console.log(`    Free:       ${formatBytes(bank.freeBytes)}`);
    bank.rounding
      .filter((entry) => entry.deltaBytes !== 0)
      .forEach((entry) => {
        console.log(
          `    Rounding:  ${entry.logicalBlockIds.join(', ')} -> ${formatBytes(entry.adjustedBytes)} (${entry.mode} granule ${
            entry.granuleBytes
          })`,
        );
      });
  });
};

export const printWindows = (context: PrintContext): void => {
  const { byWindow } = context.summaries;
  if (byWindow.length === 0) {
    return;
  }

  console.log('\nAddress windows:');
  byWindow.forEach((windowSummary) => {
    console.log(`  ${windowSummary.windowId}`);
    console.log(`    Total bytes: ${formatBytes(windowSummary.totalBytes)}`);
    console.log(`    Span bytes:  ${formatBytes(windowSummary.spanBytes)}`);
    if (windowSummary.paddingBytes > 0 || windowSummary.largestGapBytes > 0) {
      console.log(`    Padding:     ${formatBytes(windowSummary.paddingBytes)} (largest gap ${formatBytes(windowSummary.largestGapBytes)})`);
    }
    if (windowSummary.byCategory.length > 0) {
      console.log('    Categories:');
      windowSummary.byCategory.forEach((entry) => {
        console.log(`      ${entry.categoryId}: ${formatBytes(entry.bytes)}`);
      });
    }
    if (windowSummary.byBlock.length > 0) {
      console.log('    Blocks:');
      windowSummary.byBlock.forEach((entry) => {
        console.log(`      ${entry.blockId}: ${formatBytes(entry.bytes)}`);
      });
    }
  });
};

export const printTagTotals = (context: PrintContext): void => {
  const { tagTotals } = context.summaries;
  if (tagTotals.length === 0) {
    return;
  }

  console.log('\nReport tags:');
  tagTotals.forEach((entry) => {
    console.log(`  ${entry.tag}: ${formatBytes(entry.bytes)}`);
  });
};

export const printFileOnlySections = (context: PrintContext): void => {
  const { fileOnly } = context.summaries;
  if (fileOnly.totalBytes === 0) {
    return;
  }

  console.log('\nFile-only sections (non-ALLOC):');
  console.log(`  Total: ${formatBytes(fileOnly.totalBytes)}`);
  fileOnly.sections
    .filter((entry) => entry.size > 0)
    .sort((a, b) => b.size - a.size)
    .forEach((entry) => {
      console.log(`    ${entry.name}: ${formatBytes(entry.size)}`);
    });
};
