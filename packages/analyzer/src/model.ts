export type RegionKind =
  | 'flash'
  | 'code_ram'
  | 'data_ram'
  | 'dma_ram'
  | 'ext_ram'
  | 'other';

export interface RegionReserve {
  name: string;
  start: number;
  size: number;
}

export interface Region {
  id: string;
  name: string;
  kind: RegionKind;
  start: number;
  size: number;
  reserved?: RegionReserve[];
}

export type RuntimeBankKind = 'flash' | 'ram' | 'external' | 'other';

export interface RuntimeBankSegmentConfig {
  regionId: string;
  start?: number;
  size?: number;
}

export interface RuntimeBankConfig {
  id: string;
  name: string;
  kind: RuntimeBankKind;
  segments: RuntimeBankSegmentConfig[];
  description?: string;
  capacityBytes?: number;
}

export interface RuntimeGroupConfig {
  id: string;
  name: string;
  bankIds: string[];
  description?: string;
}

export type SectionCategory =
  | 'code'
  | 'code_fast'
  | 'rodata'
  | 'data_init'
  | 'bss'
  | 'dma'
  | 'other';

export interface SectionFlags {
  alloc: boolean;
  exec: boolean;
  write: boolean;
  tls?: boolean;
}

export interface Section {
  id: string;
  name: string;
  vmaStart: number;
  size: number;
  execRegionId?: string;
  lmaStart?: number;
  loadRegionId?: string;
  isCopySection?: boolean;
  category: SectionCategory;
  flags: SectionFlags;
}

export type SymbolKind = 'func' | 'object' | 'section' | 'file' | 'other';

export interface SourceLocation {
  file: string;
  line: number;
}

export interface Symbol {
  id: string;
  nameMangled: string;
  name: string;
  kind: SymbolKind;
  addr: number;
  size: number;
  sectionId?: string;
  regionId?: string;
  isWeak?: boolean;
  isStatic?: boolean;
  isTls?: boolean;
  source?: SourceLocation;
  logicalPath?: string[];
}

export interface TargetInfo {
  name: string;
  addressModel: 'flat';
  pointerSize: number;
}

export interface BuildInfo {
  elfPath: string;
  mapPath?: string;
  buildId?: string;
  timestamp?: string;
}

export interface TotalsSummary {
  flashUsed: number;
  flashCode: number;
  flashConst: number;
  flashInitImages: number;
  ramUsed: number;
  ramCode: number;
  ramDataInit: number;
  ramBss: number;
  ramDma: number;
}

export interface RegionSummary {
  regionId: string;
  size: number;
  usedStatic: number;
  usedByCategory: Partial<Record<SectionCategory, number>>;
  reserved: number;
  freeForDynamic: number;
  paddingBytes: number;
  largestGapBytes: number;
}

export interface CategorySummary {
  category: SectionCategory;
  bytes: number;
}

export interface FileOnlySummary {
  totalBytes: number;
  byCategory: CategorySummary[];
}

export interface RuntimeBankContributorSummary {
  regionId: string;
  regionName: string;
  sizeBytes: number;
  usedStaticBytes: number;
  reservedBytes: number;
}

export interface RuntimeBankSummary {
  bankId: string;
  name: string;
  kind: RuntimeBankKind;
  description?: string;
  capacityBytes: number;
  usedStaticBytes: number;
  reservedBytes: number;
  freeBytes: number;
  contributors: RuntimeBankContributorSummary[];
}

export interface RuntimeGroupSummary {
  groupId: string;
  name: string;
  description?: string;
  capacityBytes: number;
  usedStaticBytes: number;
  reservedBytes: number;
  freeBytes: number;
  bankIds: string[];
}

export interface Summaries {
  totals: TotalsSummary;
  byRegion: RegionSummary[];
  byCategory: CategorySummary[];
  fileOnly: FileOnlySummary;
  runtimeBanks: RuntimeBankSummary[];
  runtimeGroups: RuntimeGroupSummary[];
}

export interface Analysis {
  target: TargetInfo;
  build: BuildInfo;
  regions: Region[];
  sections: Section[];
  symbols: Symbol[];
  summaries: Summaries;
}

export interface MemoryMapRegionConfig extends Region {}

export interface MemoryMapConfig {
  targetId: string;
  regions: MemoryMapRegionConfig[];
  runtimeBanks?: RuntimeBankConfig[];
  runtimeGroups?: RuntimeGroupConfig[];
}

export const createEmptyAnalysis = (): Analysis => ({
  target: {
    name: 'Unknown',
    addressModel: 'flat',
    pointerSize: 4,
  },
  build: {
    elfPath: '',
  },
  regions: [],
  sections: [],
  symbols: [],
  summaries: {
    totals: {
      flashUsed: 0,
      flashCode: 0,
      flashConst: 0,
      flashInitImages: 0,
      ramUsed: 0,
      ramCode: 0,
      ramDataInit: 0,
      ramBss: 0,
      ramDma: 0,
    },
    byRegion: [],
    byCategory: [],
    fileOnly: {
      totalBytes: 0,
      byCategory: [],
    },
    runtimeBanks: [],
    runtimeGroups: [],
  },
});

export interface AnalyzeBuildParams {
  elfPath: string;
  mapPath?: string;
  targetId: string;
  toolchainPrefix?: string;
  toolchainDir?: string;
}
