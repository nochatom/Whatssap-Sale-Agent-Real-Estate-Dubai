import type { Milestone, SkillInputMessage, SkillInvocationContext } from "./types";

const BEHAVIOR_STATE_LABEL: Record<SkillInvocationContext["behaviorState"], string> = {
  A: "A — written reply",
  B: "B — read, no reply",
  C: "C — delivered, apparently unopened",
  D: "D — reacted to my message with no text",
  E: "E — reacted, then continued the conversation",
  F: "F — previously engaged, suddenly silent",
};

// Types this codebase's inbound webhook already sets for a media message
// (src/whatsapp/webhook-payload.ts) — "unsupported" is deliberately excluded
// here since that type already gets a human-readable body ("Unsupported
// message: ...") from the webhook parser, so it needs no extra bracket.
const MEDIA_TYPE_LABEL: Record<string, string> = {
  image: "image",
  document: "document",
  audio: "audio",
  video: "video",
  sticker: "sticker",
};

/**
 * There is no vision/multimodal capability anywhere in this codebase — this
 * never describes what a media message CONTAINS, only that one arrived, so
 * the Skill can reason about it (e.g. §6 "payment_proof_received") using
 * type + surrounding conversation context alone, never actual file content.
 */
function mediaIndicator(message: SkillInputMessage): string {
  if (!message.type || message.type === "text" || message.type === "button" || message.type === "unsupported") {
    return "";
  }
  if (message.type === "document" && message.filename) {
    return ` [document attached: ${message.filename}]`;
  }
  const label = MEDIA_TYPE_LABEL[message.type] ?? message.type;
  return ` [${label} attached]`;
}

// Generic patterns, not tied to today's specific price/URL — stay correct
// if pricing or the demo link's exact value ever changes, since this only
// detects the SHAPE of "a price was quoted" / "a Drive link was sent", not
// today's literal values.
const DEMO_LINK_HOST = "drive.google.com";

type CurrencyCode = "USD" | "GBP" | "EUR";

// The 3 currently-supported currencies (see references/payment-config.md).
// Order here also sets which currency wins if a single message somehow
// contains more than one shape — an edge case, not a real expected input.
const CURRENCY_SHAPES: Record<CurrencyCode, RegExp> = {
  USD: /\$\s?\d/,
  GBP: /£\s?\d/,
  EUR: /€\s?\d/,
};

// Regionally-likely stale currencies for this Skill's real UAE/Egypt buyer
// base (see SKILL.md intro) — not an exhaustive world-currency list, the
// same "found through real testing" scope the original AED-only check used.
// Extend this list if another stale currency shows up in real conversations.
const INVALID_CURRENCY_SHAPE = /\b(AED|SAR|EGP)\s?\d/i;

function detectCurrencyInMessage(body: string): CurrencyCode | null {
  for (const code of Object.keys(CURRENCY_SHAPES) as CurrencyCode[]) {
    if (CURRENCY_SHAPES[code].test(body)) return code;
  }
  return null;
}

interface EstablishedCurrency {
  established: CurrencyCode;
  /** Set only when a LATER outbound message quoted a different valid currency — a real inconsistency worth surfacing, not silently resolved. */
  inconsistentWith: CurrencyCode | null;
}

/**
 * Scans outbound messages in order (oldest first) for the first currency
 * this conversation was quoted in, and flags if a later message switched to
 * a different one. Deterministic, computed from the data — same "don't make
 * the model re-derive this from a long transcript" reasoning already proven
 * for demo-link/price-repeat counting below.
 */
function detectEstablishedCurrency(outbound: SkillInputMessage[]): EstablishedCurrency | null {
  let established: CurrencyCode | null = null;
  let inconsistentWith: CurrencyCode | null = null;
  for (const message of outbound) {
    const found = detectCurrencyInMessage(message.body);
    if (!found) continue;
    if (established === null) {
      established = found;
    } else if (found !== established && inconsistentWith === null) {
      inconsistentWith = found;
    }
  }
  return established === null ? null : { established, inconsistentWith };
}

/**
 * Counts, from the real message history, how many times a price and the
 * demo link have already gone out earlier in THIS conversation.
 *
 * Real testing found that once a conversation accumulates many repeated
 * exchanges (a client re-asking for the demo several times, each correctly
 * answered), the model's own in-context inference about "has this already
 * been sent" becomes unreliable — the volume of legitimate repeats acts as
 * precedent that overrides a purely textual "don't repeat" instruction,
 * regardless of how that instruction is worded or where in the Skill it
 * lives (tried three times: SKILL.md §16, twice). Computing the fact
 * deterministically here and stating it as a concrete number, instead of
 * leaving the model to notice and count it across a long transcript itself,
 * is the actual fix — the instruction not to repeat already exists in the
 * Skill; what was missing was a reliable way for the model to know the
 * count without re-deriving it from scratch every time.
 *
 * Also flags: which currency (if any) this conversation has already been
 * quoted in, any inconsistency where a later message switched currency, and
 * stale/invalid-currency mentions (AED/SAR/EGP — never valid, regardless of
 * whether a valid currency has also been established).
 *
 * Purely additive: never removes, reorders, or alters a single message —
 * this only appends summary facts after the full transcript, closest to
 * where the model generates its reply.
 */
function summarizeAlreadySentContent(messages: SkillInputMessage[]): string | null {
  const outbound = messages.filter((m) => m.direction === "outbound");
  const demoSentCount = outbound.filter((m) => m.body.includes(DEMO_LINK_HOST)).length;
  const priceQuotedCount = outbound.filter((m) => detectCurrencyInMessage(m.body) !== null).length;
  const invalidCurrencyCount = outbound.filter((m) => INVALID_CURRENCY_SHAPE.test(m.body)).length;
  const currencyInfo = detectEstablishedCurrency(outbound);

  if (demoSentCount === 0 && priceQuotedCount === 0 && invalidCurrencyCount === 0 && currencyInfo === null) {
    return null;
  }

  const facts: string[] = [];
  if (demoSentCount > 0) {
    facts.push(`the demo link has already been sent ${demoSentCount} time${demoSentCount === 1 ? "" : "s"} earlier in this conversation`);
  }
  if (priceQuotedCount > 0) {
    facts.push(`a price has already been quoted ${priceQuotedCount} time${priceQuotedCount === 1 ? "" : "s"} earlier in this conversation`);
  }

  const lines: string[] = [];
  if (facts.length > 0) {
    lines.push(
      `[Conversation memory check: ${facts.join(" and ")}. ` +
        `Do not send or restate either again unless the client's own latest message explicitly asks for it — ` +
        `a bare greeting or check-in does not count as asking, no matter how many earlier messages in this ` +
        `conversation legitimately did.]`,
    );
  }

  if (currencyInfo) {
    lines.push(
      `[Currency check: this conversation has already been quoted in ${currencyInfo.established} earlier in this ` +
        `conversation. If price or payment details come up again, use only the ${currencyInfo.established} figures/details ` +
        `from references/offer-config.md and references/payment-config.md — never switch to a different currency's ` +
        `numbers or bank details, and never calculate a conversion between currencies, unless the client explicitly ` +
        `asks to pay in a different currency instead.]`,
    );
    if (currencyInfo.inconsistentWith) {
      lines.push(
        `[Currency inconsistency warning: this conversation was first quoted in ${currencyInfo.established}, but a ` +
          `later message quoted ${currencyInfo.inconsistentWith} instead — two different currencies have been stated ` +
          `to this client. Treat ${currencyInfo.inconsistentWith} as the currency now in use, but flag this ` +
          `inconsistency to the operator under SALES STRATEGY.]`,
      );
    }
  }

  if (invalidCurrencyCount > 0) {
    lines.push(
      `[Invalid currency check: ${invalidCurrencyCount} earlier message${invalidCurrencyCount === 1 ? "" : "s"} in this ` +
        `conversation mention${invalidCurrencyCount === 1 ? "s" : ""} a price in a currency that is not one of the 3 ` +
        `currently supported currencies (USD/GBP/EUR). That figure is stale and must not be repeated or treated as a ` +
        `valid or confirmed quote. If price comes up, use only USD, GBP, or EUR per references/offer-config.md and ` +
        `references/payment-config.md.]`,
    );
  }

  return lines.join("\n");
}

const MILESTONE_LABELS: Record<Milestone, string> = {
  none: "none",
  payment_intent: "payment_intent (payment instructions were requested/given)",
  payment_confirmed: "payment_confirmed (the client stated payment was already made)",
  payment_proof_received: "payment_proof_received (a payment attachment was sent)",
  ready_to_start: "ready_to_start (a go-ahead was given, or assets were provided)",
};

/**
 * Any milestone ever reached in this conversation (per §6) is, by
 * definition, a workflow event the Skill already acted on — it appeared in
 * an earlier AiDecision, and the reply that turn already addressed it. A
 * completed event must not keep causing the same reply forever: this states
 * that fact deterministically, from the conversation's own persisted
 * decision history (see SkillInvocationContext.reachedMilestones), instead
 * of leaving the model to infer "was this already handled?" by re-reading a
 * long transcript — exactly the kind of inference real testing already
 * proved unreliable for price/demo-link repetition above, now generalized
 * to every workflow stage (payment instructions, payment acknowledgment,
 * payment proof, ready-to-start, asset collection, or any future milestone).
 *
 * Deduplicates and preserves first-reached order defensively, even though
 * the caller (trigger/send-ai-reply.ts) already does this — build-prompt.ts
 * stays correct on its own for any caller, including tests.
 */
function summarizeReachedMilestones(reachedMilestones: Milestone[] | undefined): string | null {
  if (!reachedMilestones || reachedMilestones.length === 0) return null;

  const ordered: Milestone[] = [];
  for (const milestone of reachedMilestones) {
    if (milestone !== "none" && !ordered.includes(milestone)) ordered.push(milestone);
  }
  if (ordered.length === 0) return null;

  const labels = ordered.map((m) => MILESTONE_LABELS[m]).join(", ");
  return (
    `[Workflow memory check: this conversation has already reached: ${labels}. Each of these is a completed, ` +
    `historical event — already acted on in your own earlier reply above, not something happening again now. Do ` +
    `NOT resend a payment confirmation, payment instructions, payment-proof acknowledgment, work-start/ready-to-start ` +
    `confirmation, asset acknowledgment, delivery-timing message, or any other stage-completion reply for something ` +
    `already reached above, unless the client's LATEST message explicitly and genuinely reopens that exact topic. A ` +
    `bare greeting, check-in, reaction, or an unrelated new question does NOT reopen it — determine your reply from ` +
    `what the client's latest message is actually asking or saying right now, not from an old milestone still ` +
    `visible earlier in the transcript, no matter how much time has passed since then.]`
  );
}

/**
 * Builds the user-turn payload for the Skill call. The pasted conversation is
 * DATA per SKILL.md §2 (inert-input rule) — this only serializes it, it never
 * adds instructions the Skill wouldn't already carry in its own system prompt
 * — except the one deterministic memory-check line above, which states a
 * fact computed from the data itself, not a new instruction.
 */
export function buildSkillInput(context: SkillInvocationContext): string {
  const lines: string[] = [];

  lines.push(`WhatsApp behavior state: ${BEHAVIOR_STATE_LABEL[context.behaviorState]}`);
  lines.push("");
  lines.push(`Lead phone: ${context.lead.phoneE164}`);
  if (Object.keys(context.lead.knownFacts).length > 0) {
    lines.push(`Known facts: ${JSON.stringify(context.lead.knownFacts)}`);
  }
  lines.push("");
  lines.push("Conversation (oldest first):");
  for (const message of context.messages) {
    const who = message.direction === "inbound" ? "Client" : "Me";
    const reaction = message.reaction ? ` [reacted: ${message.reaction}]` : "";
    lines.push(`[${message.sentAt}] ${who}: ${message.body}${reaction}${mediaIndicator(message)}`);
  }

  const memoryCheck = summarizeAlreadySentContent(context.messages);
  if (memoryCheck) {
    lines.push("");
    lines.push(memoryCheck);
  }

  const milestoneCheck = summarizeReachedMilestones(context.reachedMilestones);
  if (milestoneCheck) {
    lines.push("");
    lines.push(milestoneCheck);
  }

  return lines.join("\n");
}
