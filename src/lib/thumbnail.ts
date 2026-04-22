const DEFAULT_WIDTH = 512;
const DEFAULT_HEIGHT = 256;
const DEFAULT_QUALITY = 0.82;
const DEFAULT_TYPE = "image/webp";

export type ThumbnailOptions = {
  width?: number;
  height?: number;
  type?: string;
  quality?: number;
};

export async function buildThumbnail(source: Blob, options: ThumbnailOptions = {}): Promise<Blob> {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const type = options.type ?? DEFAULT_TYPE;
  const quality = options.quality ?? DEFAULT_QUALITY;

  const bitmap = await createImageBitmap(source);
  try {
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement("canvas"), { width, height });

    const ctx = (canvas as HTMLCanvasElement).getContext("2d");
    if (!ctx) {
      throw new Error("Could not acquire a 2D rendering context.");
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);

    return await canvasToBlob(canvas, type, quality);
  } finally {
    bitmap.close();
  }
}

async function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
  quality: number,
): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("canvas.toBlob returned null."));
      },
      type,
      quality,
    );
  });
}
