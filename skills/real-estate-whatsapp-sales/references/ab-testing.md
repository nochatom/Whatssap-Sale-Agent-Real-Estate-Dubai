# A/B Testing and Reply Variants

## What "updated daily" actually means

`replies.md` does not rewrite itself. It is a file, not a service. What happens instead:

1. Every reply sent from a template carries a **variant ID**.
2. The operator logs the outcome in the `Variants` tab of the tracking workbook.
3. On request — daily, weekly, whenever — you run a **variant review**: read the logged numbers, decide whether anything has earned a change, and rewrite `replies.md` accordingly.

Step 3 is a real edit to a real file. It just needs a human to ask for it, and it needs data to have accumulated. Reviewing daily is fine; *changing* daily is usually not, for reasons below.

---

## Variant IDs

Format: `[STAGE]-[MARKET]-[LETTER]`

- Stage codes: `II` initial_interest · `CU` curious · `QL` qualification · `PC` price_check · `SR` sample_requested · `OC` offer_considered · `OB` objection · `RB` ready_to_buy · `FU` follow_up · `GH` ghosting · `RM` reminder
- Market codes: `US`, `AE`
- Letter: `A` is the incumbent, `B` the challenger, `C` onward as needed.

Example: `PC-US-A` is the current US price-check reply. `PC-US-B` is what it is being tested against.

Every reply in `replies.md` carries its ID in the table. When you output a `RECOMMENDED WHATSAPP REPLY` that came from a template — adapted or verbatim — name the variant ID in the `SALES STRATEGY` block so the operator can log it.

---

## What gets logged

Per variant, in the `Variants` tab:

| Field | Meaning |
|---|---|
| `sent` | Times this variant was sent |
| `replied` | Client sent any text back within 48h |
| `advanced` | Client moved to a later sales stage |
| `ordered` | Client eventually paid a deposit |

`reply_rate`, `advance_rate`, and `order_rate` are computed in the sheet.

**Rank on `advance_rate`, not `reply_rate`.** A reply that reliably produces "how much?" and nothing else scores beautifully on replies and sells nothing. `order_rate` is the truest metric but takes weeks to reach significance, so use it as a tiebreaker and a sanity check, not the primary signal.

---

## Running a test

- Test **one variable at a time** at **one stage**. Two changes at once tell you nothing about either.
- Alternate assignment: odd-numbered sends get `A`, even get `B`. Do not assign by feel — assigning the challenger to the leads you like best is how a variant "wins."
- Keep the test running until the minimum sample below is met. Stopping early because B is ahead is the single most common way to adopt a worse message.

---

## Minimum sample before declaring a winner

| Sends per variant | What you may conclude |
|---|---|
| Under 20 | Nothing. Do not change `replies.md`. |
| 20–39 | A direction worth watching. Keep running. |
| 40+ | Adopt the winner if the gap in `advance_rate` is at least 10 percentage points. |
| 40+, gap under 10 points | Call it a tie. Keep the incumbent — it is the known quantity. |

At realistic WhatsApp volumes 40 sends per variant takes weeks at some stages and days at others. `PC` and `II` accumulate fast; `RB` and `OB` do not. Expect to have a live conclusion on price-check long before you have one on objection handling.

**When someone asks for a daily update and the sample is thin, say so.** "Six sends each, B is ahead, that's noise" is the correct answer and it protects a working message from being replaced by a fluke.

---

## Variant review procedure

When asked to review or update:

1. Read the current `replies.md` and the `Variants` data the operator provides.
2. For each stage with an active test, state: sends per variant, advance rate per variant, and whether the sample clears the threshold.
3. For anything that clears: promote the winner to `A`, retire the loser, and propose the next challenger `B` with a one-line hypothesis about *why* it might do better.
4. For anything that doesn't: say so plainly and leave it alone.
5. Only then edit `replies.md`. Show the operator the before and after for every line changed.

Output format:

```
VARIANT REVIEW — [date]

DECIDED
[stage] [market]: A=[n] sends, [x]% advance · B=[n] sends, [y]% advance
→ Promote [ID]. Reason: [one line]
→ New challenger [ID]: "[text]" — hypothesis: [one line]

STILL RUNNING
[stage] [market]: [n] vs [n] sends — below threshold, no change

NO TEST ACTIVE
[stages with only an A variant]

CHANGES TO replies.md
[before → after, per line]
```

---

## What is worth testing

Ordered roughly by how much they tend to move `advance_rate`:

- **Whether the reply ends in a question at all**, and which one
- **Order of price and offer** — price first vs offer first
- **Specificity of the ask** — "how many videos?" vs "what property are you marketing?"
- **Length** — one line vs three
- **Whether the sample is offered unprompted**
- Greeting warmth, especially in the UAE market where the register carries more weight

Not worth testing: emoji count, exclamation marks, minor synonym swaps. These do not move behavior at the sample sizes available, and testing them burns weeks that a real variable could have used.

---

## Constraints that survive every test

A winning variant is still discarded if it breaks any of these. Test performance does not override them.

- No promised bookings, revenue, ROI, or percentages
- No fabricated clients, testimonials, results, or credentials
- No manufactured urgency or scarcity
- No proposing a call, meeting, or voice note unprompted
- No more than one question per message
- No currency other than USD
- No banned phrases from `replies.md`
