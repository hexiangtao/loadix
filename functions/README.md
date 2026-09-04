# Share backend (Cloudflare Pages Functions + KV)

The Markdown tool can share a rendered document as a link
(`https://lab.loadix.dev/s/<id>`). The viewer (`share.html` — a separate,
lean Vite entry in the web build) fetches the stored **markdown source** and
re-renders it with the same engine the tool uses, so diagrams, math and
tables need no extra code on the receiving side.

## Layout

| Path | What it is |
| --- | --- |
| `functions/_lib/share-core.mjs` | All backend logic — framework-agnostic so Cloudflare, the local preview server and the unit tests share one implementation. |
| `functions/api/share.js` | `POST /api/share` route → `postShare(request, env.SHARE_KV)` |
| `functions/api/share/[id].js` | `GET /api/share/<id>` route → `getShare(id, env.SHARE_KV)` |
| `functions/_lib/share-core.test.mjs` | Unit tests (run by `npm test`, in-memory KV + real `Request` objects) |
| `src/web/public/_redirects` | `/s/*  →  /share.html 200` rewrite (keeps the URL in the browser so the viewer reads the id from the pathname) |
| `src/web/share.html`, `src/web/share-main.tsx` | The read-only viewer page |

KV record shape: `share:<id>` → `{ "source": string, "createdAt": number }`,
where `<id>` is an 8-character URL-safe token. Shares are **public by
design** (unguessable id, no auth) — the share dialog tells the user this.

## One-time Cloudflare setup (required before first deploy)

1. **Create the Pages project** (or connect the repo). Project name used by
   CI: `loadix-lab` (change `.github/workflows/ci.yml` if you pick another).
2. **Create the KV namespace**:
   `npx wrangler kv namespace create SHARE_KV`
3. **Bind it to the Pages project** — Cloudflare dashboard → the Pages
   project → *Settings → Functions → KV namespace bindings* → add
   `SHARE_KV`. Pages Functions read `env.SHARE_KV` from this binding;
   without it `/api/share` 500s.
4. **Add repo secrets** (GitHub → repo → Settings → Secrets → Actions):
   `CLOUDFLARE_API_TOKEN` (token with `cloudflare_pages:edit` +
   `workers_kv:edit` permissions) and `CLOUDFLARE_ACCOUNT_ID`.

After that, every push to `main` deploys the web app + functions via the
`deploy-web` job.

## Local development

The API needs no Cloudflare account locally: the core runs on any KV-shaped
store and the unit tests exercise it. To test the whole flow against the
built app, the preview server (`/.freebuff/serve-share.mjs`) serves
`dist/web/` and implements `/api/share` + the `/s/*` rewrite with the same
`share-core.mjs`, backed by an in-memory Map:

```bash
npm run build:web
node .freebuff/serve-share.mjs   # prints the preview URL
```

For the real runtime (`wrangler pages dev dist/web --kv SHARE_KV`), install
wrangler and point `--kv SHARE_KV` at a local namespace.

## API

- `POST /api/share` — body `{ "source": string }` (or raw markdown with
  `Content-Type: text/markdown`). Returns `201 { id, url: "/s/<id>" }`.
  400 for empty/malformed, 413 over the 1 MiB cap.
- `GET /api/share/<id>` — `200 { id, source, createdAt }` or `404
  { error: "not_found" }`.
