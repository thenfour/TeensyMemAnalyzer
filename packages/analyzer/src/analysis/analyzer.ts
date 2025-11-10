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

  // TODO: populate sections, symbols, and summaries by parsing the ELF/MAP files.
  void toolchain;

  return analysis;
};
