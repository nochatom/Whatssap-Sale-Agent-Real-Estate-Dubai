import { describe, expect, it } from "vitest";

import { checkServiceWindow, checkTemplateApproval } from "@/compliance/checks";

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
});

describe("checkServiceWindow (template interaction)", () => {
  it("always passes for a template send, even with no prior inbound message", () => {
    expect(checkServiceWindow({ lastInboundAt: null }, true)).toBe(true);
  });

  it("still requires an open window for a free-text send", () => {
    expect(checkServiceWindow({ lastInboundAt: null }, false)).toBe(false);
  });
});
