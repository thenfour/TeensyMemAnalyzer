// NOTE: These labels mirror the fixed section categories emitted by the analyzer today.
// Once the analyzer exposes category metadata per target we should lift these definitions
// from config instead of hard-coding them here.
export type MemoryCategoryKey =
    | 'Code'
    | 'Fast Code'
    | 'Const Data'
    | 'Init Data'
    | 'BSS'
    | 'DMA'
    | 'Other';

export interface MemoryCategoryDescriptor {
    key: MemoryCategoryKey;
    label: string;
}

export const MEMORY_CATEGORY_DESCRIPTORS: MemoryCategoryDescriptor[] = [
    { key: 'Code', label: 'Code sections' },
    { key: 'Fast Code', label: 'Fast code (ITCM)' },
    { key: 'Const Data', label: 'Const/Progmem' },
    { key: 'Init Data', label: 'Initialized data' },
    { key: 'BSS', label: 'Zero-init data' },
    { key: 'DMA', label: 'DMA sections' },
    { key: 'Other', label: 'Other allocated' },
];

export const MEMORY_CATEGORY_LABEL_BY_KEY: Record<MemoryCategoryKey, string> = MEMORY_CATEGORY_DESCRIPTORS.reduce(
    (acc, descriptor) => {
        acc[descriptor.key] = descriptor.label;
        return acc;
    },
    {} as Record<MemoryCategoryKey, string>,
);