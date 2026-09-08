/**
 * RealtimePanel — WebSocket and SSE debugging surfaces for the Requests
 * module (protocol switcher above the HTTP client).
 *
 * WebSocket: native browser API, full duplex — connect, watch frames in a
 * live log, send text payloads, disconnect. Binary frames are shown with a
 * size note.
 *
 * SSE: `EventSource` can't send custom headers, so the stream is read with
 * fetch + ReadableStream and the `text/event-stream` framing is parsed
 * here — that also makes it abortable (Stop) and allows auth headers.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Braces, Plug, PlugZap, Send, Trash2 } from 'lucide-react';

export type RealtimeMode = 'websocket' | 'sse';

interface LogEntry {
  id: number;
  dir: 'in' | 'out' | 'info' | 'error';
  time: string;
  text: string;
}

interface RealtimePanelProps {
  mode: RealtimeMode;
}

let logSeq = 0;

export function RealtimePanel({ mode }: RealtimePanelProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [sseHeaders, setSseHeaders] = useState(''); // one `Name: value` per line (SSE only)
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [input, setInput] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  const push = useCallback((dir: LogEntry['dir'], text: string) => {
    setLog((prev) => [...prev.slice(-499), { id: ++logSeq, dir, time: new Date().toLocaleTimeString(), text }]);
  }, []);

  // Auto-scroll to the newest entry.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  // Cleanup on unmount / mode switch.
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      abortRef.current?.abort();
    };
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    setConnected(false);
    setConnecting(false);
    push('info', mode === 'websocket' ? t('api.wsDisconnected') : t('api.sseStopped'));
  }, [mode, push, t]);

  const connectWs = useCallback(() => {
    if (!url.trim() || connecting) return;
    setConnecting(true);
    push('info', `${t('api.wsConnecting')} ${url.trim()}`);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url.trim());
    } catch (e) {
      push('error', e instanceof Error ? e.message : String(e));
      setConnecting(false);
      return;
    }
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      setConnecting(false);
      push('info', t('api.wsOpen'));
    };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') push('in', e.data);
      else push('in', `${t('api.wsBinary')} (${e.data.size ?? e.data.byteLength ?? '?'} B)`);
    };
    ws.onerror = () => {
      push('error', t('api.wsError'));
    };
    ws.onclose = (e) => {
      setConnected(false);
      setConnecting(false);
      if (wsRef.current === ws) wsRef.current = null;
      push('info', `${t('api.wsClosed')} (${e.code})`);
    };
  }, [url, connecting, push, t]);

  const connectSse = useCallback(() => {
    if (!url.trim() || connecting) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setConnecting(true);
    push('info', `${t('api.sseConnecting')} ${url.trim()}`);
    const headers: Record<string, string> = {};
    for (const line of sseHeaders.split('\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    void (async () => {
      try {
        const res = await fetch(url.trim(), { headers, signal: controller.signal, cache: 'no-store' });
        if (!res.ok || !res.body) {
          push('error', `${t('api.sseHttpError')} ${res.status} ${res.statusText}`);
          setConnecting(false);
          return;
        }
        setConnected(true);
        setConnecting(false);
        push('info', `${t('api.sseOpen')} ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let eventName = 'message';
        let dataLines: string[] = [];
        const flushEvent = () => {
          if (dataLines.length > 0) {
            const data = dataLines.join('\n');
            push('in', eventName === 'message' ? data : `[${eventName}] ${data}`);
          }
          dataLines = [];
          eventName = 'message';
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) !== -1 || (sep = buffer.indexOf('\r\n\r\n')) !== -1) {
            const block = buffer.slice(0, sep).trim();
            buffer = buffer.slice(sep + 2);
            for (const line of block.split(/\r?\n/)) {
              if (line.startsWith('event:')) eventName = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
              else if (line.startsWith('id:')) dataLines.push(`[id:${line.slice(3).trim()}]`);
              else if (line.startsWith('retry:')) dataLines.push(`[retry:${line.slice(6).trim()}]`);
              else if (line.trim() === '') flushEvent();
            }
            flushEvent();
          }
        }
        flushEvent();
        push('info', t('api.sseClosed'));
      } catch (e) {
        if (controller.signal.aborted) push('info', t('api.sseStopped'));
        else push('error', e instanceof Error ? e.message : String(e));
      } finally {
        setConnected(false);
        setConnecting(false);
        abortRef.current = null;
      }
    })();
  }, [url, sseHeaders, connecting, push, t]);

  const handleConnect = () => {
    if (connected || connecting) disconnect();
    else if (mode === 'websocket') connectWs();
    else connectSse();
  };

  const send = () => {
    if (!input.trim()) return;
    if (mode === 'websocket') {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(input);
        push('out', input);
        setInput('');
      } else {
        push('error', t('api.wsNotConnected'));
      }
    }
    // SSE has no client→server channel; the send box is hidden in that mode.
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-panel">
      {/* ——— Connection bar ——— */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-3 py-2">
        <input
          ref={urlRef}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleConnect();
          }}
          placeholder={mode === 'websocket' ? 'wss://echo.websocket.events' : 'https://example.com/events'}
          spellCheck={false}
          className="field min-w-0 flex-1 !py-1.5 font-mono !text-xs"
        />
        {mode === 'sse' && (
          <input
            value={sseHeaders}
            onChange={(e) => setSseHeaders(e.target.value)}
            placeholder={t('api.sseHeadersPlaceholder')}
            spellCheck={false}
            title={t('api.sseHeadersTitle')}
            className="field w-48 shrink-0 !py-1.5 font-mono !text-[11px]"
          />
        )}
        <button
          onClick={handleConnect}
          disabled={!url.trim() && !connected && !connecting}
          className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ${
            connected ? 'danger-btn !px-3' : 'primary-btn'
          } ${!url.trim() && !connected && !connecting ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          {connected ? <PlugZap size={12} /> : <Plug size={12} />}
          {connected ? t('api.disconnect') : connecting ? t('api.connecting') : t('api.connect')}
        </button>
      </div>

      {/* ——— Log ——— */}
      <div className="app-scroller sb-hairline min-h-0 flex-1 overflow-y-auto bg-[#0d1117] font-mono text-[11.5px] leading-relaxed" ref={scrollerRef}>
        {log.length === 0 && (
          <p className="px-3 py-6 text-center text-[11.5px] text-[#8b949e]">
            {mode === 'websocket' ? t('api.wsEmptyHint') : t('api.sseEmptyHint')}
          </p>
        )}
        {log.map((entry) => (
          <div key={entry.id} className="flex gap-2 border-b border-white/5 px-3 py-1">
            <span className="shrink-0 select-none text-[10px] text-[#484f58]">{entry.time}</span>
            <span
              className={`shrink-0 select-none font-bold ${
                entry.dir === 'in' ? 'text-[#3fb950]' : entry.dir === 'out' ? 'text-[#58a6ff]' : entry.dir === 'error' ? 'text-[#f85149]' : 'text-[#8b949e]'
              }`}
            >
              {entry.dir === 'in' ? '←' : entry.dir === 'out' ? '→' : entry.dir === 'error' ? '✕' : '•'}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-[#c9d1d9]">{entry.text}</span>
          </div>
        ))}
      </div>

      {/* ——— Send box (WebSocket only — SSE is one-way) ——— */}
      {mode === 'websocket' && (
        <div className="flex shrink-0 items-center gap-1.5 border-t border-line px-3 py-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
            placeholder={t('api.wsSendPlaceholder')}
            spellCheck={false}
            className="field min-w-0 flex-1 !py-1.5 font-mono !text-xs"
          />
          <button
            onClick={send}
            disabled={!connected || !input.trim()}
            className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ${
              connected && input.trim() ? 'primary-btn' : 'cursor-not-allowed border border-line bg-panel text-muted opacity-50'
            }`}
          >
            <Send size={12} />
            {t('api.send')}
          </button>
          <button
            onClick={() => setLog([])}
            title={t('api.clearLog')}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-hover hover:text-danger"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
      {mode === 'sse' && (
        <div className="flex shrink-0 items-center justify-between border-t border-line px-3 py-1.5">
          <span className="flex items-center gap-1.5 text-[11px] text-muted">
            <Braces size={11} />
            {t('api.sseOneWayHint')}
          </span>
          <button
            onClick={() => setLog([])}
            title={t('api.clearLog')}
            className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted transition-colors duration-150 hover:bg-hover hover:text-danger"
          >
            <Trash2 size={12} />
            {t('api.clearLog')}
          </button>
        </div>
      )}
    </div>
  );
}