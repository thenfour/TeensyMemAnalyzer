import { Section, SectionFlags, SectionCategory } from '../model';

interface ReadelfSectionRow {
  index: number;
  name: string;
  type: string;
  addr: number;
  off: number;
  size: number;
  flags: string;
}

const READ_ELF_SECTION_HEADER = /^\s*\[\s*(\d+)\]\s+([^\s]+)\s+([^\s]+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([^\s]+)\s+([^\s]*)\s+([^\s]*)\s*$/;

const parseFlags = (raw: string): SectionFlags => ({
  alloc: raw.includes('A'),
  exec: raw.includes('X'),
  write: raw.includes('W'),
  tls: raw.includes('T') || undefined,
});

const classifySection = (name: string, flags: SectionFlags): SectionCategory => {
  if (name.startsWith('.text')) {
    return flags.exec ? 'code_fast' : 'code';
  }
  if (name.startsWith('.rodata') || name === '.ARM.exidx') {
    return 'rodata';
  }
  if (name.startsWith('.data')) {
    return 'data_init';
  }
  if (name.startsWith('.bss')) {
    return 'bss';
  }
  if (name.includes('dma')) {
    return 'dma';
  }
  return 'other';
};

const parseLine = (line: string): ReadelfSectionRow | null => {
  const match = READ_ELF_SECTION_HEADER.exec(line);
  if (!match) {
    return null;
  }

  const [, indexStr, name, type, addrStr, offStr, sizeStr, flags] = match;
  return {
    index: parseInt(indexStr, 10),
    name,
    type,
    addr: parseInt(addrStr, 16),
    off: parseInt(offStr, 16),
    size: parseInt(sizeStr, 16),
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
      category: classifySection(parsed.name, flags),
      flags,
      lmaStart: undefined,
      loadRegionId: undefined,
      execRegionId: undefined,
    });
  });

  return rows;
};
