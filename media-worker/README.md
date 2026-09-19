# Loadix Media Worker

Standalone task API for media resolution and later yt-dlp/FFmpeg execution.

This first version contains the queue and protocol only. It intentionally does
not bundle a downloader binary or bypass DRM. The executor is injected into
`createMediaWorker({ executor })` and receives:

```js
{ taskId, url, signal }
```

It must return the normalized `ResolvedPageAsset` shape used by the dashboard.

## Run the protocol skeleton

```bash
node media-worker/server.mjs
```

The default executor returns `backend / media executor is not configured`.
That is intentional: deploying the API before configuring a downloader must
not pretend to resolve media.

## Enable the yt-dlp executor

Requires the `yt-dlp` binary on the host (or a path via
`MEDIA_WORKER_YTDLP_PATH`):

```bash
MEDIA_WORKER_EXECUTOR=ytdlp node media-worker/server.mjs
```

The executor runs `yt-dlp -J --no-warnings --no-playlist <url>` and normalizes
the JSON into the dashboard's `ResolvedPageAsset` format ladder — muxed files
first, video-only rows paired with the best audio track for the existing mux
step. Failures map onto the shared ResolveFailure taxonomy (login wall,
region lock, throttling), so the panel's advice works unchanged.

This is not a bypass tool: yt-dlp only reaches what an anonymous (or
cookie-provided) session may access. DRM content stays out of scope.

## API

```text
GET    /health
POST   /resolve                 { "url": "https://..." }
GET    /tasks/:taskId
DELETE /tasks/:taskId
GET    /download?url=<cdn-url>   streaming media proxy (Range-aware)
OPTIONS /*
```

`POST /resolve` returns `202` with a task id:

```json
{ "taskId": "media-...", "state": "queued" }
```

A task eventually becomes `succeeded`, `failed`, or `canceled`. Completed tasks
are retained in memory for 15 minutes by default and then removed. This is a
single-process experimental queue; production can replace the store with Redis,
Cloudflare Queues, or another durable broker without changing the HTTP shape.

## Streaming download proxy

`GET /download?url=<cdn-url>` pipes a media CDN response through the worker,
which matters when the CDN refuses the browser's request context:

- Bilibili's DASH video track needs a bilibili `Referer` no page can set;
- Douyin's CDN keys off a mobile User-Agent;
- some CDNs send no CORS headers, so a page cannot read the stream.

The proxy adds the right per-CDN headers, forwards `Range` requests so the
dashboard's resume logic keeps working, and streams the body without
buffering. It is allowlisted to known video CDN hosts only — never a general
open proxy. The dashboard's `proxiedByWorker(url)` builds these URLs.
