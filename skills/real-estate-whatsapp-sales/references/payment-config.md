# Payment Configuration

Source of truth for every payment method, currency, price, and bank/account/link detail the Skill is allowed to state. If a client's payment question isn't answered by this file, the Skill must not invent an answer — flag the gap under SALES STRATEGY instead, per SKILL.md §15.

Currency: USD, GBP, or EUR. If the client hasn't specified or it isn't already established earlier in the conversation, ask which one (see SKILL.md §11).

---

## Prices

Fixed, per-currency, and shared by every payment method below — not restated separately per method to avoid two sources of truth. **Never calculate, estimate, or convert a price between currencies** — not even as a rough approximation. A price marked `[PENDING]` means: tell the client that amount needs to be confirmed by the operator, never state a number, a range, or an estimate instead.

- USD: $149 — canonical figure, see `references/offer-config.md`.
- GBP: £109.23 — fixed, configured amount. Not calculated from the USD price.
- EUR: €127.48 — fixed, configured amount. Not calculated from the USD price.

---

## Payment methods

- **Bank Transfer — ACTIVE, USD only.** GBP and EUR bank transfer are disabled — never offer or state bank details for those two currencies. If a GBP or EUR client specifically wants to pay by bank transfer, tell them that option isn't available for their currency and offer PayPal instead.
- **PayPal — ACTIVE.** All three currencies.
- **Stripe — ACTIVE.** All three currencies.

If the client doesn't specify a method, PayPal or Stripe are both safe defaults to offer (both cover all three currencies); Bank Transfer is USD-only, so only offer it unprompted to a USD client. If they ask for a method or currency combination that isn't ACTIVE (e.g. bank transfer in GBP), tell them that combination isn't available and offer an ACTIVE alternative instead.

---

## Bank Transfer (ACTIVE — USD only)

Price: $149 (see Prices above)

Account holder: [PENDING — operator to supply]
Bank name: [PENDING — operator to supply]
IBAN: [PENDING — operator to supply]
SWIFT/BIC: [PENDING — operator to supply]
Account number: [PENDING — operator to supply]
Payment link: [PENDING — operator to supply]
Payment reference to quote: [PENDING — operator to supply]

**GBP and EUR bank transfer are disabled, not just unfilled.** Do not offer or state bank details for a GBP or EUR client under any circumstances, even if asked directly — this is a removed option, not a `[PENDING]` one.

---

## PayPal (ACTIVE)

- Payment method: PayPal
- Service: Professional Real Estate Property Marketing Video
- Payment link: https://www.paypal.com/ncp/payment/8M9CEMMLHSHAN
- Account/email: malekmenadjelia@gmail.com
- Currency: USD, GBP, or EUR — see Prices above for the exact figure per currency.

**The payment link above must be used exactly as written, character-for-character — never shortened, modified, re-hosted, or regenerated.** If the client asks to pay via PayPal, this is the only link and the only email to give them, in whichever currency they've specified or already established.

---

## Stripe (ACTIVE)

- Payment method: Stripe
- Currency: USD, GBP, or EUR — see Prices above for the exact figure per currency.
- Payment link: https://buy.stripe.com/eVqbJ20r78yGcpF4zYc3m00

**The payment link above must be used exactly as written, character-for-character — never shortened, modified, re-hosted, or regenerated.** If the client asks to pay via Stripe, this is the only link to give them, in whichever currency they've specified or already established.

---

## Hard boundaries

- **Never calculate, estimate, or convert a price between currencies** — not even as a rough approximation. A `[PENDING]` price means "tell the client it needs confirming," never "compute it."
- Never invent, guess, or state a bank/account/payment-link value that isn't literally written above.
- **Never invent, modify, shorten, or generate a payment link** for PayPal or Stripe. Use only the exact link (and, for PayPal, the exact email) written in this file — character-for-character, every time, regardless of currency.
- Never mix a field from one currency's block into another, or from one payment method into another.
- Only ever offer a payment method marked ACTIVE above, and only for the currencies it's active for (Bank Transfer is USD only). Never mention a not-yet-active method's details, or a disabled currency's bank details, to a client — even partially, even if asked directly by name.
- If a field for an active method/currency combination is `[PENDING]` or blank, flag the gap to the operator under SALES STRATEGY and tell the client that detail needs to be confirmed — never guess, never approximate, never stay silent about the gap.
