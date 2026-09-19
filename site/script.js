// Shared state across the page's inline modules.
const LX = { interacted: false, autotyping: false };

// ---- i18n: English / 简体中文 ----
const I18N = {
  en: {
    'nav.install': 'Install',
    'nav.launch': 'Launch',
    'hero.tw': 'Paste Markdown. Get a shareable page.',
    'hero.sub': 'Paste Markdown, get a shareable link. No account, no install.',
    'hero.cta': 'Launch Loadix',
    'hero.source': 'Source on GitHub',
    'demo.title': 'Loadix — live demo',
    'demo.tab.lt': 'Load Test',
    'demo.preview': 'Preview',
    'demo.copy': 'Copy share link',
    'demo.copied': 'Copied ✓',
    'demo.open': 'Open in Loadix ↗',
    'demo.start': 'Start',
    'demo.runningBtn': 'Running…',
    'demo.runAgain': 'Run again',
    'demo.ready': 'Ready',
    'demo.running': 'Running — {t}',
    'demo.complete': 'Complete — {req} requests, {err} errors',
    'demo.stat.req': 'Requests',
    'demo.stat.err': 'Errors',
    'modules.eyebrow': 'Modules',
    'mod1.num': '01 — Markdown',
    'mod1.title': 'Markdown',
    'mod1.tag': 'Paste Markdown from anywhere — render, keep and share it.',
    'mod1.li1': 'Render instantly: GFM · KaTeX · Mermaid',
    'mod1.li2': 'Stored locally in your browser',
    'mod1.li3': 'Share as a rendered link — no files to send',
    'mod1.li4': 'Capture a request response into the page',
    'shot1.title': 'Loadix · Markdown — split view',
    'shot.captured': 'captured live',
    'mod2.num': '02 — Requests',
    'mod2.title': 'Requests',
    'mod2.tag': 'Paste a URL or a cURL — read the insight card.',
    'mod2.li1': 'Status, time, size and shape at a glance',
    'mod2.li2': 'Faster / slower than the previous run',
    'mod2.li3': 'Drafts, collections and history',
    'mod2.li4': 'Postman v2.1 import · send to Load Test',
    'shot.send': 'Send',
    'shot.vsLast': '↘ 38 ms vs last run',
    'shot.latency': 'Latency',
    'shot.size': 'Size',
    'shot.shape': 'Shape',
    'mod3.num': '03 — Load test',
    'mod3.title': 'Load Test',
    'mod3.tag': 'Stress an endpoint from the browser and watch it live.',
    'mod3.li1': 'Constant, ramp, step, spike or soak',
    'mod3.li2': 'Live P50 / P95 / P99, RPS and errors',
    'mod3.li3': 'Assertions, variables and auto-stop',
    'mod3.li4': 'Keeps running in the background (extension)',
    'pill.constant': 'Constant',
    'pill.ramp': 'Ramp',
    'pill.step': 'Step',
    'pill.spike': 'Spike',
    'pill.soak': 'Soak',
    'shot.users': '120 users · 60 s',
    'shot.running': 'Running — 0:42 / 1:00',
    'mod4.num': '04 — Toolbox',
    'mod4.title': 'Toolbox',
    'mod4.tag': '19 single-purpose utilities behind one palette.',
    'mod4.li1': 'JWT · Base64 · URL parse & encode',
    'mod4.li2': 'JSON & SQL formatters · regex · hash',
    'mod4.li3': 'UUID · timestamp · cron · color',
    'mod4.li4': 'Every tool available at <code>Ctrl/⌘K</code>',
    'pal.navigate': 'navigate',
    'pal.open': 'open',
    'tools.eyebrow': 'Toolbox',
    'tool.urlEncode': 'URL Encode',
    'tool.urlParser': 'URL Parser',
    'tool.baseConverter': 'Base Converter',
    'tool.htmlEntities': 'HTML Entities',
    'tool.hash': 'Hash',
    'tool.jsonFormatter': 'JSON Formatter',
    'tool.sqlFormatter': 'SQL Formatter',
    'tool.diff': 'Diff',
    'tool.regex': 'Regex Tester',
    'tool.uuid': 'UUID Generator',
    'tool.timestamp': 'Timestamp',
    'tool.cron': 'Cron Parser',
    'tool.gradient': 'CSS Gradient',
    'tool.colorPicker': 'Color Picker',
    'tool.snapshot': 'Element Snapshot',
    'why.eyebrow': 'Why Loadix',
    'why1.h': 'No account',
    'why1.p': 'Open it and go. Nothing to register.',
    'why2.h': 'No telemetry',
    'why2.p': 'Your data stays in your browser.',
    'why3.h': 'Web or extension',
    'why3.p': 'Same engine. The extension adds background tests and CORS-free requests.',
    'install.eyebrow': 'Install',
    'install.step1': 'Open <code class="sh"><a href="https://lab.loadix.dev">lab.loadix.dev</a></code> — no install',
    'install.step2': 'Or grab <code class="sh">loadix-*.zip</code> from <a href="https://github.com/hexiangtao/loadix/releases" target="_blank" rel="noopener">GitHub Releases</a>',
    'install.step3': '<code class="sh">chrome://extensions</code> → Developer mode → Load unpacked',
    sample: `# Orders API

List **paid** orders with totals.

## Endpoint

\`GET /v1/orders?status=paid\`

## Response

\`\`\`json
{ "status": "paid", "total": 129.0, "items": 4 }
\`\`\`

| ID | Status | Total |
|----|--------|-------|
| o-104 | paid | 129.00 |
| o-109 | paid | 61.50 |`,
  },

  'zh-CN': {
    'nav.install': '安装',
    'nav.launch': '打开',
    'hero.tw': '把 Markdown 变成可以分享的页面',
    'hero.sub': '渲染和分享都在浏览器内完成。免注册，免安装。',
    'hero.cta': '打开 Loadix',
    'hero.source': 'GitHub 源码',
    'demo.title': 'Loadix · 在线演示',
    'demo.tab.lt': '压测',
    'demo.preview': '预览',
    'demo.copy': '复制分享链接',
    'demo.copied': '已复制 ✓',
    'demo.open': '在 Loadix 打开 ↗',
    'demo.start': '开始',
    'demo.runningBtn': '运行中…',
    'demo.runAgain': '重新运行',
    'demo.ready': '就绪',
    'demo.running': '运行中 · {t}',
    'demo.complete': '完成 · {req} 个请求，{err} 个错误',
    'demo.stat.req': '请求',
    'demo.stat.err': '错误',
    'modules.eyebrow': '核心功能',
    'mod1.num': '01 — Markdown',
    'mod1.title': 'Markdown',
    'mod1.tag': '任何来源的 Markdown，都能在这里渲染、保存和分享。',
    'mod1.li1': '即时渲染：GFM、KaTeX、Mermaid',
    'mod1.li2': '所有内容保存在本地浏览器',
    'mod1.li3': '一键生成分享链接，无需传输文件',
    'mod1.li4': '把接口响应直接存进文档',
    'shot1.title': 'Loadix · Markdown · 分栏视图',
    'shot.captured': '实时捕获',
    'mod2.num': '02 — Requests',
    'mod2.title': '请求',
    'mod2.tag': '粘贴 URL 或 cURL，返回结果一目了然。',
    'mod2.li1': '状态、耗时、大小、结构，直观呈现',
    'mod2.li2': '自动对比上一次运行的延迟变化',
    'mod2.li3': '草稿、集合、历史记录',
    'mod2.li4': '支持 Postman v2.1 导入，可直接转为压测',
    'shot.send': '发送',
    'shot.vsLast': '↘ 较上次快 38 ms',
    'shot.latency': '延迟',
    'shot.size': '大小',
    'shot.shape': '结构',
    'mod3.num': '03 — Load test',
    'mod3.title': '压测',
    'mod3.tag': '在浏览器中直接压测接口，实时查看指标。',
    'mod3.li1': 'Constant、Ramp、Step、Spike、Soak 五种模式',
    'mod3.li2': '实时显示 P50 / P95 / P99、RPS 和错误数',
    'mod3.li3': '断言、变量，错误率超标时自动停止',
    'mod3.li4': '安装扩展后，关闭标签页仍在后台运行',
    'pill.constant': 'Constant',
    'pill.ramp': 'Ramp',
    'pill.step': 'Step',
    'pill.spike': 'Spike',
    'pill.soak': 'Soak',
    'shot.users': '120 并发 · 60 秒',
    'shot.running': '运行中 · 0:42 / 1:00',
    'mod4.num': '04 — Toolbox',
    'mod4.title': '工具箱',
    'mod4.tag': '19 个工具各司其职，全部集中在同一个命令面板。',
    'mod4.li1': 'JWT、Base64、URL 编码解析',
    'mod4.li2': 'JSON / SQL 格式化、正则、哈希',
    'mod4.li3': 'UUID、时间戳、Cron、取色器',
    'mod4.li4': '所有工具都可通过 <code>Ctrl/⌘K</code> 直接唤起',
    'pal.navigate': '选择',
    'pal.open': '打开',
    'tools.eyebrow': '工具箱',
    'tool.urlEncode': 'URL 编码',
    'tool.urlParser': 'URL 解析',
    'tool.baseConverter': '进制转换',
    'tool.htmlEntities': 'HTML 实体',
    'tool.hash': '哈希',
    'tool.jsonFormatter': 'JSON 格式化',
    'tool.sqlFormatter': 'SQL 格式化',
    'tool.diff': 'Diff',
    'tool.regex': '正则测试',
    'tool.uuid': 'UUID 生成器',
    'tool.timestamp': '时间戳',
    'tool.cron': 'Cron 解析',
    'tool.gradient': 'CSS 渐变',
    'tool.colorPicker': '取色器',
    'tool.snapshot': '元素快照',
    'why.eyebrow': '为什么是 Loadix',
    'why1.h': '无需账号',
    'why1.p': '打开就能用，不需要注册登录。',
    'why2.h': '不上报数据',
    'why2.p': '你创建的内容只存在自己的浏览器里，不上传、不收集。',
    'why3.h': '网页版或扩展',
    'why3.p': '网页版和扩展功能完全一致。安装扩展后，压测可以在后台继续运行，访问接口不受跨域限制。',
    'install.eyebrow': '安装',
    'install.step1': '打开 <code class="sh"><a href="https://lab.loadix.dev">lab.loadix.dev</a></code> 即可使用，免安装',
    'install.step2': '或从 <a href="https://github.com/hexiangtao/loadix/releases" target="_blank" rel="noopener">GitHub Releases</a> 下载 <code class="sh">loadix-*.zip</code>',
    'install.step3': '<code class="sh">chrome://extensions</code> → 开发者模式 → 加载已解压的扩展程序',
    sample: `# 订单接口

列出**已支付**订单及总额。

## 端点

\`GET /v1/orders?status=paid\`

## 响应

\`\`\`json
{ "status": "paid", "total": 129.0, "items": 4 }
\`\`\`

| ID | 状态 | 总额 |
|----|--------|-------|
| o-104 | 已支付 | 129.00 |
| o-109 | 已支付 | 61.50 |`,
  },
};

let LANG = document.documentElement.lang === 'zh-CN' ? 'zh-CN' : 'en';

function t(key) {
  const dict = I18N[LANG] || {};
  if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
  return Object.prototype.hasOwnProperty.call(I18N.en, key) ? I18N.en[key] : '';
}

function applyLang(lang, initial) {
  LANG = lang === 'zh-CN' ? 'zh-CN' : 'en';
  try { localStorage.setItem('lx-lang', LANG); } catch (e) {}
  document.documentElement.lang = LANG;

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const v = t(el.dataset.i18n);
    if (v) el.textContent = v;
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const v = t(el.dataset.i18nHtml);
    if (v) el.innerHTML = v;
  });

  document.querySelectorAll('.lang-btn').forEach((b) => {
    b.classList.toggle('on', b.dataset.lang === LANG);
  });

  const tw = document.getElementById('typewriter');
  if (tw) tw.dataset.text = t('hero.tw');

  // Refresh the demo editor with the localized sample unless the user typed
  // in it or the autoplay showcase is mid-typing.
  const input = document.getElementById('demo-md-input');
  if (input && !LX.interacted && !LX.autotyping) {
    input.value = t('sample');
    input.dispatchEvent(new Event('input'));
  }

  if (!initial && LX.restartTypewriter) LX.restartTypewriter();
}

// ---- Theme (dark mode) ----
(function () {
  const btn = document.getElementById('theme-toggle');
  const meta = document.querySelector('meta[name="theme-color"]');

  function apply(dark) {
    document.documentElement.classList.toggle('dark', dark);
    if (meta) meta.setAttribute('content', dark ? '#0f0f0e' : '#ffffff');
  }

  apply(document.documentElement.classList.contains('dark'));

  if (btn) {
    btn.addEventListener('click', () => {
      const dark = !document.documentElement.classList.contains('dark');
      try { localStorage.setItem('lx-theme', dark ? 'dark' : 'light'); } catch (e) {}
      apply(dark);
    });
  }
})();

// ---- Language buttons ----
document.querySelectorAll('.lang-btn').forEach((b) => {
  b.addEventListener('click', () => applyLang(b.dataset.lang));
});

// Terminal typewriter effect: reveal lines one by one.
(function () {
  const lines = document.querySelectorAll('.term-lines .tline');
  let delay = 300; // initial pause before first line
  lines.forEach((line, i) => {
    if (line.classList.contains('blank')) {
      // Blank lines appear instantly-ish, no animation needed.
      setTimeout(() => line.classList.add('visible'), delay);
      delay += 60;
      return;
    }
    setTimeout(() => line.classList.add('visible'), delay);
    delay += 220;
  });
})();

// Scroll-reveal for feature cards.
(function () {
  const targets = document.querySelectorAll('.feature');
  if (!('IntersectionObserver' in window)) {
    targets.forEach((t) => t.classList.add('visible'));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 },
  );
  targets.forEach((t) => observer.observe(t));
})();

// ---- Interactive hero demo ----
(function () {
  const tabs = document.querySelectorAll('.demo-tab');
  const panes = document.querySelectorAll('.demo-pane');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((tt) => {
        tt.classList.toggle('on', tt === tab);
        tt.setAttribute('aria-selected', tt === tab ? 'true' : 'false');
      });
      panes.forEach((p) => p.classList.toggle('on', p.dataset.pane === tab.dataset.demo));
    });
  });

  // Markdown: live render + copy share link
  const input = document.getElementById('demo-md-input');
  const preview = document.getElementById('demo-md-preview');
  const copyBtn = document.getElementById('demo-copy-link');

  function render() {
    if (preview && input && window.marked) {
      preview.innerHTML = window.marked.parse(input.value);
    }
  }
  if (input) input.addEventListener('input', render);
  render();

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const text = 'https://lab.loadix.dev?tool=markdown';
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Clipboard API unavailable — fall back to a prompt.
        window.prompt(t('demo.copy') + ':', text);
      }
      copyBtn.textContent = t('demo.copied');
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = t('demo.copy');
        copyBtn.classList.remove('copied');
      }, 1600);
    });
  }

  // Load test: animated live run
  const startBtn = document.getElementById('demo-lt-start');
  const barsEl = document.getElementById('demo-lt-bars');
  const reqEl = document.getElementById('demo-lt-req');
  const rpsEl = document.getElementById('demo-lt-rps');
  const errEl = document.getElementById('demo-lt-err');
  const statusEl = document.getElementById('demo-lt-status');
  const dotEl = document.getElementById('demo-lt-dot');
  const p50El = document.getElementById('demo-lt-p50');
  const p95El = document.getElementById('demo-lt-p95');
  const p99El = document.getElementById('demo-lt-p99');

  const BAR_COUNT = 24;
  const RUN_MS = 10000;
  const TICK_MS = 400;

  // Pre-fill the chart with idle bars.
  for (let i = 0; i < BAR_COUNT; i++) {
    const b = document.createElement('i');
    b.style.height = '8%';
    barsEl.appendChild(b);
  }

  let running = false;
  let timer = null;

  function fmt(n) {
    return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
  }

  function startRun() {
    if (running) return;
    running = true;
    startBtn.textContent = t('demo.runningBtn');
    startBtn.disabled = true;
    statusEl.textContent = t('demo.running').replace('{t}', '0:00 / 0:10');
    statusEl.classList.add('grn');
    dotEl.style.animation = 'pulse 1.4s infinite';

    const bars = Array.from(barsEl.children);
    let req = 0;
    let err = 0;
    const rpsHistory = [];
    const latHistory = [];
    const start = performance.now();

    timer = setInterval(() => {
      const elapsed = performance.now() - start;
      const sec = Math.min(elapsed / 1000, RUN_MS / 1000);

      // Simulate a bursty-but-healthy load profile.
      const wave = 0.5 + 0.5 * Math.sin(sec / 1.6);
      const rps = 90 + Math.round(60 * wave + Math.random() * 20);
      const errThisTick = Math.random() < 0.02 ? 1 : 0;
      req += rps;
      err += errThisTick;
      rpsHistory.push(rps);
      latHistory.push(60 + Math.round(180 * wave + Math.random() * 60));

      reqEl.textContent = fmt(req);
      rpsEl.textContent = rps;
      errEl.textContent = err;
      errEl.classList.toggle('grn', err === 0);
      if (err > 0) errEl.classList.add('err');

      // Shift the chart left, push the newest bar on the right.
      bars.shift();
      const b = document.createElement('i');
      b.style.height = Math.max(6, Math.min(100, rps / 2.2)) + '%';
      b.classList.toggle('hot', errThisTick === 0);
      b.classList.toggle('err', errThisTick > 0);
      bars.push(b);
      barsEl.replaceChildren(...bars);

      // Percentiles from the latency history.
      const sorted = [...latHistory].sort((a, b2) => a - b2);
      const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
      p50El.textContent = 'P50 ' + p(0.5) + ' ms';
      p95El.textContent = 'P95 ' + p(0.95) + ' ms';
      p99El.textContent = 'P99 ' + p(0.99) + ' ms';

      const mm = String(Math.floor(sec)).padStart(2, '0');
      statusEl.textContent = t('demo.running').replace('{t}', '0:' + mm + ' / 0:10');

      if (elapsed >= RUN_MS) {
        clearInterval(timer);
        running = false;
        startBtn.textContent = t('demo.runAgain');
        startBtn.disabled = false;
        statusEl.textContent = t('demo.complete').replace('{req}', fmt(req)).replace('{err}', err);
        statusEl.classList.remove('grn');
        dotEl.style.animation = 'none';
      }
    }, TICK_MS);
  }

  if (startBtn) startBtn.addEventListener('click', startRun);
})();

// ---- Hero typewriter effect ----
(function () {
  const el = document.getElementById('typewriter');
  const caret = document.querySelector('.caret');
  if (!el || !caret) return;

  let timer = null;

  function run() {
    const text = t('hero.tw');
    let i = 0;
    clearTimeout(timer);
    caret.classList.add('is-visible');
    caret.style.opacity = '';
    el.textContent = '';

    (function type() {
      if (i <= text.length) {
        el.textContent = text.slice(0, i);
        i += 1;

        if (i <= text.length) {
          timer = setTimeout(type, 42);
          return;
        }

        timer = setTimeout(() => {
          caret.classList.remove('is-visible');
          caret.style.opacity = '0';
        }, 180);
      }
    })();
  }

  LX.restartTypewriter = run;

  // Delay the first visible cursor so the page doesn't feel jumpy on load.
  timer = setTimeout(run, 420);
})();

// ---- Auto-play demo showcase ----
(function () {
  const markdownTab = document.querySelector('[data-demo="markdown"]');
  const loadTab = document.querySelector('[data-demo="loadtest"]');
  const input = document.getElementById('demo-md-input');
  const copyBtn = document.getElementById('demo-copy-link');
  const startBtn = document.getElementById('demo-lt-start');
  const tabs = document.querySelectorAll('.demo-tab');

  if (!markdownTab || !loadTab || !input || !copyBtn || !startBtn) return;

  let userInteracted = false;
  let autoplayTimer = null;

  // Any manual interaction pauses the showcase so it never fights the user.
  function onUserInteract() {
    userInteracted = true;
    LX.interacted = true;
    clearTimeout(autoplayTimer);
  }
  tabs.forEach((tb) => tb.addEventListener('click', onUserInteract));
  input.addEventListener('input', onUserInteract);
  copyBtn.addEventListener('click', onUserInteract);
  startBtn.addEventListener('click', onUserInteract);

  // Type the markdown into the editor, live-rendering as it goes.
  function typeMarkdown(text, done) {
    let i = 0;
    LX.autotyping = true;
    input.value = '';
    input.dispatchEvent(new Event('input'));
    function step() {
      if (i <= text.length) {
        input.value = text.slice(0, i);
        input.dispatchEvent(new Event('input'));
        i++;
        setTimeout(step, 7);
      } else {
        LX.autotyping = false;
        done();
      }
    }
    step();
  }

  function play() {
    if (userInteracted) return;

    // 1) Markdown tab: type the sample, then copy the share link.
    markdownTab.click();
    typeMarkdown(t('sample'), () => {
      autoplayTimer = setTimeout(() => {
        if (userInteracted) return;
        copyBtn.click();

        // 2) Switch to Load Test and start the run.
        autoplayTimer = setTimeout(() => {
          if (userInteracted) return;
          loadTab.click();
          autoplayTimer = setTimeout(() => {
            if (userInteracted) return;
            startBtn.click();
            // 3) Wait for the ~10s run, then loop.
            autoplayTimer = setTimeout(play, 11000);
          }, 700);
        }, 1500);
      }, 1000);
    });
  }

  // Start the showcase after the headline typewriter settles.
  autoplayTimer = setTimeout(play, 2600);
})();

// Apply the initial language (head script already set <html lang>).
applyLang(LANG, true);
