import {
  Analysis,
  LogicalBlock,
  Summaries,
  TeensySizeReportEntryConfig,
  TeensySizeReportEntrySummary,
  TeensySizeReportSummary,
} from '../../model';
import { generateSummaries } from '../summaries';

export interface CalculateTeensySizeReportOptions {
  reportConfig?: Record<string, TeensySizeReportEntryConfig>;
  summaries?: Summaries;
}

interface BlockUsage {
  total: number;
  runtime: number;
  load: number;
  tags: Map<string, number>;
}

const buildBlockUsageIndex = (analysis: Analysis): Map<string, BlockUsage> => {
  const index = new Map<string, BlockUsage>();

  analysis.config.logicalBlocks.forEach((block) => {
    index.set(block.id, {
      total: 0,
      runtime: 0,
      load: 0,
      tags: new Map<string, number>(),
    });
  });

  analysis.sections.forEach((section) => {
    section.blockAssignments.forEach((assignment) => {
      const current = index.get(assignment.blockId);
      if (!current) {
        return;
      }

      current.total += assignment.size;
      if (assignment.addressType === 'load') {
        current.load += assignment.size;
      } else {
        current.runtime += assignment.size;
      }

      assignment.reportTags.forEach((tag) => {
        current.tags.set(tag, (current.tags.get(tag) ?? 0) + assignment.size);
      });
    });
  });

  return index;
};

const getLogicalBlock = (blocks: LogicalBlock[], blockId: string): LogicalBlock => {
  const found = blocks.find((block) => block.id === blockId);
  if (!found) {
    throw new Error(`Unknown logical block referenced in report: ${blockId}`);
  }
  return found;
};

const sumBlockUsage = (
  blockIds: string[] | undefined,
  index: Map<string, BlockUsage>,
  mode: 'runtime' | 'load' | 'total',
): number => {
  if (!blockIds || blockIds.length === 0) {
    return 0;
  }

  return blockIds.reduce((total, blockId) => {
    const usage = index.get(blockId);
    if (!usage) {
      throw new Error(`Report references block ${blockId} which has no recorded usage.`);
    }

    switch (mode) {
      case 'runtime':
        return total + usage.runtime;
      case 'load':
        return total + usage.load;
      case 'total':
      default:
        return total + usage.total;
    }
  }, 0);
};

const sumBucket = (tags: string[], totals: Map<string, number>): number =>
  tags.reduce((total, tag) => total + (totals.get(tag) ?? 0), 0);

const extractTagTotals = (summaries: Summaries): Map<string, number> => {
  const totals = new Map<string, number>();
  summaries.tagTotals.forEach((entry) => totals.set(entry.tag, entry.bytes));
  return totals;
};

const buildEntrySummary = (
  key: string,
  config: TeensySizeReportEntryConfig,
  analysis: Analysis,
  summaries: Summaries,
  blockUsage: Map<string, BlockUsage>,
  tagTotals: Map<string, number>,
): TeensySizeReportEntrySummary => {
  const bankConfig = analysis.config.hardwareBanks.find((bank) => bank.id === config.hardwareBankId);
  if (!bankConfig) {
    throw new Error(`Report ${key} references unknown hardware bank ${config.hardwareBankId}.`);
  }

  const bankSummary = summaries.hardwareBanks.find((summary) => summary.hardwareBankId === bankConfig.id);
  if (!bankSummary) {
    throw new Error(`No computed summary found for hardware bank ${bankConfig.id}.`);
  }

  const logicalBlocks = analysis.config.logicalBlocks;
  [...(config.codeBlockIds ?? []), ...(config.dataBlockIds ?? []), ...(config.blockIds ?? [])].forEach((blockId) => {
    getLogicalBlock(logicalBlocks, blockId);
  });

  const codeBytes = config.codeBlockIds ? sumBlockUsage(config.codeBlockIds, blockUsage, 'runtime') : undefined;
  const dataBytes = config.dataBlockIds ? sumBlockUsage(config.dataBlockIds, blockUsage, 'runtime') : undefined;
  const totalBlockBytes = config.blockIds ? sumBlockUsage(config.blockIds, blockUsage, 'total') : undefined;

  const bucketTotals: Record<string, number> = {};
  if (config.tagBuckets) {
    Object.entries(config.tagBuckets).forEach(([bucketName, tags]) => {
      bucketTotals[bucketName] = sumBucket(tags, tagTotals);
    });
  }

  return {
    hardwareBankId: bankConfig.id,
    capacityBytes: bankConfig.capacityBytes,
    rawUsedBytes: bankSummary.rawUsedBytes,
    adjustedUsedBytes: bankSummary.adjustedUsedBytes,
    freeBytes: bankSummary.freeBytes,
    codeBytes,
    dataBytes,
    blockBytes: totalBlockBytes,
    bucketTotals,
  };
};

export const calculateTeensySizeReport = (
  analysis: Analysis,
  options: CalculateTeensySizeReportOptions = {},
): TeensySizeReportSummary => {
  const summaries = options.summaries ?? generateSummaries(analysis);
  const config = options.reportConfig ?? analysis.config.reports?.teensySize;
  if (!config) {
    return {};
  }

  const blockUsage = buildBlockUsageIndex(analysis);
  const tagTotals = extractTagTotals(summaries);

  const result: TeensySizeReportSummary = {};
  Object.entries(config).forEach(([key, entry]) => {
    result[key] = buildEntrySummary(key, entry, analysis, summaries, blockUsage, tagTotals);
  });

  return result;
};
