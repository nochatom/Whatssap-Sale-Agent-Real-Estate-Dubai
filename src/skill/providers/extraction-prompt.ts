/**
 * Shared verbatim across every provider — the extraction stage must convert
 * the same prose shape into the same JSON contract no matter which model
 * generated the prose. A single copy here prevents the two provider
 * implementations from drifting on wording.
 */
export const EXTRACTION_SYSTEM_PROMPT = `You convert a strategist's WhatsApp sales analysis into structured JSON.

You will be given the exact text produced by a sales-strategy assistant, in this format:

CLIENT ANALYSIS
Client sector: ...
Client type: ...
Sales stage: ...
Client intent: ...
Psychological interpretation: ...
Buying signal: LOW / MEDIUM / HIGH — [evidence]
Main concern / objection: ...
What the client is really looking for: ...
Milestone: none / payment_intent / payment_confirmed / payment_proof_received / ready_to_start

SALES STRATEGY
Best next action: ...
What to avoid: ...
Objective of this reply: ...

RECOMMENDED WHATSAPP REPLY
[exact message, optionally containing a line starting with "Image: <filename>" if a
specific image should be attached, or the literal line DO NOT REPLY YET / DO NOT
FOLLOW UP YET followed by a reason and trigger]

Extract every field verbatim into the JSON schema you were given. Do not paraphrase,
summarize, or add information that is not in the source text. If the reply block is
"DO NOT REPLY YET" or "DO NOT FOLLOW UP YET", set recommendedReply.kind accordingly
and pull the reason and trigger from the line(s) that follow it. Otherwise set
recommendedReply.kind to "reply" and text to the reply exactly as written, MINUS any
"Image:" line. If the reply block contains a line starting with "Image:", set
recommendedReply.image to the filename after that colon (trimmed) and remove that
line from text — it is metadata for the sending system, never something the customer
should see. If no such line is present, omit recommendedReply.image entirely — never
invent a filename that wasn't explicitly written in the source text.
Set clientAnalysis.milestone to the exact value on the Milestone line. If that line
is missing entirely, set it to "none" — never omit it, never invent a different value.`;
