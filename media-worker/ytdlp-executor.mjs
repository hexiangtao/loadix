/**
 * yt-dlp executor for the standalone Media Worker.
 *
 * Runs `yt-dlp -J <url>` (dump single JSON) and normalizes the output into
 * the dashboard's `ResolvedPageAsset` shape, so the UI consumes worker
 * results without changes. yt-dlp itself is never bundled: the host machine
 * (or container) must provide the binary on PATH, or `ytDlpPath` must point
 * at it.
 *
 * Failure mapping follows the shared ResolveFailure taxonomy so the panel's
 * actionable advice (login wall / region lock / unsupported site) works for
 * worker results exactly as it does for the built-in adapters.
 */

import { spawn } from 'node:child_process';

/** Map yt-dlp's stderr vocabulary onto the shared failure taxonomy. */
function classifyYtdlpError(stderr) {
  const text = String(stderr).slice(0, 400);
  if (/sign in to confirm|login|cookies|account/i.test(text)) return { reason: 'login', detail: text };
  if (/private video|removed|unavailable|not available|geo|region/i.test(text)) return { reason: 'unavailable', detail: text };
  if (/429|too many requests|throttl/i.test(text)) return { reason: 'rate-limited', detail: text };
  if (/unsupported url|no video formats/i.test(text)) return { reason: 'no-format', detail: text };
  if (/timed out|aborted/i.test(text)) return { reason: 'network', detail: text };
  return { reason: 'blocked', detail: text };
}

/** Quality label from height/bitrates, mirroring the dashboard's format ladder. */
function qualityLabel(entry) {
  if (entry.height) return `${entry.height}p`;
  if (entry.vcodec && entry.vcodec === 'none' && entry.abr) return `${Math.round(entry.abr)}kbps`;
  return entry.format_note || entry.ext?.toUpperCase() || 'MP4';
}

function declaredBytes(entry) {
  const size = entry.filesize ?? entry.filesize_approx ?? 0;
  return Number.isFinite(size) && size > 0 ? size : 0;
}

/**
 * Pick the best audio track to pair with a video-only format. yt-dlp lists
 * audio entries separately (vcodec === 'none'); the dashboard's mux step
 * merges the pair on download, exactly like the native Bilibili DASH path.
 */
function bestAudio(formats) {
  let best = null;
  for (const entry of formats) {
    if (entry.vcodec !== 'none' || !entry.url) continue;
    const bytes = declaredBytes(entry);
    if (!best || (entry.abr ?? 0) > (best.abr ?? 0)) best = entry;
    void bytes;
  }
  return best;
}

export function normalizeYtdlpInfo(info, pageUrl) {
  const formatsRaw = info.formats ?? [];
  const usable = formatsRaw.filter((entry) => entry.url && entry.vcodec !== 'none');
  const audio = bestAudio(formatsRaw);

  const formats = usable.map((entry, index) => {
    const videoOnly = entry.acodec === 'none';
    const pair = videoOnly && audio ? audio : null;
    return {
      key: `ytdlp-${entry.format_id ?? index}`,
      container: entry.protocol === 'm3u8_native' || entry.ext === 'm3u8' ? 'hls' : 'mp4',
      quality: qualityLabel(entry),
      hasAudio: !videoOnly,
      size: declaredBytes(entry) + (pair ? declaredBytes(pair) : 0),
      url: entry.url,
      backupUrls: [],
      ...(pair
        ? { companionUrl: pair.url, companionBackupUrls: [] }
        : {}),
    };
  });

  // Complete files first, then bare tracks; better quality leads.
  formats.sort((a, b) =>
    Number(b.hasAudio) - Number(a.hasAudio) ||
    (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0) ||
    (b.size || 0) - (a.size || 0),
  );

  const dashOnly = formats.length > 0 && formats.every((format) => !format.hasAudio && !format.companionUrl);
  return {
    title: info.title?.trim() || info.id || pageUrl,
    cover: info.thumbnail,
    pageUrl,
    formats,
    ...(info.duration ? { durationSeconds: Math.round(info.duration) } : {}),
    dashOnly,
    notice: formats.length === 0 ? 'empty' : dashOnly ? 'dash-only' : '',
  };
}

function runYtdlp(binary, pageUrl, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['-J', '--no-warnings', '--no-playlist', pageUrl], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(error.code === 'ENOENT' ? { reason: 'backend', detail: `yt-dlp binary not found: ${binary}` } : { reason: 'backend', detail: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return;
      if (code === 0 && stdout.trim()) {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject({ reason: 'backend', detail: 'yt-dlp produced unparseable JSON' });
        }
        return;
      }
      reject(classifyYtdlpError(stderr));
    });
  });
}

export function createYtdlpExecutor(options = {}) {
  const ytDlpPath = options.ytDlpPath ?? 'yt-dlp';
  const timeoutMs = Math.max(5_000, options.timeoutMs ?? 60_000);

  return async function ytdlpExecutor({ url, signal }) {
    const info = await runYtdlp(ytDlpPath, url, timeoutMs, signal);
    const asset = normalizeYtdlpInfo(info, url);
    if (!asset.formats.length) {
      throw { reason: 'no-format', detail: 'yt-dlp found no downloadable formats' };
    }
    return asset;
  };
}
