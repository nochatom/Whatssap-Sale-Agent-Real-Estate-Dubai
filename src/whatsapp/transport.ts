import crypto from "node:crypto";

import type {
  SendMediaMessageParams,
  SendMessageResult,
  SendTemplateMessageParams,
  SendTextMessageParams,
  UploadMediaParams,
  UploadMediaResult,
} from "./types";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";
const AUTH_SCHEME = "Bearer";

function assertSendingEnabled(): void {
  if (process.env.SENDING_ENABLED !== "true") {
    throw new Error("Outbound sending is disabled: SENDING_ENABLED is not 'true'");
  }
}

async function postToGraphApi(
  phoneNumberId: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<SendMessageResult> {
  const response = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `${AUTH_SCHEME} ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`WhatsApp send failed (${response.status}): ${errorBody}`);
  }

  const json = (await response.json()) as { messages?: { id: string }[] };
  const waMessageId = json.messages?.[0]?.id;
  if (!waMessageId) {
    throw new Error("WhatsApp send response missing message id");
  }

  return { waMessageId };
}

/**
 * Phase 1 hard stop: no outbound message may ever be sent. SENDING_ENABLED is
 * never set to "true" in any committed file — this only reads the runtime
 * environment, it never defines the variable.
 *
 * contextMessageId is optional and additive — existing callers (Campaign
 * opener's free-text path, AI reply, follow-up) never pass it, so their
 * request body is byte-identical to before this field existed.
 */
export async function sendMessage(params: SendTextMessageParams): Promise<SendMessageResult> {
  assertSendingEnabled();
  return postToGraphApi(params.phoneNumberId, params.accessToken, {
    messaging_product: "whatsapp",
    to: params.to,
    type: "text",
    text: { body: params.body },
    ...(params.contextMessageId ? { context: { message_id: params.contextMessageId } } : {}),
  });
}

/**
 * Sends a message referencing media already uploaded to Meta via
 * uploadMedia() below — never raw bytes in this call. Same SENDING_ENABLED
 * hard stop as sendMessage/sendTemplateMessage. Purely additive: does not
 * change either of those two existing functions.
 */
export async function sendMediaMessage(params: SendMediaMessageParams): Promise<SendMessageResult> {
  assertSendingEnabled();
  const mediaObject: Record<string, unknown> = { id: params.mediaId };
  if (params.caption) mediaObject.caption = params.caption;
  if (params.kind === "document" && params.filename) mediaObject.filename = params.filename;

  return postToGraphApi(params.phoneNumberId, params.accessToken, {
    messaging_product: "whatsapp",
    to: params.to,
    type: params.kind,
    [params.kind]: mediaObject,
    ...(params.contextMessageId ? { context: { message_id: params.contextMessageId } } : {}),
  });
}

/**
 * Uploads a file's bytes to Meta's /media endpoint, returning a media id
 * that sendMediaMessage() can then reference. Deliberately NOT gated by
 * assertSendingEnabled() — uploading bytes to Meta's storage doesn't reach
 * a customer by itself; the actual send (sendMediaMessage) still is gated,
 * so in test/dev mode (SENDING_ENABLED unset) an upload can succeed while
 * the subsequent send correctly refuses, same as every other send path.
 */
export async function uploadMedia(params: UploadMediaParams): Promise<UploadMediaResult> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", params.file, params.filename);

  const response = await fetch(`${GRAPH_API_BASE}/${params.phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `${AUTH_SCHEME} ${params.accessToken}` },
    body: form,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`WhatsApp media upload failed (${response.status}): ${errorBody}`);
  }

  const json = (await response.json()) as { id?: string };
  if (!json.id) {
    throw new Error("WhatsApp media upload response missing id");
  }
  return { mediaId: json.id };
}

/**
 * Template send, with optional body variable substitution via bodyParams.
 * Same SENDING_ENABLED hard stop as sendMessage. Callers are responsible for
 * confirming the template is Meta-approved before calling this (see
 * compliance/checks.ts#checkTemplateApproval) — this function does not check
 * approval status itself, it only sends.
 */
export async function sendTemplateMessage(
  params: SendTemplateMessageParams,
): Promise<SendMessageResult> {
  assertSendingEnabled();
  return postToGraphApi(params.phoneNumberId, params.accessToken, {
    messaging_product: "whatsapp",
    to: params.to,
    type: "template",
    template: {
      name: params.templateName,
      language: { code: params.templateLanguage },
      ...(params.bodyParams && params.bodyParams.length > 0
        ? {
            components: [
              {
                type: "body",
                parameters: params.bodyParams.map((text) => ({ type: "text", text })),
              },
            ],
          }
        : {}),
    },
  });
}

/**
 * Verifies Meta's X-Hub-Signature-256 header (format "sha256=<hex>") against
 * the raw request body using the app secret. Constant-time comparison.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader) return false;

  const [scheme, providedHex] = signatureHeader.split("=");
  if (scheme !== "sha256" || !providedHex) return false;

  const expectedHex = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  let expected: Buffer;
  let provided: Buffer;
  try {
    expected = Buffer.from(expectedHex, "hex");
    provided = Buffer.from(providedHex, "hex");
  } catch {
    return false;
  }

  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

/**
 * Handles Meta's webhook subscription handshake (GET request with
 * hub.mode / hub.verify_token / hub.challenge). Returns the challenge to echo
 * back, or null if verification fails.
 */
export function verifyWebhookSubscription(
  query: URLSearchParams,
  verifyToken: string,
): string | null {
  const mode = query.get("hub.mode");
  const token = query.get("hub.verify_token");
  const challenge = query.get("hub.challenge");

  if (mode === "subscribe" && token === verifyToken && challenge) {
    return challenge;
  }
  return null;
}
