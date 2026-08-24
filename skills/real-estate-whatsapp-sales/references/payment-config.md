# Payment Configuration

Source of truth for every payment method, currency, price, and bank/account/link detail the Skill is allowed to state. If a client's payment question isn't answered by this file, the Skill must not invent an answer — flag the gap under SALES STRATEGY instead, per SKILL.md §15.

Currency: USD, GBP, or EUR. If the client hasn't specified or it isn't already established earlier in the conversation, ask which one (see SKILL.md §11).

---

## Prices

Fixed, per-currency, and shared by every payment method below — not restated separately per method to avoid two sources of truth. **Never calculate, estimate, or convert a price between currencies** — not even as a rough approximation. A price marked `[PENDING]` means: tell the client that amount needs to be confirmed by the operator, never state a number, a range, or an estimate instead.

- USD, single video: $149 — canonical figure, see `references/offer-config.md`. For more than one video, use the confirmed USD tier table below instead of this single-video figure.
- GBP, single video: £109.23 — fixed, configured amount. Not calculated from the USD price.
- EUR, single video: €127.48 — fixed, configured amount. Not calculated from the USD price.

### Multi-video pricing (USD only — confirmed 2026-08-24)

**Price is PER VIDEO, not a flat per-package rate.** More videos ordered together lowers the per-video rate, at exactly these three confirmed tiers — never any other count, never interpolated or extrapolated:

| Videos | Per-video price | Total to quote |
|---|---|---|
| 1 | $149 | **$149** |
| 2 | $140 | **$280** |
| 3 | $130 | **$390** |

**Always state the TOTAL column directly for the exact count the client is asking about — never compute it yourself by multiplying per-video × count.** These totals are already the confirmed final figures; treat them as literal facts to read off this table, not numbers to derive.

**4 or more videos in one order: not yet confirmed.** Never extrapolate a further per-video discount, never invent a number for it — flag the gap to the operator under SALES STRATEGY and tell the client that volume needs a confirmed price from the operator first.

**This tiered structure applies to USD only.** GBP and EUR only have a confirmed single-video price (above) — if a client wants more than one video and has specified or established GBP/EUR, do not apply the USD tier numbers, do not convert them, and do not invent a GBP/EUR multi-video price. Flag the gap to the operator instead and tell the client that volume's price in that currency needs to be confirmed.

---

## Payment methods

- **Bank Transfer — NOT ACTIVE.** Do not mention, offer, or provide any detail from this section to a client under any circumstances while it remains marked not active.
- **PayPal — ACTIVE.** All three currencies. **Only the payment link is ever given to a client — never an email or account name.**
- **Stripe — NOT YET ACTIVE.** Do not mention, offer, or provide any detail from this section to a client under any circumstances while it remains marked not yet active.

**PayPal is currently the only payment method offered to clients.** If the client doesn't specify a method, offer PayPal (covers all three currencies). If they ask for a method that isn't ACTIVE (bank transfer or Stripe), tell them that method isn't available and offer PayPal instead — never mention why, never offer to switch it on.

---

## Bank Transfer (NOT ACTIVE)

Price: see Prices above (single-video and USD multi-video tiers) — kept for reference only; irrelevant while this method is inactive.

Account holder: [PENDING — operator to supply]
Bank name: [PENDING — operator to supply]
IBAN: [PENDING — operator to supply]
SWIFT/BIC: [PENDING — operator to supply]
Account number: [PENDING — operator to supply]
Payment link: [PENDING — operator to supply]
Payment reference to quote: [PENDING — operator to supply]

This section exists so the payment-method architecture doesn't need redesigning if Bank Transfer is activated later — filling in these details and flipping it to ACTIVE above is the only change needed at that point. Until then it is inert configuration, never a client-facing option, for any currency.

---

## PayPal (ACTIVE)

- Payment method: PayPal
- Service: Professional Real Estate Property Marketing Video
- Payment link: https://www.paypal.com/ncp/payment/8M9CEMMLHSHAN
- Currency: USD, GBP, or EUR — see Prices above for the exact figure per currency.

**The payment link above is the ONLY payment detail ever given to a client for PayPal — never an email, account name, or any other identifier, even if the client asks for one directly.** Use the link exactly as written, character-for-character — never shortened, modified, re-hosted, or regenerated. If the client asks to pay via PayPal, or asks how to pay / for a payment link without naming a method, this link is the answer, in whichever currency they've specified or already established.

---

## Stripe (NOT YET ACTIVE)

- Payment method: Stripe
- Currency: USD, GBP, or EUR — see Prices above for the exact figure per currency.
- Payment link: [PENDING]

This section exists so the payment-method architecture doesn't need redesigning if Stripe is activated again later — filling in its payment link and flipping it to ACTIVE above is the only change needed at that point. Until then it is inert configuration, never a client-facing option.

---

## Hard boundaries

- **Never calculate, estimate, or convert a price between currencies** — not even as a rough approximation. A `[PENDING]` price means "tell the client it needs confirming," never "compute it."
- Never invent, guess, or state a bank/account/payment-link value that isn't literally written above.
- **Never invent, modify, shorten, or generate a payment link.** Use only the exact link written in this file — character-for-character, every time, regardless of currency.
- **Never state a PayPal email, account name, or any identifier other than the payment link.** The link is the only PayPal detail this Skill is ever allowed to give a client — even if the client explicitly asks "what's your PayPal email?"
- Never mix a field from one currency's block into another, or from one payment method into another.
- Only ever offer a payment method marked ACTIVE above (currently: PayPal only). Never mention a not-active or not-yet-active method's details to a client — even partially, even if asked directly by name.
- If a field for an active method/currency combination is `[PENDING]` or blank, flag the gap to the operator under SALES STRATEGY and tell the client that detail needs to be confirmed — never guess, never approximate, never stay silent about the gap.
