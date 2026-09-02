import OpenAI from "openai";

import { buildSkillInput } from "../build-prompt";
import { parseExtractionOutput } from "../parse-decision";
import { EXTRACTION_SYSTEM_PROMPT } from "./extraction-prompt";
import type { SkillProvider } from "./types";

/**
 * UNVERIFIED — shipped without a live call against the real x.ai API. The
 * account behind XAI_API_KEY had zero available credits at integration time
 * (every request, including a plain GET /v1/models, returned a 403
 * "permission-denied... used all available credits" error), so unlike every
 * other provider in this directory (each confirmed live before shipping —
 * see gemini.ts and qwen.ts's own comments), this model id and the json_object
 * structured-output assumption below could not be confirmed. "grok-4" is
 * x.ai's documented flagship model as of this writing. Re-verify both once
 * the account has credits: a plain generateContent-equivalent call, and
 * specifically whether response_format: json_object round-trips a NESTED
 * object correctly (qwen.ts found its own backend silently fails strict
 * json_schema mode for nested shapes, which is why that provider also uses
 * json_object with the shape spelled out in the prompt instead — Grok's
 * OpenAI-compatible API may or may not share that limitation).
 */
const MODEL = "grok-4";

/**
 * x.ai's API is OpenAI-compatible (same client, different base URL and key),
 * same integration shape as qwen.ts's TokenRouter provider.
 */
function client(): OpenAI {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error("XAI_API_KEY must be set — required for the Grok primary provider path");
  }
  return new OpenAI({ apiKey, baseURL: "https://api.x.ai/v1" });
}

// Identical in content to qwen.ts's QWEN_SHAPE_INSTRUCTIONS (kept as a
// separate copy rather than a shared import, matching how gemini.ts and
// qwen.ts each keep their own shape-adaptation self-contained) — spells out
// the target JSON shape in the prompt itself, since json_object mode has no
// schema awareness of its own.
const GROK_SHAPE_INSTRUCTIONS = `

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
 * Two-call shape (prose, then a separate extraction call), same pattern as
 * anthropic.ts/gemini.ts/qwen.ts. Non-streaming, unlike qwen.ts — that
 * provider's streaming requirement and raised max_tokens were both derived
 * from live testing against a known-flaky backend (TokenRouter); nothing
 * here justifies assuming Grok needs the same treatment without its own
 * live confirmation, so this starts from the plainer gemini.ts-style shape.
 * Any thrown error (network, 4xx, 5xx, empty content) is left to propagate
 * uncaught — invoke.ts's grok-primary path treats any failure as
 * fallback-worthy to Gemini, so there's no need to classify error types here.
 */
export const invokeGrok: SkillProvider = async (context, skillMarkdown) => {
  const openai = client();

  const proseResponse = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: skillMarkdown },
      { role: "user", content: buildSkillInput(context) },
    ],
  });
  const prose = proseResponse.choices[0]?.message?.content ?? "";
  if (!prose) {
    return { status: "parse_failure", reason: "Skill call returned no content", rawOutput: "" };
  }

  const extractionResponse = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT + GROK_SHAPE_INSTRUCTIONS },
      { role: "user", content: prose },
    ],
    response_format: { type: "json_object" },
  });
  const extractionText = extractionResponse.choices[0]?.message?.content ?? "";
  if (!extractionText) {
    return { status: "parse_failure", reason: "extraction call returned no content", rawOutput: prose };
  }

  const parsed = parseExtractionOutput(extractionText);
  if (!parsed.ok) {
    return { status: "parse_failure", reason: parsed.reason, rawOutput: prose };
  }

  return { status: "success", decision: parsed.decision, rawOutput: prose };
};
