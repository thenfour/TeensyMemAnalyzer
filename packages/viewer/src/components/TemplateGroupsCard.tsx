import { useMemo, useState } from 'react';
import type { Symbol as AnalyzerSymbol, TemplateGroupSummary } from '@analyzer';
import { SizeValue } from './SizeValue';
import SymbolValue from './SymbolValue';

interface TemplateGroupsCardProps {
    groups: TemplateGroupSummary[];
    symbols: AnalyzerSymbol[];
    lastRunCompletedAt: Date | null;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

type SortKey =
    | 'size'
    | 'uniqueSize'
    | 'symbolCount'
    | 'specializationCount'
    | 'largestInstance'
    | 'smallestInstance'
    | 'name';

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
    { value: 'size', label: 'Total size' },
    { value: 'uniqueSize', label: 'Unique size' },
    { value: 'symbolCount', label: 'Symbol count' },
    { value: 'specializationCount', label: 'Specializations' },
    { value: 'largestInstance', label: 'Largest instance' },
    { value: 'smallestInstance', label: 'Smallest instance' },
    { value: 'name', label: 'Name' },
];

const matchesFilter = (group: TemplateGroupSummary, needle: string): boolean => {
    if (!needle) {
        return true;
    }

    const fields: string[] = [group.displayName, group.id];
    group.specializations.forEach((spec) => {
        if (spec.key) {
            fields.push(spec.key);
        }
    });
    group.symbols.forEach((symbol) => {
        fields.push(symbol.name);
        if (symbol.mangledName) {
            fields.push(symbol.mangledName);
        }
    });

    return fields.some((field) => field.toLowerCase().includes(needle));
};

const TemplateGroupsCard = ({ groups, symbols, lastRunCompletedAt }: TemplateGroupsCardProps): JSX.Element => {
    const [filterText, setFilterText] = useState('');
    const [showTemplates, setShowTemplates] = useState(true);
    const [showNonTemplates, setShowNonTemplates] = useState(true);
    const [includeSingleSpecialization, setIncludeSingleSpecialization] = useState(false);
    const [groupLimit, setGroupLimit] = useState<number>(PAGE_SIZE_OPTIONS[1]);
    const [sortKey, setSortKey] = useState<SortKey>('size');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

    const normalizedFilter = filterText.trim().toLowerCase();

    const symbolById = useMemo(() => new Map(symbols.map((symbol) => [symbol.id, symbol])), [symbols]);

    const filteredGroups = useMemo(() =>
        groups.filter((group) => {
            if (!showTemplates && group.isTemplate) {
                return false;
            }
            if (!showNonTemplates && !group.isTemplate) {
                return false;
            }
            if (!includeSingleSpecialization && group.totals.specializationCount <= 1) {
                return false;
            }
            return matchesFilter(group, normalizedFilter);
        }),
        [groups, showTemplates, showNonTemplates, includeSingleSpecialization, normalizedFilter]);

    const sortedGroups = useMemo(() => {
        const list = [...filteredGroups];
        const compare = (a: TemplateGroupSummary, b: TemplateGroupSummary): number => {
            switch (sortKey) {
                case 'size':
                    return a.totals.sizeBytes - b.totals.sizeBytes;
                case 'uniqueSize':
                    return a.totals.uniqueSizeBytes - b.totals.uniqueSizeBytes;
                case 'symbolCount':
                    return a.totals.symbolCount - b.totals.symbolCount;
                case 'specializationCount':
                    return a.totals.specializationCount - b.totals.specializationCount;
                case 'largestInstance':
                    return a.totals.largestSymbolSizeBytes - b.totals.largestSymbolSizeBytes;
                case 'smallestInstance':
                    return a.totals.smallestSymbolSizeBytes - b.totals.smallestSymbolSizeBytes;
                case 'name':
                default:
                    return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
            }
        };

        list.sort((a, b) => {
            const result = compare(a, b);
            return sortOrder === 'desc' ? -result : result;
        });

        return list;
    }, [filteredGroups, sortKey, sortOrder]);

    const limitedGroups = useMemo(
        () => sortedGroups.slice(0, Math.max(groupLimit, 0)),
        [sortedGroups, groupLimit],
    );

    return (
        <section className="summary-card template-group-card">
            <div className="summary-header">
                <h2>Template Groups</h2>
                <div className="summary-meta">
                    {lastRunCompletedAt ? (
                        <span className="summary-updated">Based on {lastRunCompletedAt.toLocaleString()}</span>
                    ) : (
                        <span className="summary-updated">Awaiting first analysis</span>
                    )}
                </div>
            </div>

            <div className="template-group-controls">
                <label>
                    <span>Filter</span>
                    <input
                        type="text"
                        value={filterText}
                        onChange={(event) => setFilterText(event.target.value)}
                        placeholder="Search groups, specializations, or symbols"
                    />
                </label>
                <label className="toggle">
                    <input
                        type="checkbox"
                        checked={showTemplates}
                        onChange={(event) => setShowTemplates(event.target.checked)}
                    />
                    <span>Show template groups</span>
                </label>
                <label className="toggle">
                    <input
                        type="checkbox"
                        checked={showNonTemplates}
                        onChange={(event) => setShowNonTemplates(event.target.checked)}
                    />
                    <span>Show non-template symbols</span>
                </label>
                <label className="toggle">
                    <input
                        type="checkbox"
                        checked={includeSingleSpecialization}
                        onChange={(event) => setIncludeSingleSpecialization(event.target.checked)}
                    />
                    <span>Include single-specialization groups</span>
                </label>
                <label>
                    <span>Sort by</span>
                    <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
                        {SORT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
                <button
                    type="button"
                    className="template-group-sort-order"
                    onClick={() => setSortOrder((current) => (current === 'desc' ? 'asc' : 'desc'))}
                >
                    {sortOrder === 'desc' ? '↓ Descending' : '↑ Ascending'}
                </button>
                <label>
                    <span>Show</span>
                    <select
                        value={groupLimit}
                        onChange={(event) => setGroupLimit(Number.parseInt(event.target.value, 10))}
                    >
                        {PAGE_SIZE_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                                {option}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            <p className="template-group-count">
                Showing {Math.min(limitedGroups.length, filteredGroups.length)} of {filteredGroups.length} matching groups.
            </p>

            {filteredGroups.length === 0 ? (
                <p className="summary-placeholder">No matching template groups.</p>
            ) : (
                <div className="template-group-list">
                    {limitedGroups.map((group) => (
                        <details key={group.id} className="template-group">
                            <summary>
                                <div className="template-group-summary">
                                    <div className="template-group-title">
                                        <span className="template-group-name">{group.displayName}</span>
                                        <span className={`chip chip--${group.isTemplate ? 'info' : 'neutral'}`}>
                                            {group.isTemplate ? 'Template' : 'Non-template'}
                                        </span>
                                    </div>
                                    <div className="template-group-metrics">
                                        <span>
                                            Symbols: <strong>{group.totals.symbolCount.toLocaleString()}</strong>
                                        </span>
                                        <span>
                                            Specializations: <strong>{group.totals.specializationCount.toLocaleString()}</strong>
                                        </span>
                                        <span>
                                            Total size: <SizeValue value={group.totals.sizeBytes} />
                                        </span>
                                        <span>
                                            Unique size: <SizeValue value={group.totals.uniqueSizeBytes} />
                                        </span>
                                        <span>
                                            Largest instance: <SizeValue value={group.totals.largestSymbolSizeBytes} />
                                        </span>
                                        <span>
                                            Smallest instance: <SizeValue value={group.totals.smallestSymbolSizeBytes} />
                                        </span>
                                    </div>
                                </div>
                            </summary>
                            <div className="template-group-details">
                                {group.specializations.length > 0 ? (
                                    <div className="template-group-specializations">
                                        <h3>Specializations</h3>
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th scope="col">Key</th>
                                                    <th scope="col">Symbols</th>
                                                    <th scope="col">Size</th>
                                                    <th scope="col">Unique size</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {group.specializations.map((spec) => (
                                                    <tr key={spec.key ?? 'null'}>
                                                        <th scope="row">{spec.key ?? '—'}</th>
                                                        <td>{spec.totals.symbolCount.toLocaleString()}</td>
                                                        <td>
                                                            <SizeValue value={spec.totals.sizeBytes} />
                                                        </td>
                                                        <td>
                                                            <SizeValue value={spec.totals.uniqueSizeBytes} />
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : null}

                                <div className="template-group-symbols">
                                    <h3>Symbols</h3>
                                    <table>
                                        <thead>
                                            <tr>
                                                <th scope="col">Symbol</th>
                                                <th scope="col">Specialization</th>
                                                <th scope="col">Size</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {group.symbols.map((symbol) => (
                                                <tr key={symbol.symbolId}>
                                                    <th scope="row">
                                                        <SymbolValue
                                                            symbolId={symbol.symbolId}
                                                            symbol={symbolById.get(symbol.symbolId)}
                                                            summary={symbol}
                                                        />
                                                    </th>
                                                    <td>{symbol.specializationKey ?? '—'}</td>
                                                    <td>
                                                        <SizeValue value={symbol.sizeBytes} />
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </details>
                    ))}
                </div>
            )}
        </section>
    );
};

export default TemplateGroupsCard;
