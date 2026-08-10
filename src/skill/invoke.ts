import Anthropic from "@anthropic-ai/sdk";

import { loadSkillMarkdown } from "./skill-file";
import { buildSkillInput } from "./build-prompt";
import { SKILL_DECISION_JSON_SCHEMA, parseExtractionOutput } from "./parse-decision";
import type { SkillInvocationContext, SkillInvocationResult } from "./types";

// Throws at import time if any references/*.md the Skill routes to is missing.
// Phase 1 is expected to throw here until those files exist (see skill-file.ts) —
// this module must never be imported by a code path that runs in production
// without them, since the Skill cannot safely quote a price without offer-config.md.
const SKILL_MARKDOWN = loadSkillMarkdown();

const SKILL_MODEL = "claude-opus-5";
const EXTRACTION_MODEL = "claude-haiku-4-5-20251001";

const EXTRACTION_SYSTEM_PROMPT = `You convert a strategist's WhatsApp sales analysis into structured JSON.

You will be given the exact text produced by a sales-strategy assistant, in this format:

CLIENT ANALYSIS
Client sector: ...
Client type: ...
Sales stage: ...
Client intent: ...
Psychological interpretation: ...
Buying signal: LOW / MEDIUM / HIGH — [evidence]
Main concern / objection: ...
What the client is really looking for: ...

SALES STRATEGY
Best next action: ...
What to avoid: ...
Objective of this reply: ...

RECOMMENDED WHATSAPP REPLY
[exact message, or the literal line DO NOT REPLY YET / DO NOT FOLLOW UP YET followed by a reason and trigger]

Extract every field verbatim into the JSON schema you were given. Do not paraphrase,
summarize, or add information that is not in the source text. If the reply block is
"DO NOT REPLY YET" or "DO NOT FOLLOW UP YET", set recommendedReply.kind accordingly
and pull the reason and trigger from the line(s) that follow it. Otherwise set
recommendedReply.kind to "reply" and text to the reply exactly as written.`;

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export async function invokeSkill(
  context: SkillInvocationContext,
): Promise<SkillInvocationResult> {
  const client = new Anthropic();

  const skillResponse = await client.messages.create({
    model: SKILL_MODEL,
    max_tokens: 2048,
    system: SKILL_MARKDOWN,
    messages: [{ role: "user", content: buildSkillInput(context) }],
  });

  if (skillResponse.stop_reason === "refusal") {
    return { status: "parse_failure", reason: "Skill call was refused", rawOutput: "" };
  }

  const prose = extractText(skillResponse.content);

  const extractionResponse = await client.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 2048,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prose }],
    output_config: {
      format: { type: "json_schema", schema: SKILL_DECISION_JSON_SCHEMA },
    },
  });

  if (extractionResponse.stop_reason === "refusal") {
    return {
      status: "parse_failure",
      reason: "extraction call was refused",
      rawOutput: prose,
    };
  }

  const extractionText = extractText(extractionResponse.content);
  const parsed = parseExtractionOutput(extractionText);

  if (!parsed.ok) {
    return { status: "parse_failure", reason: parsed.reason, rawOutput: prose };
  }

  return { status: "success", decision: parsed.decision, rawOutput: prose };
}
