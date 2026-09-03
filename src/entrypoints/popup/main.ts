/**
 * Loadix action popup — the capture launcher behind the toolbar icon.
 *
 * Product design (why it looks the way it does):
 *  - Region capture is the dominant mental model (WeChat / Snipaste: trigger,
 *    drag, done). It is the only action shown at full weight — the hero.
 *  - Full page / visible / element are refinements of the same intent, not
 *    equal choices, so they live behind a small disclosure instead of four
 *    competing tiles. Fewer visible options = less decision burden.
 *  - The load-testing workbench is a *different* product, so it is a quiet
 *    footer entry, not a mode.
 *  - The popup overlays the current tab, which stays active underneath, so
 *    every capture runs on the page the user is looking at — no dashboard
 *    round-trip. Results are delivered as an on-page floating card by the
 *    content script; the heavy lifting happens in the service worker.
 */

const zh = navigator.language.toLowerCase().startsWith('zh');

const UI = zh
  ? {
      heroTitle: '框选截图',
      heroDesc: '在页面上拖一个矩形，松开即完成',
      moreLabel: '更多截图方式',
      optFull: '整页',
      optFullDesc: '拼接整个页面',
      optVisible: '当前视口',
      optVisibleDesc: '画面上的内容',
      optElement: '元素',
      optElementDesc: '点击页面元素',
      openDash: '打开 Loadix 压测工作台 →',
      busyVisible: '截图中…',
      busyFull: '正在拼接整页（页面会自动滚动）…',
      busyRegion: '已启动框选 — 在页面上拖一个矩形；首次点击页面会关闭本菜单。',
      busyElement: '已启动元素选择 — 点击页面上要截取的元素。',
      done: '截图完成 ✓',
      errorPrefix: '截图失败：',
      noResponse: '扩展未响应，请重试。',
    }
  : {
      heroTitle: 'Capture a region',
      heroDesc: 'Drag a rectangle on the page, release to finish',
      moreLabel: 'More capture options',
      optFull: 'Full page',
      optFullDesc: 'Stitch the whole page',
      optVisible: 'Visible tab',
      optVisibleDesc: 'What is on screen now',
      optElement: 'Element',
      optElementDesc: 'Click an element on the page',
      openDash: 'Open the Loadix workbench →',
      busyVisible: 'Capturing…',
      busyFull: 'Stitching the full page (it will auto-scroll)…',
      busyRegion: 'Region mode on — drag a rectangle on the page. The first click on the page closes this menu.',
      busyElement: 'Element mode on — click the element to capture.',
      done: 'Capture complete ✓',
      errorPrefix: 'Capture failed: ',
      noResponse: 'The extension did not respond. Try again.',
    };

type CaptureMode = 'visible' | 'fullpage' | 'selection' | 'element';

interface CaptureResultMessage {
  type: 'CAPTURE_RESULT';
  ok: boolean;
  error?: string;
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function setText(id: string, text: string) {
  $(id).textContent = text;
}

function applyCopy() {
  setText('heroTitle', UI.heroTitle);
  setText('heroDesc', UI.heroDesc);
  setText('moreLabel', UI.moreLabel);
  setText('optFull', UI.optFull);
  setText('optFullDesc', UI.optFullDesc);
  setText('optVisible', UI.optVisible);
  setText('optVisibleDesc', UI.optVisibleDesc);
  setText('optElement', UI.optElement);
  setText('optElementDesc', UI.optElementDesc);
  setText('openDash', UI.openDash);
}

function setStatus(kind: 'busy' | 'error', text: string) {
  const el = $('status');
  el.className = `status ${kind}`;
  el.textContent = text;
}

function clearStatus() {
  const el = $('status');
  el.className = 'status';
  el.textContent = '';
}

async function runMode(mode: CaptureMode) {
  clearStatus();
  const busyText =
    mode === 'visible'
      ? UI.busyVisible
      : mode === 'fullpage'
        ? UI.busyFull
        : mode === 'selection'
          ? UI.busyRegion
          : UI.busyElement;
  setStatus('busy', busyText);

  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'CAPTURE_REQUEST',
      mode,
      filename: 'loadix',
    })) as CaptureResultMessage | undefined;

    if (!res) throw new Error(UI.noResponse);
    if (!res.ok) {
      setStatus('error', `${UI.errorPrefix}${res.error ?? ''}`);
      return;
    }
    // Success — the result card is already rendered on the page by the
    // content script. Give it a moment, then dismiss.
    setStatus('busy', UI.done);
    setTimeout(() => window.close(), 450);
  } catch (e) {
    setStatus('error', `${UI.errorPrefix}${e instanceof Error ? e.message : String(e)}`);
  }
}

applyCopy();

document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode as CaptureMode;
    void runMode(mode);
  });
});

const moreBtn = $('moreBtn');
const extra = $('extra');
moreBtn.addEventListener('click', () => {
  const open = extra.classList.toggle('open');
  moreBtn.classList.toggle('open', open);
});

$('openDash').addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
  } finally {
    window.close();
  }
});
