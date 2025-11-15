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

const NM_LINE_REGEX = /^\s*([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([^\s])\s+(.+)$/;

const parseHex = (value: string): number => parseInt(value, 16);

const LOCATION_PATTERN = /^(.*):(\d+)(?::\d+)?(?:\s+\(.*\))?$/;

const parseLocation = (value: string): SourceLocation | undefined => {
  const trimmed = value.trim();
  const match = LOCATION_PATTERN.exec(trimmed);
  if (!match) {
    return undefined;
  }

  const [, filePartRaw, linePart] = match;
  const filePart = filePartRaw.trim();
  const lineNumber = Number.parseInt(linePart, 10);

  if (!filePart || Number.isNaN(lineNumber) || (filePart === '??' && lineNumber === 0)) {
    return undefined;
  }

  return {
    file: path.normalize(filePart),
    line: lineNumber,
  };
};

const splitNameAndLocation = (rawName: string): { name: string; location?: SourceLocation } => {
  const normalized = rawName.trimEnd();
  const boundaryMatch = /^(.*\S)\s+(.+)$/.exec(normalized);
  if (!boundaryMatch) {
    return { name: normalized };
  }

  const [, namePart, suffix] = boundaryMatch;
  const location = parseLocation(suffix);
  if (!location) {
    return { name: normalized };
  }

  return {
    name: namePart.trimEnd(),
    location,
  };
};

export const parseNmOutput = (stdout: string): NmSymbolInfo[] => {
  const symbols: NmSymbolInfo[] = [];
  let pendingLocationTarget: NmSymbolInfo | undefined;

  stdout.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Archive ') || trimmed.includes(" .debug")) {
      return;
    }

    const match = NM_LINE_REGEX.exec(trimmed);
    if (!match) {
      if (pendingLocationTarget) {
        const location = parseLocation(trimmed);
        if (location) {
          pendingLocationTarget.source = location;
          pendingLocationTarget = undefined;
        }
      }
      return;
    }

    const [, addrHex, sizeHex, typeCode, nameRaw] = match;

    if (typeCode.toUpperCase() === 'U') {
      return;
    }

    const address = parseHex(addrHex);
    const size = parseHex(sizeHex);
    const { name, location } = splitNameAndLocation(nameRaw);

    const symbol: NmSymbolInfo = {
      address,
      size,
      typeCode,
      name,
      rawName: name,
      source: location,
    };

    symbols.push(symbol);
    pendingLocationTarget = location ? undefined : symbol;
  });

  return symbols;
};
