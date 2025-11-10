import { Section, Symbol } from '../model';
import { NmSymbolInfo } from '../parsers/nm';

const withinSection = (section: Section, address: number): boolean =>
  address >= section.vmaStart && address < section.vmaStart + section.size;

const classifySymbolKind = (typeCode: string): Symbol['kind'] => {
  const upper = typeCode.toUpperCase();
  if (upper === 'T' || upper === 'W') {
    return 'func';
  }
  if (['D', 'B', 'R', 'G', 'S'].includes(upper)) {
    return 'object';
  }
  if (upper === 'N') {
    return 'section';
  }
  return 'other';
};

const isWeak = (typeCode: string): boolean => typeCode === 'w' || typeCode === 'W';

const isStatic = (typeCode: string): boolean => typeCode === typeCode.toLowerCase();

interface SymbolAssignmentResult {
  symbols: Symbol[];
  warnings: string[];
}

export const assignSymbolsToSections = (
  nmSymbols: NmSymbolInfo[],
  sections: Section[],
): SymbolAssignmentResult => {
  const warnings: string[] = [];

  const assigned: Symbol[] = nmSymbols.map((symbolInfo, index) => {
    const section = sections.find((entry) => withinSection(entry, symbolInfo.address));

    if (!section) {
      warnings.push(
        `Symbol ${symbolInfo.name} at 0x${symbolInfo.address.toString(16)} does not fall within any known section.`,
      );
    }

    return {
      id: `sym_${index}`,
      name: symbolInfo.name,
      nameMangled: symbolInfo.rawName,
      kind: classifySymbolKind(symbolInfo.typeCode),
      addr: symbolInfo.address,
      size: symbolInfo.size,
      sectionId: section?.id,
      regionId: section?.execRegionId,
      isWeak: isWeak(symbolInfo.typeCode) || undefined,
      isStatic: isStatic(symbolInfo.typeCode) || undefined,
      isTls: undefined,
    };
  });

  return {
    symbols: assigned,
    warnings,
  };
};
