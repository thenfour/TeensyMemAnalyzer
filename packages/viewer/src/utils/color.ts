export const hashColor = (key: string): string => {
    let hash = 0;

    for (let i = 0; i < key.length; i += 1) {
        hash = (hash << 5) - hash + key.charCodeAt(i);
        hash |= 0; // force 32-bit
    }

    const hue = Math.abs(hash) % 360;
    const saturation = 55;
    const lightness = 68;

    return `hsl(${hue} ${saturation}% ${lightness}%)`;
};
