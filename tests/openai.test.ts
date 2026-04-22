import { describe, expect, it, vi } from "vitest";
import {
  InvalidOpenAIKeyError,
  OPENAI_ENDPOINT,
  OPENAI_MODEL,
  OpenAIContentPolicyError,
  OpenAIError,
  OpenAIGenerationFailedError,
  OpenAIRateLimitError,
  b64ToBlob,
  generate360Image,
} from "../src/lib/openai";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// 1x1 transparent PNG
const ONE_PX_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("generate360Image (OpenAI) — happy path", () => {
  it("posts the prefixed prompt with model, size and quality", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        created: 1700000000,
        data: [{ b64_json: ONE_PX_PNG_B64 }],
      }),
    );

    const result = await generate360Image({
      apiKey: "sk-test",
      prompt: "a ringed planet",
      size: "3840x2160",
      quality: "high",
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(OPENAI_ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");

    const sent = JSON.parse(String(init.body));
    expect(sent.model).toBe(OPENAI_MODEL);
    expect(sent.prompt).toBe("360 equirectangular image, a ringed planet");
    expect(sent.size).toBe("3840x2160");
    expect(sent.quality).toBe("high");
    expect(sent.n).toBe(1);

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe("image/png");
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.prompt).toBe("a ringed planet");
    expect(result.finalPrompt).toBe("360 equirectangular image, a ringed planet");
    expect(result.predictionId).toBe("openai_1700000000");
  });

  it("omits quality when not provided and forwards size=auto", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        data: [{ b64_json: ONE_PX_PNG_B64 }],
      }),
    );

    await generate360Image({
      apiKey: "sk",
      prompt: "x",
      size: "auto",
      fetchImpl: fetchMock,
    });

    const sent = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(sent.size).toBe("auto");
    expect(sent.quality).toBeUndefined();
  });

  it("downloads the URL when the response uses url instead of b64_json", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ url: "https://cdn.openai/img.png" }], created: 42 }),
      )
      .mockResolvedValueOnce(new Response(blob, { status: 200 }));

    const result = await generate360Image({
      apiKey: "sk",
      prompt: "x",
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe("https://cdn.openai/img.png");
    expect(result.blob.size).toBe(3);
  });
});

describe("generate360Image (OpenAI) — error handling", () => {
  it("throws InvalidOpenAIKeyError on HTTP 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "no" } }, 401));
    await expect(
      generate360Image({ apiKey: "bad", prompt: "x", fetchImpl: fetchMock }),
    ).rejects.toBeInstanceOf(InvalidOpenAIKeyError);
  });

  it("throws OpenAIForbiddenError on HTTP 403 with the server message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "Model not accessible for your account." } }, 403),
      );
    await expect(
      generate360Image({ apiKey: "ok", prompt: "x", fetchImpl: fetchMock }),
    ).rejects.toMatchObject({
      name: "OpenAIForbiddenError",
      message: expect.stringContaining("Model not accessible"),
    });
  });

  it("includes the server message in InvalidOpenAIKeyError when provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Invalid token" } }, 401));
    await expect(
      generate360Image({ apiKey: "bad", prompt: "x", fetchImpl: fetchMock }),
    ).rejects.toMatchObject({
      name: "InvalidOpenAIKeyError",
      message: expect.stringContaining("Invalid token"),
    });
  });

  it("throws OpenAIRateLimitError on HTTP 429", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "slow" } }, 429));
    await expect(
      generate360Image({ apiKey: "sk", prompt: "x", fetchImpl: fetchMock }),
    ).rejects.toBeInstanceOf(OpenAIRateLimitError);
  });

  it("throws OpenAIContentPolicyError on HTTP 400 content_policy_violation", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "content_policy_violation",
            message: "Your prompt violated the content policy.",
          },
        },
        400,
      ),
    );
    await expect(
      generate360Image({ apiKey: "sk", prompt: "x", fetchImpl: fetchMock }),
    ).rejects.toBeInstanceOf(OpenAIContentPolicyError);
  });

  it("throws OpenAIError on other non-2xx HTTP codes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "boom" } }, 500));
    await expect(
      generate360Image({ apiKey: "sk", prompt: "x", fetchImpl: fetchMock }),
    ).rejects.toMatchObject({ name: "OpenAIError", status: 500 });
  });

  it("throws OpenAIGenerationFailedError when data is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ data: [] }));
    await expect(
      generate360Image({ apiKey: "sk", prompt: "x", fetchImpl: fetchMock }),
    ).rejects.toBeInstanceOf(OpenAIGenerationFailedError);
  });

  it("throws OpenAIGenerationFailedError when item has neither b64 nor url", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ data: [{}] }));
    await expect(
      generate360Image({ apiKey: "sk", prompt: "x", fetchImpl: fetchMock }),
    ).rejects.toBeInstanceOf(OpenAIGenerationFailedError);
  });
});

describe("b64ToBlob", () => {
  it("decodes a base64 PNG into a Blob of the expected type", () => {
    const blob = b64ToBlob(ONE_PX_PNG_B64);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("accepts a custom mime type", () => {
    const blob = b64ToBlob(ONE_PX_PNG_B64, "image/webp");
    expect(blob.type).toBe("image/webp");
  });
});

describe("exports", () => {
  it("OpenAIError is a base class", () => {
    const err = new OpenAIError("oops", 500);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(500);
  });
});
