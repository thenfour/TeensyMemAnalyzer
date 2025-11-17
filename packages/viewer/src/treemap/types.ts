export interface TreemapNode<K extends string = string, M = unknown> {
    id: string;
    label: string;
    kind: K;
    value: number;
    meta?: M;
    children?: TreemapNode<K, M>[];
}

export type TreemapTree<K extends string = string, M = unknown> = TreemapNode<K, M>;

export interface TreemapSymbolFilters {
    hardwareBanks?: ReadonlySet<string>;
    windows?: ReadonlySet<string>;
    logicalBlocks?: ReadonlySet<string>;
    sections?: ReadonlySet<string>;
    symbolQuery?: string;
    symbolQueryTokens?: string[];
}
