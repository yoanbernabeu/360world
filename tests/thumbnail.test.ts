import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildThumbnail } from "../src/lib/thumbnail";

type FakeBitmap = { width: number; height: number; close: () => void };

let canvasWidth = 0;
let canvasHeight = 0;
let outputType = "";
let outputQuality = 0;
let drawArgs: unknown[] | null = null;

const originalCreateElement = document.createElement.bind(document);

beforeEach(() => {
  canvasWidth = 0;
  canvasHeight = 0;
  outputType = "";
  outputQuality = 0;
  drawArgs = null;

  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(
      async (): Promise<FakeBitmap> => ({
        width: 2048,
        height: 1024,
        close: () => {},
      }),
    ),
  );
  vi.stubGlobal("OffscreenCanvas", undefined);

  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag !== "canvas") return originalCreateElement(tag);
    const el = originalCreateElement("canvas") as HTMLCanvasElement;
    Object.defineProperty(el, "width", {
      configurable: true,
      get: () => canvasWidth,
      set: (v: number) => {
        canvasWidth = v;
      },
    });
    Object.defineProperty(el, "height", {
      configurable: true,
      get: () => canvasHeight,
      set: (v: number) => {
        canvasHeight = v;
      },
    });
    el.getContext = (() => ({
      drawImage: (...args: unknown[]) => {
        drawArgs = args;
      },
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high",
    })) as unknown as HTMLCanvasElement["getContext"];
    el.toBlob = ((cb: (b: Blob | null) => void, type: string, quality: number) => {
      outputType = type;
      outputQuality = quality;
      cb(new Blob([new Uint8Array([9, 9, 9])], { type }));
    }) as HTMLCanvasElement["toBlob"];
    return el;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("buildThumbnail", () => {
  it("defaults to 512×256 WebP at quality 0.82", async () => {
    const source = new Blob([new Uint8Array([1])], { type: "image/webp" });
    const thumb = await buildThumbnail(source);
    expect(canvasWidth).toBe(512);
    expect(canvasHeight).toBe(256);
    expect(outputType).toBe("image/webp");
    expect(outputQuality).toBeCloseTo(0.82);
    expect(thumb.type).toBe("image/webp");
    expect(drawArgs?.slice(1)).toEqual([0, 0, 512, 256]);
  });

  it("respects custom dimensions, type and quality", async () => {
    const source = new Blob([new Uint8Array([1])]);
    await buildThumbnail(source, {
      width: 320,
      height: 160,
      type: "image/png",
      quality: 0.5,
    });
    expect(canvasWidth).toBe(320);
    expect(canvasHeight).toBe(160);
    expect(outputType).toBe("image/png");
    expect(outputQuality).toBeCloseTo(0.5);
  });

  it("throws when the 2D context is unavailable", async () => {
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag !== "canvas") return originalCreateElement(tag);
      const el = originalCreateElement("canvas") as HTMLCanvasElement;
      el.getContext = (() => null) as HTMLCanvasElement["getContext"];
      return el;
    });
    await expect(buildThumbnail(new Blob([new Uint8Array([1])]))).rejects.toThrow(/2D/);
  });
});
