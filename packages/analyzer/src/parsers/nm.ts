export interface NmSymbolInfo {
  address: number;
  size: number;
  typeCode: string;
  name: string;
  rawName: string;
}

const NM_LINE_REGEX = /^\s*([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([A-Za-z])\s+(.+)$/;

const parseHex = (value: string): number => parseInt(value, 16);

export const parseNmOutput = (stdout: string): NmSymbolInfo[] => {
  const symbols: NmSymbolInfo[] = [];

  stdout.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Archive ') || trimmed.includes(" .debug")) {
      return;
    }

    const match = NM_LINE_REGEX.exec(trimmed);
    if (!match) {
      return;
    }

    const [, addrHex, sizeHex, typeCode, name] = match;

    if (typeCode.toUpperCase() === 'U') {
      return;
    }

    const address = parseHex(addrHex);
    const size = parseHex(sizeHex);

    symbols.push({
      address,
      size,
      typeCode,
      name,
      rawName: name,
    });
  });

  return symbols;
};
