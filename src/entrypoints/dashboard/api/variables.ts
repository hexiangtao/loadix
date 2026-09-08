/**
 * Variable system for the Requests module.
 *
 * Three scopes, resolved with extracted > environment > global precedence
 * (extracted values win — they are runtime data from the last response):
 *
 *   - environments  dev / staging / prod, one active at a time
 *   - global        shared across environments (API keys, base URLs)
 *   - extracted     pulled from response bodies/headers by ExtractRule
 *
 * Values support nested references: `{{baseUrl}}/v2` where `baseUrl`
 * itself references another variable is resolved iteratively until stable.
 */

import { interpolate } from '@/engine/core';
import { queryJsonPath } from '@/engine/jsonpath';
import type { RawResponse } from '@/engine/runner';

export interface ApiEnvironment {
  id: string;
  name: string;
  vars: [string, string][];
  createdAt: number;
}

/** A response → variable extraction rule attached to a request. */
export interface ExtractRule {
  id: string;
  /** Variable name written to the extracted scope. */
  name: string;
  /** Where to pull from: parsed JSON body, raw body via regex, or a header. */
  kind: 'json' | 'regex' | 'header';
  /** JSONPath (json), regular expression (regex), or header name (header). */
  source: string;
  /** Capture group index for regex rules (1-based; 0 = whole match). */
  group?: number;
}

/** The three scopes that feed `{{name}}` interpolation. */
export interface VarScopes {
  env: [string, string][];
  global: [string, string][];
  extracted: [string, string][];
}

/** Merge scopes with precedence extracted > env > global (first wins). */
export function mergedVars(scopes: VarScopes): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [k, v] of scopes.global) if (k.trim()) merged[k.trim()] = v;
  for (const [k, v] of scopes.env) if (k.trim()) merged[k.trim()] = v;
  for (const [k, v] of scopes.extracted) if (k.trim()) merged[k.trim()] = v;
  return merged;
}

/**
 * Resolve `{{name}}` references allowing values to reference other
 * variables. Iterates until stable (max 5 passes) so chains like
 * `{{apiUrl}}/v1` with `apiUrl = https://{{host}}` resolve fully.
 */
export function interpolateNested(input: string, vars: Record<string, string>): string {
  let out = input;
  for (let pass = 0; pass < 5; pass++) {
    const next = interpolate(out, vars);
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Stringify an extracted value into a variable (objects become JSON). */
function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Apply a request's extraction rules to a received response. Rules run in
 * order; a rule that matches nothing is skipped (later rules can still
 * write their own variables).
 */
export function applyExtractRules(response: RawResponse, rules: ExtractRule[]): [string, string][] {
  const out: [string, string][] = [];
  let parsed: unknown = undefined;
  const bodyJson = (): unknown => {
    if (parsed === undefined) {
      try {
        parsed = response.body.trim() ? JSON.parse(response.body) : null;
      } catch {
        parsed = null;
      }
    }
    return parsed;
  };
  for (const rule of rules) {
    const name = rule.name.trim();
    if (!name || !rule.source.trim()) continue;
    let value: unknown;
    if (rule.kind === 'json') {
      value = queryJsonPath(bodyJson(), rule.source)[0];
    } else if (rule.kind === 'regex') {
      let re: RegExp;
      try {
        re = new RegExp(rule.source);
      } catch {
        continue;
      }
      const m = re.exec(response.body);
      if (!m) continue;
      const group = rule.group && rule.group > 0 ? rule.group : 0;
      value = m[group] ?? '';
    } else {
      const wanted = rule.source.trim().toLowerCase();
      const hit = response.headers.find(([k]) => k.toLowerCase() === wanted);
      if (!hit) continue;
      value = hit[1];
    }
    const str = stringifyValue(value);
    if (str) out.push([name, str]);
  }
  return out;
}

export function createEnvironment(name: string): ApiEnvironment {
  return { id: uid(), name, vars: [], createdAt: Date.now() };
}

/** Collision-safe id (same strategy as the markdown docStore). */
export function uid(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `env-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}