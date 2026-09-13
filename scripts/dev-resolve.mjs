/**
 * Vite plugin: /api/resolve middleware for `npm run dev:web`.
 *
 * Reuses the exact production core (functions/_lib/media-resolve-core.mjs)
 * so dev, static preview, and Cloudflare all behave identically. Node's
 * http request/response is adapted to WHATWG Request/Response with the
 * tiny helpers below.
 */
import { handleResolve } from '../functions/_lib/media-resolve-core.mjs';

/** Node req → the subset of Request the core needs (plus rawBody). */
function toCoreRequest(req, rawBody) {
  const host = req.headers.host ?? 'localhost';
  const proto = req.socket?.encrypted ? 'https' : 'http';
  return {
    method: req.method ?? 'GET',
    url: `http://${host}${req.url ?? '/'}`,
    headers: { get: (name) => req.headers[String(name).toLowerCase()] ?? null },
    rawBody,
  };
}

/** Core Response → Node res. */
async function writeCoreResponse(coreResponse, res) {
  const status = coreResponse.status;
  coreResponse.headers.forEach((value, key) => res.setHeader(key, value));
  res.statusCode = status;
  if (status === 204) {
    res.end();
    return;
  }
  const body = await coreResponse.text();
  res.end(body);
}

function readBody(req) {
  return new Promise((resolveBody) => {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
      if (chunks.reduce((sum, c) => sum + c.length, 0) > 64 * 1024) req.destroy(); // cap
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', () => resolveBody(''));
  });
}

/** Vite plugin factory — configureServer adds the middleware. */
export function mediaResolvePlugin() {
  return {
    name: 'media-resolve-endpoint',
    configureServer(server) {
      server.middlewares.use('/api/resolve', (req, res) => {
        void (async () => {
          const rawBody = req.method === 'POST' ? await readBody(req) : undefined;
          try {
            const response = await handleResolve(toCoreRequest(req, rawBody));
            await writeCoreResponse(response, res);
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'middleware' }));
          }
        })();
      });
    },
  };
}
