import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toEquirectangularBlob } from "../src/lib/equirect";

type FakeBitmap = { width: number; height: number; close: () => void };

let drawnArgs: unknown[] | null = null;
let outputType = "image/webp";
let canvasWidth = 0;
let canvasHeight = 0;

beforeEach(() => {
  drawnArgs = null;
  outputType = "image/webp";
  canvasWidth = 0;
  canvasHeight = 0;

  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async (blob: Blob): Promise<FakeBitmap> => {
      const meta = (blob as Blob & { __meta?: { w: number; h: number } }).__meta;
      return {
        width: meta?.w ?? 1536,
        height: meta?.h ?? 1024,
        close: () => {},
      };
    }),
  );

  vi.stubGlobal("OffscreenCanvas", undefined);

  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag !== "canvas") return originalCreateElement(tag);
    const el = originalCreateElement("canvas") as HTMLCanvasElement & { __dim?: number[] };
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
    el.getContext = ((): unknown => ({
      drawImage: (...args: unknown[]) => {
        drawnArgs = args;
      },
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high",
    })) as unknown as HTMLCanvasElement["getContext"];
    el.toBlob = ((cb: (blob: Blob | null) => void, type: string) => {
      outputType = type;
      cb(new Blob([new Uint8Array([1, 2, 3])], { type }));
    }) as HTMLCanvasElement["toBlob"];
    return el;
  });
});

const originalCreateElement = document.createElement.bind(document);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fakeBlob(width: number, height: number, type = "image/webp"): Blob {
  const blob = new Blob([new Uint8Array([0])], { type }) as Blob & {
    __meta?: { w: number; h: number };
  };
  blob.__meta = { w: width, h: height };
  return blob;
}

describe("toEquirectangularBlob", () => {
  it("returns the source blob untouched when ratio is already 2:1", async () => {
    const source = fakeBlob(2048, 1024);
    const result = await toEquirectangularBlob(source);
    expect(result).toBe(source);
  });

  it("stretches a 3:2 image into a 2:1 canvas", async () => {
    const source = fakeBlob(1536, 1024);
    const result = await toEquirectangularBlob(source);

    expect(result).not.toBe(source);
    expect(result.type).toBe("image/webp");
    expect(canvasWidth).toBe(2048);
    expect(canvasHeight).toBe(1024);

    expect(drawnArgs).toEqual([
      expect.objectContaining({ width: 1536, height: 1024 }),
      0,
      0,
      2048,
      1024,
    ]);
  });

  it("forwards a custom output type", async () => {
    const source = fakeBlob(1024, 1024, "image/png");
    await toEquirectangularBlob(source, { type: "image/png" });
    expect(outputType).toBe("image/png");
  });

  it("handles a 2:3 portrait image", async () => {
    const source = fakeBlob(1024, 1536);
    await toEquirectangularBlob(source);
    expect(canvasWidth).toBe(3072);
    expect(canvasHeight).toBe(1536);
  });

  it("throws when the 2D context is unavailable", async () => {
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag !== "canvas") return originalCreateElement(tag);
      const el = originalCreateElement("canvas") as HTMLCanvasElement;
      el.getContext = (() => null) as HTMLCanvasElement["getContext"];
      return el;
    });
    await expect(toEquirectangularBlob(fakeBlob(1536, 1024))).rejects.toThrow(/2D/);
  });
});
