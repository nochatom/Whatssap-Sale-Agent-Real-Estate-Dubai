import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export interface PhoneNormalizationResult {
  ok: boolean;
  e164?: string;
  reason?: string;
}

/**
 * Normalizes a raw CSV phone value to E.164. defaultCountry helps parse
 * local-format numbers (no leading +) common in GCC + Egypt lead lists.
 */
export function normalizePhoneToE164(
  raw: string,
  defaultCountry?: CountryCode,
): PhoneNormalizationResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty phone number" };
  }

  let phoneNumber;
  try {
    phoneNumber = parsePhoneNumberFromString(trimmed, defaultCountry);
  } catch {
    return { ok: false, reason: `unparseable phone number: ${raw}` };
  }

  if (!phoneNumber || !phoneNumber.isValid()) {
    return { ok: false, reason: `invalid phone number: ${raw}` };
  }

  return { ok: true, e164: phoneNumber.number };
}
