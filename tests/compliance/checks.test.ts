import { describe, expect, it } from "vitest";

import { checkCampaignActive, checkServiceWindow, checkTemplateApproval } from "@/compliance/checks";

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
