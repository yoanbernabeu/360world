import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  apiKeyStore,
  githubConfigStore,
  imagesStore,
  openaiApiKeyStore,
  preferencesStore,
  DEFAULT_PROVIDER,
  DEFAULT_OPENAI_QUALITY,
  DEFAULT_OPENAI_SIZE,
} from "../src/lib/storage";

async function reset(): Promise<void> {
  await apiKeyStore.clear();
  await openaiApiKeyStore.clear();
  await imagesStore.clear();
  await githubConfigStore.clear();
  await preferencesStore.setProvider(DEFAULT_PROVIDER);
  await preferencesStore.setOpenAISize(DEFAULT_OPENAI_SIZE);
  await preferencesStore.setOpenAIQuality(DEFAULT_OPENAI_QUALITY);
}

beforeEach(reset);
afterEach(reset);

describe("apiKeyStore", () => {
  it("returns null when no key is set", async () => {
    await expect(apiKeyStore.get()).resolves.toBeNull();
  });

  it("stores, retrieves and clears a key", async () => {
    await apiKeyStore.set("r8_abc");
    await expect(apiKeyStore.get()).resolves.toBe("r8_abc");
    await apiKeyStore.clear();
    await expect(apiKeyStore.get()).resolves.toBeNull();
  });

  it("trims surrounding whitespace before storing", async () => {
    await apiKeyStore.set("   r8_trimmed   ");
    await expect(apiKeyStore.get()).resolves.toBe("r8_trimmed");
  });

  it("rejects empty values", async () => {
    await expect(apiKeyStore.set("    ")).rejects.toThrow();
  });
});

describe("openaiApiKeyStore", () => {
  it("is independent of the Replicate key", async () => {
    await apiKeyStore.set("r8_replicate");
    await openaiApiKeyStore.set("sk-openai");
    await expect(apiKeyStore.get()).resolves.toBe("r8_replicate");
    await expect(openaiApiKeyStore.get()).resolves.toBe("sk-openai");
    await openaiApiKeyStore.clear();
    await expect(openaiApiKeyStore.get()).resolves.toBeNull();
    await expect(apiKeyStore.get()).resolves.toBe("r8_replicate");
  });

  it("rejects empty values", async () => {
    await expect(openaiApiKeyStore.set("   ")).rejects.toThrow();
  });
});

describe("preferencesStore", () => {
  it("returns the default provider when unset", async () => {
    await expect(preferencesStore.getProvider()).resolves.toBe(DEFAULT_PROVIDER);
  });

  it("persists and reads the provider", async () => {
    await preferencesStore.setProvider("replicate");
    await expect(preferencesStore.getProvider()).resolves.toBe("replicate");
    await preferencesStore.setProvider("openai");
    await expect(preferencesStore.getProvider()).resolves.toBe("openai");
  });

  it("persists and reads the OpenAI size and quality", async () => {
    await preferencesStore.setOpenAISize("3840x2160");
    await preferencesStore.setOpenAIQuality("medium");
    await expect(preferencesStore.getOpenAISize()).resolves.toBe("3840x2160");
    await expect(preferencesStore.getOpenAIQuality()).resolves.toBe("medium");
  });
});

describe("imagesStore", () => {
  it("returns an empty list when nothing is stored", async () => {
    await expect(imagesStore.list()).resolves.toEqual([]);
  });

  it("adds an image with a generated id and createdAt timestamp", async () => {
    const blob = new Blob([new Uint8Array([7, 8, 9])], { type: "image/webp" });
    const before = Date.now();
    const stored = await imagesStore.add({
      prompt: "ocean",
      finalPrompt: "360 equirectangular image, ocean",
      blob,
      contentType: "image/webp",
    });
    expect(stored.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(stored.createdAt).toBeGreaterThanOrEqual(before);
    expect(stored.blob.size).toBe(3);
  });

  it("returns images sorted by createdAt DESC", async () => {
    const a = await imagesStore.add({
      prompt: "a",
      finalPrompt: "fa",
      blob: new Blob(["a"]),
      contentType: "image/webp",
    });
    await new Promise((r) => setTimeout(r, 5));
    const b = await imagesStore.add({
      prompt: "b",
      finalPrompt: "fb",
      blob: new Blob(["b"]),
      contentType: "image/webp",
    });
    const list = await imagesStore.list();
    expect(list.map((x) => x.id)).toEqual([b.id, a.id]);
  });

  it("preserves Blob bytes", async () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const stored = await imagesStore.add({
      prompt: "p",
      finalPrompt: "fp",
      blob: new Blob([bytes], { type: "image/webp" }),
      contentType: "image/webp",
    });
    const fetched = await imagesStore.get(stored.id);
    expect(fetched).not.toBeNull();
    const buffer = await new Response(fetched!.blob).arrayBuffer();
    expect(Array.from(new Uint8Array(buffer))).toEqual(Array.from(bytes));
  });

  it("removes a single image", async () => {
    const a = await imagesStore.add({
      prompt: "a",
      finalPrompt: "fa",
      blob: new Blob(["a"]),
      contentType: "image/webp",
    });
    const b = await imagesStore.add({
      prompt: "b",
      finalPrompt: "fb",
      blob: new Blob(["b"]),
      contentType: "image/webp",
    });
    await imagesStore.remove(a.id);
    const list = await imagesStore.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(b.id);
  });

  it("clears all images", async () => {
    await imagesStore.add({
      prompt: "p",
      finalPrompt: "fp",
      blob: new Blob(["x"]),
      contentType: "image/webp",
    });
    await imagesStore.clear();
    await expect(imagesStore.list()).resolves.toEqual([]);
  });

  it("returns null for an unknown id", async () => {
    await expect(imagesStore.get("missing")).resolves.toBeNull();
  });

  it("tracks a publishedSlug when set via setPublishedSlug", async () => {
    const added = await imagesStore.add({
      prompt: "p",
      finalPrompt: "fp",
      blob: new Blob(["x"]),
      contentType: "image/webp",
    });
    await imagesStore.setPublishedSlug(added.id, "2026-01-01-p-abc");
    const fetched = await imagesStore.get(added.id);
    expect(fetched?.publishedSlug).toBe("2026-01-01-p-abc");

    await imagesStore.setPublishedSlug(added.id, null);
    const cleared = await imagesStore.get(added.id);
    expect(cleared?.publishedSlug).toBeUndefined();
  });

  it("ignores setPublishedSlug on an unknown id", async () => {
    await expect(imagesStore.setPublishedSlug("missing", "any")).resolves.toBeUndefined();
  });
});

describe("githubConfigStore", () => {
  it("returns null when nothing is configured", async () => {
    await expect(githubConfigStore.get()).resolves.toBeNull();
  });

  it("stores, retrieves and clears a config", async () => {
    await githubConfigStore.set({ username: "alice", pat: "tok" });
    await expect(githubConfigStore.get()).resolves.toEqual({
      username: "alice",
      pat: "tok",
    });
    await githubConfigStore.clear();
    await expect(githubConfigStore.get()).resolves.toBeNull();
  });

  it("trims whitespace and rejects empty fields", async () => {
    await githubConfigStore.set({ username: "  alice  ", pat: "  tok  " });
    await expect(githubConfigStore.get()).resolves.toEqual({
      username: "alice",
      pat: "tok",
    });
    await expect(githubConfigStore.set({ username: " ", pat: "tok" })).rejects.toThrow();
  });
});
