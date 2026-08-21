import { describe, expect, it } from "vitest";

import { buildSkillInput } from "@/skill/build-prompt";
import type { SkillInputMessage, SkillInvocationContext } from "@/skill/types";

function msg(direction: "inbound" | "outbound", body: string): SkillInputMessage {
  return { direction, body, sentAt: "2026-01-01T00:00:00.000Z" };
}

function contextWith(messages: SkillInputMessage[]): SkillInvocationContext {
  return {
    conversationId: "conv_1",
    behaviorState: "A",
    messages,
    lead: { phoneE164: "+15550000000", knownFacts: {} },
  };
}

describe("buildSkillInput — deterministic memory check", () => {
  it("adds no memory-check line when neither a price nor the demo link has ever been sent", () => {
    const input = buildSkillInput(contextWith([msg("inbound", "hi"), msg("outbound", "Hi! What property are you working with?")]));
    expect(input).not.toContain("Conversation memory check");
  });

  it("counts a single demo send correctly", () => {
    const input = buildSkillInput(
      contextWith([
        msg("inbound", "can I see a sample"),
        msg("outbound", "Here's the demo: https://drive.google.com/file/d/abc/view"),
      ]),
    );
    expect(input).toContain("the demo link has already been sent 1 time earlier in this conversation");
    expect(input).not.toContain("price has already been quoted");
  });

  it("counts multiple price quotes correctly, with correct pluralization", () => {
    const input = buildSkillInput(
      contextWith([
        msg("outbound", "It's $149 per video."),
        msg("inbound", "still there?"),
        msg("outbound", "Just confirming, $149 per video."),
      ]),
    );
    expect(input).toContain("a price has already been quoted 2 times earlier in this conversation");
  });

  it("combines both counts when both have been sent", () => {
    const input = buildSkillInput(
      contextWith([
        msg("outbound", "It's $149 per video."),
        msg("outbound", "Here's the demo: https://drive.google.com/file/d/abc/view"),
      ]),
    );
    expect(input).toContain("a price has already been quoted 1 time");
    expect(input).toContain("the demo link has already been sent 1 time");
    expect(input).toContain("Do not send or restate either again unless the client's own latest message explicitly asks");
  });

  it("only counts outbound messages — a client pasting a price or a Drive link doesn't count", () => {
    const input = buildSkillInput(
      contextWith([
        msg("inbound", "someone quoted me $99 elsewhere"),
        msg("inbound", "here's a link https://drive.google.com/file/d/xyz/view they sent me"),
      ]),
    );
    expect(input).not.toContain("Conversation memory check");
  });

  it("stays correct if the price changes later — detects the shape ($<digits>), not today's literal value", () => {
    const input = buildSkillInput(contextWith([msg("outbound", "It's $299 per video now.")]));
    expect(input).toContain("a price has already been quoted 1 time earlier in this conversation");
  });

  it("flags stale AED quotes separately from valid USD quotes, with a distinct currency-check line", () => {
    const input = buildSkillInput(
      contextWith([
        msg("outbound", "For 1-2 properties it's AED 500 per video."),
        msg("inbound", "How much now?"),
        msg("outbound", "It's $149 per video."),
      ]),
    );
    expect(input).toContain("a price has already been quoted 1 time earlier in this conversation"); // only the $ one
    expect(input).toContain("1 earlier message in this conversation mentions a price in a non-USD currency (e.g. AED)");
    expect(input).toContain("stale, superseded pricing from before this Skill moved to USD-only");
    expect(input).toContain("the only valid number is the current USD price from references/offer-config.md");
  });

  it("does not add a currency-check line when only USD has ever been quoted", () => {
    const input = buildSkillInput(contextWith([msg("outbound", "It's $149 per video.")]));
    expect(input).not.toContain("Currency check");
  });

  it("a client mentioning AED themselves (e.g. a competitor's quote) doesn't trigger our own currency check", () => {
    const input = buildSkillInput(contextWith([msg("inbound", "someone else quoted me AED 400")]));
    expect(input).not.toContain("Currency check");
  });
});
