import { Region, Section } from '../model';

const withinRange = (address: number, start: number, size: number): boolean =>
  address >= start && address < start + size;

const findRegionForAddress = (regions: Region[], address: number | undefined): Region | undefined => {
  if (address === undefined) {
    return undefined;
  }
  return regions.find((region) => withinRange(address, region.start, region.size));
};

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

    const execRegion = findRegionForAddress(regions, section.vmaStart);
    if (!execRegion) {
      warnings.push(`Section ${section.name} at 0x${section.vmaStart.toString(16)} does not map to any region.`);
    }

    const hasLoadAddress = section.lmaStart !== undefined && section.lmaStart !== 0;
    const loadRegion = hasLoadAddress ? findRegionForAddress(regions, section.lmaStart) : undefined;

    if (hasLoadAddress && !loadRegion) {
      warnings.push(
        `Section ${section.name} load address 0x${section.lmaStart?.toString(16)} does not map to any region.`,
      );
    }

    const isCopySection = Boolean(
      hasLoadAddress && loadRegion && execRegion && section.lmaStart !== section.vmaStart,
    );

    return {
      ...section,
      execRegionId: execRegion?.id,
      loadRegionId: loadRegion?.id,
      isCopySection,
    };
  });

  return {
    sections: updatedSections,
    warnings,
  };
};
