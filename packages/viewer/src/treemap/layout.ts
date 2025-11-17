import { hierarchy, treemap as d3Treemap, treemapSquarify } from 'd3-hierarchy';
import type { HierarchyRectangularNode } from 'd3-hierarchy';
import type { TreemapNode, TreemapTree } from './types';

export interface TreemapLayoutOptions {
    width: number;
    height: number;
    paddingInner?: number;
    paddingOuter?: number;
    paddingTop?: number;
    paddingRight?: number;
    paddingBottom?: number;
    paddingLeft?: number;
    round?: boolean;
}

export interface TreemapLayoutNode<K extends string = string, M = unknown> {
    id: string;
    depth: number;
    x: number;
    y: number;
    width: number;
    height: number;
    value: number;
    data: TreemapNode<K, M>;
    parentId?: string;
    children?: TreemapLayoutNode<K, M>[];
    isLeaf: boolean;
}

export type TreemapLayoutTree<K extends string = string, M = unknown> = TreemapLayoutNode<K, M>;

const DEFAULT_OPTIONS: Required<Omit<TreemapLayoutOptions, 'width' | 'height'>> = {
    paddingInner: 2,
    paddingOuter: 2,
    paddingTop: 2,
    paddingRight: 2,
    paddingBottom: 2,
    paddingLeft: 2,
    round: false,
};

const normalizeOptions = (options: TreemapLayoutOptions): TreemapLayoutOptions => ({
    ...DEFAULT_OPTIONS,
    ...options,
});

const toLayoutNode = <K extends string, M>(
    node: HierarchyRectangularNode<TreemapNode<K, M>>,
): TreemapLayoutNode<K, M> => {
    const width = Math.max(0, (node.x1 ?? 0) - (node.x0 ?? 0));
    const height = Math.max(0, (node.y1 ?? 0) - (node.y0 ?? 0));
    const children = node.children?.map(toLayoutNode<K, M>);

    return {
        id: node.data.id,
        depth: node.depth,
        x: node.x0 ?? 0,
        y: node.y0 ?? 0,
        width,
        height,
        value: typeof node.value === 'number' ? node.value : node.data.value,
        data: node.data,
        parentId: node.parent?.data.id,
        children,
        isLeaf: !children || children.length === 0,
    } satisfies TreemapLayoutNode<K, M>;
};

export const computeTreemapLayout = <K extends string, M>(
    tree: TreemapTree<K, M>,
    options: TreemapLayoutOptions,
): TreemapLayoutTree<K, M> | null => {
    if (!tree) {
        return null;
    }

    const { width, height, paddingInner, paddingOuter, paddingLeft, paddingRight, paddingTop, paddingBottom, round } = normalizeOptions(options);

    const root = hierarchy<TreemapNode<K, M>>(tree, (node) => node.children ?? []);

    root.sum((node) => {
        // Internal nodes already carry aggregated values. Returning them here would
        // cause d3.sum to double-count when it adds the children again. Only emit
        // a weight for leaves so the hierarchy stays area-equal.
        if (node.children && node.children.length > 0) {
            return 0;
        }

        const rawValue = Number.isFinite(node.value) ? node.value : 0;
        return rawValue > 0 ? rawValue : 0;
    });
    root.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    if (!root.value || root.value <= 0) {
        return null;
    }

    const treemapLayout = d3Treemap<TreemapNode<K, M>>()
        .tile(treemapSquarify)
        .size([width, height])
        .paddingInner(paddingInner ?? DEFAULT_OPTIONS.paddingInner)
        .paddingOuter(paddingOuter ?? DEFAULT_OPTIONS.paddingOuter)
        .paddingTop(paddingTop ?? DEFAULT_OPTIONS.paddingTop)
        .paddingRight(paddingRight ?? DEFAULT_OPTIONS.paddingRight)
        .paddingBottom(paddingBottom ?? DEFAULT_OPTIONS.paddingBottom)
        .paddingLeft(paddingLeft ?? DEFAULT_OPTIONS.paddingLeft)
        .round(round ?? DEFAULT_OPTIONS.round);

    const laidOut = treemapLayout(root);

    return toLayoutNode(laidOut);
};
