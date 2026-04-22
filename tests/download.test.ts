import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBlob, suggestedFilename } from "../src/lib/download";

describe("suggestedFilename", () => {
  it("slugifies the prompt and appends a timestamp + extension", () => {
    const name = suggestedFilename("A spatial station, in deep space!");
    expect(name).toMatch(
      /^360world-a-spatial-station-in-deep-space-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.webp$/,
    );
  });

  it("falls back to 'panorama' when the prompt has no usable characters", () => {
    const name = suggestedFilename("***");
    expect(name).toMatch(/^360world-panorama-/);
  });

  it("strips diacritics", () => {
    const name = suggestedFilename("café à Paris");
    expect(name).toMatch(/^360world-cafe-a-paris-/);
  });

  it("respects a custom extension", () => {
    const name = suggestedFilename("hello", "png");
    expect(name.endsWith(".png")).toBe(true);
  });
});

describe("downloadBlob", () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let originalCreate: typeof URL.createObjectURL;
  let originalRevoke: typeof URL.revokeObjectURL;

  beforeEach(() => {
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it("creates an anchor with the given filename and triggers a click", () => {
    const blob = new Blob(["x"], { type: "image/webp" });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadBlob(blob, "panorama.webp");

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector("a")).toBeNull();

    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    clickSpy.mockRestore();
  });
});
