import { Section, SectionBlockAssignment, Symbol, SymbolLocation } from '../model';
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

const selectPrimaryAssignment = (section: Section | undefined): SectionBlockAssignment | undefined => {
  if (!section) {
    return undefined;
  }
  if (section.primaryBlockId && section.blockAssignments.length > 0) {
    const matching = section.blockAssignments.find((assignment) => assignment.blockId === section.primaryBlockId);
    if (matching) {
      return matching;
    }
  }
  return section.blockAssignments.find((assignment) => assignment.addressType !== 'load') ?? section.blockAssignments[0];
};

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
    const primaryAssignment = selectPrimaryAssignment(section);

    let primaryLocation: SymbolLocation | undefined;
    const locations: SymbolLocation[] = [];

    if (section && section.blockAssignments.length > 0) {
      const offsetWithinSection = symbolInfo.address - section.vmaStart;
      section.blockAssignments.forEach((assignment) => {
        if (!Number.isFinite(assignment.address)) {
          return;
        }

        if (offsetWithinSection < 0 || offsetWithinSection >= assignment.size) {
          return;
        }

        const locationAddr = assignment.address + offsetWithinSection;
        const location: SymbolLocation = {
          windowId: assignment.windowId,
          blockId: assignment.blockId,
          addressType: assignment.addressType,
          addr: locationAddr,
        };

        locations.push(location);
        if (!primaryLocation && assignment === primaryAssignment) {
          primaryLocation = location;
        }
      });
    }

    if (!primaryLocation && locations.length > 0) {
      primaryLocation = locations[0];
    }

    return {
      id: `sym_${index}`,
      name: symbolInfo.name,
      nameMangled: symbolInfo.rawName,
      kind: classifySymbolKind(symbolInfo.typeCode),
      addr: symbolInfo.address,
      size: symbolInfo.size,
      sectionId: section?.id,
      blockId: primaryLocation?.blockId ?? primaryAssignment?.blockId,
      windowId: primaryLocation?.windowId ?? primaryAssignment?.windowId,
      isWeak: isWeak(symbolInfo.typeCode) || undefined,
      isStatic: isStatic(symbolInfo.typeCode) || undefined,
      isTls: undefined,
      primaryLocation,
      locations: locations.length > 0 ? locations : undefined,
    };
  });

  const deduped: Symbol[] = [];
  const seen = new Map<string, Symbol>();

  assigned.forEach((symbol) => {
    const key = `${symbol.addr}:${symbol.size}:${symbol.name}`;
    const existing = seen.get(key);
    if (!existing) {
      deduped.push(symbol);
      seen.set(key, symbol);
      return;
    }

    if (symbol.isWeak && !existing.isWeak) {
      existing.isWeak = true;
    }
    if (symbol.isStatic && !existing.isStatic) {
      existing.isStatic = true;
    }
    if (symbol.isTls && !existing.isTls) {
      existing.isTls = true;
    }

    if (symbol.nameMangled && symbol.nameMangled !== existing.nameMangled) {
      const aliasSet = new Set(existing.aliases ?? []);
      aliasSet.add(symbol.nameMangled);
      existing.aliases = Array.from(aliasSet);
    }

    if (symbol.primaryLocation && !existing.primaryLocation) {
      existing.primaryLocation = symbol.primaryLocation;
    }

    if (symbol.locations && symbol.locations.length > 0) {
      if (existing.locations && existing.locations.length > 0) {
        const mergedLocations = new Map<string, SymbolLocation>();
        const addLocation = (location: SymbolLocation): void => {
          const key = `${location.windowId}:${location.blockId ?? 'none'}:${location.addressType}:${location.addr}`;
          if (!mergedLocations.has(key)) {
            mergedLocations.set(key, location);
          }
        };

        existing.locations.forEach(addLocation);
        symbol.locations.forEach(addLocation);
        existing.locations = Array.from(mergedLocations.values());
      } else {
        existing.locations = [...symbol.locations];
      }
    }

    if (!existing.blockId && existing.primaryLocation?.blockId) {
      existing.blockId = existing.primaryLocation.blockId;
    }
    if (!existing.windowId && existing.primaryLocation?.windowId) {
      existing.windowId = existing.primaryLocation.windowId;
    }
  });

  return {
    symbols: deduped,
    warnings,
  };
};
