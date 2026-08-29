# Loadix

Chrome Manifest V3 browser extension for authorized HTTP API load testing.

Built with [WXT](https://wxt.dev) + React + TypeScript, with i18n (English / 简体中文).

[中文文档](README.zh-CN.md) · [官网](https://Loadix.pages.dev)

[![CI](https://github.com/hexiangtao/loadix/actions/workflows/ci.yml/badge.svg)](https://github.com/hexiangtao/loadix/actions/workflows/ci.yml)

## Features
- HTTP GET/POST/PUT/PATCH/DELETE/HEAD
- URL, timeout, headers, JSON/form/text body
- Concurrent virtual users, target RPS, duration, ramp-up configuration
- Smoke / Normal / Stress / Spike presets
- Assertions: HTTP status, max latency, response body contains
- `{{variable}}` interpolation
- Real-time requests/success/errors/RPS/avg/P95/P99/success-rate
- Throughput and latency charts
- Status/error breakdown and recent requests
- Test history and config restore (`chrome.storage`)
- JSON report export
- Load engine runs in the background service worker (survives tab close, fewer CORS issues)

## Project Structure
```
src/
├── entrypoints/          # WXT entrypoints
│   ├── background.ts     # Service worker hosting the load engine
│   └── dashboard/        # React app (options page / workbench)
│       ├── App.tsx
│       ├── components/   # Reusable UI components
│       ├── panels/       # Config sections (request/load/assertions/...)
│       ├── i18n/         # i18next setup + locale files
│       └── store/        # Zustand UI state
├── engine/               # Load-testing engine (pure logic, unit-testable)
│   ├── core.ts           # Interpolation, percentiles, RPS scheduler, ramp-up
│   ├── runner.ts         # Single request execution + assertions
│   ├── metrics.ts        # Live metrics aggregation
│   ├── load-engine.ts    # Orchestrator (users, pacing, abort)
│   └── core.test.ts      # Vitest unit tests
└── shared/               # Types shared between UI and engine
```

## Development
```bash
npm install
npm run dev        # Start dev server with HMR, then load the extension once
npm run compile    # Type check
npm test           # Unit tests (engine)
npm run build      # Production build → .output/chrome-mv3
npm run zip        # Build + zip for store upload
```

### Load in Chrome
1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select `.output/chrome-mv3` (or the project root during `npm run dev`)
4. Click the extension icon to open the workbench

## Architecture Notes
- The dashboard talks to the engine over a `chrome.runtime.connect` port; metrics are pushed ~2×/sec and the UI re-syncs on refresh.
- Requests are executed in the background service worker. With `host_permissions: <all_urls>`, extension-initiated requests bypass CORS for most targets.
- The engine (`src/engine`) has zero DOM/chrome dependencies so it can be unit tested with Vitest.

## Important
Use this only against systems you own or are explicitly authorized to test. Browser-based load generation is not a replacement for distributed load-testing infrastructure.
