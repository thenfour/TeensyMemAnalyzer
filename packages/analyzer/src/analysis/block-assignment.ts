import { AddressUsageKind, LogicalBlock, Section, SectionBlockAssignment } from '../model';

const toAddressType = (role: LogicalBlock['role']): AddressUsageKind => {
  if (role === 'load') {
    return 'load';
  }
  if (role === 'exec') {
    return 'exec';
  }
  return 'runtime';
};

const resolveAddressForAssignment = (section: Section, addressType: AddressUsageKind): number => {
  if (addressType === 'load') {
    if (section.lmaStart !== undefined && section.lmaStart !== 0) {
      return section.lmaStart;
    }
    if (section.vmaStart !== undefined) {
      return section.vmaStart;
    }
    throw new Error(`Section ${section.name} is missing a load address.`);
  }

  if (section.vmaStart === undefined) {
    throw new Error(`Section ${section.name} is missing a virtual address.`);
  }

  return section.vmaStart;
};

const buildAssignment = (section: Section, block: LogicalBlock): SectionBlockAssignment => {
  const addressType = toAddressType(block.role);
  const address = resolveAddressForAssignment(section, addressType);

  return {
    blockId: block.id,
    windowId: block.windowId,
    role: block.role,
    addressType,
    address,
    size: section.size,
    reportTags: block.reportTags ?? [],
  };
};

const ensureBlocksExist = (categoryId: string, blocks: LogicalBlock[]): void => {
  if (blocks.length === 0) {
    throw new Error(`No logical blocks defined for category ${categoryId}.`);
  }
};

export const assignBlocksToSections = (sections: Section[], logicalBlocks: LogicalBlock[]): Section[] => {
  const blocksByCategory = new Map<string, LogicalBlock[]>();
  logicalBlocks.forEach((block) => {
    const list = blocksByCategory.get(block.categoryId);
    if (list) {
      list.push(block);
    } else {
      blocksByCategory.set(block.categoryId, [block]);
    }
  });

  return sections.map((section) => {
    if (!section.flags.alloc || section.size === 0 || !section.categoryId) {
      return {
        ...section,
        blockAssignments: [],
        primaryBlockId: undefined,
        primaryWindowId: undefined,
      };
    }

    const blocks = blocksByCategory.get(section.categoryId) ?? [];
    ensureBlocksExist(section.categoryId, blocks);

    const assignments = blocks.map((block) => buildAssignment(section, block));
    const primary = assignments.find((assignment) => assignment.addressType !== 'load') ?? assignments[0];

    return {
      ...section,
      blockAssignments: assignments,
      primaryBlockId: primary?.blockId,
      primaryWindowId: primary?.windowId,
    };
  });
};
