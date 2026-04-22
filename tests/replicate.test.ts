import { describe, expect, it, vi } from "vitest";
import {
  GenerationFailedError,
  GenerationTimeoutError,
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

const noSleep = (): Promise<void> => Promise.resolve();

describe("generate360Image — start request", () => {
  it("posts the panorama-prefixed prompt and forwards the API key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
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
      sleep: noSleep,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(PROXY_ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer r8_test_key");

    const sentBody = JSON.parse(String(init.body));
    expect(sentBody.input.prompt).toBe("360 equirectangular image, a spatial station");
    expect(sentBody.input.aspect_ratio).toBe("3:2");
    expect(sentBody.input.output_format).toBe("webp");

    expect(result.url).toBe("https://cdn.replicate/img.webp");
    expect(result.prompt).toBe("a spatial station");
    expect(result.finalPrompt).toBe("360 equirectangular image, a spatial station");
    expect(result.predictionId).toBe("pred_1");
  });

  it("accepts a string output instead of an array", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
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
      sleep: noSleep,
    });
    expect(result.url).toBe("https://cdn.replicate/single.webp");
  });
});

describe("generate360Image — polling", () => {
  it("polls until the prediction succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ id: "pred_3", status: "starting", output: null, error: null }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: "pred_3", status: "processing", output: null, error: null }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: "pred_3", status: "processing", output: null, error: null }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "pred_3",
          status: "succeeded",
          output: ["https://cdn.replicate/done.webp"],
          error: null,
        }),
      );

    const progress: string[] = [];
    const result = await generate360Image({
      apiKey: "k",
      prompt: "x",
      fetchImpl: fetchMock,
      sleep: noSleep,
      onProgress: (e) => progress.push(e.status),
    });

    expect(result.url).toBe("https://cdn.replicate/done.webp");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const pollUrl = (fetchMock.mock.calls[1] as [string, RequestInit])[0];
    expect(pollUrl).toBe(`${PROXY_ENDPOINT}?id=pred_3`);
    const pollInit = (fetchMock.mock.calls[1] as [string, RequestInit])[1];
    expect(pollInit.method).toBe("GET");
    expect((pollInit.headers as Record<string, string>).Authorization).toBe("Bearer k");

    expect(progress).toContain("starting");
    expect(progress).toContain("processing");
    expect(progress).toContain("succeeded");
  });

  it("throws GenerationTimeoutError when polling exceeds the configured budget", async () => {
    let now = 0;
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      now += 5_000;
      return now;
    });

    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          jsonResponse({ id: "pred_4", status: "processing", output: null, error: null }),
        ),
      );

    await expect(
      generate360Image({
        apiKey: "k",
        prompt: "x",
        fetchImpl: fetchMock,
        sleep: noSleep,
        timeoutMs: 10_000,
      }),
    ).rejects.toBeInstanceOf(GenerationTimeoutError);

    dateSpy.mockRestore();
  });
});

describe("generate360Image — error handling", () => {
  it("throws InvalidApiKeyError on HTTP 401", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401));
    await expect(
      generate360Image({ apiKey: "bad", prompt: "x", fetchImpl: fetchMock, sleep: noSleep }),
    ).rejects.toBeInstanceOf(InvalidApiKeyError);
  });

  it("throws InvalidApiKeyError on HTTP 403", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ error: "forbidden" }, 403));
    await expect(
      generate360Image({ apiKey: "bad", prompt: "x", fetchImpl: fetchMock, sleep: noSleep }),
    ).rejects.toBeInstanceOf(InvalidApiKeyError);
  });

  it("throws RateLimitError on HTTP 429", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ error: "slow down" }, 429));
    await expect(
      generate360Image({ apiKey: "k", prompt: "x", fetchImpl: fetchMock, sleep: noSleep }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("throws ReplicateError on other non-2xx HTTP codes", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(
      generate360Image({ apiKey: "k", prompt: "x", fetchImpl: fetchMock, sleep: noSleep }),
    ).rejects.toMatchObject({ name: "ReplicateError", status: 500 });
  });

  it("throws GenerationFailedError when prediction status is failed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: "pred_5",
          status: "failed",
          output: null,
          error: "moderation blocked",
        }),
      );
    await expect(
      generate360Image({ apiKey: "k", prompt: "x", fetchImpl: fetchMock, sleep: noSleep }),
    ).rejects.toMatchObject({
      name: "GenerationFailedError",
      message: expect.stringContaining("moderation blocked"),
    });
  });

  it("throws GenerationFailedError when output is missing despite success", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        id: "pred_6",
        status: "succeeded",
        output: null,
        error: null,
      }),
    );
    await expect(
      generate360Image({ apiKey: "k", prompt: "x", fetchImpl: fetchMock, sleep: noSleep }),
    ).rejects.toBeInstanceOf(GenerationFailedError);
  });

  it("throws GenerationFailedError when start response omits an id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "starting", output: null, error: null }));
    await expect(
      generate360Image({ apiKey: "k", prompt: "x", fetchImpl: fetchMock, sleep: noSleep }),
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
