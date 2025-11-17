export interface TreemapNode<K extends string = string, M = unknown> {
    id: string;
    label: string;
    kind: K;
    value: number;
    meta?: M;
    children?: TreemapNode<K, M>[];
}

export type TreemapTree<K extends string = string, M = unknown> = TreemapNode<K, M>;
