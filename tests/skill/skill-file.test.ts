import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assertReferencesExist, checkReferences, extractReferencedFiles } from "@/skill/skill-file";

// offer-config.md is required; sector-playbooks.md is not — this sample
// exercises exactly one of each.
const SAMPLE_MARKDOWN = `
Route to \`references/offer-config.md\` before any price.
See \`references/sector-playbooks.md\` for the strategy shift.
Always read \`references/offer-config.md\` again here (duplicate on purpose).
`;

describe("extractReferencedFiles", () => {
  it("extracts unique references/*.md paths", () => {
    expect(extractReferencedFiles(SAMPLE_MARKDOWN)).toEqual([
      "references/offer-config.md",
      "references/sector-playbooks.md",
    ]);
  });

  it("returns an empty array when there are no references", () => {
    expect(extractReferencedFiles("no references here")).toEqual([]);
  });
});

describe("checkReferences / assertReferencesExist", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-file-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("reports nothing missing when every referenced file exists", () => {
    fs.mkdirSync(path.join(tmpDir, "references"));
    fs.writeFileSync(path.join(tmpDir, "references", "offer-config.md"), "pricing");
    fs.writeFileSync(path.join(tmpDir, "references", "sector-playbooks.md"), "playbooks");

    expect(checkReferences(SAMPLE_MARKDOWN, tmpDir)).toEqual({
      missingRequired: [],
      missingOptional: [],
    });
    expect(() => assertReferencesExist(SAMPLE_MARKDOWN, tmpDir)).not.toThrow();
  });

  it("does not throw when only an optional reference is missing, but warns", () => {
    fs.mkdirSync(path.join(tmpDir, "references"));
    fs.writeFileSync(path.join(tmpDir, "references", "offer-config.md"), "pricing");
    // sector-playbooks.md intentionally absent — it is not in REQUIRED_REFERENCES

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(checkReferences(SAMPLE_MARKDOWN, tmpDir)).toEqual({
      missingRequired: [],
      missingOptional: ["references/sector-playbooks.md"],
    });
    expect(() => assertReferencesExist(SAMPLE_MARKDOWN, tmpDir)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toMatch(/sector-playbooks\.md/);
  });

  it("throws naming only the missing required reference, even when both are missing", () => {
    // No references/ directory at all — both offer-config.md (required) and
    // sector-playbooks.md (optional) are missing.
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(checkReferences(SAMPLE_MARKDOWN, tmpDir)).toEqual({
      missingRequired: ["references/offer-config.md"],
      missingOptional: ["references/sector-playbooks.md"],
    });

    let thrown: unknown;
    try {
      assertReferencesExist(SAMPLE_MARKDOWN, tmpDir);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/offer-config\.md/);
    expect((thrown as Error).message).not.toMatch(/sector-playbooks\.md/);
  });
});
