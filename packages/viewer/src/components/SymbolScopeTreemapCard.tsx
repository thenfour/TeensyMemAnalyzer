import type { Analysis } from '@analyzer';
import type { TreemapSymbolFilters } from '../treemap';
import TreemapCardBase from './treemap/TreemapCardBase';
import { scopeTreemapConfig } from './treemap/scopeTreemapConfig';

interface SymbolScopeTreemapCardProps {
    analysis: Analysis | null;
    lastRunCompletedAt: Date | null;
    filters?: TreemapSymbolFilters;
}

const SymbolScopeTreemapCard = ({ analysis, lastRunCompletedAt, filters }: SymbolScopeTreemapCardProps): JSX.Element => (
    <TreemapCardBase
        analysis={analysis}
        lastRunCompletedAt={lastRunCompletedAt}
        filters={filters}
        config={scopeTreemapConfig}
    />
);

export default SymbolScopeTreemapCard;
