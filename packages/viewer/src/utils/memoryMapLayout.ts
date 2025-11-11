import type { MemoryMapSpan } from '../hooks/useMemoryMapData';

export interface MemoryMapLayoutOptions {
    bankStart: number;
    bankEnd: number;
    totalHeight: number;
    padding: number;
    minSpanHeight: number;
}

export interface MemoryMapSpanLayout {
    span: MemoryMapSpan;
    y: number;
    height: number;
}

export interface MemoryMapProjector {
    spanId: string;
    start: number;
    end: number;
    y: number;
    height: number;
}

const EPSILON = 1e-3;

interface SpanMetric {
    span: MemoryMapSpan;
    baseY: number;
    height: number;
    minHeight: number;
    index: number;
}

/**
 * Computes stacked positions for memory map spans while respecting a minimum visual height.
 * The algorithm starts from the address-scaled layout, then expands small spans up to the
 * configured minimum and finally compresses oversized spans so everything fits inside the track.
 */
export const computeMemoryMapSpanLayout = (
    spans: MemoryMapSpan[],
    options: MemoryMapLayoutOptions,
): { layouts: MemoryMapSpanLayout[]; projector: MemoryMapProjector[] } => {
    const { bankStart, bankEnd, totalHeight, padding, minSpanHeight } = options;

    if (spans.length === 0) {
        return { layouts: [], projector: [] };
    }

    const availableHeight = Math.max(totalHeight - padding * 2, 0);
    const extent = Math.max(bankEnd - bankStart, 0);
    const spanCount = spans.length;
    const effectiveMinHeight = spanCount > 0 && availableHeight > 0 ? Math.min(minSpanHeight, availableHeight / spanCount) : 0;

    const metrics: SpanMetric[] = spans.map((span, index) => {
        const size = typeof span.size === 'number' ? Math.max(span.size, 0) : Math.max(span.end - span.start, 0);
        const naturalHeight = extent > 0 ? (size / extent) * availableHeight : spanCount > 0 ? availableHeight / spanCount : 0;
        const height = Math.max(naturalHeight, effectiveMinHeight);
        const baseY =
            padding +
            (extent > 0
                ? ((bankEnd - span.end) / extent) * availableHeight
                : spanCount > 0
                    ? (index / spanCount) * availableHeight
                    : 0);

        return {
            span,
            baseY: Number.isFinite(baseY) ? baseY : padding,
            height,
            minHeight: effectiveMinHeight,
            index,
        };
    });

    let totalStackHeight = metrics.reduce((sum, metric) => sum + metric.height, 0);

    if (availableHeight > 0 && totalStackHeight > availableHeight + EPSILON) {
        const shrinkCapacity = metrics.reduce(
            (sum, metric) => sum + Math.max(0, metric.height - metric.minHeight),
            0,
        );

        if (shrinkCapacity > EPSILON) {
            const ratio = Math.min(1, (totalStackHeight - availableHeight) / shrinkCapacity);
            metrics.forEach((metric) => {
                const extra = metric.height - metric.minHeight;
                if (extra > EPSILON) {
                    metric.height -= extra * ratio;
                }
            });
            totalStackHeight = metrics.reduce((sum, metric) => sum + metric.height, 0);
        }

        if (totalStackHeight > availableHeight + EPSILON) {
            const scale = availableHeight / totalStackHeight;
            metrics.forEach((metric) => {
                metric.height *= scale;
            });
            totalStackHeight = metrics.reduce((sum, metric) => sum + metric.height, 0);
        }
    }

    const sorted = metrics.slice().sort((a, b) => {
        if (Math.abs(a.baseY - b.baseY) < EPSILON) {
            return a.index - b.index;
        }
        return a.baseY - b.baseY;
    });

    const bottomLimit = padding + availableHeight;
    let cursor = padding;

    const projector: MemoryMapProjector[] = [];

    const layouts = sorted.map((metric) => {
        const height = Math.max(metric.height, 0);
        const y = Math.min(Math.max(metric.baseY, cursor), bottomLimit);
        const remaining = Math.max(bottomLimit - y, 0);
        const clampedHeight = Math.min(height, remaining);
        cursor = y + clampedHeight;

        projector.push({
            spanId: metric.span.id,
            start: metric.span.start,
            end: metric.span.end,
            y,
            height: clampedHeight,
        });

        return {
            span: metric.span,
            y,
            height: clampedHeight,
        };
    });

    return { layouts, projector };
};
