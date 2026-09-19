import { createServer } from 'node:http';
import { createMediaWorker } from './core.mjs';
import { createYtdlpExecutor } from './ytdlp-executor.mjs';

/**
 * Development/standalone entrypoint.
 *
 * MEDIA_WORKER_EXECUTOR=ytdlp enables the yt-dlp executor (requires the
 * yt-dlp binary on PATH or at MEDIA_WORKER_YTDLP_PATH); without it the
 * default intentionally reports not configured.
 */
const executor = process.env.MEDIA_WORKER_EXECUTOR === 'ytdlp'
  ? createYtdlpExecutor({
      ...(process.env.MEDIA_WORKER_YTDLP_PATH ? { ytDlpPath: process.env.MEDIA_WORKER_YTDLP_PATH } : {}),
    })
  : undefined;
const worker = createMediaWorker(executor ? { executor } : {});
const port = Number(process.env.MEDIA_WORKER_PORT ?? 8787);

const server = createServer(async (req, res) => {
  try {
    const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, {
      method: req.method,
      headers: req.headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req,
      duplex: 'half',
    });
    const response = await worker.handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(port, () => {
  console.log(`Loadix Media Worker listening on http://localhost:${port}`);
});
