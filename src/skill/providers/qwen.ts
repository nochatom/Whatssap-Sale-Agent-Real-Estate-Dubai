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
// handles nested output correctly, so this provider uses that instead, with
// the target shape spelled out in the extraction prompt text itself rather
// than passed as a schema.
//
// Confirmed live (2026-08-24): non-streaming requests against this backend
// are unreliable for both calls this provider makes — the same
// system+user extraction request that failed 100% of the time non-streaming
// succeeded 8/8 with `stream: true` (0 failures across 3 different realistic
// prompts). The prose call has a second, independent issue on top of that:
// this is a reasoning model, and its internal `reasoning_content` can
// consume the entire token budget before any real answer content streams
// out, returning empty even on a call that otherwise "succeeds." Both calls
// stream for reliability; the prose call additionally uses a raised
// max_tokens (see PROSE_MAX_TOKENS below) sized from real measurements, not
// guessed.
const MODEL = "qwen/qwen3.8-max-free";

// 2048 already proved reliable for the extraction call (8/8 in testing) —
// left unchanged, no reason to raise it.
const EXTRACTION_MAX_TOKENS = 2048;

// Empirically sized, not guessed: tested 3072 (1/3 usable, avg 33s), 4096
// (2/3 usable, avg 39s), and 6144 (3/3 usable, avg 72s) against real Skill
// conversations. 6144 was the only value that reliably left enough budget
// for actual answer content after this reasoning model's internal
// `reasoning_content` — below it, a real fraction of calls "succeed" (no
// thrown error) but return zero usable characters, indistinguishable from a
// failure downstream. The latency cost is real (roughly 2x the smaller
// values) and accepted deliberately: usable content beats a faster empty
// response that just falls back to Cloudflare anyway.
const PROSE_MAX_TOKENS = 6144;

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
    "milestone": "none" | "payment_intent" | "payment_confirmed" | "payment_proof_received" | "ready_to_start"
  },
  "salesStrategy": {
    "bestNextAction": string,
    "whatToAvoid": string,
    "objectiveOfReply": string
  },
  "recommendedReply":
    { "kind": "reply", "text": string, "image"?: string }
    | { "kind": "do_not_reply_yet", "reason": string, "trigger": string }
    | { "kind": "do_not_follow_up_yet", "reason": string, "trigger": string }
}

Only include "image" when the source text's RECOMMENDED WHATSAPP REPLY block
contains a line starting with "Image:" — set it to the filename after that
colon, trimmed. Omit the "image" key entirely otherwise; never invent one.

Set clientAnalysis.milestone to the exact value on the Milestone line in the source
text. If that line is missing entirely, set it to "none" — never omit it.`;

/**
 * Accumulates a chat-completion stream into a single string, same as reading
 * `.choices[0].message.content` off a non-streaming response would give —
 * downstream code (parseExtractionOutput, the SkillDecision contract) never
 * knows or cares that the call was streamed. Any error thrown while
 * iterating (a mid-stream failure, same as an error thrown before any chunk
 * arrives) propagates uncaught, exactly like a non-streaming call's error
 * already did — invoke.ts's qwen-primary path treats any failure here as
 * fallback-worthy, so no special-casing is needed.
 */
async function streamToText(
  stream: AsyncIterable<{ choices: Array<{ delta?: { content?: string | null } }> }>,
): Promise<string> {
  let text = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) text += delta;
  }
  return text;
}

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
  const proseStream = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: PROSE_MAX_TOKENS,
    stream: true,
    messages: [
      { role: "system", content: skillMarkdown },
      { role: "user", content: buildSkillInput(context) },
    ],
  });
  const prose = await streamToText(proseStream);
  const proseCallMs = Date.now() - proseStartedAt;

  // Thrown, not returned: empty content is a genuine Qwen failure (this
  // reasoning model's internal reasoning_content can consume the whole
  // token budget and leave nothing for the real answer, even on an
  // otherwise-successful call) — it must reach invoke.ts's catch block for
  // the Cloudflare fallback to fire, the same as a network/HTTP error does.
  // A *returned* parse_failure here would dead-end with no reply at all,
  // since invokeSkill() only falls back on a thrown error.
  if (!prose) {
    throw new Error(`Qwen prose call returned no usable content after ${proseCallMs}ms (reasoning likely consumed the token budget)`);
  }

  const extractionStartedAt = Date.now();
  const extractionStream = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: EXTRACTION_MAX_TOKENS,
    stream: true,
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT + QWEN_SHAPE_INSTRUCTIONS },
      { role: "user", content: prose },
    ],
    response_format: { type: "json_object" },
  });
  const extractionText = await streamToText(extractionStream);
  const extractionCallMs = Date.now() - extractionStartedAt;
  const timingsMs = { proseCallMs, extractionCallMs, totalMs: proseCallMs + extractionCallMs };

  // Same reasoning as the prose call above: thrown, not returned, so this
  // genuine failure reaches the Cloudflare fallback instead of dead-ending.
  if (!extractionText) {
    throw new Error(`Qwen extraction call returned no usable content after ${extractionCallMs}ms`);
  }

  const parsed = parseExtractionOutput(extractionText);
  if (!parsed.ok) {
    return { status: "parse_failure", reason: parsed.reason, rawOutput: prose, timingsMs };
  }

  return { status: "success", decision: parsed.decision, rawOutput: prose, timingsMs };
};
