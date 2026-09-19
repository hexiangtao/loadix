import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Braces } from 'lucide-react';
import { load as yamlLoadFn, dump as yamlDumpFn } from 'js-yaml';
import { ToolShell } from '../ToolShell';
import { CopyButton } from '../CopyButton';
import { usePersistedState } from '../usePersistedState';
import { jsonToTs } from './jsonToTs';
import { JsonTreeView } from './JsonTreeView';
import { JsonPathInput } from './JsonPathInput';

function locateJsonError(raw: string, e: unknown): string {
  if (!(e instanceof SyntaxError)) return '';
  // V8 messages look like "Unexpected token } in JSON at position 12".
  const m = /position (\d+)/.exec(e.message);
  if (!m) return '';
  const pos = Number(m[1]);
  const line = raw.slice(0, pos).split('\n').length;
  return `line ${line}, col ${pos}`;
}

type OutputTab = 'json' | 'yaml' | 'tree' | 'ts' | 'query';

// Module-level constants keep the tab ids out of className literals, which the
// design-system test otherwise reads as styling classes.
const OUTPUT_TABS: readonly OutputTab[] = ['json', 'yaml', 'tree', 'ts', 'query'];
const YAML_INPUT_TABS: readonly OutputTab[] = ['json', 'tree', 'query'];

interface JsonToolProps {
  /** Content routed from the smart-paste box (pre-fills the input). */
  initialPayload?: string;
}

export function JsonTool({ initialPayload }: JsonToolProps) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistedState('json.input', initialPayload ?? '');
  const [indent, setIndent] = useState(2);
  const [outputTab, setOutputTab] = usePersistedState<OutputTab>('json.outputTab', 'json');

  const parsedJson = useMemo(() => {
    if (!input.trim()) return { ok: true as const, value: null as unknown, error: '' };
    try {
      return { ok: true as const, value: JSON.parse(input) as unknown, error: '' };
    } catch (e) {
      return { ok: false as const, value: null as unknown, error: locateJsonError(input, e) };
    }
  }, [input]);

  const formatted = useMemo(() => {
    if (!parsedJson.ok) return '';
    return JSON.stringify(parsedJson.value, null, indent);
  }, [parsedJson, indent]);

  const minified = useMemo(() => {
    if (!parsedJson.ok || !input.trim()) return '';
    return JSON.stringify(parsedJson.value);
  }, [parsedJson, input]);

  const yamlOut = useMemo(() => {
    if (!parsedJson.ok || parsedJson.value == null) return '';
    try {
      return yamlDumpFn(parsedJson.value, { indent: 2, lineWidth: 120, noRefs: true });
    } catch {
      return '';
    }
  }, [parsedJson]);

  // YAML → JSON: the paste box accepts either format; the output tab decides.
  const parsedYaml = useMemo(() => {
    if (!input.trim()) return { ok: true as const, value: null as unknown, error: '' };
    try {
      return { ok: true as const, value: yamlLoadFn(input) as unknown, error: '' };
    } catch {
      return { ok: false as const, value: null as unknown, error: '' };
    }
  }, [input]);

  // The input is YAML when it parses as YAML but not as JSON — a common
  // hand-written YAML shape like `key:\n  - a`. JSON output then regenerates.
  const isYamlInput = !parsedJson.ok && parsedYaml.ok && typeof parsedYaml.value === 'object' && parsedYaml.value !== null;

  const effectiveValue = isYamlInput ? parsedYaml.value : parsedJson.ok ? parsedJson.value : null;

  const tsOut = useMemo(() => {
    if (effectiveValue == null || typeof effectiveValue !== 'object') return '';
    try {
      return jsonToTs(effectiveValue, { rootName: 'Api' });
    } catch {
      return '';
    }
  }, [effectiveValue]);

  const stats = useMemo(() => {
    if (effectiveValue == null) return null;
    const keys = countKeys(effectiveValue);
    const depth = maxDepth(effectiveValue);
    const bytes = new Blob([formatted || minified]).size;
    return { keys, depth, bytes };
  }, [effectiveValue, formatted, minified]);

  const outputText = isYamlInput
    ? JSON.stringify(parsedYaml.value, null, indent)
    : outputTab === 'yaml'
      ? yamlOut
      : formatted;

  const outputIsOk = isYamlInput || parsedJson.ok;
  const tabs = isYamlInput ? YAML_INPUT_TABS : OUTPUT_TABS;
  const activeTab: OutputTab = tabs.includes(outputTab) ? outputTab : tabs[0]!;

  return (
    <ToolShell icon={Braces} title={t('tools.json.name')}>
      <div className="mb-3 flex items-center gap-3">
        <div className="flex gap-1.5">
          {[2, 4].map((n) => (
            <button
              key={n}
              onClick={() => setIndent(n)}
              className={`rounded-lg px-3 py-1.5 text-xs transition-colors duration-150 ${
                indent === n ? 'bg-primary/10 font-semibold text-primary' : 'text-muted hover:bg-hover hover:text-ink'
              }`}
            >
              {n} {t('tools.json.spaces')}
            </button>
          ))}
        </div>
        {minified && <CopyButton text={minified} className="ml-auto" />}
      </div>

      <textarea
        autoFocus
        className="field min-h-[140px] w-full flex-1 resize-y font-mono text-sm"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder='{"hello":"world","nested":{"a":[1,2,3]}}'
      />

      {stats && (
        <p className="mt-2 text-xs text-muted">
          {t('tools.json.keys')}: <b>{stats.keys}</b> · {t('tools.json.depth')}: <b>{stats.depth}</b> ·{' '}
          {t('tools.json.size')}: <b>{formatBytes(stats.bytes)}</b>
        </p>
      )}

      {!parsedJson.ok && !isYamlInput && (
        <p className="mt-2 text-xs text-danger">
          {t('tools.json.invalid')}
          {parsedJson.error ? ` (${parsedJson.error})` : ''}
        </p>
      )}

      {outputIsOk && effectiveValue != null && (
        <div className="mt-4 flex items-center justify-between">
          <div className="flex flex-wrap gap-1.5">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setOutputTab(tab)}
                className={`rounded-lg px-3 py-1.5 text-xs uppercase transition-colors duration-150 ${
                  activeTab === tab
                    ? 'bg-primary/10 font-semibold text-primary'
                    : 'text-muted hover:bg-hover hover:text-ink'
                }`}
              >
                {tab.toUpperCase()}
              </button>
            ))}
            {isYamlInput && (
              <span className="self-center text-[11px] text-muted">YAML → JSON {t('tools.json.converted')}</span>
            )}
          </div>
          {outputText && <CopyButton text={outputText} />}
        </div>
      )}

      {outputIsOk && activeTab === 'tree' && effectiveValue != null && <JsonTreeView value={effectiveValue} />}

      {outputIsOk && activeTab === 'ts' && (
        <pre className="field mt-1.5 min-h-[140px] w-full flex-1 overflow-auto font-mono text-sm">
          {tsOut || '—'}
        </pre>
      )}

      {outputIsOk && activeTab === 'query' && <JsonPathInput value={effectiveValue} />}

      {outputIsOk && (activeTab === 'json' || activeTab === 'yaml') && (
        <pre className="field mt-1.5 min-h-[140px] w-full flex-1 overflow-auto font-mono text-sm">
          {outputText}
        </pre>
      )}
    </ToolShell>
  );
}

function countKeys(v: unknown): number {
  if (Array.isArray(v)) return v.reduce((n, x) => n + countKeys(x), 0);
  if (v && typeof v === 'object') {
    return Object.keys(v as object).length + Object.values(v as object).reduce((n, x) => n + countKeys(x), 0);
  }
  return 0;
}

function maxDepth(v: unknown, d = 0): number {
  if (v && typeof v === 'object') {
    const children = Object.values(v as object);
    if (!children.length) return d;
    return Math.max(...children.map((c) => maxDepth(c, d + 1)));
  }
  return d;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
