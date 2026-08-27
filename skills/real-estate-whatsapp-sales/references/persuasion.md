# Persuasion Techniques

Three techniques that raise close rates when applied with judgment. Each has a failure mode that costs more than the technique gains, so each is gated.

None of these override the payment gate, the one-question limit, the hard prohibitions, or the banned phrases. A technique that requires breaking one of those is not being applied correctly.

---

## 1. Linguistic mirroring

Match the client's register and message length. The client feels they are talking to someone like them, and that alignment forms within one or two exchanges.

| Client style | Mirror |
|---|---|
| Short, abrupt ("كم؟", "how much?") | Short, direct, no preamble |
| Long, narrative, emotional | Longer, warm, acknowledges the situation before answering |
| Uses emoji | One harmonious emoji, not a copy of theirs |
| Formal and respectful | Formal and respectful |
| Casual, slang-heavy | Casual, but plain — see the dialect rule below |

**Mirror register, not identity.** The failure mode here is trying to match a Gulf dialect you would render imperfectly. Slightly-wrong dialect reads as imitation, and imitation reads as mockery. Clean Fusha read as respectful always beats approximate dialect read as mimicry. The same applies to US regional slang.

**Never mirror an emoji onto a price message.** A 👍 on a price is a stall (behavior state D). Answering it with a 👍 signals you read it as agreement, and the stall hardens.

**Never mirror hostility, impatience, or curtness at `ready_to_buy`.** Short is fine; cold at the moment of payment is not.

Mirroring adjusts tone. It never changes what the message is for.

---

## 2. Pre-empting the expected objection

Naming the likely objection before the client raises it defuses it. They stop building a case and start evaluating.

**The gate: the pre-empt must be true.**

The original drafts of this technique read:

> "A lot of clients tell me initially they prefer traditional photography — but once they see the result, they switch completely."
> "بعض الملاك يترددون في البداية، لكن بعد أول فيديو، يطلبون باقي العقارات."

Both are specific claims about how past clients behaved. If those clients exist, the lines are usable — drop the absolutes ("completely", "يطلبون باقي العقارات" as a general rule) and say what actually happened. If they do not exist, these are fabricated social proof, which the hard prohibitions forbid outright and which collapses the first time a client asks "who?"

**Truthful versions that make no claim about past clients.** These name the concern rather than inventing someone who overcame it, and they route to the sample, which is the thing that actually reduces risk.

| ID | Market | Line |
|---|---|---|
| `PE-US-A` | USA | "If you're wondering whether this looks as good as a real shoot — fair question, it's the main thing people want to check. I can send a sample so you can judge it yourself." |
| `PE-AE-A` | UAE | "إن كنت تتساءل عمّا إذا كانت النتيجة بمستوى التصوير التقليدي، فهذا سؤال في محله. يمكنني إرسال عينة لتحكم بنفسك." |

Placement: the second or third reply, once interest is established and before price becomes the whole conversation. Not the first message — pre-empting an objection nobody has yet formed just introduces it.

Use it once. Twice reads as insecurity about the product.

These carry variant IDs and can be A/B tested like any other reply. See `ab-testing.md`.

---

## 3. Soft close

At `HIGH` buying intent, assumptive framing outperforms permission-seeking. "How many properties are we starting with?" moves the client from *should I buy* to *how much am I buying*. "Are you ready to buy?" invites a no that did not need to exist.

**The gate: the deposit link still does not move before quantity is confirmed.**

The original draft of this technique read:

> "I'll send you the deposit link now — once confirmed, we'll start your first video immediately. How many properties should we begin with?"

That sends the link before the quantity is known, which breaks the payment gate — there is no confirmed total yet, so there is no correct link to send. It also carries two objectives in one message.

**Correct sequencing: assumptive question first, link second.**

| ID | Market | Line |
|---|---|---|
| `SC-US-A` | USA | "Perfect — how many properties are we starting with? I'll send the deposit link as soon as I know." |
| `SC-US-B` | USA | "Let's start with one property so you can see the result, then do the rest after. Sound good?" |
| `SC-AE-A` | UAE | "ممتاز — كم عقاراً سنبدأ به؟ سأرسل رابط الدفعة الأولى فور معرفة العدد." |
| `SC-AE-B` | UAE | "لنبدأ بعقار واحد لترى النتيجة، ثم نكمل الباقي بعدها. هل يناسبك ذلك؟" |

The `B` variants trade order size for a lower barrier. Worth testing against `A` — the hypothesis is that on a first purchase the smaller ask converts more often even though it books less, and that the difference shows up in repeat rate rather than in order value.

Once the quantity comes back, read `payments.md`, match the total, and send the one correct link.

---

## When not to use any of this

- The client has already decided and is asking a logistics question. Answer it.
- The client is a returning customer. They have seen the technique.
- Intent is `LOW`. Assumptive language at low intent reads as pressure and ends conversations.
- The honest move is `wait` or `stop pursuing`. No technique rescues a dead lead, and trying is how you get blocked.
