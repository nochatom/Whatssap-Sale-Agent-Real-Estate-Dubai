import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMetaTemplateStatus, stripTemplateDisplaySuffix } from "@/whatsapp/templates";

describe("stripTemplateDisplaySuffix", () => {
  it("strips Meta's own \"name · Language\" display label down to the real name", () => {
    expect(stripTemplateDisplaySuffix("property_video_intro_v1 · English")).toBe("property_video_intro_v1");
  });

  it("leaves an already-clean name untouched", () => {
    expect(stripTemplateDisplaySuffix("property_video_intro_v1")).toBe("property_video_intro_v1");
  });

  it("trims incidental whitespace", () => {
    expect(stripTemplateDisplaySuffix("  property_video_intro_v1  ")).toBe("property_video_intro_v1");
  });
});

describe("fetchMetaTemplateStatus", () => {
  const originalFetch = global.fetch;
  const originalWabaEnv = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

  beforeEach(() => {
    delete process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalWabaEnv === undefined) delete process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    else process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = originalWabaEnv;
  });

  it("finds a template by its real name, ignoring any pasted display suffix", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { name: "property_video_intro_v1", status: "APPROVED", language: "en" },
          { name: "hello_world", status: "APPROVED", language: "en_US" },
        ],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchMetaTemplateStatus("property_video_intro_v1 · English", "test-token");

    expect(result).toEqual({ name: "property_video_intro_v1", status: "APPROVED", language: "en" });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("2140666990221175/message_templates");
    const options = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(options.headers.Authorization).toBe("Bearer test-token");
  });

  it("returns null when no template on the WABA matches", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ name: "hello_world", status: "APPROVED", language: "en_US" }] }),
    }) as unknown as typeof fetch;

    const result = await fetchMetaTemplateStatus("does_not_exist", "test-token");

    expect(result).toBeNull();
  });

  it("throws with the response body when Meta returns a non-2xx status", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"invalid token"}',
    }) as unknown as typeof fetch;

    await expect(fetchMetaTemplateStatus("property_video_intro_v1", "bad-token")).rejects.toThrow(/HTTP 401/);
  });

  it("respects WHATSAPP_BUSINESS_ACCOUNT_ID when set, instead of the default WABA", async () => {
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = "999999999";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchMetaTemplateStatus("some_template", "test-token");

    expect(fetchMock.mock.calls[0]?.[0]).toContain("999999999/message_templates");
  });
});
