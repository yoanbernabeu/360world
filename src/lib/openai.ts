import { buildPrompt } from "./prompt";

export const OPENAI_ENDPOINT = "https://api.openai.com/v1/images/generations";
export const OPENAI_MODEL = "gpt-image-2";

export type OpenAIImageSize =
  | "auto"
  | "1024x1024"
  | "1024x1536"
  | "1536x1024"
  | "2560x1440"
  | "3840x2160";

export type OpenAIImageQuality = "auto" | "low" | "medium" | "high";

export const OPENAI_SIZE_OPTIONS: ReadonlyArray<{ value: OpenAIImageSize; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "1024x1024", label: "Square (1024×1024)" },
  { value: "1024x1536", label: "Portrait (1024×1536)" },
  { value: "1536x1024", label: "Landscape (1536×1024)" },
  { value: "2560x1440", label: "2K (2560×1440)" },
  { value: "3840x2160", label: "4K (3840×2160)" },
];

export const OPENAI_QUALITY_OPTIONS: ReadonlyArray<{ value: OpenAIImageQuality; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export type GeneratedOpenAIImage = {
  blob: Blob;
  prompt: string;
  finalPrompt: string;
  predictionId: string;
};

export class OpenAIError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OpenAIError";
  }
}

export class InvalidOpenAIKeyError extends OpenAIError {
  constructor(detail?: string) {
    super(
      detail
        ? `OpenAI rejected the API key (401): ${detail}`
        : "Your OpenAI API key was rejected (401).",
      401,
    );
    this.name = "InvalidOpenAIKeyError";
  }
}

export class OpenAIForbiddenError extends OpenAIError {
  constructor(detail: string) {
    super(`OpenAI returned 403: ${detail}`, 403);
    this.name = "OpenAIForbiddenError";
  }
}

export class OpenAIRateLimitError extends OpenAIError {
  constructor() {
    super("OpenAI is rate-limiting this key. Try again in a moment.", 429);
    this.name = "OpenAIRateLimitError";
  }
}

export class OpenAIContentPolicyError extends OpenAIError {
  constructor(detail: string) {
    super(`OpenAI refused the prompt: ${detail}`, 400);
    this.name = "OpenAIContentPolicyError";
  }
}

export class OpenAIGenerationFailedError extends OpenAIError {
  constructor(detail: string) {
    super(`Generation failed: ${detail}`);
    this.name = "OpenAIGenerationFailedError";
  }
}

type OpenAIImageResponse = {
  created?: number;
  data?: Array<{ b64_json?: string; url?: string }>;
};

type OpenAIErrorResponse = {
  error?: { message?: string; code?: string; type?: string };
};

type GenerateOptions = {
  apiKey: string;
  prompt: string;
  size?: OpenAIImageSize;
  quality?: OpenAIImageQuality;
  fetchImpl?: typeof fetch;
  endpoint?: string;
  signal?: AbortSignal;
};

export async function generate360Image(opts: GenerateOptions): Promise<GeneratedOpenAIImage> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const endpoint = opts.endpoint ?? OPENAI_ENDPOINT;
  const finalPrompt = buildPrompt(opts.prompt);

  const body: Record<string, unknown> = {
    model: OPENAI_MODEL,
    prompt: finalPrompt,
    n: 1,
  };
  if (opts.size && opts.size !== "auto") body.size = opts.size;
  else if (opts.size === "auto") body.size = "auto";
  if (opts.quality) body.quality = opts.quality;

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  await assertOk(response);

  const payload = (await response.json()) as OpenAIImageResponse;
  const first = payload.data?.[0];
  if (!first) {
    throw new OpenAIGenerationFailedError("OpenAI response did not contain any image.");
  }

  let blob: Blob;
  if (first.b64_json) {
    blob = b64ToBlob(first.b64_json, "image/png");
  } else if (first.url) {
    const download = await fetchImpl(first.url, { signal: opts.signal });
    if (!download.ok) {
      throw new OpenAIGenerationFailedError(`Image download failed: HTTP ${download.status}`);
    }
    blob = await download.blob();
  } else {
    throw new OpenAIGenerationFailedError("OpenAI response had no image data.");
  }

  return {
    blob,
    prompt: opts.prompt,
    finalPrompt,
    predictionId: `openai_${payload.created ?? Date.now()}`,
  };
}

export function b64ToBlob(b64: string, type = "image/png"): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) return;
  const payload = await safeJson(response);
  const message = payload?.error?.message ?? `HTTP ${response.status}`;
  const code = payload?.error?.code ?? payload?.error?.type;

  if (response.status === 401) {
    throw new InvalidOpenAIKeyError(message);
  }
  if (response.status === 403) {
    throw new OpenAIForbiddenError(message);
  }
  if (response.status === 429) {
    throw new OpenAIRateLimitError();
  }
  if (
    response.status === 400 &&
    (code === "content_policy_violation" || /content[_ ]policy|moderation|safety/i.test(message))
  ) {
    throw new OpenAIContentPolicyError(message);
  }
  throw new OpenAIError(`OpenAI returned HTTP ${response.status}: ${message}`, response.status);
}

async function safeJson(response: Response): Promise<OpenAIErrorResponse | null> {
  try {
    return (await response.json()) as OpenAIErrorResponse;
  } catch {
    return null;
  }
}
