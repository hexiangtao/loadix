# Loadix

用于授权 HTTP API 负载测试的 Chrome Manifest V3 浏览器扩展。

基于 [WXT](https://wxt.dev) + React + TypeScript 构建，支持中英文（English / 简体中文）。

[English](README.md) · [官网](https://loadix.dev)

[![CI](https://github.com/hexiangtao/loadix/actions/workflows/ci.yml/badge.svg)](https://github.com/hexiangtao/loadix/actions/workflows/ci.yml)

## 功能特性
- HTTP GET/POST/PUT/PATCH/DELETE/HEAD
- 自定义 URL、超时、请求头、JSON/form/text 请求体
- 并发虚拟用户、目标 RPS、持续时间、升压（ramp-up）配置
- Smoke / Normal / Stress / Spike 预设
- 断言：HTTP 状态码、最大延迟、响应体包含文本
- `{{variable}}` 变量插值
- 实时指标：请求数 / 成功 / 错误 / RPS / 平均 / P95 / P99 / 成功率
- 吞吐量与延迟图表
- 状态/错误分布与最近请求
- 测试历史与配置恢复（`chrome.storage`）
- JSON 报告导出
- 压测引擎运行在后台 service worker（关闭标签页不中断、更少 CORS 问题）

## 项目结构
```
src/
├── entrypoints/          # WXT 入口
│   ├── background.ts     # 承载压测引擎的 service worker
│   └── dashboard/        # React 应用（工作台）
│       ├── App.tsx
│       ├── components/   # 可复用 UI 组件
│       ├── panels/       # 配置分区（请求/负载/断言/...）
│       ├── i18n/         # i18next 配置与语言包
│       └── store/        # Zustand UI 状态
├── engine/               # 压测引擎（纯逻辑，可单元测试）
│   ├── core.ts           # 插值、百分位、RPS 调度、升压
│   ├── runner.ts         # 单次请求执行 + 断言
│   ├── metrics.ts        # 实时指标聚合
│   ├── load-engine.ts    # 编排器（用户数、节流、中止）
│   └── core.test.ts      # Vitest 单元测试
└── shared/               # UI 与引擎共享的类型
```

## 开发
```bash
npm install
npm run dev        # 启动带 HMR 的 dev server，然后加载扩展一次
npm run compile    # 类型检查
npm test           # 引擎单元测试
npm run build      # 生产构建 → .output/chrome-mv3
npm run zip        # 构建并打包 zip（用于商店上传）
```

### 在 Chrome 中加载
1. 打开 `chrome://extensions/`
2. 开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择 `.output/chrome-mv3`（`npm run dev` 时也可选项目根目录）
4. 点击扩展图标打开工作台

## 架构说明
- 工作台通过 `chrome.runtime.connect` 端口与引擎通信；指标约每 0.5 秒推送一次，页面刷新后自动重新同步。
- 请求在后台 service worker 中执行。凭借 `host_permissions: <all_urls>`，扩展发起的请求可绕过大多数目标的 CORS 限制。
- 引擎（`src/engine`）零 DOM/chrome 依赖，可用 Vitest 进行单元测试。

## 重要提示
请仅对你拥有或明确授权测试的系统使用本工具。基于浏览器的负载生成不能替代分布式压测基础设施。
