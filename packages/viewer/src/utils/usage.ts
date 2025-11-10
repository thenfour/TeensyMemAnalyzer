export const computeUsagePercent = (used: number | undefined, total: number | undefined): number | null => {
    if (used === undefined || total === undefined || total === 0) {
        return null;
    }
    return Math.min(100, Math.max(0, (used / total) * 100));
};
