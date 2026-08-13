import NewCampaignClient from "./NewCampaignClient";

// Reads WHATSAPP_PHONE_NUMBER_ID at request time — must not be statically
// prerendered, or the prefilled default would reflect the build
// environment instead of the actual deployed server's configuration.
export const dynamic = "force-dynamic";

/**
 * Prefills the sender number field with the real configured
 * WHATSAPP_PHONE_NUMBER_ID as a convenience default (still editable) —
 * not fabricated, this is the account's actual configured value.
 */
export default function NewCampaignPage() {
  const defaultSenderPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
  return <NewCampaignClient defaultSenderPhoneNumberId={defaultSenderPhoneNumberId} />;
}
