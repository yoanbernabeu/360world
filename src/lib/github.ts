import { GITHUB_REPO, type GithubConfig } from "./storage";

const GITHUB_API = "https://api.github.com";
const GITHUB_RAW = "https://raw.githubusercontent.com";
const DEFAULT_BRANCH = "main";
const MANIFEST_PATH = "index.json";
const IMAGES_DIR = "images";
const THUMBS_DIR = "thumbs";
const MANIFEST_VERSION = 1;

export class GithubError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GithubError";
    this.status = status;
  }
}

export type ManifestEntry = {
  slug: string;
  prompt: string;
  finalPrompt: string;
  createdAt: number;
};

export type Manifest = {
  version: number;
  items: ManifestEntry[];
};

export type PublishInput = {
  image: Blob;
  thumbnail: Blob;
  prompt: string;
  finalPrompt: string;
  createdAt: number;
};

export type PublishResult = {
  slug: string;
  imageUrl: string;
  thumbUrl: string;
  viewerUrl: string;
  galleryUrl: string;
};

export type ValidationResult =
  | { ok: true; login: string; defaultBranch: string }
  | { ok: false; reason: string };

export function buildSlug(prompt: string, createdAt: number): string {
  const slug =
    prompt
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "panorama";
  const date = new Date(createdAt).toISOString().slice(0, 10);
  const suffix = createdAt.toString(36).slice(-6);
  return `${date}-${slug}-${suffix}`;
}

export function publicImagePath(slug: string): string {
  return `${IMAGES_DIR}/${slug}.webp`;
}

export function publicThumbPath(slug: string): string {
  return `${THUMBS_DIR}/${slug}.webp`;
}

export function rawImageUrl(username: string, slug: string): string {
  return `${GITHUB_RAW}/${username}/${GITHUB_REPO}/${DEFAULT_BRANCH}/${publicImagePath(slug)}`;
}

export function rawThumbUrl(username: string, slug: string): string {
  return `${GITHUB_RAW}/${username}/${GITHUB_REPO}/${DEFAULT_BRANCH}/${publicThumbPath(slug)}`;
}

export function rawManifestUrl(username: string): string {
  return `${GITHUB_RAW}/${username}/${GITHUB_REPO}/${DEFAULT_BRANCH}/${MANIFEST_PATH}`;
}

export function siteImageUrl(username: string, slug: string): string {
  return `/u/${username}/${slug}.webp`;
}

export function siteGalleryUrl(username: string): string {
  return `/u/${username}`;
}

export function siteViewerUrl(username: string, slug: string): string {
  return `/u/${username}/view/${slug}`;
}

export async function validateConfig(config: GithubConfig): Promise<ValidationResult> {
  try {
    const userResp = await fetch(`${GITHUB_API}/user`, {
      headers: authHeaders(config.pat),
    });
    if (userResp.status === 401) {
      return { ok: false, reason: "Token rejected — check that it hasn't expired." };
    }
    if (!userResp.ok) {
      return { ok: false, reason: `GitHub /user returned ${userResp.status}.` };
    }
    const user = (await userResp.json()) as { login?: string };
    if (!user.login) {
      return { ok: false, reason: "GitHub /user returned no login." };
    }
    if (user.login.toLowerCase() !== config.username.toLowerCase()) {
      return {
        ok: false,
        reason: `Token belongs to "${user.login}", not "${config.username}".`,
      };
    }

    const repoResp = await fetch(`${GITHUB_API}/repos/${config.username}/${GITHUB_REPO}`, {
      headers: authHeaders(config.pat),
    });
    if (repoResp.status === 404) {
      return {
        ok: false,
        reason: `Repo "${config.username}/${GITHUB_REPO}" not found or not accessible with this token.`,
      };
    }
    if (!repoResp.ok) {
      return { ok: false, reason: `GitHub /repos returned ${repoResp.status}.` };
    }
    const repo = (await repoResp.json()) as {
      default_branch?: string;
      permissions?: { push?: boolean };
      private?: boolean;
      size?: number;
    };
    if (repo.permissions && repo.permissions.push !== true) {
      return {
        ok: false,
        reason: "Token has read access only — needs Contents: Read and write.",
      };
    }
    return {
      ok: true,
      login: user.login,
      defaultBranch: repo.default_branch ?? DEFAULT_BRANCH,
    };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

export async function fetchPublicManifest(username: string): Promise<Manifest> {
  // Prefer the Contents API: raw.githubusercontent.com caches for ~5 minutes,
  // which makes freshly-published worlds invisible. The API is fresher but is
  // rate-limited to 60 req/h per IP for anonymous callers — fall back to raw
  // (stale but unlimited) if we hit the limit.
  try {
    const resp = await fetch(
      `${GITHUB_API}/repos/${username}/${GITHUB_REPO}/contents/${MANIFEST_PATH}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
      },
    );
    if (resp.status === 404) {
      return { version: MANIFEST_VERSION, items: [] };
    }
    if (resp.status === 403 || resp.status === 429) {
      return fetchPublicManifestViaRaw(username);
    }
    if (!resp.ok) {
      throw new GithubError(`Could not load manifest (${resp.status}).`, resp.status);
    }
    const data = (await resp.json()) as { content?: string; encoding?: string };
    if (!data.content || data.encoding !== "base64") {
      return { version: MANIFEST_VERSION, items: [] };
    }
    const json = base64ToUtf8(data.content.replace(/\n/g, ""));
    return normalizeManifest(JSON.parse(json) as Manifest);
  } catch (err) {
    if (err instanceof GithubError) throw err;
    return { version: MANIFEST_VERSION, items: [] };
  }
}

async function fetchPublicManifestViaRaw(username: string): Promise<Manifest> {
  const resp = await fetch(rawManifestUrl(username), { cache: "no-store" });
  if (resp.status === 404) return { version: MANIFEST_VERSION, items: [] };
  if (!resp.ok) {
    throw new GithubError(`Could not load manifest (${resp.status}).`, resp.status);
  }
  const data = (await resp.json()) as Manifest;
  return normalizeManifest(data);
}

export async function publishImage(
  config: GithubConfig,
  input: PublishInput,
): Promise<PublishResult> {
  const slug = buildSlug(input.prompt, input.createdAt);
  const [imageBase64, thumbBase64] = await Promise.all([
    blobToBase64(input.image),
    blobToBase64(input.thumbnail),
  ]);

  await putContent(config, {
    path: publicImagePath(slug),
    contentBase64: imageBase64,
    message: `Publish ${slug}`,
  });
  await putContent(config, {
    path: publicThumbPath(slug),
    contentBase64: thumbBase64,
    message: `Publish thumb ${slug}`,
  });

  const manifestState = await readManifest(config);
  const items = manifestState.manifest.items.filter((it) => it.slug !== slug);
  items.unshift({
    slug,
    prompt: input.prompt,
    finalPrompt: input.finalPrompt,
    createdAt: input.createdAt,
  });
  const nextManifest: Manifest = { version: MANIFEST_VERSION, items };
  await putContent(config, {
    path: MANIFEST_PATH,
    contentBase64: utf8ToBase64(JSON.stringify(nextManifest, null, 2) + "\n"),
    message: `Update manifest for ${slug}`,
    sha: manifestState.sha,
  });

  return {
    slug,
    imageUrl: siteImageUrl(config.username, slug),
    thumbUrl: rawThumbUrl(config.username, slug),
    viewerUrl: siteViewerUrl(config.username, slug),
    galleryUrl: siteGalleryUrl(config.username),
  };
}

export async function unpublishImage(config: GithubConfig, slug: string): Promise<void> {
  const [imageMeta, thumbMeta] = await Promise.all([
    getContent(config, publicImagePath(slug)),
    getContent(config, publicThumbPath(slug)),
  ]);
  if (imageMeta) {
    await deleteContent(config, {
      path: publicImagePath(slug),
      sha: imageMeta.sha,
      message: `Unpublish ${slug}`,
    });
  }
  if (thumbMeta) {
    await deleteContent(config, {
      path: publicThumbPath(slug),
      sha: thumbMeta.sha,
      message: `Unpublish thumb ${slug}`,
    });
  }

  const manifestState = await readManifest(config);
  const items = manifestState.manifest.items.filter((it) => it.slug !== slug);
  const nextManifest: Manifest = { version: MANIFEST_VERSION, items };
  await putContent(config, {
    path: MANIFEST_PATH,
    contentBase64: utf8ToBase64(JSON.stringify(nextManifest, null, 2) + "\n"),
    message: `Update manifest after unpublish ${slug}`,
    sha: manifestState.sha,
  });
}

type ContentMeta = { sha: string; contentBase64: string | null };

async function getContent(config: GithubConfig, path: string): Promise<ContentMeta | null> {
  const resp = await fetch(contentUrl(config, path), {
    headers: authHeaders(config.pat),
    cache: "no-store",
  });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    throw new GithubError(`GET ${path} failed (${resp.status}).`, resp.status);
  }
  const data = (await resp.json()) as {
    sha: string;
    content?: string;
    encoding?: string;
  };
  return {
    sha: data.sha,
    contentBase64:
      data.encoding === "base64" && data.content ? data.content.replace(/\n/g, "") : null,
  };
}

async function readManifest(
  config: GithubConfig,
): Promise<{ manifest: Manifest; sha: string | undefined }> {
  const meta = await getContent(config, MANIFEST_PATH);
  if (!meta || !meta.contentBase64) {
    return { manifest: { version: MANIFEST_VERSION, items: [] }, sha: meta?.sha };
  }
  try {
    const json = base64ToUtf8(meta.contentBase64);
    const parsed = JSON.parse(json) as Manifest;
    return { manifest: normalizeManifest(parsed), sha: meta.sha };
  } catch {
    return { manifest: { version: MANIFEST_VERSION, items: [] }, sha: meta.sha };
  }
}

async function putContent(
  config: GithubConfig,
  body: { path: string; contentBase64: string; message: string; sha?: string },
): Promise<void> {
  const resp = await fetch(contentUrl(config, body.path), {
    method: "PUT",
    headers: {
      ...authHeaders(config.pat),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: body.message,
      content: body.contentBase64,
      branch: DEFAULT_BRANCH,
      sha: body.sha,
    }),
  });
  if (resp.ok) return;

  // If the file already exists, the PUT fails with 422 unless we supply a sha.
  // Fetch the existing sha and retry — this keeps the happy path free of preflight
  // probes and avoids 404 noise for first-time publishes.
  if (resp.status === 422 && !body.sha) {
    const existing = await getContent(config, body.path);
    if (existing) {
      return putContent(config, { ...body, sha: existing.sha });
    }
  }

  const text = await resp.text();
  throw new GithubError(`PUT ${body.path} failed (${resp.status}): ${text}`, resp.status);
}

async function deleteContent(
  config: GithubConfig,
  body: { path: string; sha: string; message: string },
): Promise<void> {
  const resp = await fetch(contentUrl(config, body.path), {
    method: "DELETE",
    headers: {
      ...authHeaders(config.pat),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: body.message,
      sha: body.sha,
      branch: DEFAULT_BRANCH,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new GithubError(`DELETE ${body.path} failed (${resp.status}): ${text}`, resp.status);
  }
}

function contentUrl(config: GithubConfig, path: string): string {
  return `${GITHUB_API}/repos/${config.username}/${GITHUB_REPO}/contents/${path}`;
}

function authHeaders(pat: string): Record<string, string> {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function normalizeManifest(data: Manifest | undefined): Manifest {
  if (!data || !Array.isArray(data.items)) {
    return { version: MANIFEST_VERSION, items: [] };
  }
  const items = data.items.filter(
    (it): it is ManifestEntry =>
      typeof it?.slug === "string" &&
      typeof it.prompt === "string" &&
      typeof it.finalPrompt === "string" &&
      typeof it.createdAt === "number",
  );
  return { version: MANIFEST_VERSION, items };
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result as string;
      const comma = value.indexOf(",");
      resolve(comma >= 0 ? value.slice(comma + 1) : value);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed."));
    reader.readAsDataURL(blob);
  });
}

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

export function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
