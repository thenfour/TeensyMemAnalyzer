export interface ObjdumpSectionInfo {
  name: string;
  size: number;
  vma: number;
  lma: number;
}

const SECTION_LINE_REGEX =
  /^\s*\d+\s+([^\s]+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([^\s]+)\s*$/;

const hexToNumber = (value: string): number => parseInt(value, 16);

export const parseObjdumpSectionHeaders = (stdout: string): Map<string, ObjdumpSectionInfo> => {
  const sections = new Map<string, ObjdumpSectionInfo>();

  stdout.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Idx') || trimmed.startsWith('SYMBOL') || trimmed.startsWith('Sections')) {
      return;
    }

    const match = SECTION_LINE_REGEX.exec(trimmed);
    if (!match) {
      return;
    }

    const [, name, sizeHex, vmaHex, lmaHex] = match;

    sections.set(name, {
      name,
      size: hexToNumber(sizeHex),
      vma: hexToNumber(vmaHex),
      lma: hexToNumber(lmaHex),
    });
  });

  return sections;
};
