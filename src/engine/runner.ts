/** Single HTTP request execution with timeout + variable interpolation. */

import type { RequestResult, TestConfig } from '../shared/types';
import { assertionsPass, buildHeaders, interpolate } from './core';

export async function executeRequest(config: TestConfig, vars: Record<string, string>): Promise<RequestResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeout);
  const started = performance.now();
  try {
    const res = await fetch(interpolate(config.url, vars), {
      method: config.method,
      headers: buildHeaders(config, vars),
      body: config.method === 'GET' || config.method === 'HEAD' ? undefined : interpolate(config.body, vars),
      signal: controller.signal,
      cache: 'no-store',
    });
    const body = await res.text();
    return {
      status: res.status,
      ms: performance.now() - started,
      body,
      ok: res.ok,
      error: '',
      pass: false,
      ts: Date.now(),
    };
  } catch (e) {
    const err = e as Error;
    return {
      status: 0,
      ms: performance.now() - started,
      body: '',
      ok: false,
      error: err.name === 'AbortError' ? 'TIMEOUT' : err.message,
      pass: false,
      ts: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function executeAndAssert(config: TestConfig, vars: Record<string, string>): Promise<RequestResult> {
  const result = await executeRequest(config, vars);
  result.pass = assertionsPass(result, config.assertions);
  return result;
}
