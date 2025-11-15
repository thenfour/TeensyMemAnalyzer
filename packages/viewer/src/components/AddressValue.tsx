import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import type { AddressUsageKind } from '@teensy-mem-explorer/analyzer';
import { useAddressResolution } from '../context/AddressResolverContext';
import Tooltip from './Tooltip';

export type AddressDisplayFormat = 'hex' | 'decimal';

interface AddressFormatContextValue {
    format: AddressDisplayFormat;
    formatValue: (value: number | undefined, override?: AddressDisplayFormat) => string;
    cycleFormat: () => void;
}

const AddressFormatContext = createContext<AddressFormatContextValue | undefined>(undefined);

const formatHex = (value: number): string => `0x${value.toString(16).toUpperCase()}`;

const formatDecimal = (value: number): string => value.toLocaleString();

const FORMAT_SEQUENCE: AddressDisplayFormat[] = ['hex', 'decimal'];

const FORMATTERS: Record<AddressDisplayFormat, (value: number) => string> = {
    hex: formatHex,
    decimal: formatDecimal,
};

const ADDRESS_TYPE_LABELS: Record<AddressUsageKind, string> = {
    runtime: 'Runtime',
    exec: 'Executable',
    load: 'Load Image',
};

export const AddressFormatProvider = ({ children }: PropsWithChildren<unknown>): JSX.Element => {
    const [format, setFormat] = useState<AddressDisplayFormat>('hex');

    const formatValue = useCallback(
        (value: number | undefined, override?: AddressDisplayFormat): string => {
            if (value === undefined || Number.isNaN(value)) {
                return '—';
            }
            const selectedFormat = override ?? format;
            const formatter = FORMATTERS[selectedFormat];
            return formatter(value);
        },
        [format],
    );

    const cycleFormat = useCallback(() => {
        setFormat((current) => {
            const currentIndex = FORMAT_SEQUENCE.indexOf(current);
            const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % FORMAT_SEQUENCE.length;
            return FORMAT_SEQUENCE[nextIndex];
        });
    }, []);

    const value = useMemo<AddressFormatContextValue>(
        () => ({
            format,
            formatValue,
            cycleFormat,
        }),
        [format, formatValue, cycleFormat],
    );

    return <AddressFormatContext.Provider value={value}>{children}</AddressFormatContext.Provider>;
};

export const useAddressFormat = (): AddressFormatContextValue => {
    const context = useContext(AddressFormatContext);
    if (!context) {
        throw new Error('useAddressFormat must be used within an AddressFormatProvider');
    }
    return context;
};

export interface AddressMetadata {
    label?: string;
    regionName?: string;
    regionId?: string;
    regionKind?: string;
    regionKindLabel?: string;
    addressType?: AddressUsageKind;
}

interface AddressValueProps {
    value: number | undefined;
    meta?: AddressMetadata;
    className?: string;
}

const AddressValue = ({ value, meta, className }: AddressValueProps): JSX.Element => {
    const { format, formatValue, cycleFormat } = useAddressFormat();
    const { resolveAddress, hasResolver } = useAddressResolution();

    if (value === undefined || Number.isNaN(value)) {
        const emptyClassName = className ? `${className} address-value address-value--empty` : 'address-value address-value--empty';
        return <span className={emptyClassName}>{'—'}</span>;
    }

    const resolution = useMemo(() => {
        if (!hasResolver) {
            return null;
        }
        const options = meta?.addressType ? { addressType: meta.addressType } : undefined;
        return resolveAddress(value, options) ?? null;
    }, [hasResolver, resolveAddress, value, meta?.addressType]);

    const describeSignedOffset = (offset: number | undefined): string | null => {
        if (offset === undefined || Number.isNaN(offset)) {
            return null;
        }
        if (offset === 0) {
            return 'start';
        }
        const magnitude = Math.abs(offset);
        const sign = offset >= 0 ? '+' : '-';
        return `${sign}${formatHex(magnitude)} (${sign}${magnitude.toLocaleString()} bytes)`;
    };

    type TooltipRow = {
        key: string;
        label: string;
        value: string;
    };

    const rows: TooltipRow[] = [
        { key: 'hex', label: 'Hex', value: formatValue(value, 'hex') },
        { key: 'decimal', label: 'Decimal', value: formatValue(value, 'decimal') },
    ];

    if (meta?.label) {
        rows.push({ key: 'label', label: 'Label', value: meta.label });
    }

    const region = resolution?.region;
    const section = resolution?.section;
    const symbol = resolution?.symbol;

    const effectiveRegionName = region?.windowName ?? meta?.regionName ?? meta?.regionId;
    const effectiveRegionId = region?.windowId ?? meta?.regionId;
    const regionLabel = meta?.regionKindLabel ?? meta?.regionKind ?? (region ? 'Region' : undefined);

    if (regionLabel && (effectiveRegionName || effectiveRegionId || region?.addressType || meta?.addressType)) {
        const parts: string[] = [];
        if (effectiveRegionName) {
            parts.push(effectiveRegionName);
        }
        if (effectiveRegionId && effectiveRegionId !== effectiveRegionName) {
            parts.push(`(${effectiveRegionId})`);
        }
        const typeLabel = region?.addressType
            ? ADDRESS_TYPE_LABELS[region.addressType]
            : meta?.addressType
                ? ADDRESS_TYPE_LABELS[meta.addressType]
                : undefined;
        if (typeLabel) {
            parts.push(typeLabel);
        }
        if (parts.length > 0) {
            rows.push({ key: 'region', label: regionLabel, value: parts.join(' • ') });
        }
    }

    const regionOffset = describeSignedOffset(region?.offset);
    if (regionOffset) {
        rows.push({
            key: 'region-offset',
            label: 'Offset in range',
            value: regionOffset === 'start' ? 'Start of range' : regionOffset,
        });
    }

    const windowOffset = describeSignedOffset(region?.windowOffset);
    if (windowOffset) {
        rows.push({
            key: 'window-offset',
            label: 'Offset from window base',
            value: windowOffset === 'start' ? 'At window base' : windowOffset,
        });
    }

    if (region?.blockName || region?.blockId) {
        const parts: string[] = [];
        if (region.blockName) {
            parts.push(region.blockName);
        }
        if (region.blockId && region.blockId !== region.blockName) {
            parts.push(`(${region.blockId})`);
        }
        if (parts.length > 0) {
            rows.push({ key: 'block', label: 'Block', value: parts.join(' • ') });
        }
    }

    if (region?.bankName || region?.bankId) {
        const parts: string[] = [];
        if (region.bankName) {
            parts.push(region.bankName);
        }
        if (region.bankId && region.bankId !== region.bankName) {
            parts.push(`(${region.bankId})`);
        }
        if (parts.length > 0) {
            rows.push({ key: 'bank', label: 'Bank', value: parts.join(' • ') });
        }
    }

    if (section) {
        const parts: string[] = [section.name];
        if (section.id !== section.name) {
            parts.push(`(${section.id})`);
        }
        const sectionTypeLabel = ADDRESS_TYPE_LABELS[section.addressType];
        if (sectionTypeLabel) {
            parts.push(sectionTypeLabel);
        }
        rows.push({ key: 'section', label: 'Section', value: parts.join(' • ') });
    }

    if (symbol) {
        const parts: string[] = [symbol.name];
        if (symbol.nameMangled && symbol.nameMangled !== symbol.name) {
            parts.push(symbol.nameMangled);
        }
        rows.push({ key: 'symbol', label: 'Symbol', value: parts.join(' • ') });

        const symbolOffset = describeSignedOffset(symbol.offset);
        if (symbolOffset) {
            rows.push({
                key: 'symbol-offset',
                label: 'Symbol offset',
                value: symbolOffset === 'start' ? 'At symbol start' : symbolOffset,
            });
        }
        if (symbol.size && symbol.size > 0) {
            rows.push({
                key: 'symbol-size',
                label: 'Symbol size',
                value: `${symbol.size.toLocaleString()} bytes`,
            });
        }
    }

    const display = formatValue(value, format);
    const tooltipContent = (
        <div className="address-tooltip">
            {rows.map((row) => (
                <div className="address-tooltip-row" key={row.key}>
                    <span className="address-tooltip-label">{row.label}</span>
                    <span>{row.value}</span>
                </div>
            ))}
        </div>
    );

    const combinedClassName = className ? `${className} address-value` : 'address-value';

    return (
        <Tooltip content={tooltipContent}>
            <button type="button" className={combinedClassName} onClick={cycleFormat}>
                {display}
            </button>
        </Tooltip>
    );
};

export default AddressValue;
