# Analytics Dashboard

The workbook `AI-Property-Films-Pipeline-Dashboard.xlsx` is the single source of truth for the ledger, the variant log, and the metrics. Upload it to Google Drive and open with Google Sheets — every formula in it uses functions Sheets supports natively.

If a Google Drive connector is connected, the sheet can be read directly each session. Without one, paste the relevant tab into the conversation when asking for a sweep, a variant review, or a metrics read.

---

## Tabs

| Tab | Purpose | Who writes it |
|---|---|---|
| `Conversations` | One row per inbound lead | Operator, as leads arrive |
| `Orders` | One row per order | Operator, at deposit |
| `Variants` | Reply variant performance | Operator, per send and outcome |
| `Daily` | Revenue and activity by date | Formulas |
| `Dashboard` | Headline metrics | Formulas |
| `Legend` | Which cells to fill in | Reference |

Blue cells are for typing into. Black cells are formulas — overwriting one silently breaks the metric above it.

---

## Metric definitions

Definitions matter more than formulas here, because two people counting "conversion rate" differently will disagree about whether the business is working.

**Daily revenue** — cash actually received on that date, not orders booked. A $149 order contributes $74.50 on the deposit date and $74.50 on the balance date, which are usually different days. This is deliberate: it tracks money in the account, so it is reconcilable against PayPal.

**Conversion rate** — orders with a confirmed deposit ÷ total conversations, over the same period. A lead counts in the denominator on the date of first contact, so the rate lags: leads that arrived yesterday have not had a chance to convert. Read it over 30 days, not daily.

**Repeat customer %** — clients with 2+ orders ÷ clients with 1+ orders. Counted on clients, never on orders. With a small book this number is volatile — one repeat client at n=8 moves it 12 points — so treat it as directional until there are 30+ customers.

**Average order value** — total booked revenue ÷ number of orders. Watch it alongside conversion rate: a rising conversion rate and a falling AOV usually means the offer is doing the selling, not the pitch.

**Outstanding balance** — delivered orders with no balance payment. This is the number that quietly grows if nobody runs the sweep.

---

## Reading the dashboard

When asked for a metrics read, report the number, the direction, and the caveat. A number without its sample size invites a decision it cannot support.

Good: "Conversion is 18% over 30 days, up from 12%, on 44 conversations — small enough that four orders either way moves it 9 points."

Bad: "Conversion is up 50%."

Flag these patterns when they appear:

- Conversion rate rising while AOV falls — discounting, or the offer carrying the pitch
- Repeat % near zero after 20+ customers — a delivery quality or follow-up problem, not a sales problem
- Outstanding balance growing week over week — the sweep is not being run
- One market's conversion far below the other — a tone or template problem, and the first place to point a variant test

---

## Filling it in

Per lead, at first contact, add a `Conversations` row. Per order, at deposit, add an `Orders` row. Per templated reply sent, increment the variant's `sent` in `Variants`, and update `replied` / `advanced` / `ordered` as the conversation moves.

That last one is the part that gets skipped, and skipping it is what makes the A/B system decorative. If logging every send is unrealistic, log one stage at a time — the stage currently under test — and leave the rest at zero.
