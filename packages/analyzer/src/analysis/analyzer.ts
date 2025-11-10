import path from 'path';
import { loadMemoryMap } from '../config/loader';
import {
  Analysis,
  AnalyzeBuildParams,
  createEmptyAnalysis,
  MemoryMapConfig,
  Region,
} from '../model';
import { resolveToolchain } from '../toolchain/resolver';
import { runCommand } from '../utils/exec';
import { parseReadelfSections } from '../parsers/readelf';
import { assignRegionsToSections } from './region-assignment';
import { calculateSummaries } from './summaries';

const deriveTargetName = (targetId: string): string => {
  switch (targetId) {
    case 'teensy40':
      return 'Teensy 4.0';
    case 'teensy41':
      return 'Teensy 4.1';
    default:
      return targetId;
  }
};

const mapRegions = (config: MemoryMapConfig): Region[] =>
  config.regions.map((regionConfig) => ({
    ...regionConfig,
    reserved: regionConfig.reserved ?? [],
  }));

export const analyzeBuild = async (params: AnalyzeBuildParams): Promise<Analysis> => {
  const { elfPath, mapPath, targetId } = params;
  const toolchain = await resolveToolchain(params);
  const memoryMap = await loadMemoryMap(targetId);

  const analysis = createEmptyAnalysis();

  analysis.target = {
    name: deriveTargetName(targetId),
    addressModel: 'flat',
    pointerSize: 4,
  };

  analysis.build = {
    elfPath: path.resolve(elfPath),
    mapPath: mapPath ? path.resolve(mapPath) : undefined,
    timestamp: new Date().toISOString(),
  };

  analysis.regions = mapRegions(memoryMap);

  const sectionsResult = await runCommand(toolchain.readelf, ['-S', analysis.build.elfPath]);
  if (sectionsResult.exitCode !== 0) {
    throw new Error(
      `Failed to read section headers from ELF.\nCommand: ${toolchain.readelf} -S ${analysis.build.elfPath}\n${sectionsResult.stderr.trim()}`,
    );
  }

  const sections = parseReadelfSections(sectionsResult.stdout);
  const regionAssignment = assignRegionsToSections(analysis.regions, sections);
  analysis.sections = regionAssignment.sections;

  if (regionAssignment.warnings.length > 0) {
    // TODO: surface warnings in analysis metadata once available.
    // Currently, we simply log them for visibility.
    regionAssignment.warnings.forEach((warning) => {
      // eslint-disable-next-line no-console
      console.warn(warning);
    });
  }

  analysis.summaries = calculateSummaries(analysis.regions, analysis.sections);

  void toolchain; // placeholder until we use other commands

  return analysis;
};
