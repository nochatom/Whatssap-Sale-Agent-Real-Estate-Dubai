import Anthropic from "@anthropic-ai/sdk";

import { buildSkillInput } from "../build-prompt";
import { SKILL_DECISION_JSON_SCHEMA, parseExtractionOutput } from "../parse-decision";
import { EXTRACTION_SYSTEM_PROMPT } from "./extraction-prompt";
import type { SkillProvider } from "./types";

const SKILL_MODEL = "claude-opus-5";
const EXTRACTION_MODEL = "claude-haiku-4-5-20251001";

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/**
 * Verbatim body of the original single-provider invokeSkill — moved here
 * unchanged when the NVIDIA provider was added alongside it. Reads
 * ANTHROPIC_API_KEY implicitly via the SDK's own default env-var lookup,
 * same as before.
 */
export const invokeAnthropic: SkillProvider = async (context, skillMarkdown) => {
  const client = new Anthropic();

  const skillResponse = await client.messages.create({
    model: SKILL_MODEL,
    max_tokens: 2048,
    system: skillMarkdown,
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
};
