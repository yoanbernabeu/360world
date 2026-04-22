import { buildPrompt } from "./prompt";

export const PROXY_ENDPOINT = "/.netlify/functions/replicate";
export const REPLICATE_MODEL = "openai/gpt-image-2";

export type GeneratedImage = {
  url: string;
  prompt: string;
  finalPrompt: string;
};

export class ReplicateError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ReplicateError";
  }
}

export class InvalidApiKeyError extends ReplicateError {
  constructor() {
    super("Your Replicate API key was rejected (401).", 401);
    this.name = "InvalidApiKeyError";
  }
}

export class RateLimitError extends ReplicateError {
  constructor() {
    super("Replicate is rate-limiting this key. Try again in a moment.", 429);
    this.name = "RateLimitError";
  }
}

export class GenerationFailedError extends ReplicateError {
  constructor(detail: string) {
    super(`Generation failed: ${detail}`);
    this.name = "GenerationFailedError";
  }
}

type ReplicatePrediction = {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output: string[] | string | null;
  error: string | null;
};

type GenerateOptions = {
  apiKey: string;
  prompt: string;
  fetchImpl?: typeof fetch;
  endpoint?: string;
};

export async function generate360Image(opts: GenerateOptions): Promise<GeneratedImage> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const endpoint = opts.endpoint ?? PROXY_ENDPOINT;
  const finalPrompt = buildPrompt(opts.prompt);

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      input: {
        aspect_ratio: "3:2",
        background: "auto",
        moderation: "auto",
        number_of_images: 1,
        output_compression: 90,
        output_format: "webp",
        prompt: finalPrompt,
        quality: "high",
      },
    }),
  });

  if (response.status === 401 || response.status === 403) {
    throw new InvalidApiKeyError();
  }
  if (response.status === 429) {
    throw new RateLimitError();
  }
  if (!response.ok) {
    const text = await safeText(response);
    throw new ReplicateError(
      `Replicate proxy returned HTTP ${response.status}: ${text}`,
      response.status,
    );
  }

  const prediction = (await response.json()) as ReplicatePrediction;

  if (prediction.status === "failed" || prediction.status === "canceled") {
    throw new GenerationFailedError(prediction.error ?? prediction.status);
  }
  if (prediction.status !== "succeeded") {
    throw new GenerationFailedError(
      `Prediction did not finish in time (status: ${prediction.status}).`,
    );
  }

  const url = extractFirstUrl(prediction.output);
  if (!url) {
    throw new GenerationFailedError("Replicate response did not contain an image URL.");
  }

  return { url, prompt: opts.prompt, finalPrompt };
}

export async function fetchImageBlob(url: string, fetchImpl: typeof fetch = fetch): Promise<Blob> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new ReplicateError(`Failed to download image: HTTP ${response.status}`, response.status);
  }
  return response.blob();
}

function extractFirstUrl(output: ReplicatePrediction["output"]): string | null {
  if (!output) return null;
  if (typeof output === "string") return output;
  return output[0] ?? null;
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "<unreadable body>";
  }
}
