import { buildPrompt } from "./prompt";

export const PROXY_ENDPOINT = "/.netlify/functions/replicate";
export const REPLICATE_MODEL = "openai/gpt-image-2";

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export type GeneratedImage = {
  url: string;
  prompt: string;
  finalPrompt: string;
  predictionId: string;
};

export type ProgressEvent = {
  status: ReplicatePrediction["status"];
  attempt: number;
  elapsedMs: number;
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

export class GenerationTimeoutError extends ReplicateError {
  constructor(elapsedMs: number) {
    super(`Generation did not complete within ${Math.round(elapsedMs / 1000)}s.`);
    this.name = "GenerationTimeoutError";
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
  pollIntervalMs?: number;
  timeoutMs?: number;
  onProgress?: (event: ProgressEvent) => void;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export async function generate360Image(opts: GenerateOptions): Promise<GeneratedImage> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const endpoint = opts.endpoint ?? PROXY_ENDPOINT;
  const pollInterval = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const finalPrompt = buildPrompt(opts.prompt);

  const startResponse = await fetchImpl(endpoint, {
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
    signal: opts.signal,
  });

  await assertOk(startResponse);

  const initial = (await startResponse.json()) as ReplicatePrediction;
  if (!initial.id) {
    throw new GenerationFailedError("Replicate did not return a prediction id.");
  }

  let prediction = initial;
  const startedAt = Date.now();
  let attempt = 0;

  while (prediction.status === "starting" || prediction.status === "processing") {
    const elapsed = Date.now() - startedAt;
    opts.onProgress?.({ status: prediction.status, attempt, elapsedMs: elapsed });

    if (elapsed > timeoutMs) {
      throw new GenerationTimeoutError(elapsed);
    }
    await sleep(pollInterval, opts.signal);

    const pollResponse = await fetchImpl(`${endpoint}?id=${encodeURIComponent(prediction.id)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      signal: opts.signal,
    });
    await assertOk(pollResponse);
    prediction = (await pollResponse.json()) as ReplicatePrediction;
    attempt += 1;
  }

  if (prediction.status === "failed" || prediction.status === "canceled") {
    throw new GenerationFailedError(prediction.error ?? prediction.status);
  }

  const url = extractFirstUrl(prediction.output);
  if (!url) {
    throw new GenerationFailedError("Replicate response did not contain an image URL.");
  }

  opts.onProgress?.({
    status: prediction.status,
    attempt,
    elapsedMs: Date.now() - startedAt,
  });

  return { url, prompt: opts.prompt, finalPrompt, predictionId: prediction.id };
}

export async function fetchImageBlob(url: string, fetchImpl: typeof fetch = fetch): Promise<Blob> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new ReplicateError(`Failed to download image: HTTP ${response.status}`, response.status);
  }
  return response.blob();
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) return;
  if (response.status === 401 || response.status === 403) {
    throw new InvalidApiKeyError();
  }
  if (response.status === 429) {
    throw new RateLimitError();
  }
  const text = await safeText(response);
  throw new ReplicateError(
    `Replicate proxy returned HTTP ${response.status}: ${text}`,
    response.status,
  );
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

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
