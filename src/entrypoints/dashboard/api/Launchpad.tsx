import { useRef, useState } from 'react';
import { ArrowRight, Braces, ChevronRight, ClipboardPaste, Globe, Terminal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ApiMethod, ApiRequest } from './apiTypes';
import { requestPatchFromInput } from './requestImport';

interface LaunchpadProps {
  onApply: (patch: Partial<ApiRequest>, send: boolean) => void;
}

const EXAMPLES: { id: string; method: ApiMethod; url: string; icon: typeof Globe; patch: Partial<ApiRequest> }[] = [
  { id: 'json', method: 'GET', url: 'https://jsonplaceholder.typicode.com/todos/1', icon: Braces, patch: { method: 'GET', url: 'https://jsonplaceholder.typicode.com/todos/1', params: [] } },
  { id: 'headers', method: 'GET', url: 'https://httpbin.org/headers', icon: Globe, patch: { method: 'GET', url: 'https://httpbin.org/headers', params: [] } },
  { id: 'post', method: 'POST', url: 'https://httpbin.org/post', icon: Terminal, patch: { method: 'POST', url: 'https://httpbin.org/post', params: [] } },
];

export function Launchpad({ onApply }: LaunchpadProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const apply = (value: string, send: boolean) => {
    try {
      setError('');
      onApply(requestPatchFromInput(value), send);
      if (!send) setInput('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setInput(text);
        setError('');
        inputRef.current?.focus();
      }
    } catch {
      inputRef.current?.focus();
    }
  };

  return (
    <div className="anim-rise mx-auto flex w-full max-w-2xl flex-col items-center px-5 py-8 sm:py-12">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-primary/15 bg-primary/8 text-primary shadow-sm">
        <ArrowRight size={21} />
      </div>
      <h2 className="text-center text-lg font-semibold tracking-tight text-ink">{t('api.launchTitle')}</h2>
      <p className="mt-1.5 max-w-md text-center text-[12px] leading-relaxed text-muted">{t('api.launchHint')}</p>

      <div className="mt-6 w-full rounded-2xl border border-line bg-panel p-1.5 shadow-sm transition-shadow duration-200 focus-within:border-primary/45 focus-within:shadow-[0_8px_28px_color-mix(in_srgb,var(--color-primary)_10%,transparent)]">
        <div className="flex items-center gap-2">
          <Globe size={16} className="ml-2 shrink-0 text-muted/60" />
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(e) => {
              setInput(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                apply(input, true);
              } else if (e.key === 'Enter' && !e.shiftKey && !input.includes('\n')) {
                e.preventDefault();
                apply(input, true);
              }
            }}
            placeholder={t('api.launchPlaceholder')}
            spellCheck={false}
            className="max-h-24 min-h-8 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-muted/55"
          />
          <button onClick={paste} title={t('api.launchPaste')} className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-primary">
            <ClipboardPaste size={15} />
          </button>
          <button onClick={() => apply(input, true)} disabled={!input.trim()} className="primary-btn flex shrink-0 items-center gap-1.5 !rounded-xl !px-3.5 !py-2 disabled:opacity-40">
            {t('api.launchSend')}
            <ArrowRight size={14} />
          </button>
        </div>
        {error && <div className="px-10 pb-1.5 text-[11px] text-danger">{error}</div>}
      </div>

      <div className="mt-7 flex w-full flex-col gap-2">
        <div className="px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted/65">{t('api.launchExamples')}</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {EXAMPLES.map(({ id, method, url, icon: Icon, patch }) => (
            <button
              key={id}
              onClick={() => onApply(patch, true)}
              className="group flex cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-panel px-3 py-2.5 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-hover text-muted transition-colors group-hover:bg-primary/10 group-hover:text-primary"><Icon size={14} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-semibold text-ink">{t(`api.example_${id}`)}</span>
                <span className="mt-0.5 block truncate font-mono text-[9.5px] text-muted/70">{method} · {url.replace('https://', '')}</span>
              </span>
              <ChevronRight size={13} className="shrink-0 text-muted/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </button>
          ))}
        </div>
      </div>
      <button onClick={() => inputRef.current?.focus()} className="mt-5 cursor-pointer text-[11px] text-muted transition-colors hover:text-primary">
        <Terminal size={12} className="mr-1 inline-block" />
        {t('api.launchCurlHint')}
      </button>
      {input && <button onClick={() => { setInput(''); setError(''); }} className="mt-2 cursor-pointer text-[11px] text-muted/65 hover:text-ink"><X size={11} className="mr-1 inline" />{t('api.cancel')}</button>}
    </div>
  );
}
