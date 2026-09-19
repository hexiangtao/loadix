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
      tabs.forEach((t) => {
        t.classList.toggle('on', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
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
        window.prompt('Copy your share link:', text);
      }
      copyBtn.textContent = 'Copied ✓';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = 'Copy share link';
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
    startBtn.textContent = 'Running…';
    startBtn.disabled = true;
    statusEl.textContent = 'Running — 0:00 / 0:10';
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
      const ss = String(Math.floor((sec % 1) * 60)).padStart(2, '0');
      statusEl.textContent = 'Running — 0:' + mm + ' / 0:10';

      if (elapsed >= RUN_MS) {
        clearInterval(timer);
        running = false;
        startBtn.textContent = 'Run again';
        startBtn.disabled = false;
        statusEl.textContent = 'Complete — ' + fmt(req) + ' requests, ' + err + ' errors';
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
  if (!el) return;
  const text = el.dataset.text || '';
  const speed = 42; // ms per character
  let i = 0;

  function type() {
    if (i <= text.length) {
      el.textContent = text.slice(0, i);
      i++;
      setTimeout(type, speed);
    }
  }

  // Let the page settle before the caret starts typing.
  setTimeout(type, 500);
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

  const SAMPLE = `# Orders API

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
| o-109 | paid | 61.50 |`;

  let userInteracted = false;
  let autoplayTimer = null;

  // Any manual interaction pauses the showcase so it never fights the user.
  function onUserInteract() {
    userInteracted = true;
    clearTimeout(autoplayTimer);
  }
  tabs.forEach((t) => t.addEventListener('click', onUserInteract));
  input.addEventListener('input', onUserInteract);
  copyBtn.addEventListener('click', onUserInteract);
  startBtn.addEventListener('click', onUserInteract);

  // Type the markdown into the editor, live-rendering as it goes.
  function typeMarkdown(text, done) {
    let i = 0;
    input.value = '';
    input.dispatchEvent(new Event('input'));
    function step() {
      if (i <= text.length) {
        input.value = text.slice(0, i);
        input.dispatchEvent(new Event('input'));
        i++;
        setTimeout(step, 7);
      } else {
        done();
      }
    }
    step();
  }

  function play() {
    if (userInteracted) return;

    // 1) Markdown tab: type the sample, then copy the share link.
    markdownTab.click();
    typeMarkdown(SAMPLE, () => {
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
