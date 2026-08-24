import { describe, expect, it } from "vitest";

import { buildSkillInput } from "@/skill/build-prompt";
import type { Milestone, SkillInputMessage, SkillInvocationContext } from "@/skill/types";

function msg(
  direction: "inbound" | "outbound",
  body: string,
  extra?: Partial<Pick<SkillInputMessage, "type" | "filename">>,
): SkillInputMessage {
  return { direction, body, sentAt: "2026-01-01T00:00:00.000Z", ...extra };
}

function contextWith(messages: SkillInputMessage[], reachedMilestones?: Milestone[]): SkillInvocationContext {
  return {
    conversationId: "conv_1",
    behaviorState: "A",
    messages,
    reachedMilestones,
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
});

describe("buildSkillInput — currency checks (USD/GBP/EUR valid, AED/SAR/EGP invalid)", () => {
  it("counts GBP and EUR price mentions the same way USD ones are counted", () => {
    const input = buildSkillInput(
      contextWith([msg("outbound", "It's £109.23 per video."), msg("outbound", "Confirming, £109.23.")]),
    );
    expect(input).toContain("a price has already been quoted 2 times earlier in this conversation");

    const eurInput = buildSkillInput(contextWith([msg("outbound", "It's €127.48 per video.")]));
    expect(eurInput).toContain("a price has already been quoted 1 time earlier in this conversation");
  });

  it("emits an established-currency fact line once any valid currency has been quoted", () => {
    const input = buildSkillInput(contextWith([msg("outbound", "It's $149 per video.")]));
    expect(input).toContain(
      "this conversation has already been quoted in USD earlier in this conversation",
    );
    expect(input).toContain("references/offer-config.md and references/payment-config.md");
    expect(input).toContain("never calculate a conversion between currencies");
  });

  it("names GBP or EUR (not USD) as established when that's the currency actually quoted", () => {
    const gbpInput = buildSkillInput(contextWith([msg("outbound", "It's £109.23 per video.")]));
    expect(gbpInput).toContain("this conversation has already been quoted in GBP earlier");

    const eurInput = buildSkillInput(contextWith([msg("outbound", "It's €127.48 per video.")]));
    expect(eurInput).toContain("this conversation has already been quoted in EUR earlier");
  });

  it("does NOT emit an established-currency line when no valid currency has ever been quoted", () => {
    const input = buildSkillInput(contextWith([msg("inbound", "hi"), msg("outbound", "Sure, happy to help!")]));
    expect(input).not.toContain("Currency check");
  });

  it("flags a currency inconsistency when a later message quotes a different valid currency", () => {
    const input = buildSkillInput(
      contextWith([msg("outbound", "It's $149 per video."), msg("outbound", "Actually, it's £109.23 per video.")]),
    );
    expect(input).toContain("Currency inconsistency warning");
    expect(input).toContain("this conversation was first quoted in USD, but a later message quoted GBP instead");
    expect(input).toContain("Treat GBP as the currency now in use");
  });

  it("does NOT flag an inconsistency when the same currency is quoted more than once", () => {
    const input = buildSkillInput(
      contextWith([msg("outbound", "It's $149 per video."), msg("outbound", "Confirming, $149.")]),
    );
    expect(input).not.toContain("Currency inconsistency warning");
  });

  it("flags stale AED quotes with the generalized invalid-currency wording", () => {
    const input = buildSkillInput(
      contextWith([
        msg("outbound", "For 1-2 properties it's AED 500 per video."),
        msg("inbound", "How much now?"),
        msg("outbound", "It's $149 per video."),
      ]),
    );
    expect(input).toContain("a price has already been quoted 1 time earlier in this conversation"); // only the $ one
    expect(input).toContain("Invalid currency check");
    expect(input).toContain(
      "1 earlier message in this conversation mentions a price in a currency that is not one of the 3 currently supported currencies (USD/GBP/EUR)",
    );
    expect(input).toContain("use only USD, GBP, or EUR per references/offer-config.md and references/payment-config.md");
  });

  it("also treats SAR and EGP as invalid/stale currencies", () => {
    const sarInput = buildSkillInput(contextWith([msg("outbound", "It's SAR 550 per video.")]));
    expect(sarInput).toContain("Invalid currency check");

    const egpInput = buildSkillInput(contextWith([msg("outbound", "It's EGP 2000 per video.")]));
    expect(egpInput).toContain("Invalid currency check");
  });

  it("a client mentioning AED themselves (e.g. a competitor's quote) doesn't trigger our own currency check", () => {
    const input = buildSkillInput(contextWith([msg("inbound", "someone else quoted me AED 400")]));
    expect(input).not.toContain("Currency check");
    expect(input).not.toContain("Invalid currency check");
  });
});

describe("buildSkillInput — workflow memory check (reached milestones)", () => {
  it("adds no workflow-memory line when no milestone has been reached", () => {
    const input = buildSkillInput(contextWith([msg("inbound", "hi")]));
    expect(input).not.toContain("Workflow memory check");
  });

  it("adds no workflow-memory line when reachedMilestones is an empty array", () => {
    const input = buildSkillInput(contextWith([msg("inbound", "hi")], []));
    expect(input).not.toContain("Workflow memory check");
  });

  it("states a single reached milestone as historical and instructs not to resend it", () => {
    const input = buildSkillInput(
      contextWith(
        [
          msg("inbound", "I've made the payment"),
          msg("outbound", "I've confirmed receipt of your payment. I'll start working on your videos now!"),
          msg("inbound", "Hey"),
        ],
        ["payment_confirmed"],
      ),
    );
    expect(input).toContain("Workflow memory check");
    expect(input).toContain("payment_confirmed");
    expect(input).toContain("historical event");
    expect(input).toContain("Do NOT resend a payment confirmation");
    expect(input).toContain("bare greeting, check-in, reaction, or an unrelated new question does NOT reopen it");
  });

  it("lists multiple reached milestones, deduped, in first-reached order", () => {
    const input = buildSkillInput(
      contextWith([msg("inbound", "hi")], ["payment_intent", "payment_confirmed", "payment_intent", "ready_to_start"]),
    );
    const idxIntent = input.indexOf("payment_intent");
    const idxConfirmed = input.indexOf("payment_confirmed");
    const idxReady = input.indexOf("ready_to_start");
    expect(idxIntent).toBeGreaterThan(-1);
    expect(idxConfirmed).toBeGreaterThan(idxIntent);
    expect(idxReady).toBeGreaterThan(idxConfirmed);
    // Deduped: "payment_intent" text appears in the summary line only once
    // (plus once more inside the milestone list's own longer descriptions is
    // not possible here since labels are distinct strings) — assert no
    // doubled listing via a simple occurrence count of the exact token.
    const occurrences = input.split("payment_intent").length - 1;
    expect(occurrences).toBe(1);
  });

  it("covers every workflow stage generically (payment instructions, proof, ready-to-start), not just payment_confirmed", () => {
    const proofInput = buildSkillInput(contextWith([msg("inbound", "ok")], ["payment_proof_received"]));
    expect(proofInput).toContain("payment_proof_received");
    expect(proofInput).toContain("asset acknowledgment");
    expect(proofInput).toContain("delivery-timing message");

    const readyInput = buildSkillInput(contextWith([msg("inbound", "ok")], ["ready_to_start"]));
    expect(readyInput).toContain("ready_to_start");
  });

  it("ignores a stray 'none' entry defensively (should never be passed, but stays correct if it is)", () => {
    const input = buildSkillInput(contextWith([msg("inbound", "hi")], ["none" as Milestone]));
    expect(input).not.toContain("Workflow memory check");
  });

  it("coexists with the price/demo-link memory check without interfering with either", () => {
    const input = buildSkillInput(
      contextWith(
        [msg("outbound", "It's $149 per video."), msg("inbound", "I've made the payment")],
        ["payment_confirmed"],
      ),
    );
    expect(input).toContain("Conversation memory check");
    expect(input).toContain("Workflow memory check");
  });
});

describe("buildSkillInput — repetition alert (repeated outbound replies)", () => {
  it("adds no repetition-alert line when nothing repeats", () => {
    const input = buildSkillInput(
      contextWith([msg("inbound", "hi"), msg("outbound", "Hi! What property are you working with?")]),
    );
    expect(input).not.toContain("Repetition alert");
  });

  it("adds no repetition-alert line for a single occurrence of a long reply", () => {
    const input = buildSkillInput(
      contextWith([msg("outbound", "I've confirmed receipt of your payment. I'll start working on your videos now!")]),
    );
    expect(input).not.toContain("Repetition alert");
  });

  it("flags a substantial reply that has gone out word-for-word more than once", () => {
    const input = buildSkillInput(
      contextWith([
        msg("inbound", "I've made the payment"),
        msg("outbound", "I've confirmed receipt of your payment. I'll start working on your videos now!"),
        msg("inbound", "Hey"),
        msg("outbound", "I've confirmed receipt of your payment. I'll start working on your videos now!"),
        msg("inbound", "Hey"),
      ]),
    );
    expect(input).toContain("Repetition alert");
    expect(input).toContain("sent 2 times");
    expect(input).toContain("I've confirmed receipt of your payment");
    expect(input).toContain("hard failure");
  });

  it("treats curly and straight apostrophe/quote variants as the same text (the exact real-world case that caused the bug)", () => {
    const input = buildSkillInput(
      contextWith([
        msg("outbound", "I've confirmed receipt of your payment. I'll start working on your videos now!"),
        msg("outbound", "I’ve confirmed receipt of your payment. I’ll start working on your videos now!"),
      ]),
    );
    expect(input).toContain("Repetition alert");
    expect(input).toContain("sent 2 times");
  });

  it("does not flag short, generic repeats (e.g. 'Thanks!' said twice)", () => {
    const input = buildSkillInput(
      contextWith([
        msg("outbound", "Thanks!"),
        msg("inbound", "np"),
        msg("outbound", "Thanks!"),
      ]),
    );
    expect(input).not.toContain("Repetition alert");
  });

  it("only counts outbound messages — the client repeating their own words doesn't count", () => {
    const input = buildSkillInput(
      contextWith([
        msg("inbound", "can you do a video for my other property too please"),
        msg("outbound", "Sure, happy to help with that!"),
        msg("inbound", "can you do a video for my other property too please"),
      ]),
    );
    expect(input).not.toContain("Repetition alert");
  });

  it("reports each distinct repeated message separately when more than one has repeated", () => {
    const input = buildSkillInput(
      contextWith([
        msg("outbound", "I've confirmed receipt of your payment. I'll start working on your videos now!"),
        msg("outbound", "I've confirmed receipt of your payment. I'll start working on your videos now!"),
        msg("outbound", "Perfect, let's get your property photos or listing link whenever you're ready!"),
        msg("outbound", "Perfect, let's get your property photos or listing link whenever you're ready!"),
      ]),
    );
    expect(input).toContain("I've confirmed receipt of your payment");
    expect(input).toContain("Perfect, let's get your property photos");
  });

  it("coexists with the milestone and price/demo-link checks without interfering with either", () => {
    const input = buildSkillInput(
      contextWith(
        [
          msg("outbound", "It's $149 per video."),
          msg("outbound", "I've confirmed receipt of your payment. I'll start working on your videos now!"),
          msg("outbound", "I've confirmed receipt of your payment. I'll start working on your videos now!"),
        ],
        ["payment_confirmed"],
      ),
    );
    expect(input).toContain("Conversation memory check");
    expect(input).toContain("Workflow memory check");
    expect(input).toContain("Repetition alert");
  });
});

describe("buildSkillInput — media indicator", () => {
  it("appends [image attached] for an image message", () => {
    const input = buildSkillInput(contextWith([msg("inbound", "", { type: "image" })]));
    expect(input).toContain("[image attached]");
  });

  it("appends [document attached: filename] when a document has a filename", () => {
    const input = buildSkillInput(contextWith([msg("inbound", "", { type: "document", filename: "receipt.pdf" })]));
    expect(input).toContain("[document attached: receipt.pdf]");
  });

  it("appends a generic [document attached] when a document has no filename", () => {
    const input = buildSkillInput(contextWith([msg("inbound", "", { type: "document" })]));
    expect(input).toContain("[document attached]");
    expect(input).not.toContain("[document attached:");
  });

  it("appends [audio attached], [video attached], [sticker attached] for those types", () => {
    expect(buildSkillInput(contextWith([msg("inbound", "", { type: "audio" })]))).toContain("[audio attached]");
    expect(buildSkillInput(contextWith([msg("inbound", "", { type: "video" })]))).toContain("[video attached]");
    expect(buildSkillInput(contextWith([msg("inbound", "", { type: "sticker" })]))).toContain("[sticker attached]");
  });

  it("adds no indicator for text, button, unsupported, or unset types", () => {
    expect(buildSkillInput(contextWith([msg("inbound", "hi", { type: "text" })]))).not.toContain("attached]");
    expect(buildSkillInput(contextWith([msg("inbound", "Yes", { type: "button" })]))).not.toContain("attached]");
    expect(
      buildSkillInput(contextWith([msg("inbound", "Unsupported message: poll", { type: "unsupported" })])),
    ).not.toContain("attached]");
    expect(buildSkillInput(contextWith([msg("inbound", "hi")]))).not.toContain("attached]");
  });
});
