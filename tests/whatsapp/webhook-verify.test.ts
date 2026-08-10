import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyWebhookSignature, verifyWebhookSubscription } from "@/whatsapp/transport";

function signBody(body: string, secret: string): string {
  const hex = crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
  return `sha256=${hex}`;
}

describe("verifyWebhookSignature", () => {
  const secret = "test-app-secret";
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

  it("accepts a correctly signed body", () => {
    const header = signBody(body, secret);
    expect(verifyWebhookSignature(body, header, secret)).toBe(true);
  });

  it("rejects a body signed with a different secret", () => {
    const header = signBody(body, "wrong-secret");
    expect(verifyWebhookSignature(body, header, secret)).toBe(false);
  });

  it("rejects a mutated body against the original signature", () => {
    const header = signBody(body, secret);
    const mutatedBody = body.replace("whatsapp_business_account", "something_else");
    expect(verifyWebhookSignature(mutatedBody, header, secret)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
  });

  it("rejects a header with the wrong scheme", () => {
    const hex = crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(verifyWebhookSignature(body, `sha1=${hex}`, secret)).toBe(false);
  });

  it("rejects a malformed hex signature without throwing", () => {
    expect(verifyWebhookSignature(body, "sha256=not-hex-zz", secret)).toBe(false);
  });
});

describe("verifyWebhookSubscription", () => {
  const verifyToken = "my-verify-token";

  it("returns the challenge when mode and token match", () => {
    const query = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": verifyToken,
      "hub.challenge": "12345",
    });
    expect(verifyWebhookSubscription(query, verifyToken)).toBe("12345");
  });

  it("returns null when the verify token is wrong", () => {
    const query = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "wrong-token",
      "hub.challenge": "12345",
    });
    expect(verifyWebhookSubscription(query, verifyToken)).toBeNull();
  });

  it("returns null when the mode is not subscribe", () => {
    const query = new URLSearchParams({
      "hub.mode": "unsubscribe",
      "hub.verify_token": verifyToken,
      "hub.challenge": "12345",
    });
    expect(verifyWebhookSubscription(query, verifyToken)).toBeNull();
  });

  it("returns null when the challenge is missing", () => {
    const query = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": verifyToken,
    });
    expect(verifyWebhookSubscription(query, verifyToken)).toBeNull();
  });
});
