# Behavioral Signals

Deeper handling for WhatsApp behavior states B, C, D, E, F (defined in SKILL.md §8). Read this when the client's signal is a reaction, a read-no-reply, an apparent non-open, or silence after prior engagement — not when they've sent you words. The §17 output contract requires naming which of the operator's messages a B/C/D/F signal attaches to; this file is how you determine that, and how confident to be about it.

---

## Attaching a signal to a message

A reaction, a read receipt, or silence always attaches to a specific prior operator message — never to "the conversation" in the abstract. Default to the **most recently sent operator message** as the anchor, with one exception: if the operator sent multiple messages close together (see Case 2/4 in `examples.md`, where an opener and a follow-up landed days apart), attach the signal to whichever message actually asked something or offered something — a plain check-in has nothing to react to or ignore in a meaningful sense, so skip past it to the last substantive message.

If it's genuinely ambiguous which message a signal attaches to (e.g. two questions were asked back to back with no reply to either), say so as Inferred, not Explicit, and name both candidates rather than picking one with false confidence.

## State B — read, no reply

Weight this by what the last operator message actually asked. A read-no-reply on a low-effort question ("which platform is this for?") carries less signal than a read-no-reply on a price given after they asked twice (see Case 1 in `examples.md`) — the second is a live buyer going quiet, worth flagging as a possible stall rather than routine.

## State C — delivered, apparently unopened

**Do not default to "hasn't seen it" without ruling out delivery failure first.** Cases 2 and 3 in `examples.md` are both state C that was never actually about disinterest — one was a Drive *folder* link that doesn't preview inline, the other was a `/u/N/`-scoped link that's broken for anyone but the sender. Whenever the unopened message contained a link, a file, or an asset, add "the link may not have worked" to the candidate list in SKILL.md §9 before weighing it against "not interested" or "busy." This is not a hedge to include reflexively — it's specifically relevant whenever a link or asset was the payload.

## State D — reacted, no text

A reaction with no text is a stall or a polite close, never upgraded to buying intent on its own (SKILL.md §8 hard rule — "a 👍 on a price is a stall, not a yes" applies to any reaction on any message, not price alone). Case 4 in `examples.md` is the concrete instance: a 👍 on a demo offer, followed by continued silence, was correctly read as closure, not encouragement. Treat a reaction the same way regardless of which emoji — 👍 ❤️ 🔥 😂 👏 🙏 👌 all mean "acknowledged," not "yes."

## State E — reacted, then continued the conversation

The reaction is tone on top of real text, not a separate signal. Read the text normally per §3–§7 and let the reaction adjust warmth, not substance — a 🔥 before an objection doesn't soften the objection.

## State F — previously engaged, suddenly silent

The highest-value diagnostic, and the easiest to misread. Two concrete anchors from real cases:

- **A fast responder going quiet is a stronger signal than a slow one going quiet.** Case 1: a client replying within a minute went silent for 20+ hours immediately after a second price deflection. Speed-then-silence right after a specific operator message points hard at that message as the cause — say so directly rather than defaulting to a vague "may be busy."
- **Multiple unanswered messages inside a short window is a pattern, not three separate chances.** Case 4: three messages inside 48 hours, all unanswered, is the point at which sending a fourth risks being reported rather than getting a reply. Once you're at this point, the correct output is `DO NOT FOLLOW UP YET` with a real reason to wait for — never a fourth restatement of the same offer in different words (SKILL.md §9's banned-follow-ups list exists precisely for this pattern).

## Confidence

Everything in this file is Inferred, not Explicit, by definition — a reaction or silence has no words to quote. Hedge accordingly per SKILL.md §4, and never let a state-B/C/D/F read alone move the sales stage (§8's hard rule, restated: upgrade stage only on words).
