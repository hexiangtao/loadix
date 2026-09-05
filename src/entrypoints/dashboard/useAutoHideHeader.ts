import { useEffect, useState } from 'react';

/**
 * Auto-hides a sticky header while content scrolls downward and restores it on
 * upward scroll (or when back at the very top). Listens in the capture phase
 * so nested scroll containers (CodeMirror, the preview pane) count too — not
 * just the window — which is what lets the immersive Markdown / share views
 * reclaim their chrome while the user reads or edits.
 *
 * When `enabled` flips to false the header is forced back into view.
 */
export function useAutoHideHeader(enabled: boolean): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setHidden(false);
      return;
    }

    // Track each scroll source's own position (window vs. containers), so
    // interleaved scroll events from different elements don't fight.
    const pos = new WeakMap<EventTarget, number>();

    const onScroll = (e: Event) => {
      const el = e.target;
      if (!el) return;
      const cur = el === document ? window.scrollY : (el as HTMLElement).scrollTop;
      const prev = pos.get(el) ?? cur;
      pos.set(el, cur);
      const delta = cur - prev;
      // "Back at the top" means the element being scrolled is at ITS top —
      // window.scrollY for the page, its own scrollTop for nested scrollers
      // (preview pane, editor). Checking only window.scrollY here breaks
      // immersive reading in inner-scroll layouts (where the window never
      // scrolls): every small-delta event would force the header back into
      // view, so it jitters and never stays hidden.
      const atTop = cur <= 16;
      if (delta > 6) setHidden(true);
      else if (delta < -6) setHidden(false);
      else if (atTop) setHidden(false);
    };

    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
  }, [enabled]);

  return hidden;
}