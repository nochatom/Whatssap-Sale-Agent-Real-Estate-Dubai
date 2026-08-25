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
 * Confirmed via a real production incident (2026-08-25): once a conversation
 * reaches ready_to_start (a go-ahead was given, or assets were provided — see
 * MILESTONE_LABELS above), the model has been observed conflating "the client
 * said they want to pay" with "the client already paid" and stating this as
 * fact to the client (e.g. "You've already purchased a video creation service
 * from me"), even though no payment_confirmed or payment_proof_received
 * milestone was ever reached in the same conversation. Same "state the fact
 * deterministically instead of trusting the model to infer it correctly from
 * a long transcript" reasoning as every other check in this file — this is
 * additive and never fires once payment has genuinely been confirmed.
 */
function summarizePaymentClaimGuard(reachedMilestones: Milestone[] | undefined): string | null {
  if (!reachedMilestones || !reachedMilestones.includes("ready_to_start")) return null;
  const paymentConfirmed =
    reachedMilestones.includes("payment_confirmed") || reachedMilestones.includes("payment_proof_received");
  if (paymentConfirmed) return null;

  return (
    `[Payment claim guard: this conversation has reached ready_to_start (a go-ahead was given, or assets were ` +
    `provided) but has NEVER reached payment_confirmed or payment_proof_received. Do NOT state or imply that the ` +
    `client has already purchased, already paid, completed payment, or is a paid/existing customer — ready_to_start ` +
    `alone is not proof of payment, regardless of anything earlier in the transcript that looks like payment intent ` +
    `(e.g. "I wanna pay now" or a payment link having been sent). If payment status is relevant to your reply, treat ` +
    `it as still pending/unconfirmed.]`
  );
}

// Curly quote variants the model itself has been observed to alternate
// between across separate generations of essentially the same sentence
// (e.g. "I've" vs "I've" using U+2019 instead of U+0027) — normalized away
// so two outputs that are really the same text aren't treated as distinct
// just because a different apostrophe glyph was used that turn.
function normalizeReplyText(body: string): string {
  return body
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// Below this length, exact repeats are usually short, generic acknowledgments
// ("Sure!", "Thanks!") that are fine to repeat and not worth flagging — the
// real failure mode this guards against is a substantial, specific reply
// (a workflow-stage confirmation, a detailed answer) being regenerated
// near-verbatim, which is long by nature.
const MIN_REPEAT_LENGTH = 20;

interface RepeatedReply {
  text: string;
  count: number;
}

/**
 * Confirmed via a real production incident (2026-08-24): once the exact same
 * substantial reply has already gone out more than once in a conversation,
 * the model treats its OWN prior output as strong precedent and keeps
 * regenerating it — even when SkillInvocationContext.reachedMilestones (see
 * summarizeReachedMilestones above) correctly names the milestone as
 * historical, and even when the latest client message is unrelated. Naming
 * *which milestone* was reached wasn't enough once the mistake had already
 * repeated a few times; what stops it is confronting the model with the
 * concrete fact that it has already said this more than once, the same
 * "count it, don't just say don't-repeat" fix already proven for
 * price/demo-link above — generalized here to ANY reply content, not tied
 * to a specific milestone or fixed shape, since a stage-completion reply's
 * wording isn't a fixed regex-able string the way a price or a URL is.
 *
 * Deliberately independent of summarizeReachedMilestones: this catches
 * verbatim repetition regardless of why it happened, as a defense-in-depth
 * backstop for whatever the underlying cause turns out to be next time.
 */
function detectRepeatedReplies(outbound: SkillInputMessage[]): RepeatedReply[] {
  const counts = new Map<string, number>();
  for (const message of outbound) {
    const normalized = normalizeReplyText(message.body);
    if (normalized.length < MIN_REPEAT_LENGTH) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  const repeats: RepeatedReply[] = [];
  for (const [text, count] of counts) {
    if (count >= 2) repeats.push({ text, count });
  }
  return repeats;
}

const URL_SHAPE_GLOBAL = /https?:\/\/\S+/gi;

// >=0.7 was picked against the real 2026-08-25 incident (a reply that dropped
// its trailing "you can pay via PayPal..." sentence on repeat measured ~0.76
// against the original).
const NEAR_DUPLICATE_SIMILARITY_THRESHOLD = 0.7;

// Deliberately higher than MIN_REPEAT_LENGTH (used by the exact-match detector
// above). Short templated one-liners are exactly where word-set similarity is
// least reliable — two DIFFERENT, legitimate price quotes in two different
// currencies (e.g. "It's $149 per video, all inclusive." vs "It's £109.23 per
// video, all inclusive.") can score close to the same threshold purely from
// shared boilerplate words, even though the number that actually matters
// differs. The real incident text this guard targets was ~150+ characters;
// gating near-duplicate comparison to longer replies only avoids that false
// positive while still catching the real case with margin to spare.
const NEAR_DUPLICATE_MIN_LENGTH = 60;

function wordSet(normalizedBody: string): Set<string> {
  return new Set(
    normalizedBody
      .replace(URL_SHAPE_GLOBAL, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .split(/\s+/)
      .filter(Boolean),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

interface NearDuplicateGroup {
  count: number;
  /** Distinct wordings within this group, first-seen order (for the preview). */
  texts: string[];
}

/**
 * Extends detectRepeatedReplies to catch the case a byte-for-byte comparison
 * misses: the SAME core question/intent sent more than once with a sentence
 * added or removed (e.g. a payment-link sentence present the first time, gone
 * on the retry) — confirmed as the actual real-world shape of the 2026-08-25
 * incident, where the exact-match guard above never fired because no two
 * occurrences were byte-identical. Groups outbound replies by word-set
 * similarity (order-independent, URL-stripped so a dropped/changed link
 * doesn't itself defeat the match) and only reports a group whose members are
 * NOT all identical — a fully-identical group is already reported by
 * detectRepeatedReplies and would be double coverage of the same fact.
 */
function detectNearDuplicateReplies(outbound: SkillInputMessage[]): NearDuplicateGroup[] {
  const candidates = outbound.map((m) => normalizeReplyText(m.body)).filter((t) => t.length >= NEAR_DUPLICATE_MIN_LENGTH);
  const wordSets = candidates.map(wordSet);
  const assigned = new Array<boolean>(candidates.length).fill(false);
  const groups: NearDuplicateGroup[] = [];

  for (let i = 0; i < candidates.length; i++) {
    if (assigned[i]) continue;
    const anchorText = candidates[i];
    const anchorWords = wordSets[i];
    if (anchorText === undefined || anchorWords === undefined) continue;

    const clusterIndices = [i];
    for (let j = i + 1; j < candidates.length; j++) {
      if (assigned[j]) continue;
      const candidateWords = wordSets[j];
      if (candidateWords === undefined) continue;
      if (jaccardSimilarity(anchorWords, candidateWords) >= NEAR_DUPLICATE_SIMILARITY_THRESHOLD) {
        clusterIndices.push(j);
      }
    }
    if (clusterIndices.length < 2) continue;

    const clusterTexts: string[] = [];
    for (const idx of clusterIndices) {
      const text = candidates[idx];
      if (text !== undefined) clusterTexts.push(text);
    }
    if (clusterTexts.length < 2) continue;

    const [firstText, ...restTexts] = clusterTexts;
    const allIdentical = firstText !== undefined && restTexts.every((t) => t === firstText);
    if (allIdentical) continue;

    for (const idx of clusterIndices) assigned[idx] = true;

    const distinct: string[] = [];
    for (const t of clusterTexts) if (!distinct.includes(t)) distinct.push(t);
    groups.push({ count: clusterTexts.length, texts: distinct });
  }

  return groups;
}

function summarizeRepeatedReplies(messages: SkillInputMessage[]): string | null {
  const outbound = messages.filter((m) => m.direction === "outbound");
  const repeats = detectRepeatedReplies(outbound);
  const nearDuplicates = detectNearDuplicateReplies(outbound);
  if (repeats.length === 0 && nearDuplicates.length === 0) return null;

  const blocks: string[] = [];

  if (repeats.length > 0) {
    const lines = repeats.map(({ text, count }) => {
      const preview = text.length > 160 ? `${text.slice(0, 160)}...` : text;
      return `- (sent ${count} times) "${preview}"`;
    });
    blocks.push(
      `[Repetition alert: your own reply text below has already gone out more than once, word-for-word, earlier in ` +
        `this conversation:\n${lines.join("\n")}\nSending this same content again is a hard failure, regardless of the ` +
        `reason — do NOT repeat it. Write a reply driven only by the client's CURRENT latest message, even if that ` +
        `message is short, unrelated, or a bare greeting — unless the client's own latest message explicitly asks for ` +
        `this exact content again, in which case answer it directly rather than avoiding it.]`,
    );
  }

  if (nearDuplicates.length > 0) {
    const lines = nearDuplicates.map(({ count, texts }) => {
      const [firstText = ""] = texts;
      const preview = firstText.length > 160 ? `${firstText.slice(0, 160)}...` : firstText;
      return `- (functionally repeated ${count} times, wording varies slightly) "${preview}"`;
    });
    blocks.push(
      `[Near-duplicate alert: your own replies below have already made essentially the same point — the same core ` +
        `question or intent — more than once earlier in this conversation, even though the exact wording differs ` +
        `slightly (e.g. a sentence added or removed):\n${lines.join("\n")}\nRegenerating the same core content again, ` +
        `even reworded, is a hard failure, regardless of the reason — do NOT repeat it. Write a reply driven only by ` +
        `the client's CURRENT latest message, even if that message is short, unrelated, or a bare greeting — unless ` +
        `the client's own latest message explicitly reopens this exact topic or asks for it again, in which case ` +
        `answer it directly rather than avoiding it.]`,
    );
  }

  return blocks.join("\n");
}

// Whole-message vocabulary for "carries no new information" detection —
// greetings, check-ins, and bare acknowledgments only. Deliberately does NOT
// include "yes"/"no"/"ok" alone being enough to cover a real decision word
// (e.g. "Ok I wanna pay now" still contains "wanna"/"pay"/"now", none of
// which are in this list, so the message as a whole still fails the
// every-word-must-match test below and is correctly NOT flagged).
const LOW_CONTENT_WORDS = new Set([
  "hi", "hii", "hiya", "hey", "heyy", "hello", "yo", "hola",
  "good", "morning", "afternoon", "evening", "day",
  "how", "r", "are", "you", "u", "doing", "going", "it", "whats", "what's", "wassup", "sup",
  "there", "still", "you're", "youre",
  "ok", "okay", "k", "kk", "sure", "thanks", "thank", "np", "cool", "nice", "alright", "yep", "yup", "fine", "great", "awesome",
]);

const MAX_LOW_CONTENT_WORDS = 6;

/**
 * True only when EVERY word in the message (after stripping punctuation) is
 * in the small-talk/greeting/acknowledgment vocabulary above — a whole-message
 * check, not a "contains a greeting word" check, so "Hey how are you" matches
 * but "Ok I wanna pay now" or "Yes I know I wanna request service another"
 * do not (they contain real content words outside the list).
 */
function isLowContentMessage(body: string): boolean {
  const words = body
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0 || words.length > MAX_LOW_CONTENT_WORDS) return false;
  return words.every((w) => LOW_CONTENT_WORDS.has(w));
}

/**
 * Confirmed via a real production incident (2026-08-25): a bare "Hey" (or
 * "Hey how are you", "Hey, how are you?") sent while an earlier question or
 * workflow stage is still open gets treated by the model as if it answered or
 * reopened that earlier thread — the model just re-fires the old pending
 * question and never acknowledges what the client actually said. This states
 * the fact deterministically (the latest message really does carry no new
 * information) instead of relying on the model to notice that on its own,
 * same reasoning as every other check in this file. Purely about HOW to
 * respond to the latest message — it does not touch reachedMilestones,
 * pricing, or anything else already stated elsewhere in the prompt.
 */
function summarizeFreshTurnCheck(messages: SkillInputMessage[]): string | null {
  const latestInbound = [...messages].reverse().find((m) => m.direction === "inbound");
  if (!latestInbound || !isLowContentMessage(latestInbound.body)) return null;

  return (
    `[Fresh-turn check: the client's LATEST message ("${latestInbound.body.trim()}") is only a short greeting, ` +
    `check-in, or acknowledgment — it does NOT answer or advance any earlier open question, service request, or ` +
    `workflow stage, no matter what is still pending above. Respond naturally to this message first. You may briefly ` +
    `mention what is still needed only if it's genuinely relevant, but do NOT ignore this message and simply re-ask ` +
    `or re-state an old pending question as if the client had just answered or reopened it.]`
  );
}

/**
 * Additive context for an automated campaign follow-up call (see
 * trigger/schedule-followup.ts's sequenceStep-branched path) — never set for
 * a normal inbound-message reply. Same pattern as every other fact above:
 * a deterministic, code-computed line telling the Skill what kind of turn
 * this is, not a different prompt or personality. The Skill's own existing
 * rules (pricing, tone, objection-handling, etc.) still apply unchanged;
 * this only adds the specific constraints the user requested for each stage
 * of the sequence.
 */
function summarizeCampaignFollowUp(campaignFollowUp: SkillInvocationContext["campaignFollowUp"]): string | null {
  if (!campaignFollowUp) return null;

  if (campaignFollowUp.stage === "first") {
    return (
      `[Automated follow-up context: 48 hours have passed with no reply since the campaign message was sent. ` +
      `This is an automated first follow-up — keep it short and natural, and do not simply repeat the original ` +
      `campaign message.]`
    );
  }

  return (
    `[Automated follow-up context: this is the FINAL automated follow-up in this sequence, sent after 96 hours ` +
    `of silence. Emphasize the service's value — professional property marketing videos, helping attract buyers ` +
    `or renters, 30-60 second videos, 24-hour delivery, unlimited revisions. Do not invent a discount, bonus, or ` +
    `limited-time offer — use only confirmed pricing from references/payment-config.md if price comes up. No ` +
    `further automated follow-up will be sent after this one.]`
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

  const paymentClaimGuard = summarizePaymentClaimGuard(context.reachedMilestones);
  if (paymentClaimGuard) {
    lines.push("");
    lines.push(paymentClaimGuard);
  }

  const repetitionCheck = summarizeRepeatedReplies(context.messages);
  if (repetitionCheck) {
    lines.push("");
    lines.push(repetitionCheck);
  }

  const freshTurnCheck = summarizeFreshTurnCheck(context.messages);
  if (freshTurnCheck) {
    lines.push("");
    lines.push(freshTurnCheck);
  }

  const campaignFollowUpCheck = summarizeCampaignFollowUp(context.campaignFollowUp);
  if (campaignFollowUpCheck) {
    lines.push("");
    lines.push(campaignFollowUpCheck);
  }

  return lines.join("\n");
}
