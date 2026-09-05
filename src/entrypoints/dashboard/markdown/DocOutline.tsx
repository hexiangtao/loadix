import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

export interface DocOutlineProps {
  /** The scroll container that holds the rendered markdown (preview pane / share scroller). */
  containerRef: RefObject<HTMLElement | null>;
  /** The markdown source currently rendered — the outline re-scans when it changes. */
  source: string;
  /** Closes the panel (renders the ✕ in the header). */
  onClose?: () => void;
  /** Reports how many headings the outline found — lets parents hide toggles when there's nothing to outline. */
  onItemsChange?: (count: number) => void;
  /** Extra classes for the outer wrapper (visibility/positioning live here). */
  className?: string;
}

/** Distance from the top of the container at which a heading counts as "current". */
const READING_OFFSET = 96;
/** Indentation stops growing past this depth, so deeply nested docs can't spiral. */
const MAX_INDENT = 3;

interface OutlineItem {
  id: string;
  text: string;
  level: number;
  el: HTMLElement;
}

/**
 * Scroll-spy document outline (大纲) for rendered markdown.
 *
 * Scans the headings inside the scroll container, gives each a stable slug id,
 * tracks which one the reader is currently on (a horizontal "reading line" near
 * the top of the container — the same line a click jumps to), and smooth-scrolls
 * the container on click. Positions are read live rather than cached, so late
 * rendering (mermaid diagrams, images, fonts) never leaves the highlight stale.
 *
 * Shared verbatim between the dashboard preview (preview mode) and the share
 * viewer, so both surfaces behave identically. Returns null when the document
 * has fewer than two headings — an outline for a heading-less doc is just noise.
 */
export function DocOutline({ containerRef, source, onClose, onItemsChange, className }: DocOutlineProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<OutlineItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const itemsRef = useRef<OutlineItem[]>([]);
  const onItemsChangeRef = useRef(onItemsChange);
  useEffect(() => {
    onItemsChangeRef.current = onItemsChange;
  }, [onItemsChange]);

  // (Re)scan the headings whenever the rendered document changes. Rather than
  // capturing the container node once, every handler re-reads containerRef
  // (whose .current always points at the live pane — jumps prove it) so a node
  // swap under React reconciliation can never orphan the listeners.
  useEffect(() => {
    const scan = () => {
      const container = containerRef.current;
      if (!container) return;
      const heads = Array.from(container.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'));
      const seen = new Map<string, number>();
      const list: OutlineItem[] = [];
      for (const el of heads) {
        const text = (el.textContent ?? '').trim();
        if (!text) continue;
        const base = slugify(text) || 'section';
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const id = n === 0 ? base : `${base}-${n}`;
        el.id = id;
        list.push({ id, text, level: Number(el.tagName[1]), el });
      }
      itemsRef.current = list;
      setItems(list);
      setActiveId(null);
      onItemsChangeRef.current?.(list.length);
    };

    // The active heading is the last one whose top sits above the reading line.
    const computeActive = () => {
      const container = containerRef.current;
      if (!container) return;
      const list = itemsRef.current;
      if (list.length === 0) {
        setActiveId(null);
        return;
      }
      let current: string | null = null;
      // Near the very bottom of the document the last heading wins — a short
      // trailing section may never cross the reading line otherwise, and the
      // last ~120px of scroll is visually indistinct from the very end.
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 120) {
        const last = list[list.length - 1];
        if (last) current = last.id;
      } else {
        const line = container.getBoundingClientRect().top + READING_OFFSET;
        for (const item of list) {
          if (item.el.getBoundingClientRect().top <= line) current = item.id;
          else break;
        }
      }
      // At the very top of the document the first heading is the natural anchor.
      if (current == null && container.scrollTop < READING_OFFSET) {
        current = list[0]?.id ?? null;
      }
      setActiveId((prev) => (prev === current ? prev : current));
    };

    const container = containerRef.current;
    if (!container) return;
    scan();
    computeActive();
    container.addEventListener('scroll', computeActive, { passive: true });
    const ro = new ResizeObserver(computeActive);
    ro.observe(container);
    window.addEventListener('resize', computeActive);
    // Embedded webviews can coalesce or drop scroll events (especially while a
    // JS-driven scroll animation is running), which would freeze the highlight.
    // A slow poller backstops the event listeners — it re-reads the ref each
    // tick, so it survives any container-node replacement, and only does work
    // when the scroll position actually moved.
    let lastTop = container.scrollTop;
    const poll = window.setInterval(() => {
      const c = containerRef.current;
      if (c && c.scrollTop !== lastTop) {
        lastTop = c.scrollTop;
        computeActive();
      }
    }, 250);
    return () => {
      window.clearInterval(poll);
      container.removeEventListener('scroll', computeActive);
      ro.disconnect();
      window.removeEventListener('resize', computeActive);
    };
  }, [source, containerRef]);

  if (items.length < 2) return null;

  const jumpTo = (item: OutlineItem) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = item.el.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    const target = Math.max(0, rect.top - cRect.top + container.scrollTop - READING_OFFSET + 8);
    // Native `scrollTo({behavior:'smooth'})` is silently flaky in embedded
    // webviews (it can stall partway or not move at all), so the animation is
    // driven manually — deterministic everywhere, and cancelled the moment the
    // reader wheels or touches, so they always stay in control.
    smoothScrollTo(container, target);
  };

  return (
    <div className={className ?? ''}>
      <aside className="flex h-full w-56 shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-line pl-3 pr-1.5">
          <span className="text-[10.5px] font-bold uppercase tracking-widest text-muted">
            {t('tools.markdown.outline')}
          </span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('tools.markdown.outlineClose')}
              title={t('tools.markdown.outlineClose')}
              className="cursor-pointer rounded-md p-1 text-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <nav
          aria-label={t('tools.markdown.outline')}
          className="app-scroller min-h-0 flex-1 overflow-y-auto py-1.5 pr-0.5"
        >
          <ul className="space-y-px">
            {items.map((item) => {
              const active = item.id === activeId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => jumpTo(item)}
                    title={item.text}
                    aria-current={active ? 'true' : undefined}
                    className={`group flex w-full cursor-pointer items-center gap-1.5 rounded-md py-[3px] pr-2 text-left text-xs leading-snug transition-colors duration-150 ${
                      active
                        ? 'bg-primary/10 font-semibold text-primary'
                        : 'text-muted hover:bg-hover hover:text-ink'
                    }`}
                    style={{ paddingLeft: `${0.5 + Math.min(item.level - 1, MAX_INDENT) * 0.6875}rem` }}
                  >
                    <span
                      className={`size-[5px] shrink-0 rounded-full transition-colors duration-150 ${
                        active ? 'bg-primary' : 'bg-line group-hover:bg-muted'
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate">{item.text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
    </div>
  );
}

/** GitHub-style slug: lowercase, punctuation dropped, spaces → dashes. */
function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Eased scroll animation (ease-out cubic, distance-scaled, capped at 600ms)
 * that replaces native smooth scrolling — see the note in jumpTo. Cancels on
 * user wheel/touch input so the reader always stays in control.
 */
function smoothScrollTo(container: HTMLElement, target: number) {
  // Never scroll past the end — a heading near the document's end may sit
  // below the reading line even at full scroll, so the goal is clamped to
  // the maximum scroll position (the bottom-clamp then marks it active).
  const max = Math.max(0, container.scrollHeight - container.clientHeight);
  const goal = Math.min(target, max);
  const start = container.scrollTop;
  const delta = goal - start;
  if (Math.abs(delta) < 2 || reducedMotion()) {
    container.scrollTop = goal;
    return;
  }
  const duration = Math.min(600, Math.max(250, Math.abs(delta) * 0.4));
  const t0 = performance.now();
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  let raf = 0;
  let watchdog = 0;
  const cancel = () => {
    cancelAnimationFrame(raf);
    window.clearTimeout(watchdog);
    container.removeEventListener('wheel', cancel);
    container.removeEventListener('touchstart', cancel);
  };
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / duration);
    container.scrollTop = start + delta * ease(p);
    if (p < 1) raf = requestAnimationFrame(step);
    else cancel(); // natural completion — the last frame already landed exactly
  };
  raf = requestAnimationFrame(step);
  // If rAF stalls inside an embedded webview, snap so the click never feels dead.
  watchdog = window.setTimeout(() => {
    container.scrollTop = goal;
    cancel();
  }, duration + 200);
  container.addEventListener('wheel', cancel, { passive: true });
  container.addEventListener('touchstart', cancel, { passive: true });
}