import { Region, Section } from '../model';

const withinRange = (address: number, start: number, size: number): boolean =>
  address >= start && address < start + size;

const findRegionForAddress = (regions: Region[], address: number): Region | undefined =>
  regions.find((region) => withinRange(address, region.start, region.size));

export interface AssignRegionsResult {
  sections: Section[];
  warnings: string[];
}

export const assignRegionsToSections = (regions: Region[], sections: Section[]): AssignRegionsResult => {
  const warnings: string[] = [];
  const updatedSections = sections.map((section) => {
    if (section.size === 0) {
      return section;
    }

    const region = findRegionForAddress(regions, section.vmaStart);
    if (!region) {
      warnings.push(`Section ${section.name} at 0x${section.vmaStart.toString(16)} does not map to any region.`);
      return section;
    }

    return {
      ...section,
      execRegionId: region.id,
    };
  });

  return {
    sections: updatedSections,
    warnings,
  };
};
