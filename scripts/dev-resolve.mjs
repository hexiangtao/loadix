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

/**
 * Make outbound fetches follow a proxy from the environment — with a fallback.
 *
 * Node's global `fetch` ignores the OS proxy settings entirely: on a machine
 * with a Clash-style system proxy (127.0.0.1:7897) it answers
 * `UND_ERR_CONNECT_TIMEOUT` to every international host, while `curl` through
 * that same proxy gets a 200. Node 22 has no `--use-env-proxy` /
 * `NODE_USE_ENV_PROXY` (both are 24+, and this build rejects the flag), so the
 * dispatcher has to be set by hand.
 *
 * The fallback is the important half, and it was measured rather than assumed:
 * THIS machine's proxy `ECONNRESET`s every bilibili connection while reaching
 * YouTube perfectly, and direct access is the exact mirror image (YouTube
 * times out, bilibili answers 200). Routing every request one way therefore
 * cannot work — setting a global proxy agent broke 番剧 resolution outright
 * (`502 fetch failed`, while the same URLs succeeded direct). So: proxy first,
 * direct on a network-level failure. A proxy is not a superset of the direct
 * route.
 *
 * Only NETWORK failures fall back. An HTTP status is an answer, not a
 * transport problem, and re-sending a request because a server said 500 would
 * be a different (and much worse) behaviour.
 *
 * `undici` is already in the tree; if it is ever absent this stays direct
 * rather than refusing to start. The Cloudflare function never uses this path.
 */
async function installProxyFromEnv() {
  const proxy =
    process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
  if (!proxy) return;
  let Agent;
  let ProxyAgent;
  try {
    ({ Agent, ProxyAgent } = await import('undici'));
  } catch (err) {
    console.warn(`[media-resolve] HTTPS_PROXY set but undici is unavailable — going direct: ${err?.message ?? err}`);
    return;
  }
  // Both routes are explicit dispatchers. The fallback must NOT rely on the
  // process-global dispatcher: an earlier version of this file set that global
  // to the proxy, and because Vite restarts its server INSIDE the same Node
  // process, the stale global hijacked the "direct" retry — every request went
  // through the proxy anyway and 番剧 stayed broken with a 502.
  const viaProxy = new ProxyAgent(proxy);
  const viaNetwork = new Agent();
  const passthrough = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    try {
      return await passthrough(input, { ...init, dispatcher: viaProxy });
    } catch (error) {
      if (init?.signal?.aborted) throw error;
      // Named per host so the dev log says WHICH site the proxy cannot serve.
      let host = '';
      try {
        host = new URL(typeof input === 'string' ? input : (input?.url ?? '')).host;
      } catch {
        host = '(unparseable url)';
      }
      try {
        const response = await passthrough(input, { ...init, dispatcher: viaNetwork });
        console.log(`[media-resolve] proxy could not reach ${host} — direct answered ${response.status}`);
        return response;
      } catch (directError) {
        console.log(
          `[media-resolve] ${host} failed through the proxy AND direct: ${directError?.cause?.code ?? directError?.message}`,
        );
        throw directError;
      }
    }
  };
  console.log(`[media-resolve] outbound requests via proxy ${proxy}, with a direct fallback`);
}

/** Vite plugin factory — configureServer adds the middleware. */
export function mediaResolvePlugin() {
  return {
    name: 'media-resolve-endpoint',
    async configureServer(server) {
      await installProxyFromEnv();
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
