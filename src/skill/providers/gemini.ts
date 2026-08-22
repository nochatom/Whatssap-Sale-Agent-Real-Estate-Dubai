import { GoogleGenAI } from "@google/genai";

import { buildSkillInput } from "../build-prompt";
import { SKILL_DECISION_JSON_SCHEMA, parseExtractionOutput } from "../parse-decision";
import { EXTRACTION_SYSTEM_PROMPT } from "./extraction-prompt";
import type { SkillProvider } from "./types";

// gemini-2.5-flash: confirmed free-tier-eligible and structured-output-
// capable as of the current Gemini API docs (checked 2026-08-21). Chosen
// over the 2.0 line (Google's own pricing page and models page
// contradicted each other on whether it's still live) and the newest 3.x
// Flash variants (a Google developer-forum report of schema-constrained
// output degenerating into repeated tokens on 3.7 Flash) — 2.5 Flash was
// the most consistently confirmed-live, confirmed-stable choice.
const MODEL = "gemini-2.5-flash";

/**
 * Gemini's structured-output support is a documented SUBSET of JSON Schema
 * (confirmed: no `anyOf`, no `const` — only type/properties/required/enum/
 * additionalProperties/format/min-max/items/etc.). SKILL_DECISION_JSON_SCHEMA's
 * recommendedReply is a 3-variant anyOf+const discriminated union, so it
 * can't be passed through as-is. clientAnalysis and salesStrategy use
 * neither anyOf nor const and are reused verbatim; recommendedReply is
 * flattened into one object carrying every possible field (optional),
 * with `kind` as an enum instead of per-variant const.
 *
 * This never changes the actual output contract: parseExtractionOutput /
 * isSkillDecision (unmodified) validate purely structurally per `kind` and
 * ignore any extra fields, so a Gemini response validates identically to
 * an Anthropic or Cloudflare one — the SkillDecision this fallback produces
 * is indistinguishable from the primary provider's.
 */
const GEMINI_DECISION_SCHEMA = {
  type: "object",
  properties: {
    clientAnalysis: SKILL_DECISION_JSON_SCHEMA.properties.clientAnalysis,
    salesStrategy: SKILL_DECISION_JSON_SCHEMA.properties.salesStrategy,
    recommendedReply: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["reply", "do_not_reply_yet", "do_not_follow_up_yet"] },
        text: { type: "string" },
        reason: { type: "string" },
        trigger: { type: "string" },
      },
      required: ["kind"],
    },
  },
  required: ["clientAnalysis", "salesStrategy", "recommendedReply"],
};

function client(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY must be set — required for the Claude -> Gemini fallback path");
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * Free-tier only, by explicit requirement — never retried in a loop here.
 * A 429 (rate-limit or daily quota) can't succeed by retrying within the
 * same window, and looping against it either wastes time uselessly or, on
 * a billing-enabled project, risks quietly accumulating paid usage instead
 * of failing loudly. Any error thrown here is treated as terminal for this
 * fallback attempt by the caller (invoke.ts) — it does not retry Gemini
 * itself.
 *
 * Whether a given Gemini API key can ever incur a charge is entirely a
 * property of the Google Cloud project behind it (billing account linked
 * or not) — confirmed via Gemini's current rate-limits documentation, this
 * is not something any client-side code (this file included) can detect,
 * enforce, or override. The guarantee this file provides is narrower and
 * concrete: it never retries past a quota error and never does anything
 * that could turn one failed request into repeated billed attempts.
 *
 * System prompt and user input are concatenated into one `contents` string
 * rather than using a separate system-instruction field — this is the
 * simple, confirmed-working call shape from the SDK's own published
 * examples; a dedicated system-role field was not independently confirmed
 * before shipping, so this avoids relying on an unverified parameter name.
 */
export const invokeGemini: SkillProvider = async (context, skillMarkdown) => {
  const ai = client();

  const proseResponse = await ai.models.generateContent({
    model: MODEL,
    contents: `${skillMarkdown}\n\n---\n\n${buildSkillInput(context)}`,
  });
  const prose = proseResponse.text ?? "";
  if (!prose) {
    return { status: "parse_failure", reason: "Skill call returned no content", rawOutput: "" };
  }

  const extractionResponse = await ai.models.generateContent({
    model: MODEL,
    contents: `${EXTRACTION_SYSTEM_PROMPT}\n\n---\n\n${prose}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: GEMINI_DECISION_SCHEMA,
    },
  });
  const extractionText = extractionResponse.text ?? "";
  if (!extractionText) {
    return { status: "parse_failure", reason: "extraction call returned no content", rawOutput: prose };
  }

  const parsed = parseExtractionOutput(extractionText);
  if (!parsed.ok) {
    return { status: "parse_failure", reason: parsed.reason, rawOutput: prose };
  }

  return { status: "success", decision: parsed.decision, rawOutput: prose };
};
