export type LogicalBlockRole = 'exec' | 'load' | 'runtime' | (string & {});

export type AddressUsageKind = 'exec' | 'load' | 'runtime';

export type RoundingMode = 'ceil' | 'floor' | 'nearest';

export interface AddressWindow {
  id: string;
  name: string;
  description?: string;
  notes?: string;
  baseAddress?: number;
  sizeBytes?: number;
  reservations?: AddressWindowReservation[];
}

export interface AddressWindowReservation {
  id: string;
  label: string;
  sizeBytes: number;
  startOffset: number;
  notes?: string;
}

export interface HardwareBankRoundingRule {
  granuleBytes: number;
  mode: RoundingMode;
  logicalBlockIds: string[];
}

export interface HardwareBank {
  id: string;
  name: string;
  description?: string;
  capacityBytes: number;
  windowIds: string[];
  roundingRules?: HardwareBankRoundingRule[];
}

export interface SectionCategory {
  id: string;
  name: string;
  description?: string;
  notes?: string;
}

export interface LogicalBlock {
  id: string;
  name: string;
  description?: string;
  categoryId: string;
  windowId: string;
  role?: LogicalBlockRole;
  reportTags?: string[];
  notes?: string;
}

export interface SectionRuleMatch {
  equals?: string;
  prefix?: string;
  suffix?: string;
  regex?: string;
}

export interface SectionRule {
  match: SectionRuleMatch;
  categoryId: string;
  notes?: string;
}

export interface TagBucketsConfig {
  [bucket: string]: string[];
}

export interface TeensySizeReportEntryConfig {
  hardwareBankId: string;
  codeBlockIds?: string[];
  dataBlockIds?: string[];
  blockIds?: string[];
  tagBuckets?: TagBucketsConfig;
}

export interface ReportsConfig {
  teensySize?: Record<string, TeensySizeReportEntryConfig>;
}

export interface MemoryMapConfig {
  targetId: string;
  displayName?: string;
  notes?: string;
  addressWindows: AddressWindow[];
  hardwareBanks: HardwareBank[];
  sectionCategories: SectionCategory[];
  logicalBlocks: LogicalBlock[];
  sectionRules: SectionRule[];
  reports?: ReportsConfig;
}

export interface SectionFlags {
  alloc: boolean;
  exec: boolean;
  write: boolean;
  tls?: boolean;
}

export interface SectionBlockAssignment {
  blockId: string;
  windowId: string;
  role?: LogicalBlockRole;
  addressType: AddressUsageKind;
  address: number;
  size: number;
  reportTags: string[];
}

export interface Section {
  id: string;
  name: string;
  vmaStart: number;
  size: number;
  lmaStart?: number;
  flags: SectionFlags;
  categoryId?: string;
  blockAssignments: SectionBlockAssignment[];
  primaryBlockId?: string;
  primaryWindowId?: string;
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
  blockId?: string;
  windowId?: string;
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
  runtimeBytes: number;
  loadImageBytes: number;
  fileOnlyBytes: number;
}

export interface CategorySummary {
  categoryId: string;
  runtimeBytes: number;
  loadImageBytes: number;
}

export interface FileOnlySectionSummary {
  sectionId: string;
  name: string;
  size: number;
}

export interface FileOnlySummary {
  totalBytes: number;
  sections: FileOnlySectionSummary[];
}

export interface WindowUsageByRole {
  addressType: AddressUsageKind;
  bytes: number;
}

export interface WindowCategoryBreakdown {
  categoryId: string;
  bytes: number;
}

export interface WindowBlockBreakdown {
  blockId: string;
  bytes: number;
}

export interface WindowSectionPlacement {
  sectionId: string;
  blockId: string;
  addressType: AddressUsageKind;
  start: number;
  size: number;
}

export interface WindowSummary {
  windowId: string;
  totalBytes: number;
  byRole: WindowUsageByRole[];
  byCategory: WindowCategoryBreakdown[];
  byBlock: WindowBlockBreakdown[];
  spanBytes: number;
  paddingBytes: number;
  largestGapBytes: number;
  placements: WindowSectionPlacement[];
}

export interface HardwareBankRoundingDetail {
  logicalBlockIds: string[];
  granuleBytes: number;
  mode: RoundingMode;
  rawBytes: number;
  adjustedBytes: number;
  deltaBytes: number;
}

export interface HardwareBankWindowBreakdown {
  windowId: string;
  bytes: number;
}

export interface HardwareBankBlockBreakdown {
  blockId: string;
  bytes: number;
}

export type HardwareBankSpanKind = 'occupied' | 'free' | 'reserved';

export interface HardwareBankLayoutSpan {
  id: string;
  label: string;
  kind: HardwareBankSpanKind;
  sizeBytes: number;
  startOffset: number;
  endOffset: number;
  startAddress?: number;
  endAddress?: number;
  windowId?: string;
  blockIds?: string[];
  reservationId?: string;
}

export interface HardwareBankLayout {
  totalBytes: number;
  spans: HardwareBankLayoutSpan[];
}

export type HardwareBankBlockSpanKind = 'block' | 'free' | 'reserved' | 'padding';

export interface HardwareBankBlockLayoutSpan {
  id: string;
  label: string;
  kind: HardwareBankBlockSpanKind;
  sizeBytes: number;
  startOffset: number;
  endOffset: number;
  startAddress?: number;
  endAddress?: number;
  windowId?: string;
  blockId?: string;
  reservationId?: string;
  parentSpanId: string;
  sectionIds?: string[];
}

export interface HardwareBankBlockLayout {
  totalBytes: number;
  spans: HardwareBankBlockLayoutSpan[];
}

export interface HardwareBankSummary {
  hardwareBankId: string;
  name: string;
  description?: string;
  capacityBytes: number;
  rawUsedBytes: number;
  adjustedUsedBytes: number;
  freeBytes: number;
  reservedBytes: number;
  rounding: HardwareBankRoundingDetail[];
  windowBreakdown: HardwareBankWindowBreakdown[];
  blockBreakdown: HardwareBankBlockBreakdown[];
  layout: HardwareBankLayout;
  blockLayout: HardwareBankBlockLayout;
}

export interface TagUsageSummary {
  tag: string;
  bytes: number;
}

export interface Summaries {
  totals: TotalsSummary;
  byCategory: CategorySummary[];
  byWindow: WindowSummary[];
  hardwareBanks: HardwareBankSummary[];
  fileOnly: FileOnlySummary;
  tagTotals: TagUsageSummary[];
}

export interface TeensySizeReportEntrySummary {
  hardwareBankId: string;
  capacityBytes: number;
  rawUsedBytes: number;
  adjustedUsedBytes: number;
  freeBytes: number;
  codeBytes?: number;
  dataBytes?: number;
  blockBytes?: number;
  bucketTotals: Record<string, number>;
}

export type TeensySizeReportSummary = Record<string, TeensySizeReportEntrySummary>;

export interface Analysis {
  target: TargetInfo;
  build: BuildInfo;
  config: MemoryMapConfig;
  sections: Section[];
  symbols: Symbol[];
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
  config: {
    targetId: 'unknown',
    addressWindows: [],
    hardwareBanks: [],
    sectionCategories: [],
    logicalBlocks: [],
    sectionRules: [],
    reports: {},
  },
  sections: [],
  symbols: [],
});

export interface AnalyzeBuildParams {
  elfPath: string;
  mapPath?: string;
  targetId: string;
  toolchainPrefix?: string;
  toolchainDir?: string;
}
