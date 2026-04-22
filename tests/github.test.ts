import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  base64ToUtf8,
  blobToBase64,
  buildSlug,
  fetchPublicManifest,
  publicImagePath,
  publicThumbPath,
  publishImage,
  rawImageUrl,
  rawManifestUrl,
  rawThumbUrl,
  siteGalleryUrl,
  siteImageUrl,
  siteViewerUrl,
  unpublishImage,
  utf8ToBase64,
  validateConfig,
} from "../src/lib/github";

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

describe("buildSlug", () => {
  it("combines date, slugified prompt and suffix", () => {
    const ts = new Date("2026-02-10T00:00:00Z").getTime();
    const slug = buildSlug("A sunset over Paris!", ts);
    expect(slug).toMatch(/^2026-02-10-a-sunset-over-paris-[a-z0-9]{1,6}$/);
  });

  it("falls back to 'panorama' for unusable prompts", () => {
    const ts = new Date("2026-02-10T00:00:00Z").getTime();
    const slug = buildSlug("***", ts);
    expect(slug).toMatch(/^2026-02-10-panorama-/);
  });

  it("truncates very long prompts to 40 chars", () => {
    const ts = new Date("2026-02-10T00:00:00Z").getTime();
    const slug = buildSlug("a".repeat(100), ts);
    const middle = slug.slice("2026-02-10-".length).split("-")[0];
    expect(middle.length).toBeLessThanOrEqual(40);
  });
});

describe("URL builders", () => {
  it("produces the expected raw/image/gallery/viewer URLs", () => {
    expect(publicImagePath("abc")).toBe("images/abc.webp");
    expect(publicThumbPath("abc")).toBe("thumbs/abc.webp");
    expect(rawImageUrl("alice", "abc")).toBe(
      "https://raw.githubusercontent.com/alice/360world-data/main/images/abc.webp",
    );
    expect(rawThumbUrl("alice", "abc")).toBe(
      "https://raw.githubusercontent.com/alice/360world-data/main/thumbs/abc.webp",
    );
    expect(rawManifestUrl("alice")).toBe(
      "https://raw.githubusercontent.com/alice/360world-data/main/index.json",
    );
    expect(siteImageUrl("alice", "abc")).toBe("/u/alice/abc.webp");
    expect(siteGalleryUrl("alice")).toBe("/u/alice");
    expect(siteViewerUrl("alice", "abc")).toBe("/u/alice/view/abc");
  });
});

describe("base64 helpers", () => {
  it("round-trips UTF-8 text", () => {
    const text = "héllo — 🌍 world";
    expect(base64ToUtf8(utf8ToBase64(text))).toBe(text);
  });

  it("blobToBase64 strips the data URL prefix", async () => {
    const blob = new Blob([new Uint8Array([104, 105])], { type: "text/plain" });
    const b64 = await blobToBase64(blob);
    expect(base64ToUtf8(b64)).toBe("hi");
  });
});

describe("validateConfig", () => {
  it("accepts a valid token with push access", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ login: "alice" }))
      .mockResolvedValueOnce(jsonResponse({ default_branch: "main", permissions: { push: true } }));
    const result = await validateConfig({ username: "alice", pat: "tok" });
    expect(result).toEqual({ ok: true, login: "alice", defaultBranch: "main" });
  });

  it("rejects a 401 response", async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(401));
    const result = await validateConfig({ username: "alice", pat: "bad" });
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/rejected/i) });
  });

  it("rejects when the token belongs to another user", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ login: "bob" }))
      .mockResolvedValueOnce(jsonResponse({ default_branch: "main" }));
    const result = await validateConfig({ username: "alice", pat: "tok" });
    expect(result).toEqual({
      ok: false,
      reason: expect.stringMatching(/belongs to "bob"/),
    });
  });

  it("rejects when the repo is not accessible", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ login: "alice" }))
      .mockResolvedValueOnce(emptyResponse(404));
    const result = await validateConfig({ username: "alice", pat: "tok" });
    expect(result).toEqual({
      ok: false,
      reason: expect.stringMatching(/not found/),
    });
  });

  it("rejects when the token has no push permission", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ login: "alice" }))
      .mockResolvedValueOnce(
        jsonResponse({ default_branch: "main", permissions: { push: false } }),
      );
    const result = await validateConfig({ username: "alice", pat: "tok" });
    expect(result).toEqual({
      ok: false,
      reason: expect.stringMatching(/read access only/i),
    });
  });

  it("surfaces network errors", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const result = await validateConfig({ username: "alice", pat: "tok" });
    expect(result).toEqual({ ok: false, reason: "offline" });
  });
});

describe("fetchPublicManifest", () => {
  it("returns empty manifest on 404", async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(404));
    const m = await fetchPublicManifest("alice");
    expect(m).toEqual({ version: 1, items: [] });
  });

  it("parses and normalizes items", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        version: 1,
        items: [
          { slug: "s1", prompt: "p1", finalPrompt: "f1", createdAt: 1 },
          { slug: "bad" }, // missing fields — filtered out
        ],
      }),
    );
    const m = await fetchPublicManifest("alice");
    expect(m.items).toEqual([{ slug: "s1", prompt: "p1", finalPrompt: "f1", createdAt: 1 }]);
  });

  it("throws on non-404 errors", async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(500));
    await expect(fetchPublicManifest("alice")).rejects.toThrow(/manifest/);
  });

  it("falls back to empty items when the payload is malformed", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ version: 1 }));
    const m = await fetchPublicManifest("alice");
    expect(m).toEqual({ version: 1, items: [] });
  });
});

describe("publishImage", () => {
  it("PUTs image, thumbnail and updated manifest (no preflight probes)", async () => {
    // PUT image
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }, { status: 201 }));
    // PUT thumb
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }, { status: 201 }));
    // GET manifest (needed to merge + sha) → 404
    fetchMock.mockResolvedValueOnce(emptyResponse(404));
    // PUT manifest
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }, { status: 201 }));

    const ts = new Date("2026-02-10T00:00:00Z").getTime();
    const result = await publishImage(
      { username: "alice", pat: "tok" },
      {
        image: new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }),
        thumbnail: new Blob([new Uint8Array([4, 5])], { type: "image/webp" }),
        prompt: "sunset",
        finalPrompt: "sunset, 360",
        createdAt: ts,
      },
    );

    expect(result.slug).toMatch(/^2026-02-10-sunset-/);
    expect(result.imageUrl).toBe(`/u/alice/${result.slug}.webp`);
    expect(result.viewerUrl).toBe(`/u/alice/view/${result.slug}`);
    expect(result.galleryUrl).toBe("/u/alice");

    const putCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(putCalls).toHaveLength(3);
    const manifestCall = putCalls[2]!;
    const body = JSON.parse(manifestCall[1]!.body as string);
    const manifest = JSON.parse(base64ToUtf8(body.content.replace(/\n/g, "")));
    expect(manifest.items[0]).toMatchObject({
      slug: result.slug,
      prompt: "sunset",
      finalPrompt: "sunset, 360",
      createdAt: ts,
    });
  });

  it("retries a 422 conflict with the existing sha", async () => {
    // PUT image → 422 (file already exists, we didn't send sha)
    fetchMock.mockResolvedValueOnce(new Response("conflict", { status: 422 }));
    // GET image → returns sha
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ sha: "sha-existing", content: "xxx", encoding: "base64" }),
    );
    // PUT image retry with sha → 200
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    // PUT thumb → 201
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }, { status: 201 }));
    // GET manifest → 404
    fetchMock.mockResolvedValueOnce(emptyResponse(404));
    // PUT manifest → 201
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }, { status: 201 }));

    await publishImage(
      { username: "alice", pat: "tok" },
      {
        image: new Blob([new Uint8Array([1])]),
        thumbnail: new Blob([new Uint8Array([2])]),
        prompt: "p",
        finalPrompt: "p",
        createdAt: new Date("2026-02-10T00:00:00Z").getTime(),
      },
    );

    const imagePuts = fetchMock.mock.calls.filter(
      ([url, init]) => init?.method === "PUT" && String(url).includes("images/"),
    );
    expect(imagePuts).toHaveLength(2);
    const firstBody = JSON.parse(imagePuts[0]![1]!.body as string);
    const retryBody = JSON.parse(imagePuts[1]![1]!.body as string);
    expect(firstBody.sha).toBeUndefined();
    expect(retryBody.sha).toBe("sha-existing");
  });

  it("throws a GithubError when a PUT fails with an unrelated status", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));

    await expect(
      publishImage(
        { username: "alice", pat: "tok" },
        {
          image: new Blob([new Uint8Array([1])]),
          thumbnail: new Blob([new Uint8Array([1])]),
          prompt: "x",
          finalPrompt: "x",
          createdAt: Date.now(),
        },
      ),
    ).rejects.toThrow(/PUT images/);
  });
});

describe("unpublishImage", () => {
  it("deletes image, thumbnail and rewrites the manifest", async () => {
    // getContent(image) → 200 with sha
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ sha: "sha-img", content: "xxx", encoding: "base64" }),
    );
    // getContent(thumb) → 200
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ sha: "sha-thumb", content: "xxx", encoding: "base64" }),
    );
    // DELETE image
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    // DELETE thumb
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    // getContent(manifest)
    const manifestBody = JSON.stringify({
      version: 1,
      items: [
        { slug: "target", prompt: "p", finalPrompt: "f", createdAt: 1 },
        { slug: "other", prompt: "p2", finalPrompt: "f2", createdAt: 2 },
      ],
    });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        sha: "sha-manifest",
        content: utf8ToBase64(manifestBody),
        encoding: "base64",
      }),
    );
    // PUT manifest
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await unpublishImage({ username: "alice", pat: "tok" }, "target");

    const deleteCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE");
    expect(deleteCalls).toHaveLength(2);

    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(putCall).toBeDefined();
    const body = JSON.parse(putCall![1]!.body as string);
    const manifest = JSON.parse(base64ToUtf8(body.content.replace(/\n/g, "")));
    expect(manifest.items.map((it: { slug: string }) => it.slug)).toEqual(["other"]);
    expect(body.sha).toBe("sha-manifest");
  });

  it("throws when DELETE fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sha: "sha-img", content: "x", encoding: "base64" }))
      .mockResolvedValueOnce(emptyResponse(404))
      .mockResolvedValueOnce(new Response("boom", { status: 409 }));

    await expect(unpublishImage({ username: "alice", pat: "tok" }, "target")).rejects.toThrow(
      /DELETE images/,
    );
  });

  it("skips DELETE when a file does not exist", async () => {
    fetchMock
      .mockResolvedValueOnce(emptyResponse(404)) // image not there
      .mockResolvedValueOnce(emptyResponse(404)) // thumb not there
      .mockResolvedValueOnce(emptyResponse(404)) // manifest not there
      .mockResolvedValueOnce(jsonResponse({ ok: true })); // PUT manifest

    await unpublishImage({ username: "alice", pat: "tok" }, "missing");
    const methods = fetchMock.mock.calls.map(([, init]) => init?.method ?? "GET");
    expect(methods).toEqual(["GET", "GET", "GET", "PUT"]);
  });
});
