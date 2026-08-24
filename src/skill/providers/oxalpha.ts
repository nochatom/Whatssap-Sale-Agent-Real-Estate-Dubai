import OpenAI from "openai";

import { buildSkillInput } from "../build-prompt";
import { parseExtractionOutput } from "../parse-decision";
import { EXTRACTION_SYSTEM_PROMPT } from "./extraction-prompt";
import type { SkillProvider } from "./types";

// OpenRouter (openrouter.ai) is an OpenAI-compatible aggregator, same
// integration shape as TokenRouter in qwen.ts. "stealth/ox-alpha" is an
// anonymized/beta test model on OpenRouter — its real capabilities (schema
// support, streaming reliability, reasoning-token behavior) are undocumented,
// so this starts with the plainest, most defensively-safe call shape already
// proven necessary for another unknown-capability backend (qwen.ts): plain
// non-streaming requests, `json_object` mode (not schema-constrained) for the
// extraction call, with the target shape spelled out in the prompt text
// rather than passed as a schema. Adjust only if real testing shows a
// specific failure mode, the same empirical approach used for qwen.ts.
const MODEL = "stealth/ox-alpha";

function client(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY must be set — required when AI_PROVIDER=oxalpha");
  }
  const baseURL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  return new OpenAI({ apiKey, baseURL });
}

// Appended to the shared EXTRACTION_SYSTEM_PROMPT only for this provider —
// that file stays untouched (byte-identical for every other provider) since
// it's documented as shared verbatim. Mirrors qwen.ts's QWEN_SHAPE_INSTRUCTIONS
// exactly: spells out the target shape in place of schema-based enforcement,
// since json_object mode has no shape awareness of its own.
const OXALPHA_SHAPE_INSTRUCTIONS = `

Output ONLY a single JSON object (no markdown, no code fences, no extra text) with exactly this shape:
{
  "clientAnalysis": {
    "clientSector": string,
    "clientType": string,
    "salesStage": string,
    "clientIntent": string,
    "psychologicalInterpretation": string,
    "buyingSignal": { "level": "LOW" | "MEDIUM" | "HIGH", "evidence": string },
    "mainConcern": string,
    "whatClientIsLookingFor": string,
    "milestone": "none" | "payment_intent" | "payment_confirmed" | "payment_proof_received" | "ready_to_start"
  },
  "salesStrategy": {
    "bestNextAction": string,
    "whatToAvoid": string,
    "objectiveOfReply": string
  },
  "recommendedReply":
    { "kind": "reply", "text": string }
    | { "kind": "do_not_reply_yet", "reason": string, "trigger": string }
    | { "kind": "do_not_follow_up_yet", "reason": string, "trigger": string }
}

Set clientAnalysis.milestone to the exact value on the Milestone line in the source
text. If that line is missing entirely, set it to "none" — never omit it.`;

/**
 * Two-call shape (prose, then a separate extraction call) — same pattern as
 * anthropic.ts, gemini.ts, and qwen.ts. Any thrown error here (network, 4xx,
 * 5xx, empty content) is left to propagate uncaught — invoke.ts's
 * oxalpha-primary path treats any failure as fallback-worthy (falls through
 * to Qwen, then Cloudflare), so there's no need to classify error types here.
 */
export const invokeOxAlpha: SkillProvider = async (context, skillMarkdown) => {
  const openai = client();

  const proseResponse = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [
      { role: "system", content: skillMarkdown },
      { role: "user", content: buildSkillInput(context) },
    ],
  });
  const prose = proseResponse.choices[0]?.message?.content ?? "";

  if (!prose) {
    throw new Error("Ox Alpha prose call returned no usable content");
  }

  const extractionResponse = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT + OXALPHA_SHAPE_INSTRUCTIONS },
      { role: "user", content: prose },
    ],
    response_format: { type: "json_object" },
  });
  const extractionText = extractionResponse.choices[0]?.message?.content ?? "";

  if (!extractionText) {
    throw new Error("Ox Alpha extraction call returned no usable content");
  }

  const parsed = parseExtractionOutput(extractionText);
  if (!parsed.ok) {
    return { status: "parse_failure", reason: parsed.reason, rawOutput: prose };
  }

  return { status: "success", decision: parsed.decision, rawOutput: prose };
};
