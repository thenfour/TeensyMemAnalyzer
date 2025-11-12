import path from 'path';
import { SourceLocation } from '../model';

export interface NmSymbolInfo {
  address: number;
  size: number;
  typeCode: string;
  name: string;
  rawName: string;
  source?: SourceLocation;
}

const NM_LINE_REGEX = /^\s*([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([A-Za-z])\s+(.+)$/;

const parseHex = (value: string): number => parseInt(value, 16);

const extractLocation = (line: string): { cleanedLine: string; location?: SourceLocation } => {
  const trimmed = line.trimEnd();
  const match = trimmed.match(/\s+(.+):(\d+)$/);
  if (!match) {
    return { cleanedLine: trimmed };
  }

  const [, filePartRaw, linePart] = match;
  const filePart = filePartRaw.trim();
  if (!filePart) {
    return { cleanedLine: trimmed };
  }

  const lineNumber = parseInt(linePart, 10);
  if (Number.isNaN(lineNumber)) {
    return { cleanedLine: trimmed };
  }

  if (filePart === '??' && lineNumber === 0) {
    return { cleanedLine: trimmed };
  }

  const cleanedLine = trimmed.slice(0, trimmed.length - match[0].length).trimEnd();

  return {
    cleanedLine,
    location: {
      file: path.normalize(filePart),
      line: lineNumber,
    },
  };
};

export const parseNmOutput = (stdout: string): NmSymbolInfo[] => {
  const symbols: NmSymbolInfo[] = [];

  stdout.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Archive ') || trimmed.includes(" .debug")) {
      return;
    }

    const { cleanedLine, location } = extractLocation(trimmed);
    const match = NM_LINE_REGEX.exec(cleanedLine.trim());
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
      source: location,
    });
  });

  return symbols;
};
