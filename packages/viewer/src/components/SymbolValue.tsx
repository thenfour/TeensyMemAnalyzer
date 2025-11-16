import { useMemo } from 'react';
import type {
    AddressUsageKind,
    Symbol as AnalyzerSymbol,
    TemplateGroupSymbolSummary,
} from '@analyzer';
import { useAddressFormat } from './AddressValue';
import { useSizeFormat } from './SizeValue';
import Tooltip from './Tooltip';

type TooltipRow = {
    key: string;
    label: string;
    value: string;
};

const ADDRESS_TYPE_LABELS: Record<AddressUsageKind, string> = {
    exec: 'Executable',
    load: 'Load image',
    runtime: 'Runtime',
};

const describeAddress = (
    address: number | undefined,
    addressType: AddressUsageKind | undefined,
    formatAddress: (value: number | undefined, override?: 'hex' | 'decimal') => string,
): string | null => {
    if (address === undefined || Number.isNaN(address)) {
        return null;
    }
    const parts: string[] = [formatAddress(address, 'hex')];
    const typeLabel = addressType ? ADDRESS_TYPE_LABELS[addressType] ?? addressType : null;
    if (typeLabel) {
        parts.push(typeLabel);
    }
    return parts.join(' • ');
};

const formatSourceLocation = (symbol: AnalyzerSymbol | undefined): string | null => {
    if (!symbol?.source) {
        return null;
    }
    const { file, line } = symbol.source;
    return `${file}:${line}`;
};

const formatLogicalPath = (symbol: AnalyzerSymbol | undefined): string | null => {
    if (!symbol?.logicalPath || symbol.logicalPath.length === 0) {
        return null;
    }
    return symbol.logicalPath.join(' → ');
};

const formatAliases = (symbol: AnalyzerSymbol | undefined): string | null => {
    if (!symbol?.aliases || symbol.aliases.length === 0) {
        return null;
    }
    return symbol.aliases.join(', ');
};

const formatAttributes = (symbol: AnalyzerSymbol | undefined): string | null => {
    if (!symbol) {
        return null;
    }
    const traits: string[] = [];
    if (symbol.isWeak) {
        traits.push('Weak');
    }
    if (symbol.isStatic) {
        traits.push('Static');
    }
    if (symbol.isTls) {
        traits.push('TLS');
    }
    return traits.length > 0 ? traits.join(' • ') : null;
};

interface SymbolValueProps {
    symbolId: string;
    symbol?: AnalyzerSymbol;
    summary?: TemplateGroupSymbolSummary;
    className?: string;
}

const SymbolValue = ({ symbolId, symbol, summary, className }: SymbolValueProps): JSX.Element => {
    const { formatValue: formatAddress } = useAddressFormat();
    const { formatValue: formatSize } = useSizeFormat();

    const displayName = symbol?.name ?? summary?.name ?? symbolId;

    const rows = useMemo(() => {
        const entries: TooltipRow[] = [];

        entries.push({ key: 'name', label: 'Demangled', value: displayName });

        const mangled = symbol?.nameMangled ?? summary?.mangledName;
        if (mangled && mangled !== displayName) {
            entries.push({ key: 'mangled', label: 'Mangled', value: mangled });
        }

        entries.push({ key: 'id', label: 'Symbol ID', value: symbolId });

        const specializationKey = summary?.specializationKey;
        if (specializationKey) {
            entries.push({ key: 'specialization', label: 'Specialization', value: specializationKey });
        }

        if (symbol?.kind) {
            entries.push({ key: 'kind', label: 'Kind', value: symbol.kind });
        }

        const attributes = formatAttributes(symbol);
        if (attributes) {
            entries.push({ key: 'attributes', label: 'Attributes', value: attributes });
        }

        const sizeValue = symbol?.size ?? summary?.sizeBytes;
        if (typeof sizeValue === 'number' && Number.isFinite(sizeValue)) {
            entries.push({ key: 'size', label: 'Size', value: formatSize(sizeValue, 'bytes') });
        }

        const primaryLocation = symbol?.primaryLocation ?? summary?.primaryLocation;
        const primaryAddress = describeAddress(primaryLocation?.addr ?? symbol?.addr ?? summary?.addr, primaryLocation?.addressType, formatAddress);
        if (primaryAddress) {
            entries.push({ key: 'address', label: 'Primary address', value: primaryAddress });
        }

        const sectionId = symbol?.sectionId ?? summary?.sectionId;
        if (sectionId) {
            entries.push({ key: 'section', label: 'Section', value: sectionId });
        }

        const blockId = primaryLocation?.blockId ?? symbol?.blockId ?? summary?.blockId;
        if (blockId) {
            entries.push({ key: 'block', label: 'Block', value: blockId });
        }

        const windowId = primaryLocation?.windowId ?? symbol?.windowId ?? summary?.windowId;
        if (windowId) {
            entries.push({ key: 'window', label: 'Window', value: windowId });
        }

        const sourceLocation = formatSourceLocation(symbol);
        if (sourceLocation) {
            entries.push({ key: 'source', label: 'Source', value: sourceLocation });
        }

        const logicalPath = formatLogicalPath(symbol);
        if (logicalPath) {
            entries.push({ key: 'logical-path', label: 'Logical path', value: logicalPath });
        }

        const aliases = formatAliases(symbol);
        if (aliases) {
            entries.push({ key: 'aliases', label: 'Aliases', value: aliases });
        }

        const locationCount = symbol?.locations?.length ?? 0;
        if (locationCount > 1) {
            entries.push({
                key: 'locations',
                label: 'Additional locations',
                value: `${locationCount - 1} alternate location${locationCount - 1 === 1 ? '' : 's'}`,
            });
        }

        return entries;
    }, [displayName, formatAddress, formatSize, symbol, symbolId, summary]);

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

    const buttonClassName = className ? `${className} symbol-value` : 'symbol-value';

    return (
        <Tooltip content={tooltipContent}>
            <button type="button" className={buttonClassName}>
                {displayName}
            </button>
        </Tooltip>
    );
};

export default SymbolValue;
