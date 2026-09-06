/**
 * Shared position-aware drag & drop ordering — the small kernel both
 * sidebars (markdown docs and API requests) build on.
 *
 * The model: every item in a same-parent sibling group carries a numeric
 * `order`. Lists sort with manual orders first; siblings that have never
 * been reordered keep their legacy sort (recency for docs/requests, creation
 * age for folders), so introducing the field changes nothing visually until
 * the first drag. A reorder splices the moved item into the target group's
 * visible sequence and renumbers it densely (0..n-1) — orders never collide
 * or grow unboundedly, and untouched rows keep their identity so React keys
 * stay stable.
 *
 * Drop zones on a row split into three bands — top edge (insert before),
 * bottom edge (insert after), middle (`into`: drop INSIDE, folders only) —
 * so one drag gesture covers reordering, nesting, and moving between groups.
 */

/** Fraction of a row's height (from each edge) that means "insert before/after". */
export const EDGE_ZONE = 0.3;

/** Which part of a row the pointer is over. */
export type ReorderZone = 'before' | 'after' | 'into';

/** Resolves the pointer position to a drop zone. Folders translate the
    middle of the row into `into`; flat items split the middle in half. */
export function zoneFromEvent(e: React.DragEvent, supportInto: boolean): ReorderZone {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio = (e.clientY - rect.top) / Math.max(rect.height, 1);
  if (ratio < EDGE_ZONE) return 'before';
  if (ratio > 1 - EDGE_ZONE) return 'after';
  return supportInto ? 'into' : ratio < 0.5 ? 'before' : 'after';
}

/** Manual orders first; unordered siblings keep recency (newest first). */
export function byOrderRecency<T extends { order?: number; updatedAt: number }>(a: T, b: T): number {
  const oa = a.order ?? Number.MAX_SAFE_INTEGER;
  const ob = b.order ?? Number.MAX_SAFE_INTEGER;
  return oa !== ob ? oa - ob : b.updatedAt - a.updatedAt;
}

/** Manual orders first; unordered siblings keep creation age (oldest first). */
export function byOrderCreated<T extends { order?: number; createdAt: number }>(a: T, b: T): number {
  const oa = a.order ?? Number.MAX_SAFE_INTEGER;
  const ob = b.order ?? Number.MAX_SAFE_INTEGER;
  return oa !== ob ? oa - ob : a.createdAt - b.createdAt;
}

export interface ReorderPlan<T> {
  /** The whole target group with dense orders applied. */
  ordered: T[];
  /** Only the entries whose `order` (or parent) actually changed. */
  changed: T[];
}

/**
 * Plans a reorder inside `group` — the target sibling group in its visible
 * sort order. `movedInTarget` is the dragged item with its new parent already
 * applied; `anchorId` + `zone` place it (null anchor = append at the end,
 * which is how "drop into a folder" lands). Returns null when nothing would
 * change, so callers skip the state update and the write entirely.
 */
export function planReorder<T extends { id: string; order?: number }>(
  group: T[],
  movedId: string,
  anchorId: string | null,
  zone: ReorderZone,
  movedInTarget: T,
): ReorderPlan<T> | null {
  const without = group.filter((x) => x.id !== movedId);
  let insertAt = without.length;
  if (anchorId != null) {
    const idx = without.findIndex((x) => x.id === anchorId);
    if (idx < 0) return null; // anchor vanished — nothing sensible to do
    insertAt = zone === 'before' ? idx : idx + 1;
  }
  const ordered = [...without.slice(0, insertAt), movedInTarget, ...without.slice(insertAt)].map((x, i) => ({
    ...x,
    order: i,
  }));
  const before = new Map(group.map((x) => [x.id, x]));
  const changed = ordered.filter((x) => before.get(x.id)?.order !== x.order);
  return changed.length === 0 ? null : { ordered, changed };
}
