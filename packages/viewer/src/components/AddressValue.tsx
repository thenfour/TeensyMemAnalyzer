import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';
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
}

interface AddressValueProps {
    value: number | undefined;
    meta?: AddressMetadata;
    className?: string;
}

const AddressValue = ({ value, meta, className }: AddressValueProps): JSX.Element => {
    const { format, formatValue, cycleFormat } = useAddressFormat();

    if (value === undefined || Number.isNaN(value)) {
        const emptyClassName = className ? `${className} address-value address-value--empty` : 'address-value address-value--empty';
        return <span className={emptyClassName}>{'—'}</span>;
    }

    const display = formatValue(value, format);
    const tooltipContent = (
        <div className="address-tooltip">
            <div className="address-tooltip-row">
                <span className="address-tooltip-label">Hex</span>
                <span>{formatValue(value, 'hex')}</span>
            </div>
            <div className="address-tooltip-row">
                <span className="address-tooltip-label">Decimal</span>
                <span>{formatValue(value, 'decimal')}</span>
            </div>
            {meta?.label ? (
                <div className="address-tooltip-row">
                    <span className="address-tooltip-label">Label</span>
                    <span>{meta.label}</span>
                </div>
            ) : null}
            {meta?.regionName || meta?.regionId ? (
                <div className="address-tooltip-row">
                    <span className="address-tooltip-label">Region</span>
                    <span>
                        {meta.regionName ?? meta.regionId}
                        {meta.regionId && meta.regionName ? ` (${meta.regionId})` : null}
                    </span>
                </div>
            ) : null}
            {meta?.regionKind || meta?.regionKindLabel ? (
                <div className="address-tooltip-row">
                    <span className="address-tooltip-label">Kind</span>
                    <span>{meta.regionKindLabel ?? meta.regionKind}</span>
                </div>
            ) : null}
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
