import OpenAI from "openai";

import { buildSkillInput } from "../build-prompt";
import { SKILL_DECISION_JSON_SCHEMA, parseExtractionOutput } from "../parse-decision";
import { EXTRACTION_SYSTEM_PROMPT } from "./extraction-prompt";
import type { SkillProvider } from "./types";

// Strongest model on Cloudflare's own documented JSON-mode-compatible
// allow-list (only 9 specific models support structured output at all —
// confirmed via developers.cloudflare.com/workers-ai/features/json-mode/ —
// the newer/larger @cf/openai/gpt-oss-120b is notably NOT on that list).
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/**
 * Cloudflare Workers AI exposes an OpenAI-compatible endpoint, so the same
 * `openai` SDK used for the (now-removed) NVIDIA provider is reused here
 * too, just repointed at Cloudflare's baseURL. CLOUDFLARE_ACCOUNT_ID and
 * CLOUDFLARE_API_TOKEN are read explicitly here — the only place in the
 * codebase that reads them — and neither is ever logged.
 */
function client(): OpenAI {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must both be set — required when AI_PROVIDER=cloudflare",
    );
  }
  return new OpenAI({
    apiKey: apiToken,
    baseURL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
  });
}

export const invokeCloudflare: SkillProvider = async (context, skillMarkdown) => {
  const openai = client();

  const skillResponse = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: skillMarkdown },
      { role: "user", content: buildSkillInput(context) },
    ],
  });

  const prose = skillResponse.choices[0]?.message?.content ?? "";
  if (!prose) {
    return { status: "parse_failure", reason: "Skill call returned no content", rawOutput: "" };
  }

  // Cloudflare's own docs are explicit that JSON Mode is not guaranteed —
  // a schema-conformant request can still fail with "JSON Mode couldn't be
  // met." That must land here as a normal parse_failure result, not an
  // uncaught throw (unlike the Anthropic/NVIDIA paths, which only had to
  // handle empty/malformed content, never an explicit API-level failure).
  let extractionText: string;
  try {
    const extractionResponse = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: prose },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "skill_decision", schema: SKILL_DECISION_JSON_SCHEMA, strict: true },
      },
    });
    extractionText = extractionResponse.choices[0]?.message?.content ?? "";
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { status: "parse_failure", reason: `extraction call failed: ${reason}`, rawOutput: prose };
  }

  if (!extractionText) {
    return { status: "parse_failure", reason: "extraction call returned no content", rawOutput: prose };
  }

  const parsed = parseExtractionOutput(extractionText);

  if (!parsed.ok) {
    return { status: "parse_failure", reason: parsed.reason, rawOutput: prose };
  }

  return { status: "success", decision: parsed.decision, rawOutput: prose };
};
