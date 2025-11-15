import type {
  AddressUsageKind,
  AddressWindow,
  Analysis,
  HardwareBank,
  LogicalBlock,
  Section,
  SectionBlockAssignment,
  Symbol as AnalyzerSymbol,
} from '../model';

export interface AddressLookupOptions {
  addressType?: AddressUsageKind;
}

export interface AddressLookupRegion {
  addressType?: AddressUsageKind;
  windowId?: string;
  windowName?: string;
  blockId?: string;
  blockName?: string;
  bankId?: string;
  bankName?: string;
  start: number;
  end: number;
  size: number;
  offset: number;
  windowOffset?: number;
  blockOffset?: number;
}

export interface AddressLookupSection {
  id: string;
  name: string;
  addressType: AddressUsageKind;
  start: number;
  end: number;
  size: number;
  offset: number;
}

export interface AddressLookupSymbol {
  id: string;
  name: string;
  nameMangled?: string;
  address: number;
  size?: number;
  offset: number;
}

export interface AddressLookupResult {
  address: number;
  region?: AddressLookupRegion;
  section?: AddressLookupSection;
  symbol?: AddressLookupSymbol;
}

export interface AddressResolver {
  resolve(address: number, options?: AddressLookupOptions): AddressLookupResult | null;
}

interface AssignmentSpan {
  section: Section;
  assignment: SectionBlockAssignment;
  start: number;
  end: number;
}

interface SectionSpan {
  section: Section;
  addressType: AddressUsageKind;
  start: number;
  end: number;
}

const buildTypePreference = (preferred?: AddressUsageKind): AddressUsageKind[] => {
  if (!preferred) {
    return ['runtime', 'exec', 'load'];
  }

  switch (preferred) {
    case 'exec':
      return ['exec', 'runtime', 'load'];
    case 'load':
      return ['load', 'runtime', 'exec'];
    case 'runtime':
    default:
      return ['runtime', 'exec', 'load'];
  }
};

const toName = (id: string | undefined, entity: { name?: string } | undefined): string | undefined => {
  if (entity?.name) {
    return entity.name;
  }
  return id;
};

export const createAddressResolver = (analysis: Analysis): AddressResolver => {
  const windowById = new Map<string, AddressWindow>();
  analysis.config.addressWindows.forEach((window) => {
    windowById.set(window.id, window);
  });

  const blockById = new Map<string, LogicalBlock>();
  analysis.config.logicalBlocks.forEach((block) => {
    blockById.set(block.id, block);
  });

  const bankByWindowId = new Map<string, HardwareBank>();
  analysis.config.hardwareBanks.forEach((bank) => {
    bank.windowIds.forEach((windowId) => {
      if (!bankByWindowId.has(windowId)) {
        bankByWindowId.set(windowId, bank);
      }
    });
  });

  const assignmentSpans: AssignmentSpan[] = [];
  analysis.sections.forEach((section) => {
    section.blockAssignments.forEach((assignment) => {
      const start = assignment.address;
      const size = assignment.size ?? section.size;
      if (!Number.isFinite(start) || !Number.isFinite(size) || size <= 0) {
        return;
      }
      assignmentSpans.push({
        section,
        assignment,
        start,
        end: start + size,
      });
    });
  });
  assignmentSpans.sort((a, b) => a.start - b.start);

  const sectionSpans: SectionSpan[] = [];
  analysis.sections.forEach((section) => {
    const { size } = section;
    if (!Number.isFinite(size) || size <= 0) {
      return;
    }

    if (typeof section.vmaStart === 'number' && Number.isFinite(section.vmaStart)) {
      sectionSpans.push({
        section,
        addressType: 'runtime',
        start: section.vmaStart,
        end: section.vmaStart + size,
      });
      if (section.flags.exec) {
        sectionSpans.push({
          section,
          addressType: 'exec',
          start: section.vmaStart,
          end: section.vmaStart + size,
        });
      }
    }

    if (typeof section.lmaStart === 'number' && Number.isFinite(section.lmaStart)) {
      sectionSpans.push({
        section,
        addressType: 'load',
        start: section.lmaStart,
        end: section.lmaStart + size,
      });
    }
  });
  sectionSpans.sort((a, b) => a.start - b.start);

  const sortedSymbols = analysis.symbols
    .filter((symbol) => typeof symbol.addr === 'number' && Number.isFinite(symbol.addr))
    .slice()
    .sort((a, b) => a.addr - b.addr);

  const findAssignmentSpan = (address: number, typePreference: AddressUsageKind[]): AssignmentSpan | undefined => {
    for (const preferred of typePreference) {
      let candidate: AssignmentSpan | undefined;
      for (const span of assignmentSpans) {
        if (span.assignment.addressType !== preferred) {
          continue;
        }
        if (span.start > address) {
          break;
        }
        if (address >= span.start && address < span.end) {
          candidate = span;
        }
      }
      if (candidate) {
        return candidate;
      }
    }

    let fallback: AssignmentSpan | undefined;
    for (const span of assignmentSpans) {
      if (span.start > address) {
        break;
      }
      if (address >= span.start && address < span.end) {
        fallback = span;
      }
    }
    return fallback;
  };

  const findSectionSpan = (address: number, typePreference: AddressUsageKind[]): SectionSpan | undefined => {
    for (const preferred of typePreference) {
      let candidate: SectionSpan | undefined;
      for (const span of sectionSpans) {
        if (span.addressType !== preferred) {
          continue;
        }
        if (span.start > address) {
          break;
        }
        if (address >= span.start && address < span.end) {
          candidate = span;
        }
      }
      if (candidate) {
        return candidate;
      }
    }

    let fallback: SectionSpan | undefined;
    for (const span of sectionSpans) {
      if (span.start > address) {
        break;
      }
      if (address >= span.start && address < span.end) {
        fallback = span;
      }
    }
    return fallback;
  };

  const findSymbol = (address: number): AnalyzerSymbol | undefined => {
    if (sortedSymbols.length === 0) {
      return undefined;
    }

    let candidate: AnalyzerSymbol | undefined;
    for (const symbol of sortedSymbols) {
      if (symbol.addr > address) {
        break;
      }
      candidate = symbol;
    }

    if (!candidate) {
      return undefined;
    }

    const offset = address - candidate.addr;
    const size = candidate.size ?? 0;
    const coversAddress = size > 0 ? offset >= 0 && offset < size : offset === 0;
    if (!coversAddress) {
      return undefined;
    }

    return candidate;
  };

  const buildRegion = (address: number, span: AssignmentSpan): AddressLookupRegion => {
    const { assignment, section, start, end } = span;
    const window = windowById.get(assignment.windowId);
    const block = blockById.get(assignment.blockId);
    const bank = bankByWindowId.get(assignment.windowId);
    const size = end - start;
    const offset = address - start;
    const windowOffset = window?.baseAddress !== undefined ? address - window.baseAddress : undefined;

    return {
      addressType: assignment.addressType,
      windowId: assignment.windowId,
      windowName: toName(assignment.windowId, window),
      blockId: assignment.blockId,
      blockName: block ? toName(assignment.blockId, block) : assignment.blockId,
      bankId: bank?.id,
      bankName: bank ? toName(bank.id, bank) : undefined,
      start,
      end,
      size,
      offset,
      blockOffset: offset,
      windowOffset,
    } satisfies AddressLookupRegion;
  };

  const buildSection = (address: number, span: SectionSpan): AddressLookupSection => {
    const { section, addressType, start, end } = span;
    const offset = address - start;

    return {
      id: section.id,
      name: section.name,
      addressType,
      start,
      end,
      size: end - start,
      offset,
    } satisfies AddressLookupSection;
  };

  const buildSymbol = (address: number, symbol: AnalyzerSymbol): AddressLookupSymbol => {
    const offset = address - symbol.addr;
    return {
      id: symbol.id,
      name: symbol.name,
      nameMangled: symbol.nameMangled,
      address: symbol.addr,
      size: symbol.size,
      offset,
    } satisfies AddressLookupSymbol;
  };

  const resolve = (address: number, options?: AddressLookupOptions): AddressLookupResult | null => {
    if (!Number.isFinite(address)) {
      return null;
    }

    const typePreference = buildTypePreference(options?.addressType);
    const regionSpan = findAssignmentSpan(address, typePreference);
    const sectionSpan = findSectionSpan(address, typePreference);
    const symbol = findSymbol(address);

    const region = regionSpan ? buildRegion(address, regionSpan) : undefined;
    const section = sectionSpan ? buildSection(address, sectionSpan) : undefined;
    const symbolInfo = symbol ? buildSymbol(address, symbol) : undefined;

    if (!region && !section && !symbolInfo) {
      return null;
    }

    return {
      address,
      region,
      section,
      symbol: symbolInfo,
    } satisfies AddressLookupResult;
  };

  return {
    resolve,
  } satisfies AddressResolver;
};
