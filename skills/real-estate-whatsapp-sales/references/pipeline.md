# Pipeline and Reminders

## What this system can and cannot do

This skill has no timer and no background process. Nothing sends itself. What it does is turn a ledger into a list of *due reminders with the exact text to send*, on demand, in a few seconds.

To make that feel automatic, the operator runs a **daily pipeline sweep** — either by asking for one ("run the pipeline sweep") or by setting it as a recurring daily task in Claude. Either way the sweep produces drafts; a human presses send. That boundary is deliberate: an unattended message to a paying client who already sent their photos an hour ago does more damage than a reminder sent two hours late.

---

## The ledger

Reminders are computed from the tracking workbook (`AI-Property-Films-Pipeline-Dashboard.xlsx`), specifically the `Orders` tab. If the operator has not shared the current ledger in the conversation, ask for it before producing reminders. Never reconstruct order state from memory across sessions — you don't have one.

Minimum fields needed per order to compute reminders:

| Field | Why it matters |
|---|---|
| `client_id`, `client_name` | Addressing the reminder |
| `market` | UAE or USA — decides language and tone |
| `deposit_paid_date` | Starts the photo clock |
| `photos_received_date` | Blank = photos still outstanding |
| `delivered_date` | Blank + photos present = in production |
| `balance_paid_date` | Blank + delivered = balance outstanding |
| `reminders_sent` | Count, to enforce the cap |
| `last_reminder_date` | To enforce one per day |

---

## Reminder cadence — deposit paid, photos not received

This is the primary case. The client has already paid; they are not a lead being chased, they are a customer with an unfinished task. Tone is service, not sales.

Measure elapsed time from `deposit_paid_date`.

| Elapsed | Reminder | Angle |
|---|---|---|
| 4–8 hours | #1 | Warm, low-friction. Assume they got busy. |
| 24 hours | #2 | Give the reason: the 24-hour clock starts at photos, not at payment. |
| 72 hours | #3 | Remove friction — offer to work with fewer photos, or take them from an existing listing link. |
| 7 days | — | **Stop.** Flag to the operator. Do not send a fourth. |

Rules that keep this from turning into harassment:

- Maximum **3** reminders per order, ever.
- Maximum **1** reminder per client per day, across all reasons.
- If the client replied anything at all since the last reminder, the counter resets and the sweep does not fire — a human answers instead.
- Never mention refunds, forfeiture, expiry of their payment, or any consequence. They paid; the money is theirs until the work is delivered.
- Never guilt-trip, never say "just following up again", never open with "I noticed you haven't".

### Reminder text — USA 🇺🇸

**#1 (4–8h)**
> Hey [NAME] — payment's confirmed, thank you. Whenever you're ready, send the property photos over and I'll get started.

**#2 (24h)**
> Hey [NAME], quick one — the 24-hour turnaround starts from when I get the photos, so as soon as you send them we're off. Anything I can help with on your end?

**#3 (72h)**
> [NAME] — if it's easier, send whatever you have, even 6 to 8 good photos is plenty. Or drop me the listing link and I'll pull them from there.

### Reminder text — UAE 🇦🇪

**#1 (4–8h)**
> مرحباً [NAME]، تم تأكيد الدفع، شكراً لك. متى ما كنت جاهزاً، أرسل لي صور العقار وسأبدأ العمل مباشرة.

**#2 (24h)**
> مرحباً [NAME]، تذكير بسيط — مدة التسليم (24 ساعة) تبدأ من لحظة استلام الصور. بمجرد إرسالها سنبدأ فوراً. هل تحتاج أي مساعدة؟

**#3 (72h)**
> [NAME]، إن كان أسهل، أرسل ما هو متوفر لديك — من 6 إلى 8 صور جيدة كافية. أو أرسل لي رابط الإعلان وسآخذ الصور منه.

---

## Secondary reminder cases

Same caps apply (3 max, 1 per day, reset on any client reply).

| Situation | Trigger | Angle |
|---|---|---|
| Deposit link sent, not paid | 24h, 72h | Neutral. Ask if they hit a problem with the link, not whether they still want it. |
| Delivered, balance unpaid | 24h, 72h, 7d | Confirm they're happy first, then the balance link. Never withhold work already delivered. |
| Photos received, delivery overdue | Past 24h from photos | This one is a reminder **to the operator**, not the client. Flag it loudly. |
| Ghosting (no order) | 48h, 7d | Sales cadence, not service. Use the `ghosting` templates in `replies.md`. |

---

## Sweep output format

When running a sweep, output one block per due reminder and nothing else:

```
DUE REMINDERS — [date]

[1] [CLIENT NAME] · [market] · Order [ID]
Reason: deposit paid [X]h ago, photos not received
Reminder: #2 of 3 (last sent [date] or none)
Message:
[exact text, plain, ready to send]

---

OPERATOR FLAGS
- [anything past the cap, overdue deliveries, or missing ledger data]

NOTHING DUE: [list of orders checked and skipped, one line each]
```

If nothing is due, say so in one line. A sweep that manufactures a reason to message someone is worse than a quiet day.
