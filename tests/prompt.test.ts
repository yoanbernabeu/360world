import { describe, expect, it } from "vitest";
import { buildPrompt } from "../src/lib/prompt";

describe("buildPrompt", () => {
  it("prepends the panorama prefix to a plain user prompt", () => {
    expect(buildPrompt("a spatial station")).toBe("360 equirectangular image, a spatial station");
  });

  it("trims surrounding whitespace before prefixing", () => {
    expect(buildPrompt("   moonlit forest   ")).toBe("360 equirectangular image, moonlit forest");
  });

  it("does not double-prefix when the user already wrote 360 equirectangular", () => {
    expect(buildPrompt("360 equirectangular city skyline")).toBe(
      "360 equirectangular city skyline",
    );
  });

  it("detects the prefix even when wording differs slightly", () => {
    expect(buildPrompt("A 360, equirectangular shot of a beach")).toBe(
      "A 360, equirectangular shot of a beach",
    );
  });

  it("throws on empty input", () => {
    expect(() => buildPrompt("   ")).toThrow(/empty/i);
  });
});
