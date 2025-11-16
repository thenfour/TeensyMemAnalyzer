import type { Symbol as AnalyzerSymbol } from '@analyzer';
import AddressValue from './AddressValue';
import { SizeValue } from './SizeValue';
import SymbolValue from './SymbolValue';

export interface SymbolContribution {
    id: string;
    symbolId: string;
    name: string;
    addr: number;
    coverage: number;
    size: number;
}

interface SymbolContributionTableProps {
    symbols: SymbolContribution[];
    symbolLookup: Map<string, AnalyzerSymbol>;
    emptyMessage?: string;
}

const SymbolContributionTable = ({ symbols, symbolLookup, emptyMessage = 'No symbols available.' }: SymbolContributionTableProps): JSX.Element => {
    if (symbols.length === 0) {
        return <p className="symbol-table-empty">{emptyMessage}</p>;
    }

    return (
        <div className="symbol-table">
            <table>
                <thead>
                    <tr>
                        <th scope="col">Symbol</th>
                        <th scope="col">Address</th>
                        <th scope="col">Coverage</th>
                    </tr>
                </thead>
                <tbody>
                    {symbols.map((symbol) => (
                        <tr key={symbol.id}>
                            <th scope="row" className="symbol-table-name">
                                <SymbolValue symbolId={symbol.symbolId} symbol={symbolLookup.get(symbol.symbolId)} />
                            </th>
                            <td className="symbol-table-address">
                                <AddressValue value={symbol.addr} />
                            </td>
                            <td className="symbol-table-size">
                                <SizeValue value={symbol.coverage} />
                                {symbol.coverage < symbol.size ? (
                                    <span className="symbol-table-size-total">
                                        {' '}
                                        of <SizeValue value={symbol.size} />
                                    </span>
                                ) : null}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default SymbolContributionTable;
