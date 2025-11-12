import path from 'path';
import { loadMemoryMap } from '../config/loader';
import { Analysis, AnalyzeBuildParams, createEmptyAnalysis } from '../model';
import { resolveToolchain } from '../toolchain/resolver';
import { runCommand } from '../utils/exec';
import { parseReadelfSections } from '../parsers/readelf';
import { parseObjdumpSectionHeaders } from '../parsers/objdump';
import { parseNmOutput } from '../parsers/nm';
import { assignSymbolsToSections } from './symbol-assignment';
import { applySectionCategories } from './section-classification';
import { assignBlocksToSections } from './block-assignment';

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

export const analyzeBuild = async (params: AnalyzeBuildParams): Promise<Analysis> => {
  const { elfPath, mapPath, targetId } = params;
  const toolchain = await resolveToolchain(params);
  const memoryMap = await loadMemoryMap(targetId);

  const analysis = createEmptyAnalysis();

  analysis.target = {
    name: memoryMap.displayName ?? deriveTargetName(targetId),
    addressModel: 'flat',
    pointerSize: 4,
  };

  analysis.build = {
    elfPath: path.resolve(elfPath),
    mapPath: mapPath ? path.resolve(mapPath) : undefined,
    timestamp: new Date().toISOString(),
  };
  analysis.config = memoryMap;

  const sectionsResult = await runCommand(toolchain.readelf, ['-S', analysis.build.elfPath]);
  if (sectionsResult.exitCode !== 0) {
    throw new Error(
      `Failed to read section headers from ELF.\nCommand: ${toolchain.readelf} -S ${analysis.build.elfPath}\n${sectionsResult.stderr.trim()}`,
    );
  }

  const sections = parseReadelfSections(sectionsResult.stdout);

  const objdumpResult = await runCommand(toolchain.objdump, ['-h', analysis.build.elfPath]);
  if (objdumpResult.exitCode !== 0) {
    throw new Error(
      `Failed to read load addresses from ELF.\nCommand: ${toolchain.objdump} -h ${analysis.build.elfPath}\n${objdumpResult.stderr.trim()}`,
    );
  }

  const objdumpSections = parseObjdumpSectionHeaders(objdumpResult.stdout);
  sections.forEach((section) => {
    const info = objdumpSections.get(section.name);
    if (info) {
      section.lmaStart = info.lma;
    }
  });

  const categorizedSections = applySectionCategories(sections, memoryMap.sectionRules);
  const sectionAssignments = assignBlocksToSections(categorizedSections, memoryMap.logicalBlocks);
  analysis.sections = sectionAssignments;

  const nmResult = await runCommand(toolchain.nm, [
    '--print-size',
    '--size-sort',
    '--numeric-sort',
    '--demangle',
    '--line-numbers',
    analysis.build.elfPath,
  ]);
  if (nmResult.exitCode !== 0) {
    throw new Error(
      `Failed to read symbols from ELF.\nCommand: ${toolchain.nm} --print-size --size-sort --numeric-sort --demangle ${analysis.build.elfPath}\n${nmResult.stderr.trim()}`,
    );
  }

  const nmSymbols = parseNmOutput(nmResult.stdout);
  const symbolAssignment = assignSymbolsToSections(nmSymbols, analysis.sections);
  analysis.symbols = symbolAssignment.symbols;

  if (symbolAssignment.warnings.length > 0) {
    symbolAssignment.warnings.forEach((warning) => {
      // eslint-disable-next-line no-console
      console.warn(warning);
    });
  }

  return analysis;
};
