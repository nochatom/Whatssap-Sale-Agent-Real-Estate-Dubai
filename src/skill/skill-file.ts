import fs from "node:fs";
import path from "node:path";

export const SKILL_DIR = path.join(process.cwd(), "skills", "real-estate-whatsapp-sales");
export const SKILL_MD_PATH = path.join(SKILL_DIR, "SKILL.md");

const REFERENCE_PATTERN = /references\/[\w-]+\.md/g;

/**
 * Only these three are safety/consistency-critical enough to hard-block
 * invokeSkill: offer-config.md (money — a missing price gets invented),
 * whatsapp-style.md (voice — without it every reply reads like a brochure),
 * behavioral-signals.md (the B/C/D/F states the §17 output contract requires
 * naming a reply's attachment to). The rest degrade gracefully to general
 * sales reasoning when missing, and several (sector-playbooks.md above all)
 * shouldn't be written until real conversations exist to write them from.
 */
export const REQUIRED_REFERENCES = [
  "references/offer-config.md",
  "references/whatsapp-style.md",
  "references/behavioral-signals.md",
];

/**
 * The Skill routes to references/*.md for pricing, sector strategy, objections, etc.
 * Extraction is regex-based against the literal paths the Skill text uses to route.
 */
export function extractReferencedFiles(skillMarkdown: string): string[] {
  const matches = skillMarkdown.match(REFERENCE_PATTERN) ?? [];
  return [...new Set(matches)].sort();
}

export interface ReferenceCheckResult {
  missingRequired: string[];
  missingOptional: string[];
}

export function checkReferences(skillMarkdown: string, skillDir: string): ReferenceCheckResult {
  const missing = extractReferencedFiles(skillMarkdown).filter(
    (ref) => !fs.existsSync(path.join(skillDir, ref)),
  );
  return {
    missingRequired: missing.filter((ref) => REQUIRED_REFERENCES.includes(ref)),
    missingOptional: missing.filter((ref) => !REQUIRED_REFERENCES.includes(ref)),
  };
}

/**
 * Hard-throws only on the required set. A missing optional reference is
 * logged as a warning — invokeSkill still runs, falling back to general
 * sales reasoning for that area until the file is written.
 */
export function assertReferencesExist(skillMarkdown: string, skillDir: string): void {
  const { missingRequired, missingOptional } = checkReferences(skillMarkdown, skillDir);

  if (missingOptional.length > 0) {
    console.warn(
      `Skill references missing (non-blocking) under ${skillDir}: ${missingOptional.join(", ")}. ` +
        `Falling back to general sales reasoning for these until they're written.`,
    );
  }

  if (missingRequired.length > 0) {
    throw new Error(
      `Required Skill references missing under ${skillDir}: ${missingRequired.join(", ")}. ` +
        `The Skill cannot safely run without these.`,
    );
  }
}

export function loadSkillMarkdown(): string {
  const content = fs.readFileSync(SKILL_MD_PATH, "utf-8");
  assertReferencesExist(content, SKILL_DIR);
  return content;
}
