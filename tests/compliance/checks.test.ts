import { describe, expect, it } from "vitest";

import { checkCampaignActive, checkNotTollFree, checkServiceWindow, checkTemplateApproval } from "@/compliance/checks";

describe("checkTemplateApproval", () => {
  it("passes non-template sends regardless of template status", () => {
    expect(checkTemplateApproval({ templateStatus: "REJECTED" }, false)).toBe(true);
    expect(checkTemplateApproval({ templateStatus: "PENDING" }, false)).toBe(true);
  });

  it("passes a template send only when the campaign's template is APPROVED", () => {
    expect(checkTemplateApproval({ templateStatus: "APPROVED" }, true)).toBe(true);
    expect(checkTemplateApproval({ templateStatus: "PENDING" }, true)).toBe(false);
    expect(checkTemplateApproval({ templateStatus: "REJECTED" }, true)).toBe(false);
  });

  it("fails closed for a template send with no campaign — never passes an organic template", () => {
    expect(checkTemplateApproval(null, true)).toBe(false);
  });

  it("passes a non-template send with no campaign", () => {
    expect(checkTemplateApproval(null, false)).toBe(true);
  });
});

describe("checkServiceWindow (template interaction)", () => {
  it("always passes for a template send, even with no prior inbound message", () => {
    expect(checkServiceWindow({ lastInboundAt: null }, true)).toBe(true);
  });

  it("still requires an open window for a free-text send", () => {
    expect(checkServiceWindow({ lastInboundAt: null }, false)).toBe(false);
  });
});

describe("checkNotTollFree", () => {
  it("blocks a template send to a North American toll-free number", () => {
    expect(checkNotTollFree("+18005440300", true)).toBe(false); // 800
    expect(checkNotTollFree("+18778181014", true)).toBe(false); // 877
    expect(checkNotTollFree("+18889194987", true)).toBe(false); // 888
    expect(checkNotTollFree("+18559817557", true)).toBe(false); // 855
    expect(checkNotTollFree("+18669767530", true)).toBe(false); // 866
  });

  it("passes a template send to an ordinary geographic number", () => {
    expect(checkNotTollFree("+14243728268", true)).toBe(true);
    expect(checkNotTollFree("+13053912222", true)).toBe(true);
  });

  it("never blocks a non-template (free-text/AI reply) send, even to a toll-free number", () => {
    // A toll-free number could never have replied to reach an organic
    // conversation in the first place, but this proves the scoping anyway.
    expect(checkNotTollFree("+18005440300", false)).toBe(true);
  });

  it("passes (fails open) on an unparseable number rather than blocking on a formatting issue", () => {
    expect(checkNotTollFree("not-a-real-number", true)).toBe(true);
  });
});

describe("checkCampaignActive", () => {
  it("passes when there is no campaign — nothing to be inactive", () => {
    expect(checkCampaignActive(null)).toBe(true);
  });

  it("still requires ACTIVE status when a campaign exists", () => {
    expect(checkCampaignActive({ status: "ACTIVE" })).toBe(true);
    expect(checkCampaignActive({ status: "PAUSED" })).toBe(false);
    expect(checkCampaignActive({ status: "DRAFT" })).toBe(false);
  });
});
