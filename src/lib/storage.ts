import { createStore, get, set, del, clear, keys } from "idb-keyval";
import type { OpenAIImageQuality, OpenAIImageSize } from "./openai";

const API_KEY_DB_NAME = "360world-key";
const IMAGES_DB_NAME = "360world-images";
const PREFS_DB_NAME = "360world-prefs";
const GITHUB_DB_NAME = "360world-github";
const STORE_NAME = "store";
const REPLICATE_KEY_FIELD = "replicate";
const OPENAI_KEY_FIELD = "openai";
const PROVIDER_FIELD = "provider";
const OPENAI_SIZE_FIELD = "openai-size";
const OPENAI_QUALITY_FIELD = "openai-quality";
const GITHUB_USERNAME_FIELD = "username";
const GITHUB_PAT_FIELD = "pat";

export const GITHUB_REPO = "360world-data";

const apiKeyDb = createStore(API_KEY_DB_NAME, STORE_NAME);
const imagesDb = createStore(IMAGES_DB_NAME, STORE_NAME);
const prefsDb = createStore(PREFS_DB_NAME, STORE_NAME);
const githubDb = createStore(GITHUB_DB_NAME, STORE_NAME);

export type Provider = "openai" | "replicate";
export const DEFAULT_PROVIDER: Provider = "openai";
export const DEFAULT_OPENAI_SIZE: OpenAIImageSize = "auto";
export const DEFAULT_OPENAI_QUALITY: OpenAIImageQuality = "high";

export type StoredImage = {
  id: string;
  prompt: string;
  finalPrompt: string;
  blob: Blob;
  contentType: string;
  createdAt: number;
  publishedSlug?: string;
};

type StoredImageRecord = {
  id: string;
  prompt: string;
  finalPrompt: string;
  bytes: ArrayBuffer;
  contentType: string;
  createdAt: number;
  publishedSlug?: string;
};

function makeKeyStore(field: string): {
  get: () => Promise<string | null>;
  set: (key: string) => Promise<void>;
  clear: () => Promise<void>;
} {
  return {
    async get(): Promise<string | null> {
      const value = await get<string>(field, apiKeyDb);
      return value ?? null;
    },
    async set(key: string): Promise<void> {
      const trimmed = key.trim();
      if (trimmed.length === 0) {
        throw new Error("API key cannot be empty.");
      }
      await set(field, trimmed, apiKeyDb);
    },
    async clear(): Promise<void> {
      await del(field, apiKeyDb);
    },
  };
}

export const apiKeyStore = makeKeyStore(REPLICATE_KEY_FIELD);
export const replicateApiKeyStore = apiKeyStore;
export const openaiApiKeyStore = makeKeyStore(OPENAI_KEY_FIELD);

export const preferencesStore = {
  async getProvider(): Promise<Provider> {
    const value = await get<Provider>(PROVIDER_FIELD, prefsDb);
    return value === "replicate" || value === "openai" ? value : DEFAULT_PROVIDER;
  },
  async setProvider(provider: Provider): Promise<void> {
    await set(PROVIDER_FIELD, provider, prefsDb);
  },
  async getOpenAISize(): Promise<OpenAIImageSize> {
    const value = await get<OpenAIImageSize>(OPENAI_SIZE_FIELD, prefsDb);
    return value ?? DEFAULT_OPENAI_SIZE;
  },
  async setOpenAISize(size: OpenAIImageSize): Promise<void> {
    await set(OPENAI_SIZE_FIELD, size, prefsDb);
  },
  async getOpenAIQuality(): Promise<OpenAIImageQuality> {
    const value = await get<OpenAIImageQuality>(OPENAI_QUALITY_FIELD, prefsDb);
    return value ?? DEFAULT_OPENAI_QUALITY;
  },
  async setOpenAIQuality(quality: OpenAIImageQuality): Promise<void> {
    await set(OPENAI_QUALITY_FIELD, quality, prefsDb);
  },
};

export const imagesStore = {
  async list(): Promise<StoredImage[]> {
    const ids = (await keys<string>(imagesDb)) as string[];
    const records = await Promise.all(ids.map((id) => get<StoredImageRecord>(id, imagesDb)));
    return records
      .filter((r): r is StoredImageRecord => Boolean(r))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(toStoredImage);
  },

  async get(id: string): Promise<StoredImage | null> {
    const record = await get<StoredImageRecord>(id, imagesDb);
    if (!record) return null;
    return toStoredImage(record);
  },

  async add(image: Omit<StoredImage, "id" | "createdAt">): Promise<StoredImage> {
    const bytes = await image.blob.arrayBuffer();
    const record: StoredImageRecord = {
      id: crypto.randomUUID(),
      prompt: image.prompt,
      finalPrompt: image.finalPrompt,
      bytes,
      contentType: image.contentType,
      createdAt: Date.now(),
      publishedSlug: image.publishedSlug,
    };
    await set(record.id, record, imagesDb);
    return toStoredImage(record);
  },

  async setPublishedSlug(id: string, slug: string | null): Promise<void> {
    const record = await get<StoredImageRecord>(id, imagesDb);
    if (!record) return;
    const next: StoredImageRecord = {
      ...record,
      publishedSlug: slug ?? undefined,
    };
    await set(id, next, imagesDb);
  },

  async remove(id: string): Promise<void> {
    await del(id, imagesDb);
  },

  async clear(): Promise<void> {
    await clear(imagesDb);
  },
};

function toStoredImage(record: StoredImageRecord): StoredImage {
  return {
    id: record.id,
    prompt: record.prompt,
    finalPrompt: record.finalPrompt,
    contentType: record.contentType,
    createdAt: record.createdAt,
    publishedSlug: record.publishedSlug,
    blob: new Blob([record.bytes], { type: record.contentType }),
  };
}

export type GithubConfig = {
  username: string;
  pat: string;
};

export const githubConfigStore = {
  async get(): Promise<GithubConfig | null> {
    const [username, pat] = await Promise.all([
      get<string>(GITHUB_USERNAME_FIELD, githubDb),
      get<string>(GITHUB_PAT_FIELD, githubDb),
    ]);
    if (!username || !pat) return null;
    return { username, pat };
  },

  async set(config: GithubConfig): Promise<void> {
    const username = config.username.trim();
    const pat = config.pat.trim();
    if (!username || !pat) {
      throw new Error("GitHub config requires a username and PAT.");
    }
    await set(GITHUB_USERNAME_FIELD, username, githubDb);
    await set(GITHUB_PAT_FIELD, pat, githubDb);
  },

  async clear(): Promise<void> {
    await Promise.all([del(GITHUB_USERNAME_FIELD, githubDb), del(GITHUB_PAT_FIELD, githubDb)]);
  },
};
