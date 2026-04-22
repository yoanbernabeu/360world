# 360World

Generate AI-made 360° equirectangular panoramas straight from your browser, then step inside them with an interactive viewer that supports mouse, touch _and_ the device gyroscope.

> **Bring your own key.** 360World never stores or sees your Replicate token: it lives in your browser's IndexedDB and is sent client-side to a tiny CORS proxy that simply forwards it to Replicate.

## Features

- ✨ **Prompt → 360°** via Replicate's `openai/gpt-image-2` model
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

Then open the app, paste a Replicate token (get one at [replicate.com/account/api-tokens](https://replicate.com/account/api-tokens)) and type a prompt.

### Without Netlify

```bash
npm run dev              # Astro dev server only — generation will fail (no proxy)
```

The `/.netlify/functions/replicate` proxy is required because Replicate's API does not return CORS headers. Use `netlify dev` locally and deploy to Netlify (or any platform with serverless functions and matching path).

## Project layout

```
src/
  lib/                Pure TS modules (tested)
    prompt.ts         buildPrompt — prefixes "360 equirectangular image, …"
    replicate.ts      generate360Image, fetchImageBlob + typed errors
    storage.ts        apiKeyStore + imagesStore (idb-keyval)
    download.ts       downloadBlob + suggestedFilename
  pages/
    index.astro       Landing page
    app.astro         Generator + viewer + gallery
  layouts/BaseLayout.astro
  styles/global.css   Tailwind + Photo Sphere Viewer CSS
netlify/functions/replicate.ts   CORS-only proxy
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

- The Netlify function logs nothing (no body, no headers, no token).
- Your token is stored in plain text inside this browser's IndexedDB (`360world` → `api-key`). Anyone with access to your browser profile can read it. Don't use shared devices.
- Generated images live next to it (`360world` → `images`). Use the Settings menu to clear either.
- No analytics, no cookies, no third-party scripts.

## FAQ

**Why not call Replicate directly from the browser?**
Replicate doesn't return CORS headers, so a browser fetch is rejected. The proxy is the smallest possible workaround — it only forwards your `Authorization` header.

**Can the proxy steal my key?**
The proxy code is in `netlify/functions/replicate.ts`. It does not log, persist, or transform the header. Audit it, or self-host it on any serverless platform you trust.

**Why IndexedDB instead of localStorage?**
Generated panoramas are multi-megabyte Blobs; localStorage would either choke or force base64 inflation. IndexedDB stores them natively.

**Can I encrypt the key?**
Encryption without a user passphrase only adds friction — the decryption key would sit next to it. A passphrase mode is on the post-V1 wishlist.

## Contributing

Issues and pull requests are welcome. By participating in this project you agree to abide by its [Code of Conduct](./CODE_OF_CONDUCT.md).

## Author

Made by [Yoan Bernabeu](http://yoandev.co).

## License

MIT © 2026 Yoan Bernabeu — see [LICENSE](./LICENSE).
