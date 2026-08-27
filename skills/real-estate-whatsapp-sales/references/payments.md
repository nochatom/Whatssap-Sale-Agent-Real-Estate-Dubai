# Payments — 50% Upfront Deposit (PayPal, USD only)

Read this file in full before any reply that contains a payment link. Do not quote a link from memory; URLs recalled rather than read are the single most likely thing to go wrong in this workflow.

---

## Confirmed deposit links

Use a link only for its exact matching order total. Never send a link for a different amount.

| Order total | 50% deposit (first payment) | PayPal deposit link | Balance after delivery |
|---|---|---|---|
| $149 | $74.50 | https://www.paypal.com/ncp/payment/8M9CEMMLHSHAN | $74.50 |
| $269 | $134.50 | https://www.paypal.com/ncp/payment/5EPS9L7R333R4 | $134.50 |
| $369 | $184.50 | https://www.paypal.com/ncp/payment/B78TY84ENGHBC | $184.50 |
| $459 | $229.50 | https://www.paypal.com/ncp/payment/SATACWTNVWAHN | $229.50 |
| $539 | $269.50 | https://www.paypal.com/ncp/payment/D7EFWTEDERYBJ | $269.50 |

---

## Quantity → total mapping

Confirmed by the operator. This is the authoritative price list.

| Videos | List total | Effective per video | Deposit | Status |
|---|---|---|---|---|
| 1 | $149 | $149.00 | $74.50 | Confirmed |
| 2 | $269 | $134.50 | $134.50 | Confirmed — but see the offer rule below |
| 3 | $369 | $123.00 | $184.50 | Confirmed |
| 4 | $459 | $114.75 | $229.50 | Confirmed |
| 5 | $539 | $107.80 | $269.50 | Confirmed |
| 6+ | — | — | — | **Not confirmed — do not quote** |

For 6 or more, do not extrapolate from the gaps between tiers. Output `CANNOT CONFIRM PAYMENT LINK — OPERATOR INPUT REQUIRED` and tell the operator the quantity requested.

An earlier internal note listed 3 videos at $390. That is superseded. **The price for 3 is $369.**

---

## How the offer interacts with the ladder

The buy-1-get-1-free offer is live and limited to the first 5 clients each week.

- **A client wanting 2 videos, while offer slots remain: $149.** They buy one at $149 and the second is free. The $269 tier does not apply to them.
- **A client wanting 2 videos, once the week's 5 slots are gone: $269.** This is the only situation in which the $269 tier and its link are used. It is not dead — it is the overflow price.
- **3 and above: ladder pricing, no free video.** $369 / $459 / $539.

Before quoting 2 videos, check with the operator how many offer slots are left this week. If that is unknown, quote $149 and flag it — honoring the offer costs $120; retracting it after quoting costs the client.

---

## The step from 2 to 3

Under the offer, 2 videos cost $149 and 3 cost $369. The third video therefore costs $220 — more than the first two combined. Clients notice this, and it is the most likely price objection you will face.

Do not hide it and do not apologize for it. When a client asks about 3 while the offer is available, give both real options and let them choose:

- USA: "3 videos is $369. Worth knowing — the current offer is 2 videos for $149, so if two would cover it for now, that's the better value. Which works for you?"
- UAE: "ثلاثة فيديوهات بسعر 369 دولاراً. للعلم، العرض الحالي هو فيديوان بسعر 149 دولاراً، فإن كان فيديوان يكفيان الآن فهو خيار أفضل من حيث القيمة. أيهما تفضل؟"

This is one question, and it treats the client as someone who can do arithmetic. Steering them to the $369 tier without mentioning the offer they qualify for is the kind of thing that gets noticed after the sale.

**Operator note:** this cliff is worth repricing. A 3-video tier that undercuts "2 for $149 plus a single at $149" ($298) would remove the objection entirely. Flagging, not deciding.

---

## Payment workflow

1. Confirm the client's final video quantity.
2. Confirm the matching total from the quantity table above.
3. Select the exact matching 50% deposit link.
4. Send only that link. Nothing else in the same message.
5. Do not start the order until the deposit is confirmed by the operator.
6. Once confirmed, ask the client for the property photos.
7. Produce and deliver within the agreed turnaround (24 hours from receiving photos).
8. After delivery, request the remaining 50%.

---

## Hard rules

- PayPal only. USD only.
- Never convert a price into AED, GBP, EUR, or any other currency, even if the client asks in their local currency.
- Never invent, modify, shorten, or reconstruct a payment link. If it is not character-for-character in the table above, it does not exist.
- Never send a link whose deposit amount is not exactly 50% of the confirmed total.
- The first payment is always exactly 50%. The second is always the remaining 50%.
- Never state that payment has been received unless the operator has confirmed it.
- If no exact link exists for a confirmed amount, return `CANNOT CONFIRM PAYMENT LINK — OPERATOR INPUT REQUIRED`.

---

## Reply templates for the payment stage

**Sending the deposit — USA**
> Great! To get started, here's the 50% deposit link for your $[TOTAL] order — $[DEPOSIT] now, $[BALANCE] after delivery: [LINK]

**Sending the deposit — UAE**
> ممتاز. للبدء، هذا رابط الدفعة الأولى (50%) لطلبك بقيمة [TOTAL] دولاراً — [DEPOSIT] دولاراً الآن، و[BALANCE] دولاراً بعد التسليم: [LINK]

**After deposit confirmed — USA**
> Payment received, thank you. Send over the property photos whenever you're ready and I'll have the video back to you within 24 hours.

**After deposit confirmed — UAE**
> تم استلام الدفعة، شكراً لك. أرسل لي صور العقار متى ما كنت جاهزاً، وسيكون الفيديو جاهزاً خلال 24 ساعة.

**Requesting the balance after delivery — USA**
> Hope you're happy with it. Here's the link for the remaining $[BALANCE]: [LINK]

**Requesting the balance after delivery — UAE**
> أتمنى أن ينال الفيديو إعجابك. هذا رابط الدفعة المتبقية بقيمة [BALANCE] دولاراً: [LINK]

Note: the table above lists deposit links. If a separate link is needed to collect the balance, confirm it with the operator rather than reusing the deposit link.
