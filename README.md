# Loadix

**All-in-one developer toolkit — APIs and Markdown, local-first.**

Load testing, an API request client, Markdown preview &amp; sharing, and 19 everyday utilities — all in your browser. It runs as a web app (no install) or a Chrome extension, and both surfaces share the same engine.

No account, no telemetry: requests, documents and test runs stay in your browser (IndexedDB + local storage). The only network round-trips are the requests you send and the pages you choose to publish as share links.

Built with [WXT](https://wxt.dev) + React + TypeScript, with i18n (English / 简体中文 / 日本語 / 한국어 / Français).

[Website](https://loadix.dev) · [Launch](https://lab.loadix.dev) · [GitHub](https://github.com/hexiangtao/loadix)

[![CI](https://github.com/hexiangtao/loadix/actions/workflows/ci.yml/badge.svg)](https://github.com/hexiangtao/loadix/actions/workflows/ci.yml)

## What's inside

### Load Test

In-browser HTTP load and stress testing.

- **Five load shapes** — constant, ramp, step, spike and soak
- **Live metrics** — requests, RPS, errors, and latency percentiles (P50 / P95 / P99) with throughput and latency charts
- **Assertions** — HTTP status, max latency, body-contains, with a failure breakdown
- **Variables** — `{{variable}}` interpolation in URLs, headers and bodies
- **Reports** — export a JSON report or a self-contained HTML file
- In the extension the engine runs in the background service worker, so closing the tab doesn't stop a run; `host_permissions: <all_urls>` also exempts requests from CORS for most targets

### Requests

An API client built around real responses rather than raw walls of JSON.

- Start from a URL or a whole (even multi-line) cURL command
- **Response insights** — status, time, size and JSON shape at a glance, plus faster / slower comparison to the previous run
- **Environments** — dev / staging / prod variable scopes with nested `{{name}}` references, plus global and session (extracted) scopes; switch with one click
- **Tests tab** — response assertions (status, latency, body contains, JSONPath, header) with pass/fail chips after every send
- **Request chaining** — extract values from a response (JSONPath / regex / header) into the extracted scope, then reference them as `{{name}}` in later requests — login → token → CRUD flows work out of the box
- **Protocols** — GraphQL bodies (query + variables panes), plus WebSocket and SSE panels with live message logs
- **Free API directory** — 116 curated free APIs (sourced from the public-apis community list, MIT) with one-click **Try it**: search, filter by category/auth, star the ones you use into your own toolkit
- Organize with drafts, collections and history; import Postman v2.1 and **OpenAPI 3.0** (YAML or JSON), export either format
- Send any request straight to **Load Test**, or capture the response into a **Markdown** page as live documentation

### Markdown

A local Markdown workspace with live preview.

- Pages and folders with drag-and-drop organization; everything is stored locally in **IndexedDB**
- GFM tables and task lists, KaTeX math, Mermaid diagrams, highlighted code, collapsible outline
- Paste Markdown from anywhere — LLM output, notes, docs — and preview it immediately, no other tool needed
- **Share as a link** — publish any page to a public, unguessable URL rendered by the same engine (with title + Open Graph preview for Slack / Teams); no file to send
- Export a rendered page as PNG, or capture a live API response into the page

### Toolbox

19 single-purpose utilities behind one searchable palette (`Ctrl/⌘K`):

JWT · Base64 · URL Encode · URL Parser · Diff · Base Converter · HTML Entities · Unicode · Hash · JSON Formatter · SQL Formatter · Regex Tester · UUID Generator · Timestamp · Cron Parser · CSS Gradient · Color Picker · JSONPath · Element Snapshot

## Local-first

- **No account, no telemetry.** Nothing to register; no analytics SDK, no usage beacons.
- **Web or extension, same engine.** The web app needs nothing to install; the extension adds background load tests, CORS-free requests for most targets, and offline-capable tools.
- **Open source.** Everything — the engine, the persistence, and the share backend — is in this repository.

## Get started

**No install:** open [lab.loadix.dev](https://lab.loadix.dev), paste an endpoint, go.

**Chrome extension** (background engine, offline, CORS-free requests for most targets):

1. Grab the latest `loadix-*.zip` from [GitHub Releases](https://github.com/hexiangtao/loadix/releases)
2. Open `chrome://extensions/` and enable **Developer mode**
3. Click **Load unpacked** and select the unzipped folder

## Development

```bash
npm install
npm run dev        # Extension dev server with HMR
npm run dev:web    # Web-only dev (dashboard, no extension)
npm run compile    # Type check
npm test           # Unit tests (engine, stores, imports)
npm run build      # Extension build → .output/chrome-mv3
npm run build:web  # Web dashboard → dist/web
npm run zip        # Build + zip for store upload
```

## Project structure

```
src/
├── engine/                  # Load-test engine — pure TS, zero DOM/chrome deps
│   ├── core.ts              #   RPS scheduler, percentiles, interpolation
│   ├── load-model.ts        #   constant / ramp / step / spike / soak
│   ├── runner.ts            #   Single-request execution + assertions
│   ├── load-engine.ts       #   Orchestrator (load shapes, pacing, abort)
│   ├── metrics.ts           #   Live metrics aggregation
│   └── engine-host.ts       #   UI ⇄ engine contract (+ chrome/browser hosts)
├── entrypoints/
│   ├── background.ts        #   Service worker hosting the load engine
│   └── dashboard/           #   React app (all modules)
│       ├── App.tsx          #   Routing: loadtest / requests / markdown / tools
│       ├── api/             #   Requests module — client, stores, import,
│       │                    #     response insights, Markdown capture
│       ├── markdown/        #   Markdown module — doc tree, editor, preview,
│       │                    #     outline, share, IndexedDB store
│       ├── tools/           #   Toolbox — registry, ⌘K palette, tool components
│       ├── panels/          #   Load-test config panels
│       ├── components/      #   Shared UI — charts, result cards, dialogs
│       ├── store/           #   Zustand UI state
│       └── i18n/            #   en / zh-CN / ja / ko / fr
├── shared/                  # Types shared between engine, UI, web
└── web/                     # Share viewer (renders published pages)

functions/                   # Share backend (Cloudflare Pages Functions + KV)
site/                        # Marketing page (loadix.dev)
```

## Architecture notes

- **One engine, three surfaces.** The UI talks to the load engine over an `EngineHost` (`chrome.runtime.connect` in the extension, a browser host in the web build); metrics stream ~2×/sec and re-sync on refresh.
- **Shared render path.** Markdown preview, the share viewer, and server-side share pages render from the same core — what you preview is what a reader of a share link sees.
- **Bounded persistence.** History snapshots are capped and large bodies truncated to keep local storage healthy.
- **i18n.** `en`, `zh-CN`, `ja`, `ko`, `fr` ship by default; add strings under `src/entrypoints/dashboard/i18n/locales/`.

## Disclaimer

Use Loadix only against systems you own or are explicitly authorized to test. Browser-based load generation is not a replacement for distributed load-testing infrastructure.
