import type { SkillInvocationContext, SkillInvocationResult } from "../types";

/**
 * One provider = one way of turning a SkillInvocationContext into a
 * SkillInvocationResult, via whichever underlying AI API it wraps. The Skill
 * markdown is loaded once at the invoke.ts entry point (its own throws-at-
 * import-time contract lives there, unchanged) and passed in rather than
 * re-read per provider.
 */
export type SkillProvider = (
  context: SkillInvocationContext,
  skillMarkdown: string,
) => Promise<SkillInvocationResult>;
