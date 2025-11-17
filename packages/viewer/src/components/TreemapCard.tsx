import type { Analysis } from '@analyzer';
import type { TreemapSymbolFilters } from '../treemap';
import TreemapCardBase from './treemap/TreemapCardBase';
import { memoryTreemapConfig } from './treemap/memoryTreemapConfig';

interface MemoryTreemapCardProps {
    analysis: Analysis | null;
    lastRunCompletedAt: Date | null;
    filters?: TreemapSymbolFilters;
}

const MemoryTreemapCard = ({ analysis, lastRunCompletedAt, filters }: MemoryTreemapCardProps): JSX.Element => (
    <TreemapCardBase analysis={analysis} lastRunCompletedAt={lastRunCompletedAt} filters={filters} config={memoryTreemapConfig} />
);

export default MemoryTreemapCard;
