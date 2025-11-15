import { Section, SectionRule } from '../model';

const regexCache = new Map<string, RegExp>();

const matchesRule = (sectionName: string, rule: SectionRule): boolean => {
  const { match } = rule;

  if (match.equals !== undefined && sectionName === match.equals) {
    return true;
  }

  if (match.prefix !== undefined && sectionName.startsWith(match.prefix)) {
    return true;
  }

  if (match.suffix !== undefined && sectionName.endsWith(match.suffix)) {
    return true;
  }

  if (match.regex !== undefined) {
    const expression = regexCache.get(match.regex) ?? new RegExp(match.regex);
    regexCache.set(match.regex, expression);
    if (expression.test(sectionName)) {
      return true;
    }
  }

  return false;
};

export const applySectionCategories = (sections: Section[], rules: SectionRule[]): Section[] => {
  const unmatched: Section[] = [];

  const next = sections.map((section) => {
    if (!section.flags.alloc || section.size === 0) {
      return section;
    }

    const matchingRule = rules.find((rule) => matchesRule(section.name, rule));

    if (!matchingRule) {
      unmatched.push(section);
      return section;
    }

    return {
      ...section,
      categoryId: matchingRule.categoryId,
    };
  });

  if (unmatched.length > 0) {
    const details = unmatched.map((section) => `${section.name} (0x${section.vmaStart.toString(16)})`).join(', ');
    throw new Error(`No section category assigned for: ${details}`);
  }

  return next;
};
