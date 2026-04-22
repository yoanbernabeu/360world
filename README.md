# 360World

Generate AI-made 360° equirectangular panoramas straight from your browser, then step inside them with an interactive viewer that supports mouse, touch _and_ the device gyroscope.

> **Bring your own key.** 360World never stores or sees your API tokens: they live in your browser's IndexedDB and are sent client-side to the provider you pick — either OpenAI (direct call) or Replicate (via a tiny CORS proxy).

## Features

- ✨ **Prompt → 360°** via `gpt-image-2` — OpenAI (direct call) or Replicate (proxied)
- 🎚️ **Size & quality selectors** when using OpenAI — up to 4K (3840×2160)
- 🖼️ **Photo Sphere Viewer** for drag, zoom, fullscreen and gyroscope navigation
- 📱 **Mobile-first** — gyroscope button, iOS permission flow handled
- 💾 **Local gallery** persisted in IndexedDB (Blobs, not base64)
- 🔐 **Zero backend secrets** — BYOK design, no accounts, no tracking
- 🧪 **Tested** — `src/lib/` covered ≥ 90% with mocked `fetch` and `fake-indexeddb`

## Stack

Astro 6 · TypeScript (strict) · Tailwind CSS 4 · Photo Sphere Viewer 5 · idb-keyval · Netlify Functions · Vitest.

## Get started in 30 seconds

```bash
npm install
npm run start            # netlify dev → http://localhost:8888
```

Then open the app, pick a provider and paste its key:

- **OpenAI** — grab a key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys). Called directly from the browser (CORS is allowed).
- **Replicate** — grab a token at [replicate.com/account/api-tokens](https://replicate.com/account/api-tokens). Routed through the `/.netlify/functions/replicate` proxy.

### Without Netlify

```bash
npm run dev              # Astro dev server only
```

OpenAI works fine with the plain Astro dev server (no proxy needed). Replicate requires the Netlify function because its API does not return CORS headers — use `netlify dev` locally and deploy to any platform with serverless functions and matching path.

## Project layout

```
src/
  lib/                Pure TS modules (tested)
    prompt.ts         buildPrompt — prefixes "360 equirectangular image, …"
    openai.ts         generate360Image (direct call) + size/quality types + typed errors
    replicate.ts      generate360Image (polled), fetchImageBlob + typed errors
    storage.ts        apiKeyStore + openaiApiKeyStore + preferencesStore + imagesStore
    download.ts       downloadBlob + suggestedFilename
  pages/
    index.astro       Landing page
    app.astro         Generator + viewer + gallery
  layouts/BaseLayout.astro
  styles/global.css   Tailwind + Photo Sphere Viewer CSS
netlify/functions/replicate.ts   CORS-only proxy (Replicate only)
tests/                Vitest specs (mocked fetch + fake-indexeddb)
```

## Scripts

| Script                  | What it does                                  |
| ----------------------- | --------------------------------------------- |
| `npm run dev`           | Astro dev server (no proxy)                   |
| `npm run start`         | `netlify dev` (Astro + functions, full setup) |
| `npm run build`         | Static build into `dist/`                     |
| `npm run preview`       | Preview the build locally                     |
| `npm run test`          | Run the unit test suite                       |
| `npm run test:watch`    | Watch mode                                    |
| `npm run test:coverage` | Run with v8 coverage                          |
| `npm run typecheck`     | Astro + TS type checking                      |
| `npm run lint`          | ESLint + Prettier check                       |
| `npm run format`        | Prettier write + ESLint --fix                 |

## Deploy

Push to a Git repo and connect Netlify — `netlify.toml` handles the rest. No environment variables to configure: the function never holds secrets.

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start)

## Privacy & security

- The Netlify function logs nothing (no body, no headers, no token). OpenAI calls don't hit it at all.
- Your tokens are stored in plain text inside this browser's IndexedDB (`360world-key` → `openai` / `replicate`). Anyone with access to your browser profile can read them. Don't use shared devices.
- Generated images live in `360world-images`; preferences (provider, size, quality) in `360world-prefs`. Use the Settings menu to clear or forget each key independently.
- No analytics, no cookies, no third-party scripts.

## FAQ

**OpenAI or Replicate — which one should I pick?**
Both run `gpt-image-2` and produce the same panoramas. OpenAI is faster (direct call, no proxy) and exposes explicit **size** (up to 4K) and **quality** selectors. Replicate keeps a fixed `3:2` preset but can be handy if you already have a Replicate account or want to self-host the proxy. You can save both keys and switch at any time from the app.

**Why the proxy for Replicate but not for OpenAI?**
Replicate doesn't return CORS headers, so a browser fetch is rejected — the Netlify function exists only to forward your `Authorization` header. OpenAI returns CORS headers on `api.openai.com`, so 360World calls it directly.

**Can the proxy steal my key?**
The proxy code is in `netlify/functions/replicate.ts`. It does not log, persist, or transform the header. Audit it, or self-host it on any serverless platform you trust. (Not involved for OpenAI.)

**Why IndexedDB instead of localStorage?**
Generated panoramas are multi-megabyte Blobs; localStorage would either choke or force base64 inflation. IndexedDB stores them natively.

**Can I encrypt the keys?**
Encryption without a user passphrase only adds friction — the decryption key would sit next to them. A passphrase mode is on the post-V1 wishlist.

## Contributing

Issues and pull requests are welcome. By participating in this project you agree to abide by its [Code of Conduct](./CODE_OF_CONDUCT.md).

## Author

Made by [Yoan Bernabeu](http://yoandev.co).

## License

MIT © 2026 Yoan Bernabeu — see [LICENSE](./LICENSE).
