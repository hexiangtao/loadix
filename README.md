# Loadix

A local API workbench in your browser. Decode JWTs, parse URLs, format JSON, hash strings, generate UUIDs, parse cron, convert bases — and run load tests against your own APIs. All in your browser, no account, no install, no nothing.

Built with [WXT](https://wxt.dev) + React + TypeScript, with i18n (English / 简体中文 / 日本語 / 한국어 / Français).

[Website](https://loadix.dev) · [GitHub](https://github.com/hexiangtao/loadix)

[![CI](https://github.com/hexiangtao/loadix/actions/workflows/ci.yml/badge.svg)](https://github.com/hexiangtao/loadix/actions/workflows/ci.yml)

## What you get

- **17 everyday developer tools** — JWT, Base64, URL Parser, URL Encode, JSON Formatter, SQL Formatter, HTML Entities, Markdown, Regex Tester, Hash, UUID Generator, Timestamp, Cron Parser, Color Picker, JSONPath, Base Converter, CSS Gradient, plus the Diff Checker.
- **No account, no telemetry, no backend.** Your URLs, headers, payloads and test runs never leave the browser. Works offline once installed.
- **Browser-based HTTP load tester** — concurrent virtual users, target RPS, ramp-up, duration. Run from the background service worker, so closing the tab doesn't stop the test.
- **Open source, MIT licensed.** Audit anything you don't trust.

## The tools

### Encoders / decoders
- **JWT** — decode payloads, sign with HS256, verify signatures locally
- **Base64** — encode & decode Base64 strings
- **URL Parser** — decompose URLs, edit query parameters in place
- **URL Encode** — percent-encode & decode URL components
- **HTML Entities** — escape & unescape HTML entities
- **Hash** — MD5, SHA-1, SHA-256, SHA-512
- **Base Converter** — binary / octal / decimal / hexadecimal (BigInt, no precision loss)

### Formatters
- **JSON Formatter** — pretty-print, minify, validate
- **SQL Formatter** — pretty-print SQL queries
- **Markdown** — live-rendered preview
- **Diff Checker** — side-by-side / unified line diff (LCS-based)

### Tools
- **Regex Tester** — test patterns and extract capture groups
- **UUID Generator** — v1, v3, v4, v5, v7 (with namespace + name for v3 / v5)
- **Timestamp** — Unix epoch ↔ human date
- **Cron Parser** — read cron expressions, preview next runs
- **Color Picker** — HEX / RGB / HSL with native picker
- **JSONPath** — query JSON with the JSONPath expression language
- **CSS Gradient** — visual linear / radial gradient builder

## Load tester

A complete HTTP load testing tool, separate from the workbench:

- **Methods:** GET / POST / PUT / PATCH / DELETE / HEAD
- **Configuration:** URL, timeout, custom headers, JSON / form / text body
- **Load model:** virtual users, target RPS, duration, ramp-up
- **Presets:** Smoke / Normal / Stress / Spike
- **Assertions:** HTTP status, max latency, body-contains
- **Variables:** `{{variable}}` interpolation in URLs, headers, bodies
- **Live metrics:** requests, success, errors, RPS, avg, P50 / P95 / P99, success rate
- **Charts:** throughput / sec and latency
- **Recent requests, status / error breakdown, assertion failures**
- **History & export:** runs saved to `chrome.storage`, restore configs, export JSON reports
- **Runs in the background service worker** — survives tab close, fewer CORS issues thanks to `host_permissions: <all_urls>`

## Project structure

```
src/
├── entrypoints/          # WXT entrypoints
│   ├── background.ts     # Service worker hosting the load engine
│   └── dashboard/        # React app (workbench + load tester UI)
│       ├── App.tsx
│       ├── components/   # Reusable UI components
│       ├── panels/       # Config sections (request / load / assertions / …)
│       ├── tools/        # The developer tools
│       ├── i18n/         # i18next setup + locale files
│       └── store/        # Zustand UI state
├── engine/               # Load-testing engine (pure logic, unit-testable)
│   ├── core.ts           # Interpolation, percentiles, RPS scheduler, ramp-up
│   ├── runner.ts         # Single request execution + assertions
│   ├── metrics.ts        # Live metrics aggregation
│   ├── load-engine.ts    # Orchestrator (users, pacing, abort)
│   └── core.test.ts      # Vitest unit tests
└── shared/               # Types shared between UI and engine

site/                     # Static landing page (loadix.dev)
├── index.html
├── script.js
└── style.css
```

## Development

```bash
npm install
npm run dev        # Start dev server with HMR, then load the extension once
npm run dev:web    # Web-only dev (just the dashboard, no extension)
npm run compile    # Type check
npm test           # Unit tests (engine)
npm run build      # Production build → .output/chrome-mv3
npm run build:web  # Build the standalone web dashboard
npm run zip        # Build + zip for store upload
```

### Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select `.output/chrome-mv3` (or the project root during `npm run dev`)
4. Click the extension icon to open the workbench

### Or use the web build

The same dashboard is also published as a standalone web app — no Chrome install required. Visit [lab.loadix.dev](https://lab.loadix.dev) after running `npm run build:web`, or browse the prebuilt copy at [loadix.dev](https://loadix.dev).

## Architecture notes

- The dashboard talks to the load engine over a `chrome.runtime.connect` port; metrics are pushed ~2× / sec and the UI re-syncs on refresh.
- Requests are executed in the background service worker. With `host_permissions: <all_urls>`, extension-initiated requests bypass CORS for most targets.
- The engine (`src/engine`) has zero DOM / chrome dependencies so it can be unit tested with Vitest.
- Tools are registered in `src/entrypoints/dashboard/tools/registry.ts`; each tool lives in its own component file under `src/entrypoints/dashboard/tools/tools/`.
- Persisted input (per tool) is stored in `localStorage` under the `loadix-tool:` prefix via `usePersistedState`.

## Internationalization

Five locales ship by default — `en`, `zh-CN`, `ja`, `ko`, `fr`. Add or edit strings in `src/entrypoints/dashboard/i18n/locales/`. The active language falls back to English when a key is missing.

## Disclaimer

Use this only against systems you own or are explicitly authorized to test. Browser-based load generation is not a replacement for distributed load-testing infrastructure.
