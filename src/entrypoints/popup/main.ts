/**
 * Loadix action popup — the capture launcher behind the toolbar icon.
 *
 * Design intent (why it looks the way it does):
 *  - Uses Loadix's own dark design tokens (see app.css): graphite neutrals,
 *    system blue, SF Pro stack — the popup is a sibling of the dashboard, not
 *    a generic dark card.
 *  - One primary intent per view. Region capture is the mental model
 *    (WeChat / Snipaste: trigger, drag, done), so it is the only full-weight
 *    action — a flat system-blue hero with a crop glyph. Full page / visible /
 *    element are refinements of the same intent, so they collapse behind a
 *    quiet disclosure; the workbench is a different product, so it sits
 *    below a hairline divider as a plain menu row.
 *  - Details that read as "designed": real keycap chips for the shortcut,
 *    lucide-style 1.5px-stroke icons, Apple-menu hover rows (no boxy cards),
 *    a hairline inner highlight on the primary button instead of a gradient,
 *    and a focus ring that matches the app's focus language.
 *  - The popup overlays the current tab, which stays active underneath, so
 *    every capture runs on the page the user is looking at. Results are
 *    delivered as an on-page floating card by the content script; the heavy
 *    lifting happens in the service worker.
 */

const zh = navigator.language.toLowerCase().startsWith('zh');

const UI = zh
  ? {
      heroTitle: '框选截图',
      heroDesc: '在页面上拖一个矩形',
      moreLabel: '更多方式',
      optFull: '整页',
      optFullDesc: '拼接整个页面',
      optVisible: '当前视口',
      optVisibleDesc: '屏幕当前内容',
      optElement: '元素',
      optElementDesc: '点击页面元素',
      dashLabel: '打开 Loadix 工具箱',
      busyVisible: '截图中…',
      busyFull: '正在拼接整页，页面会自动滚动…',
      busyRegion: '在页面上拖一个矩形；首次点击页面会关闭本菜单',
      busyElement: '点击页面上要截取的元素',
      done: '截图完成',
      errorPrefix: '截图失败：',
      noResponse: '扩展未响应，请重试。',
    }
  : {
      heroTitle: 'Capture region',
      heroDesc: 'Drag a rectangle on the page',
      moreLabel: 'More options',
      optFull: 'Full page',
      optFullDesc: 'Stitch the whole page',
      optVisible: 'Visible tab',
      optVisibleDesc: 'What is on screen',
      optElement: 'Element',
      optElementDesc: 'Click an element',
      dashLabel: 'Open the Loadix toolbox',
      busyVisible: 'Capturing…',
      busyFull: 'Stitching the full page — it will auto-scroll…',
      busyRegion: 'Drag a rectangle on the page. The first click on the page closes this menu.',
      busyElement: 'Click the element you want to capture',
      done: 'Capture complete',
      errorPrefix: 'Capture failed: ',
      noResponse: 'The extension did not respond. Try again.',
    };

type CaptureMode = 'visible' | 'fullpage' | 'selection' | 'element';

interface CaptureResultMessage {
  type: 'CAPTURE_RESULT';
  ok: boolean;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Icons (lucide-style, 24px viewBox, 1.7px stroke)                    */
/* ------------------------------------------------------------------ */

function svg(inner: string, size = 15): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

const ICONS: Record<string, string> = {
  region: svg('<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>'), // crop
  fullpage: svg(
    '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>', // maximize
  ),
  visible: svg(
    '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>', // eye
  ),
  element: svg('<path d="m4 4 7.07 17 2.51-7.39L21 11.07z"/>'), // mouse-pointer
  dash: svg(
    '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>', // activity (pulse)
  ),
  chevron: svg('<polyline points="6 9 12 15 18 9"/>', 12),
  arrow: svg('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>', 14),
  spinner: svg(
    '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    14,
  ).replace('stroke-width="1.7"', 'stroke-width="2"'),
  check: svg('<polyline points="20 6 9 17 4 12"/>', 14),
  alert: svg(
    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    14,
  ),
};

/* ------------------------------------------------------------------ */

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const $$ = <T extends Element>(sel: string) => Array.from(document.querySelectorAll<T>(sel));

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
  setText('dashLabel', UI.dashLabel);

  $('heroIcon').innerHTML = ICONS.region!;
  $('moreChevron').innerHTML = ICONS.chevron!;
  $$<HTMLSpanElement>('[data-icon]').forEach((el) => {
    const name = el.dataset.icon;
    if (name && ICONS[name]) el.innerHTML = ICONS[name];
  });
}

function setStatus(kind: 'busy' | 'done' | 'error', text: string) {
  const el = $('status');
  el.className = `status ${kind}`;
  $('statusText').textContent = text;
  const icon =
    kind === 'busy'
      ? ICONS.spinner!.replace('<svg ', '<svg class="spin" ')
      : kind === 'done'
        ? ICONS.check!
        : ICONS.alert!;
  $('statusIcon').innerHTML = icon;
}

function clearStatus() {
  const el = $('status');
  el.className = 'status';
  $('statusText').textContent = '';
  $('statusIcon').textContent = '';
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
    setStatus('done', UI.done);
    setTimeout(() => window.close(), 450);
  } catch (e) {
    setStatus('error', `${UI.errorPrefix}${e instanceof Error ? e.message : String(e)}`);
  }
}

applyCopy();

$$<HTMLButtonElement>('[data-mode]').forEach((btn) => {
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
  moreBtn.setAttribute('aria-expanded', String(open));
});

$('openDash').addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
  } finally {
    window.close();
  }
});