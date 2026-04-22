import { createStore, get, set, del, clear, keys } from "idb-keyval";

const API_KEY_DB_NAME = "360world-key";
const IMAGES_DB_NAME = "360world-images";
const STORE_NAME = "store";
const API_KEY_FIELD = "replicate";

const apiKeyDb = createStore(API_KEY_DB_NAME, STORE_NAME);
const imagesDb = createStore(IMAGES_DB_NAME, STORE_NAME);

export type StoredImage = {
  id: string;
  prompt: string;
  finalPrompt: string;
  blob: Blob;
  contentType: string;
  createdAt: number;
};

type StoredImageRecord = {
  id: string;
  prompt: string;
  finalPrompt: string;
  bytes: ArrayBuffer;
  contentType: string;
  createdAt: number;
};

export const apiKeyStore = {
  async get(): Promise<string | null> {
    const value = await get<string>(API_KEY_FIELD, apiKeyDb);
    return value ?? null;
  },
  async set(key: string): Promise<void> {
    const trimmed = key.trim();
    if (trimmed.length === 0) {
      throw new Error("API key cannot be empty.");
    }
    await set(API_KEY_FIELD, trimmed, apiKeyDb);
  },
  async clear(): Promise<void> {
    await del(API_KEY_FIELD, apiKeyDb);
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
    };
    await set(record.id, record, imagesDb);
    return toStoredImage(record);
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
    blob: new Blob([record.bytes], { type: record.contentType }),
  };
}
