import { Section, SectionFlags } from '../model';

interface ReadelfSectionRow {
  index: number;
  name: string;
  type: string;
  addr: number;
  off: number;
  size: number;
  flags: string;
}

const parseFlags = (raw: string): SectionFlags => ({
  alloc: raw.includes('A'),
  exec: raw.includes('X'),
  write: raw.includes('W'),
  tls: raw.includes('T') || undefined,
});

const parseLine = (line: string): ReadelfSectionRow | null => {
  if (!line.startsWith('[')) {
    return null;
  }

  const indexMatch = /^\[\s*(\d+)\]/.exec(line);
  if (!indexMatch) {
    return null;
  }

  const index = parseInt(indexMatch[1], 10);

  const remainder = line.slice(indexMatch[0].length).trim();
  if (!remainder) {
    return null;
  }

  const normalized = remainder.replace(/\s+/g, ' ');
  const parts = normalized.split(' ');

  if (parts.length < 7) {
    return null;
  }

  const name = parts[0];
  const type = parts[1];
  const addrHex = parts[2];
  const offHex = parts[3];
  const sizeHex = parts[4];
  const esHex = parts[5];
  const rest = parts.slice(6);

  if (rest.length < 3) {
    return null;
  }

  const hasFlags = rest.length === 4;
  const flags = hasFlags ? rest[0] : '';

  const addr = parseInt(addrHex, 16);
  const off = parseInt(offHex, 16);
  const size = parseInt(sizeHex, 16);
  void parseInt(esHex, 16);

  return {
    index,
    name,
    type,
    addr,
    off,
    size,
    flags,
  };
};

export const parseReadelfSections = (stdout: string): Section[] => {
  const rows: Section[] = [];

  stdout.split('\n').forEach((line) => {
    const parsed = parseLine(line.trim());
    if (!parsed) {
      return;
    }

    const flags = parseFlags(parsed.flags);
    rows.push({
      id: `sec_${parsed.index}`,
      name: parsed.name,
      vmaStart: parsed.addr,
      size: parsed.size,
      flags,
      lmaStart: undefined,
      categoryId: undefined,
      blockAssignments: [],
      primaryBlockId: undefined,
      primaryWindowId: undefined,
    });
  });

  return rows;
};
