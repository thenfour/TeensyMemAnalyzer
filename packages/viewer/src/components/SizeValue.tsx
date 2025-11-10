import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import Tooltip from './Tooltip';

export type SizeDisplayFormat = 'pretty' | 'bytes' | 'kilobytes' | 'hex';

interface SizeFormatContextValue {
    format: SizeDisplayFormat;
    formatValue: (value: number | undefined, override?: SizeDisplayFormat) => string;
    cycleFormat: () => void;
}

const SizeFormatContext = createContext<SizeFormatContextValue | undefined>(undefined);

const formatPretty = (value: number): string => {
    if (value >= 1024 * 1024) {
        return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
    }
    if (value >= 1024) {
        return `${(value / 1024).toFixed(1)} KiB`;
    }
    return `${value} B`;
};

const formatKilobytes = (value: number): string => `${(value / 1024).toFixed(2)} KiB`;

const formatBytesDecimal = (value: number): string => `${value.toLocaleString()} B`;

const formatHex = (value: number): string => `0x${value.toString(16).toUpperCase()}`;

const FORMAT_SEQUENCE: SizeDisplayFormat[] = ['pretty', 'bytes', 'kilobytes', 'hex'];

const FORMATTERS: Record<SizeDisplayFormat, (value: number) => string> = {
    pretty: formatPretty,
    bytes: formatBytesDecimal,
    kilobytes: formatKilobytes,
    hex: formatHex,
};

export const SizeFormatProvider = ({ children }: PropsWithChildren<unknown>): JSX.Element => {
    const [format, setFormat] = useState<SizeDisplayFormat>('pretty');

    const formatValue = useCallback(
        (value: number | undefined, override?: SizeDisplayFormat): string => {
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

    const value = useMemo<SizeFormatContextValue>(
        () => ({
            format,
            formatValue,
            cycleFormat,
        }),
        [format, formatValue, cycleFormat],
    );

    return <SizeFormatContext.Provider value={value}>{children}</SizeFormatContext.Provider>;
};

export const useSizeFormat = (): SizeFormatContextValue => {
    const context = useContext(SizeFormatContext);
    if (!context) {
        throw new Error('useSizeFormat must be used within a SizeFormatProvider');
    }
    return context;
};

interface SizeValueProps {
    value: number | undefined;
    className?: string;
}

export const SizeValue = ({ value, className }: SizeValueProps): JSX.Element => {
    const { format, formatValue, cycleFormat } = useSizeFormat();

    if (value === undefined || Number.isNaN(value)) {
        const emptyClassName = className ? `${className} size-value size-value--empty` : 'size-value size-value--empty';
        return <span className={emptyClassName}>{'—'}</span>;
    }

    const display = formatValue(value, format);
    const tooltip = <div className="address-tooltip">
        <div className="address-tooltip-row">
            <span className="address-tooltip-label">Pretty</span>
            <span>{formatValue(value, 'pretty')}</span>
        </div>
        <div className="address-tooltip-row">
            <span className="address-tooltip-label">Bytes</span>
            <span>{formatValue(value, 'bytes')}</span>
        </div>
        <div className="address-tooltip-row">
            <span className="address-tooltip-label">KiB</span>
            <span>{formatValue(value, 'kilobytes')}</span>
        </div>
        <div className="address-tooltip-row">
            <span className="address-tooltip-label">Hex</span>
            <span>{formatValue(value, 'hex')}</span>
        </div>
        <div className="address-tooltip-row">
            <span className="address-tooltip-label">Note</span>
            <span>Click to change size display format</span>
        </div>
    </div>;

    const combinedClassName = className ? `${className} size-value` : 'size-value';

    return (
        <Tooltip content={tooltip}>
            <button type="button" className={combinedClassName} onClick={cycleFormat}>
                {display}
            </button>
        </Tooltip>
    );
};
