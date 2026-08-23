import { describe, expect, it } from "vitest";

import { classifyBehaviorState } from "@/whatsapp/behavior-state";

describe("classifyBehaviorState", () => {
  it("classifies a text message with a body as A", () => {
    expect(classifyBehaviorState({ type: "text", body: "hi" })).toBe("A");
  });

  it("does NOT classify a text message with an empty/null body", () => {
    expect(classifyBehaviorState({ type: "text", body: "" })).toBeNull();
    expect(classifyBehaviorState({ type: "text", body: null })).toBeNull();
  });

  it("classifies image/document/audio/video/sticker messages as A, even with a null body", () => {
    for (const type of ["image", "document", "audio", "video", "sticker"]) {
      expect(classifyBehaviorState({ type, body: null })).toBe("A");
    }
  });

  it("returns null for an unrecognized type", () => {
    expect(classifyBehaviorState({ type: "button", body: "Yes" })).toBeNull();
    expect(classifyBehaviorState({ type: "unsupported", body: "Unsupported message: poll" })).toBeNull();
    expect(classifyBehaviorState({ type: "reaction", body: null })).toBeNull();
  });
});
