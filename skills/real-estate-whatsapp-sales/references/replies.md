# Reply Templates — UAE + USA

These are starting points, not scripts. Adapt them to what the conversation has already established. Sending a template verbatim to someone who already has the price reads as automated, and clients disengage from anything that feels automated.

Every reply carries a **variant ID**. When you recommend a reply drawn from here, name the ID in the `SALES STRATEGY` block so the operator can log it. See `ab-testing.md` for how variants are tested and promoted.

`A` is the incumbent. A `B` row means a test is live at that stage — alternate assignment, odd sends get `A`, even get `B`.

**Last variant review:** never run (initial version)

---

## UAE 🇦🇪 — by stage

| ID | Stage | Reply |
|----|-------|-------|
| `II-AE-A` | `initial_interest` | "السلام عليكم، مرحباً بك في AI Property Films. نحول صور عقارك إلى فيديو تسويقي احترافي خلال 24 ساعة، بدون تصوير ميداني. عرض خاص: اطلب فيديو واحد واحصل على الثاني مجاناً. هل لديك عقار معين؟" |
| `CU-AE-A` | `curious` | "بكل سرور. نأخذ صور العقار الموجودة لديك ونحولها إلى فيديو تسويقي احترافي، بدون تصوير ميداني. ما نوع العقار الذي تعمل عليه؟" |
| `QL-AE-A` | `qualification` | "ممتاز. كم عدد الصور المتوفرة لديك للعقار؟" |
| `PC-AE-A` | `price_check` | "سعر الفيديو الواحد 149 دولاراً. ومع العرض، تحصل على فيديو إضافي مجاناً. كم فيديو تحتاج؟" |
| `SR-AE-A` | `sample_requested` | "بكل سرور. سأرسل لك عينة خلال ساعة. بعد مشاهدتها، أخبرني رأيك." |
| `OC-AE-A` | `offer_considered` | "العرض متاح لأول 5 عملاء هذا الأسبوع: فيديو واحد بسعر 149 دولاراً، والثاني مجاناً. هل ترغب في البدء؟" |
| `OB-AE-A` | `objection` | "أتفهم ذلك. لكن مع العرض، تدفع 149 دولاراً مقابل فيديوين. هل ترغب في عينة مجانية لتقييم الجودة؟" |
| `RB-AE-A` | `ready_to_buy` | "ممتاز! سأرسل لك رابط الدفعة الأولى (50%). بعد تأكيد الدفع، أرسل صور العقار وسنبدأ فوراً. الفيديو جاهز خلال 24 ساعة." |
| `FU-AE-A` | `follow_up` | "مرحباً، أردت التأكد من وصول العرض السابق. هل لديك أي استفسار؟" |
| `GH-AE-A` | `ghosting` | "مرحباً، عرض الفيديو + الفيديو المجاني لا يزال متاحاً. هل ترغب في متابعة؟" |

---

## USA 🇺🇸 — by stage

| ID | Stage | Reply |
|----|-------|-------|
| `II-US-A` | `initial_interest` | "Hey! Welcome to AI Property Films. We turn your property photos into a professional marketing video in 24 hours — no shoot, no crew, no hassle. Special offer: buy 1 video, get the 2nd one free. Do you have a specific property in mind?" |
| `CU-US-A` | `curious` | "Happy to explain. We take the photos you already have and turn them into a professional marketing video — no shoot needed. What kind of property are you working with?" |
| `QL-US-A` | `qualification` | "Perfect. How many photos do you have for the property?" |
| `PC-US-A` | `price_check` | "$149 per video. With the offer, you get a 2nd video free. How many videos do you need?" |
| `SR-US-A` | `sample_requested` | "Happy to share. I'll send a sample within an hour. Let me know your thoughts after you watch it." |
| `OC-US-A` | `offer_considered` | "The offer runs for the first 5 clients this week: 1 video at $149, 2nd one free. Want to get started?" |
| `OB-US-A` | `objection` | "I get it. But with the offer, you're paying $149 for 2 videos. Want a free sample to check the quality?" |
| `RB-US-A` | `ready_to_buy` | "Great! I'll send the 50% deposit link. Once payment's confirmed, send your property photos and we'll start immediately. Video ready in 24 hours." |
| `FU-US-A` | `follow_up` | "Hey, just checking in — did you have any questions about the offer?" |
| `GH-US-A` | `ghosting` | "Hey, the buy 1 get 1 free offer is still available. Want to move forward?" |

---

## Suggested first test

No variants have been tested yet. The highest-volume stage is `price_check`, so start there — it accumulates sample fastest and sits directly upstream of the order.

| ID | Reply | Hypothesis |
|----|-------|------------|
| `PC-US-B` | "Depends how many you need — with the current offer it's 2 videos for $149. What are you marketing?" | Leading with the offer rather than the unit price may reframe $149 as a bundle instead of a per-item cost, and asking about the property rather than the quantity may qualify without feeling like a checkout question. |
| `PC-AE-B` | "أهلاً بك. مع العرض الحالي، فيديوان بسعر 149 دولاراً. ما نوع العقار الذي ترغب في تسويقه؟" | Same hypothesis, adapted to the UAE preference for value before price. |

Run one market at a time. Do not change anything else while this is running.

---

## Objection handling

Identify the real objection before answering the stated one, then run: acknowledge → clarify or reframe → reduce risk → move forward.

| Objection | UAE | USA |
|-----------|-----|-----|
| "Price is high" | "أتفهم ذلك. لكن مع العرض، تدفع 149 دولاراً مقابل فيديوين. هل ترغب في عينة مجانية؟" | "I get it. But with the offer, you're paying $149 for 2 videos. Want a free sample?" |
| "I need to think" | "طبعاً، خذ وقتك. العرض متاح لأول 5 عملاء. هل ترغب في تفاصيل إضافية؟" | "Of course, take your time. The offer is limited to the first 5 clients. Want more details?" |
| "I have another supplier" | "نحن نقدم خدمة مختلفة: لا تصوير، تسليم خلال 24 ساعة، فيديو احترافي. جرب عينة مجانية." | "We offer something different: no shoot, 24-hour delivery, professional quality. Try a free sample." |
| "Can I see a sample?" | "بكل سرور. سأرسل لك عينة خلال ساعة." | "Happy to. I'll send a sample within an hour." |
| "Will it actually get me bookings?" | "الفيديو يساعد على لفت الانتباه وتحسين طريقة عرض العقار. النتائج تختلف من عقار لآخر." | "It helps the listing stand out and get more attention. Results vary by property — I won't promise numbers." |
| "Why 50% upfront?" | "الدفعة الأولى 50% لبدء العمل، والباقي بعد التسليم. هذا يحمي الطرفين." | "50% to start, the rest after you've seen the video. It protects both of us." |

---

## Banned phrases

| Banned | Replace with |
|--------|--------------|
| "We guarantee more bookings" | "This can help attract more attention" |
| "We're the best" | "We're trusted by agents in both the UAE and USA" |
| "Today only" (unless true) | "Limited to the first 5 clients this week" |
| "Special price just for you" | "Our current offer applies to all new clients" |
| "This will increase your revenue by X%" | Do not make numeric claims at all |
| "Trust me" | Offer a sample instead |
| "Just following up again" | Say something new, or don't message |

---

## Worked examples

**Client (UAE):** "السلام عليكم، كم سعر الفيديو؟"

Market UAE · stage `price_check` · signal MEDIUM · concern: price unknown, no scope given yet · variant `PC-AE-A`.

> "وعليكم السلام. سعر الفيديو الواحد 149 دولاراً. ومع العرض الحالي، تحصل على فيديو إضافي مجاناً. هل لديك عقار معين ترغب في تسويقه؟"

**Client (USA):** "Hey, how much for a video?"

Market USA · stage `price_check` · signal MEDIUM · concern: price unknown · variant `PC-US-A`.

> "Hey! $149 per video, and with our current offer you get a 2nd video free. What type of property are you looking to market?"

**Client (USA):** reacts 👍 to the price message, no text, 6 hours pass.

Market USA · behavior state D · stage stays `price_check`, not upgraded · signal LOW to MEDIUM. A thumbs-up on a price acknowledges receipt; it does not accept the price. Most likely they are comparing or deferring.

> "Hey — happy to send over a quick sample so you can see the quality before deciding. Want me to?"

**Client (UAE):** engaged for three days, sample sent, then silent for 48 hours.

Market UAE · behavior state F · stage `ghosting` · signal LOW · variant `GH-AE-A`. Diagnose against the last message sent: if it ended with a price and a question, the silence most likely sits on the price.

> "مرحباً، أتمنى أن تكون العينة قد نالت إعجابك. العرض لا يزال متاحاً إن رغبت في المتابعة."

---

## Persuasion variants

Pre-empt and soft-close lines live in `persuasion.md` and carry their own IDs (`PE-US-A`, `PE-AE-A`, `SC-US-A`, `SC-US-B`, `SC-AE-A`, `SC-AE-B`). They are logged and tested exactly like the stage templates above.
