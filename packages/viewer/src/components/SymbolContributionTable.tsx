import AddressValue from './AddressValue';
import { SizeValue } from './SizeValue';

export interface SymbolContribution {
    id: string;
    name: string;
    addr: number;
    coverage: number;
    size: number;
}

interface SymbolContributionTableProps {
    symbols: SymbolContribution[];
    emptyMessage?: string;
}

const SymbolContributionTable = ({ symbols, emptyMessage = 'No symbols available.' }: SymbolContributionTableProps): JSX.Element => {
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
                            <th scope="row" className="symbol-table-name">{symbol.name}</th>
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
