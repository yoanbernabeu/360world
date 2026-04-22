const TARGET_RATIO = 2;

export type EquirectOptions = {
  type?: string;
  quality?: number;
};

export async function toEquirectangularBlob(
  source: Blob,
  options: EquirectOptions = {},
): Promise<Blob> {
  const type = options.type ?? source.type ?? "image/webp";
  const quality = options.quality ?? 0.95;
  const bitmap = await createImageBitmap(source);
  try {
    const ratio = bitmap.width / bitmap.height;
    if (Math.abs(ratio - TARGET_RATIO) < 0.01) {
      return source;
    }

    const targetWidth = Math.max(bitmap.width, bitmap.height * TARGET_RATIO);
    const targetHeight = Math.round(targetWidth / TARGET_RATIO);

    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(targetWidth, targetHeight)
        : Object.assign(document.createElement("canvas"), {
            width: targetWidth,
            height: targetHeight,
          });

    const ctx = (canvas as HTMLCanvasElement).getContext("2d");
    if (!ctx) {
      throw new Error("Could not acquire a 2D rendering context.");
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

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
