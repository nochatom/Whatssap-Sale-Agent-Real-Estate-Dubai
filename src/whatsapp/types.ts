export interface SendTextMessageParams {
  to: string;
  body: string;
  phoneNumberId: string;
  accessToken: string;
  /** Meta wamid this text is a quoted reply to — omit for a plain send. */
  contextMessageId?: string;
}

/** The four outbound media types Meta's Cloud API supports via a pre-uploaded media id. */
export type MediaKind = "image" | "video" | "document" | "audio";

export interface SendMediaMessageParams {
  to: string;
  phoneNumberId: string;
  accessToken: string;
  mediaId: string;
  kind: MediaKind;
  caption?: string;
  /** Only meaningful for kind "document" — Meta shows this as the file's name. */
  filename?: string;
  contextMessageId?: string;
}

export interface UploadMediaParams {
  phoneNumberId: string;
  accessToken: string;
  file: Blob;
  filename: string;
}

export interface UploadMediaResult {
  mediaId: string;
}

/**
 * Meta's documented Cloud API limits per media kind (max file size, allowed
 * MIME types) — used to validate a file before ever uploading it, both
 * client-side (composer) and server-side (reply route), from one source so
 * they can't drift apart.
 */
export const MEDIA_LIMITS: Record<MediaKind, { maxBytes: number; mimeTypes: string[] }> = {
  image: { maxBytes: 5 * 1024 * 1024, mimeTypes: ["image/jpeg", "image/png"] },
  video: { maxBytes: 16 * 1024 * 1024, mimeTypes: ["video/mp4", "video/3gpp"] },
  document: {
    maxBytes: 100 * 1024 * 1024,
    mimeTypes: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
      "text/csv",
    ],
  },
  audio: { maxBytes: 16 * 1024 * 1024, mimeTypes: ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"] },
};

export function mediaKindForMimeType(mimeType: string): MediaKind | null {
  for (const kind of Object.keys(MEDIA_LIMITS) as MediaKind[]) {
    if (MEDIA_LIMITS[kind].mimeTypes.includes(mimeType)) return kind;
  }
  return null;
}

/**
 * Template send with optional body variable substitution. bodyParams maps
 * positionally to the template's {{1}}, {{2}}, ... placeholders — omit for
 * a template with no variables.
 */
export interface SendTemplateMessageParams {
  to: string;
  phoneNumberId: string;
  accessToken: string;
  templateName: string;
  templateLanguage: string;
  bodyParams?: string[];
}

export interface SendMessageResult {
  waMessageId: string;
}

export interface InboundWebhookMessage {
  waMessageId: string;
  from: string;
  timestamp: string;
  type: string;
  text?: string;
}
