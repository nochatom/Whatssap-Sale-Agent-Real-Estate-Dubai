import OpenAI from "openai";

import { buildSkillInput } from "../build-prompt";
import { parseExtractionOutput } from "../parse-decision";
import { EXTRACTION_SYSTEM_PROMPT } from "./extraction-prompt";
import type { SkillProvider } from "./types";

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
// meta/llama-3.1-405b-instruct does not exist on NVIDIA's current hosted API
// (confirmed 404 — absent from their documented model list); this is their
// newest/strongest available Llama model as of the same check.
const MODEL = "meta/llama-3.3-70b-instruct";

/**
 * NVIDIA NIM's API is OpenAI-compatible, so the standard `openai` SDK is
 * used against NVIDIA's baseURL rather than a NVIDIA-specific client.
 * NVIDIA_API_KEY is read explicitly here (the OpenAI SDK has no NVIDIA-aware
 * default env var to fall back on) — this is the only place in the codebase
 * that reads it, and it is never logged.
 */
function client(): OpenAI {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    throw new Error("NVIDIA_API_KEY is not set — required when AI_PROVIDER=nvidia");
  }
  return new OpenAI({ apiKey, baseURL: NVIDIA_BASE_URL });
}

export const invokeNvidia: SkillProvider = async (context, skillMarkdown) => {
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

  const extractionResponse = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
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
