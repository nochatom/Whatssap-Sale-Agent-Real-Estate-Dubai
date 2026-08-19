import { loadSkillMarkdown } from "./skill-file";
import { invokeAnthropic } from "./providers/anthropic";
import { invokeCloudflare } from "./providers/cloudflare";
import type { SkillProvider } from "./providers/types";
import type { SkillInvocationContext, SkillInvocationResult } from "./types";

// Throws at import time if any references/*.md the Skill routes to is missing.
// Phase 1 is expected to throw here until those files exist (see skill-file.ts) —
// this module must never be imported by a code path that runs in production
// without them, since the Skill cannot safely quote a price without offer-config.md.
const SKILL_MARKDOWN = loadSkillMarkdown();

const PROVIDERS: Record<string, SkillProvider> = {
  anthropic: invokeAnthropic,
  cloudflare: invokeCloudflare,
};

/**
 * AI_PROVIDER selects which underlying AI API generates replies —
 * "cloudflare" or "anthropic". Unset or unrecognized falls back to
 * "anthropic" (the original, historically-known-good provider) rather than
 * guessing. Both providers implement the identical Skill contract (same
 * SKILL_MARKDOWN, same extraction prompt, same SkillDecision validation) —
 * swapping providers is only ever this one env var, never a code change.
 */
export async function invokeSkill(
  context: SkillInvocationContext,
): Promise<SkillInvocationResult> {
  const providerName = process.env.AI_PROVIDER ?? "anthropic";
  const provider = PROVIDERS[providerName] ?? invokeAnthropic;
  return provider(context, SKILL_MARKDOWN);
}
