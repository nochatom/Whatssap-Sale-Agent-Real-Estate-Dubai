import OpenAI from "openai";

import { buildSkillInput } from "../build-prompt";
import { parseExtractionOutput } from "../parse-decision";
import { EXTRACTION_SYSTEM_PROMPT } from "./extraction-prompt";
import type { SkillProvider } from "./types";

// TokenRouter (api.tokenrouter.com) is an OpenAI-compatible aggregator that
// proxies this Qwen model. Confirmed live against the real endpoint
// (2026-08-22): its structured-output support only extends to FLAT schemas —
// a strict json_schema request containing even one nested object (let alone
// the actual SKILL_DECISION_JSON_SCHEMA, which nests clientAnalysis.buyingSignal
// and more) reliably fails with a 503 "bad_response_status_code" from the
// upstream backend, regardless of whether the union is anyOf/const or a
// flattened Gemini-style variant — reproduced 4/4 times. The looser
// `json_object` mode (valid-JSON-only, not grammar-constrained to a schema)
// was confirmed to handle nested output correctly, so this provider uses that
// instead, with the target shape spelled out in the extraction prompt text
// itself rather than passed as a schema.
const MODEL = "qwen/qwen3.8-max-free";

/**
 * QWEN_API_KEY is the only credential this provider needs — TokenRouter uses
 * a single bearer key against a fixed base URL, unlike Cloudflare's
 * per-account URL segment.
 */
function client(): OpenAI {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) {
    throw new Error("QWEN_API_KEY must be set — required when AI_PROVIDER=qwen");
  }
  return new OpenAI({ apiKey, baseURL: "https://api.tokenrouter.com/v1" });
}

// Appended to the shared EXTRACTION_SYSTEM_PROMPT only for this provider —
// that file stays untouched (byte-identical for every other provider) since
// it's documented as shared verbatim. This spells out the exact target shape
// in place of the schema-based enforcement Anthropic/Cloudflare/Gemini each
// get from their own structured-output parameter, since json_object mode
// here has no shape awareness of its own.
const QWEN_SHAPE_INSTRUCTIONS = `

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
    "milestone": "none" | "payment_confirmed" | "ready_to_start"
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
 * anthropic.ts and gemini.ts, chosen over Cloudflare's single-call approach
 * specifically because that approach depends on strict-schema structured
 * output, which this backend can't do for a nested shape (see MODEL comment
 * above). Any thrown error here (network, 4xx, 5xx, empty content) is left
 * to propagate uncaught — invoke.ts's qwen-primary path treats any failure
 * as fallback-worthy, so there's no need to classify error types here the
 * way Cloudflare's provider does for its own narrower fallback trigger.
 */
export const invokeQwen: SkillProvider = async (context, skillMarkdown) => {
  const openai = client();

  const proseStartedAt = Date.now();
  const proseResponse = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [
      { role: "system", content: skillMarkdown },
      { role: "user", content: buildSkillInput(context) },
    ],
  });
  const proseCallMs = Date.now() - proseStartedAt;

  const prose = proseResponse.choices[0]?.message?.content ?? "";
  if (!prose) {
    return { status: "parse_failure", reason: "Skill call returned no content", rawOutput: "" };
  }

  const extractionStartedAt = Date.now();
  const extractionResponse = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT + QWEN_SHAPE_INSTRUCTIONS },
      { role: "user", content: prose },
    ],
    response_format: { type: "json_object" },
  });
  const extractionCallMs = Date.now() - extractionStartedAt;
  const timingsMs = { proseCallMs, extractionCallMs, totalMs: proseCallMs + extractionCallMs };

  const extractionText = extractionResponse.choices[0]?.message?.content ?? "";
  if (!extractionText) {
    return { status: "parse_failure", reason: "extraction call returned no content", rawOutput: prose, timingsMs };
  }

  const parsed = parseExtractionOutput(extractionText);
  if (!parsed.ok) {
    return { status: "parse_failure", reason: parsed.reason, rawOutput: prose, timingsMs };
  }

  return { status: "success", decision: parsed.decision, rawOutput: prose, timingsMs };
};
