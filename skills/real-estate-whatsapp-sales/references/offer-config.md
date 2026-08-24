# Offer Configuration

Source of truth for every price, inclusion, and boundary the Skill is allowed to state. If a client's question isn't answered by this file, the Skill must not invent an answer — flag the gap under SALES STRATEGY instead.

Confirmed by the operator (Oualid) on 2026-08-09.

---

## The product

One video per property, in ONE format. 30–60 seconds. Built entirely from the client's existing listing photos — no on-site filming, no physical shoot.

**Format — the client picks exactly ONE, not all three:**
- 9:16 vertical (Reels / TikTok / Stories)
- 1:1 square (feed posts)
- 16:9 horizontal (website / landscape)

The $149 price covers ONE video in ONE of these formats, chosen by the client — never all three, never more than one, for the base price. If the client hasn't said which format yet, ask (MAX ONE question, per SKILL.md §10) before finalizing the order — never assume or default to a specific format. Additional formats of the same video are not part of the base offer; pricing for extra formats is not currently set — never quote a number for that, flag it to the operator instead.

**Captions/text overlays, when included:** English only. No translation offered.

## Pricing

**Price is PER VIDEO, tiered by how many videos/properties are ordered together in USD — not a flat per-package rate.** $149 for one video is the official starting price and the number to open with when scope isn't yet known. Once the client's video count is known, use the exact confirmed tier from `references/payment-config.md`'s multi-video pricing table (1 video = $149, 2 = $280 total, 3 = $390 total) — always state the TOTAL for that count directly from the table, never computed by multiplying a per-video figure yourself. 4+ videos in one order is not yet confirmed — flag it to the operator rather than inventing or extrapolating a number.

State the applicable figure as-is: never rounded down, never pre-discounted beyond the confirmed tiers, never framed as "starting from" a lower figure. Any number below the confirmed tier price is a negotiated outcome, not a default — reached only by following `references/pricing-and-negotiation.md`, never invented or offered unprompted.

Once a price has been stated to this client anywhere earlier in the conversation, do not restate it again unless the client's own latest message actually asks about price, cost, or how much — a bare "hey"/"hello"/check-in with nothing else is not that. Repeating it unprompted, even framed as "confirming" or "as a reminder," is a hard failure, not a courtesy (see SKILL.md §16).

**Currency: open in USD by default.** $149 (single video) is the default opening price, stated in USD, unless the client has already specified or established a different one of the 3 supported currencies (USD/GBP/EUR — see `references/payment-config.md` for the GBP/EUR prices and SKILL.md §11 for the currency-selection flow). The multi-video tier table is USD-only — GBP/EUR only have a confirmed single-video price; for more than one video in GBP/EUR, flag the gap to the operator rather than converting or inventing a figure. Never calculate a GBP/EUR figure from a USD number — each currency's price is its own literal number in `references/payment-config.md`, never derived from another. If the conversation history contains a figure in a currency that is not one of USD/GBP/EUR (e.g. AED, SAR, EGP), that is stale, superseded pricing information — never quote it, never treat it as valid or already-confirmed, and never let it change or "average out" the number you state now.

## Demo video

Direct link (not a folder — safe to send as-is, previews inline): https://drive.google.com/file/d/1zbNgtjv-MnQCR6BSZjT__cyS2PzQTYcr/view?usp=sharing

When the client explicitly asks to see the demo, asks for a sample, or confirms wanting to see it (e.g. "yes, send it" after being offered one) — send this exact link **in that same reply**, not a promise to send it later. Never claim it will be sent "shortly" / "within X minutes" / "soon" — the link itself is the delivery. Do not modify, shorten, or re-host the URL. Per §17, it goes in the RECOMMENDED WHATSAPP REPLY as plain text alongside whatever else the reply needs to say — no markdown, no extra framing beyond what `whatsapp-style.md` already allows.

**The literal URL text (`https://drive.google.com/file/d/1zbNgtjv-MnQCR6BSZjT__cyS2PzQTYcr/view?usp=sharing`) must be present, character-for-character, inside `recommendedReply.text` itself.** Writing "I've sent you the link," "I've sent the demo again," or any other description of the act of sending — without the URL string actually appearing in that same reply — is WRONG and is treated the same as not sending it at all. Never describe having sent it; paste it.

Example of a correctly formed reply (adapt the surrounding sentence to the conversation, but reproduce the URL exactly as shown, unshortened):

> Here's the demo: https://drive.google.com/file/d/1zbNgtjv-MnQCR6BSZjT__cyS2PzQTYcr/view?usp=sharing

Still governed by the existing rule (see `examples.md` Case 2): only send it when the client has said yes or asked directly — never unprompted. And once it has actually been sent anywhere earlier in the conversation, do not send it again unless the client's latest message explicitly asks for it again — a bare "hey"/"hello"/check-in is not that. This holds no matter how many times it was legitimately re-sent earlier on request; a history full of real re-asks is not license to volunteer it now unasked (see SKILL.md §16).

## Revisions

Unlimited, within reason. Scoped to reasonable edit requests on the delivered video — not a new production from different photos.

## Delivery

24 hours from receiving the property's photos.

## Payment terms

50% upfront, 50% on delivery.

For bank details, IBAN/SWIFT, payment method, and pricing in GBP/EUR, see `references/payment-config.md` — never invent or state these from memory.

## Additional service

Website-to-video conversion (source is a property website/listing page instead of photos) is also offered. **Pricing for this is not yet set.** Never quote a number for it — flag to the operator.

## Add-ons — never included in the base price, never quote a number

These may be offered, but any price for them must come from the operator, not the Skill:

- Voiceover / narration
- Custom licensed music
- Client branding (logo / contact info) — available on request; confirm terms with the operator before agreeing to anything

## Hard boundaries — always no

- No on-site filming or physical shoot of any kind — every video is built from photos already provided by the client
- No drone footage — inconsistent with the no-filming model. (If stock/licensed aerial footage is ever a real path, that changes this line — confirm with the operator first)
- No appointment setting, calls, or meetings of any kind (see SKILL.md §15 — this is a Skill-wide rule, not specific to pricing, restated here for completeness)
