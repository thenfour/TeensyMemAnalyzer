import type { Symbol } from '../model';
import type {
  TemplateGroupSpecializationSummary,
  TemplateGroupSummary,
  TemplateGroupSymbolSummary,
} from '../model';

const NON_TEMPLATE_GROUP_PREFIX = '[non-template]';

interface TemplateParseResult {
  groupName: string;
  specializationKey: string | null;
}

const parseTemplateSignature = (name: string): TemplateParseResult | null => {
  const ltIndex = name.indexOf('<');
  if (ltIndex === -1) {
    return null;
  }

  const baseCandidate = name.slice(0, ltIndex).trim();
  if (!baseCandidate) {
    return null;
  }

  // Heuristic: require the character before '<' to be an identifier character or '>'/']'
  const precedingChar = baseCandidate[baseCandidate.length - 1];
  if (!/[A-Za-z0-9_>\]\)]/.test(precedingChar)) {
    return null;
  }

  let depth = 0;
  for (let index = ltIndex; index < name.length; index += 1) {
    const char = name[index];
    if (char === '<') {
      depth += 1;
    } else if (char === '>') {
      depth -= 1;
      if (depth === 0) {
        const specialization = name.slice(ltIndex + 1, index).trim();
        return {
          groupName: baseCandidate,
          specializationKey: specialization.length > 0 ? specialization : null,
        } satisfies TemplateParseResult;
      }
    }
  }

  return null;
};

interface UniqueSizeTracker {
  add(key: string, size: number): void;
  total(): number;
}

const createUniqueSizeTracker = (): UniqueSizeTracker => {
  const map = new Map<string, number>();
  return {
    add: (key: string, size: number) => {
      const existing = map.get(key);
      if (existing === undefined || size > existing) {
        map.set(key, size);
      }
    },
    total: () => Array.from(map.values()).reduce((sum, value) => sum + value, 0),
  } satisfies UniqueSizeTracker;
};

interface GroupAccumulator {
  id: string;
  displayName: string;
  isTemplate: boolean;
  symbols: TemplateGroupSymbolSummary[];
  specializations: Map<string | null, SpecializationAccumulator>;
  uniqueSizes: UniqueSizeTracker;
  largestSymbolSize: number;
  smallestSymbolSize: number;
}

interface SpecializationAccumulator {
  key: string | null;
  symbols: TemplateGroupSymbolSummary[];
  uniqueSizes: UniqueSizeTracker;
}

const createGroupAccumulator = (id: string, displayName: string, isTemplate: boolean): GroupAccumulator => ({
  id,
  displayName,
  isTemplate,
  symbols: [],
  specializations: new Map<string | null, SpecializationAccumulator>(),
  uniqueSizes: createUniqueSizeTracker(),
  largestSymbolSize: 0,
  smallestSymbolSize: Number.POSITIVE_INFINITY,
});

const createSpecializationAccumulator = (key: string | null): SpecializationAccumulator => ({
  key,
  symbols: [],
  uniqueSizes: createUniqueSizeTracker(),
});

const buildUniqueSizeKey = (symbol: Symbol): string => {
  const sectionId = symbol.sectionId ?? 'unknown-section';
  const addr = symbol.primaryLocation?.addr ?? symbol.addr ?? Number.NaN;
  return `${sectionId}:${Number.isFinite(addr) ? addr : 'unknown-addr'}`;
};

const toTemplateGroupSymbolSummary = (
  symbol: Symbol,
  specializationKey: string | null,
): TemplateGroupSymbolSummary => ({
  symbolId: symbol.id,
  name: symbol.name,
  mangledName: symbol.nameMangled || undefined,
  sizeBytes: Number.isFinite(symbol.size) ? symbol.size : 0,
  specializationKey,
  sectionId: symbol.sectionId,
  blockId: symbol.blockId,
  windowId: symbol.windowId,
  addr: symbol.addr,
  primaryLocation: symbol.primaryLocation,
});

const finalizeSpecialization = (acc: SpecializationAccumulator): TemplateGroupSpecializationSummary => ({
  key: acc.key,
  symbols: acc.symbols,
  totals: {
    symbolCount: acc.symbols.length,
    sizeBytes: acc.symbols.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    uniqueSizeBytes: acc.uniqueSizes.total(),
  },
});

export const buildTemplateGroups = (symbols: Symbol[]): TemplateGroupSummary[] => {
  const groups = new Map<string, GroupAccumulator>();

  symbols.forEach((symbol) => {
    const parsed = parseTemplateSignature(symbol.name ?? '');
    const isTemplate = parsed !== null;
    const groupId = isTemplate ? parsed.groupName : `${NON_TEMPLATE_GROUP_PREFIX} ${symbol.name}`;
    const displayName = isTemplate ? parsed!.groupName : symbol.name;
    const specializationKey = parsed?.specializationKey ?? null;

    let group = groups.get(groupId);
    if (!group) {
      group = createGroupAccumulator(groupId, displayName, isTemplate);
      groups.set(groupId, group);
    }

    const summary = toTemplateGroupSymbolSummary(symbol, specializationKey);
    group.symbols.push(summary);

    const uniqueKey = buildUniqueSizeKey(symbol);
    group.uniqueSizes.add(uniqueKey, summary.sizeBytes);

    if (summary.sizeBytes > group.largestSymbolSize) {
      group.largestSymbolSize = summary.sizeBytes;
    }
    if (summary.sizeBytes < group.smallestSymbolSize) {
      group.smallestSymbolSize = summary.sizeBytes;
    }

    let specialization = group.specializations.get(specializationKey);
    if (!specialization) {
      specialization = createSpecializationAccumulator(specializationKey);
      group.specializations.set(specializationKey, specialization);
    }

    specialization.symbols.push(summary);
    specialization.uniqueSizes.add(uniqueKey, summary.sizeBytes);
  });

  return Array.from(groups.values()).map((group) => {
    const specializations = Array.from(group.specializations.values()).map(finalizeSpecialization);
    const sizeBytes = group.symbols.reduce((sum, entry) => sum + entry.sizeBytes, 0);
    const uniqueSizeBytes = group.uniqueSizes.total();

    return {
      id: group.id,
      displayName: group.displayName,
      isTemplate: group.isTemplate,
      symbols: group.symbols,
      specializations,
      totals: {
        symbolCount: group.symbols.length,
        specializationCount: specializations.length,
        sizeBytes,
        uniqueSizeBytes,
        largestSymbolSizeBytes: group.largestSymbolSize,
        smallestSymbolSizeBytes: Number.isFinite(group.smallestSymbolSize)
          ? group.smallestSymbolSize
          : 0,
      },
    } satisfies TemplateGroupSummary;
  });
};
