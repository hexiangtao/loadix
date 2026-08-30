# Loadix — Product Roadmap

Loadix is a browser-based HTTP API load & stress testing workbench
(Chrome extension + web app sharing one engine).

> **Positioning**: Loadix is *not* a replacement for JMeter / Gatling / k6.
> It is a lightweight, developer-friendly workbench for API development,
> regression, and moderate stress testing. The browser imposes concurrency,
> networking, CPU, and page-lifecycle limits that a distributed cluster does not.

---

## Phase 0 — Foundation (✅ done)

- Single-request load test: method / URL / headers / body / timeout
- Basic load model: virtual users, target RPS, duration, ramp-up
- Assertions: status / latency / body-contains
- `{{variable}}` interpolation
- Live metrics: requests / success / errors / RPS / avg / P95 / P99 / success rate
- Charts, status breakdown, recent requests
- History + config restore, JSON report export
- Engine in background service worker (survives tab close, fewer CORS issues)
- Shared engine + UI across extension & web (`EngineHost` abstraction)
- i18n (en / zh-CN / ja / ko / fr), light/dark theme
- CI (type-check / test / build / zip) + semantic-release + Cloudflare Pages

---

## Phase 1 — Professional metrics & auto-stop (in progress)

Goal: make the results dashboard genuinely professional, add safety guards.

- [x] Slowest requests (Top-N by latency)
- [x] Assertion failure breakdown (which rule + count)
- [x] P50 / P90 / Max latency percentiles
- [x] Max error rate → auto-stop
- [x] P95 over threshold → auto-stop
- [ ] Error detail aggregation (group by error message)

> Status: metrics panels and auto-stop guards are done. Only error detail
> aggregation remains (group errors by message, not just status code).

---

## Phase 2 — Load scheduling engine (core rewrite)

Goal: correctly separate **concurrency** from **RPS**, the foundation for
every advanced load model. This is the highest-priority architectural change.

> **Concurrency ≠ RPS.** Concurrency = number of simultaneous requests in
> flight. RPS = requests completed/started per second. A correct engine models
> them independently.

- [x] Load model types:
  - Constant Users (fixed VUs, each loops)
  - Constant RPS (paced launches, e.g. token bucket)
  - Ramp-up (users grow over time)
  - Step load (users step up at intervals)
  - Spike (sudden burst, hold, drop)
  - Soak (long constant run)
- [ ] Per-VU independent lifecycle (each VU owns its own session)
- [x] Precise RPS pacing (token bucket / leaky bucket, no shared-slot race)
- [x] Graceful stop + full AbortController cancellation
- [ ] Backpressure: prevent unbounded Promise accumulation
- [ ] Memory control for long runs (ring buffers, bounded history)

> Status: core scheduler rewritten (`load-model.ts` + `LoadEngine`). Concurrency
> and RPS are now independent (target-concurrency control loop + token bucket).
> Current models: `constant` and `ramp`. Step / Spike / Soak are future model
> kinds to add on top of this foundation. Per-VU session lifecycle, backpressure,
> and memory caps are still pending.

---

## Phase 3 — Variables & data-driven testing

- [ ] Environment variables (`{{xxx}}`, already partially present)
- [ ] JSONPath extraction: capture values from a response
- [ ] Pass extracted values to subsequent requests (token chaining)
- [ ] CSV data-driven testing (one row per iteration)
- [ ] Per-VU independent variables + random variables
- [ ] Think time / inter-request delay

---

## Phase 4 — Scenario / API chain

- [ ] Multi-step scenario (sequence of requests)
- [ ] Automatic token / cookie propagation between steps
- [ ] Scenario-level iteration & transaction metrics

---

## Phase 5 — Scripting & engineering (deferred / optional)

- [ ] Pre-request / post-response scripts (deferred — high complexity + JS security surface)
- [ ] Test plan import / export
- [ ] Web Worker engine for the web app (extension already runs in SW)
- [ ] Enhanced report export (HTML/PDF)

---

## Implementation order rationale

1. **Scheduling engine first** — every load model depends on it; doing Scenario
   or data-driven testing first would force a rewrite later.
2. **Variables/data-driven second** — JSONPath & CSV build on a stable scheduler.
3. **Scenario last** — it is a data-model change on top of 1 & 2.
4. **Scripting deferred** — highest complexity, lowest immediate value, security
   surface; revisit only if there is real demand.
