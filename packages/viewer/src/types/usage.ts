import type { AddressUsageKind } from '@teensy-mem-explorer/analyzer';

export type RangeBounds = {
    start: number;
    end: number;
};

export type AddressRangeMeta = {
    occupied?: RangeBounds;
    total: RangeBounds;
    regionId?: string;
    regionName?: string;
    regionKind?: string;
    regionKindLabel?: string;
    addressType?: AddressUsageKind;
};

export type UsageBarData = {
    id: string;
    label: string;
    used: number | undefined;
    total: number | undefined;
    free?: number | undefined;
    percent: number | null;
    description?: string;
    addressRange?: AddressRangeMeta;
};
