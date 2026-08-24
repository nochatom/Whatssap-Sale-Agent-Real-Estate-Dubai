# Examples

Real cases from operator conversations, not invented ones. Read this file when you need a worked pattern for a comparable case. Each entry: what happened, the outcome, and the lesson — mapped to where it changes how you run the pipeline.

---

## Case 1 — Double price deflection killed a live buyer

```
[07:20] Client: How much you charge for these kind of videos?
[11:36] Operator: Sure. Where are you planning to use the video — your website,
        Facebook/Instagram, TikTok/Reels, or somewhere else? I'll make it in
        the right format for the platform.
[11:37] Client: ok, what about the charges?
[11:38] Operator: It depends on the video and where you'll be using it. For a
        standard 30-60 second property video, I can give you a fixed price
        once I know the property and format you need. How many properties
        are you looking to create videos for?
```

**Outcome:** silence, 20+ hours. The client had been replying within a minute up to that point.

**Lesson:** two price deflections in a row killed a buyer who was moving fast. "ok, what about the charges?" — the short "ok" acknowledges the question was heard and sets it aside; it is not confusion, it is impatience. Repeating the same deflection a second time reads as evasive, not thorough.

**How this changes the pipeline now:** at the time this happened, there was no `offer-config.md` — the deflection was the only honest option. That is no longer true. Pricing now exists (§ Pricing in `offer-config.md`): $149 for one video regardless of platform or exact length — video count changes the price (see the confirmed multi-video tiers in `payment-config.md`), but platform and format never do. **A price-first asker who asks twice gets the number on the second ask.** Formatting/platform questions are still worth asking, but never in place of the price when the client has asked for it twice — ask the platform question *and* give the price in the same reply, or give the price alone. Never make price conditional on information that doesn't actually change it.

---

## Case 2 — Sent a Drive folder link, unrequested

```
[Day 1] Operator: Hi there — I came across your property listings and wanted
        to reach out. I create high-quality short-form showcase videos for
        Dubai real estate using the photos you already have — no filming
        required. They're designed for Instagram, TikTok, and property
        portals to help attract more buyers and tenants. Would you be
        interested in seeing a quick sample?
[Day 3] Operator: Can you see you Demo here I hope you like it
        https://drive.google.com/drive/folders/[ID]
```

**Outcome:** zero inbound reply, ever, at any point.

**Lesson:** two compounding mistakes. First, the operator asked permission ("Would you be interested in seeing a sample?") and then sent the sample two days later without ever getting a yes — the client never asked for it. Second, a Google Drive **folder** link doesn't preview or play inline in WhatsApp; the recipient has to click through, and may hit an access wall depending on sharing settings. Effort that isn't visible is effort that didn't happen, from the client's side.

**How this changes the pipeline now:** never send an asset — sample, demo, deliverable — unless the client has said yes to seeing it, or has asked for it directly. If they haven't responded to "would you like to see a sample," that is `DO NOT FOLLOW UP YET`, not a green light. And never send a folder link where a direct file or video link will do — if the only asset available is a folder, that's a gap to report to the operator, not to send anyway (§15: missing/wrong-format assets are reported to the operator, never sent as-is to the client). This is also a §17 output-rule violation waiting to happen: "no markdown, no hope/soft filler" applies to sample-delivery messages the same as any other reply — "I hope you like it" is exactly the filler `whatsapp-style.md` bans.

---

## Case 3 — The `/u/3/` link (same asset, broken for the recipient)

```
Operator sent: https://drive.google.com/drive/u/3/folders/[ID]
```

**Lesson:** `/u/N/` in a Google Drive URL is the *sender's* account index in their own browser session — it means "account #3 in my logged-in list." A recipient clicking that link gets an account chooser or an access error, because account #3 means nothing on their device. The work was never seen. This is not a rejection from the client — it's a delivery failure the client never even reached.

**How this changes the pipeline now:** this is an operational check, not a conversational one — the Skill cannot verify a URL's validity mid-conversation. What it can do: never assume a client's silence after a link means disinterest without first flagging the link format as a possible cause under SALES STRATEGY (§9's "weigh the candidates" list — add "broken/inaccessible link" as a candidate before defaulting to "not interested"), especially when the link is a Drive/folder-style share rather than a direct playable link.

---

## Case 4 — Thumbs-up with no words, and "free" said twice

```
[Day 1] Operator: [cold opener, same as Case 2] ... Would you be interested
        in seeing a quick sample? its free for you
[Day 3] Operator: see Demo Maybe Do you like it its free for u
[Day 5] Operator: Can you see you Demo here I hope you like it
        https://drive.google.com/drive/folders/[ID]
```

**Outcome:** messages read, one 👍 reaction, zero words, across all three messages.

**Lesson, in three parts:**
1. A 👍 with no text on a cold pitch is a polite close, not encouragement — the same logic as SKILL.md §8's "a 👍 on a price is a stall, not a yes." Do not upgrade sales stage or buying signal on a reaction alone (§8 hard rule).
2. Three unanswered messages inside 48 hours is the exact pattern that risks the number being reported as spam — not a reason to send a fourth.
3. "Free" was said twice here, and it directly contradicted a $149 quote given to a different prospect that same week. Saying "free" when the real offer is paid doesn't raise interest — it lowers credibility, and creates a live contradiction the moment two prospects compare notes or the operator has to explain the gap.

**How this changes the pipeline now:** never say "free" — or offer anything not in `offer-config.md`. If a sample or demo is genuinely being offered as free, that has to be a real, deliberate operator decision reflected in `offer-config.md`, not an ad-lib line to make a cold opener land softer. Absent that, price every offer straight, including the first one. On the reaction-with-no-text pattern: treat it as §8 state D, do not follow up a third time without a new reason (§9's banned follow-ups — "did you see my message?" is exactly what this pattern tempts), and if a fourth message is genuinely warranted, it needs a concrete new trigger, not a repeat of the same ask in different words.
