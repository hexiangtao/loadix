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

## API

```text
GET    /health
POST   /resolve                 { "url": "https://..." }
GET    /tasks/:taskId
DELETE /tasks/:taskId
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
