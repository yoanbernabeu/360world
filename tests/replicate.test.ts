import { describe, expect, it, vi } from "vitest";
import {
  GenerationFailedError,
  InvalidApiKeyError,
  PROXY_ENDPOINT,
  RateLimitError,
  ReplicateError,
  fetchImageBlob,
  generate360Image,
} from "../src/lib/replicate";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("generate360Image", () => {
  it("posts to the proxy with bearer auth and the panorama-prefixed prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "pred_1",
        status: "succeeded",
        output: ["https://cdn.replicate/img.webp"],
        error: null,
      }),
    );

    const result = await generate360Image({
      apiKey: "r8_test_key",
      prompt: "a spatial station",
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(PROXY_ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer r8_test_key");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    const sentBody = JSON.parse(String(init.body));
    expect(sentBody.input.prompt).toBe("360 equirectangular image, a spatial station");
    expect(sentBody.input.aspect_ratio).toBe("3:2");
    expect(sentBody.input.output_format).toBe("webp");
    expect(sentBody.input.number_of_images).toBe(1);

    expect(result.url).toBe("https://cdn.replicate/img.webp");
    expect(result.prompt).toBe("a spatial station");
    expect(result.finalPrompt).toBe("360 equirectangular image, a spatial station");
  });

  it("accepts a string output instead of an array", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "pred_2",
        status: "succeeded",
        output: "https://cdn.replicate/single.webp",
        error: null,
      }),
    );
    const result = await generate360Image({
      apiKey: "k",
      prompt: "x",
      fetchImpl: fetchMock,
    });
    expect(result.url).toBe("https://cdn.replicate/single.webp");
  });

  it("throws InvalidApiKeyError on HTTP 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));
    await expect(
      generate360Image({ apiKey: "bad", prompt: "x", fetchImpl: fetchMock }),
    ).rejects.toBeInstanceOf(InvalidApiKeyError);
  });

  it("throws InvalidApiKeyError on HTTP 403", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "forbidden" }, 403));
    await expect(
      generate360Image({ apiKey: "bad", prompt: "x", fetchImpl: fetchMock }),
    ).rejects.toBeInstanceOf(InvalidApiKeyError);
  });

  it("throws RateLimitError on HTTP 429", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "slow down" }, 429));
    await expect(
      generate360Image({ apiKey: "k", prompt: "x", fetchImpl: fetchMock }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("throws ReplicateError on other non-2xx HTTP codes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(
      generate360Image({ apiKey: "k", prompt: "x", fetchImpl: fetchMock }),
    ).rejects.toMatchObject({ name: "ReplicateError", status: 500 });
  });

  it("throws GenerationFailedError when prediction status is failed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "pred_3",
        status: "failed",
        output: null,
        error: "moderation blocked",
      }),
    );
    await expect(
      generate360Image({ apiKey: "k", prompt: "x", fetchImpl: fetchMock }),
    ).rejects.toMatchObject({
      name: "GenerationFailedError",
      message: expect.stringContaining("moderation blocked"),
    });
  });

  it("throws GenerationFailedError when status is still processing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "pred_4",
        status: "processing",
        output: null,
        error: null,
      }),
    );
    await expect(
      generate360Image({ apiKey: "k", prompt: "x", fetchImpl: fetchMock }),
    ).rejects.toBeInstanceOf(GenerationFailedError);
  });

  it("throws GenerationFailedError when output is missing despite success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "pred_5",
        status: "succeeded",
        output: null,
        error: null,
      }),
    );
    await expect(
      generate360Image({ apiKey: "k", prompt: "x", fetchImpl: fetchMock }),
    ).rejects.toBeInstanceOf(GenerationFailedError);
  });
});

describe("fetchImageBlob", () => {
  it("downloads the URL and returns a Blob", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(blob, { status: 200 }));
    const result = await fetchImageBlob("https://cdn/img.webp", fetchMock);
    expect(result).toBeInstanceOf(Blob);
    expect(result.size).toBe(3);
  });

  it("throws ReplicateError on non-2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    await expect(fetchImageBlob("https://cdn/missing.webp", fetchMock)).rejects.toBeInstanceOf(
      ReplicateError,
    );
  });
});
