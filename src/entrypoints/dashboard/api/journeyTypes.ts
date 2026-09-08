/**
 * Journey data model — a named, persistable API flow.
 *
 * A Journey is a first-class workspace entity (like a collection). Its
 * `steps` is a **recursive node tree**, not a flat list:
 *
 *   - `request`   — runs one request (delay, retries, timeout, bindings,
 *                   conditional skip)
 *   - `branch`    — evaluates each branch's condition against the previous
 *                   response; runs the first branch that matches (a branch
 *                   with `condition: null` is the unconditional fallback)
 *   - `parallel`  — runs all lanes concurrently; lanes share the variables
 *                   present when the node starts, and their extractions
 *                   merge back (last write wins) when every lane finishes
 *
 * Containers nest: a branch's matched sequence or a parallel's lanes can
 * contain further branch/parallel nodes.
 *
 * Bindings map a variable the step *uses* (`{{target}}`) to a variable it
 * should *come from* (`source`). Sources are durable:
 *
 *   - `step:N:name`  — the value extracted by the node at DFS index N
 *                      (a depth-first pre-order walk of the whole tree;
 *                      survives request renames, containers included)
 *   - anything else  — a variable in the runtime scope (env / global /
 *                      extracted), e.g. `userId` or `baseUrl`
 */

/** A condition evaluated against the previous response. */
export interface JourneyCondition {
  /** What to inspect on the previous step's response. */
  source: 'prevStatus' | 'prevBody';
  /** prevStatus compares the status number; prevBody is substring. */
  op: 'eq' | 'ne' | 'contains' | 'notContains';
  /** Status code (prevStatus) or text (prevBody). */
  value?: string;
}

export interface JourneyRequestNode {
  id: string;
  kind: 'request';
  requestId: string;
  /** target variable → source variable (`step:N:name` or runtime var name). */
  bindings?: Record<string, string>;
  /** ms to wait after the previous node completes (before this one). */
  delayMs?: number;
  /** Retry attempts beyond the first send (network error / 5xx only). */
  retries?: number;
  /** Base ms between retries (doubles per attempt). */
  retryDelayMs?: number;
  /** Per-node timeout override; 0/undefined = module default. */
  timeoutMs?: number;
  /** When set, the node is skipped unless the condition holds. */
  skipIf?: JourneyCondition;
}

export interface JourneyBranch {
  id: string;
  /** null = unconditional fallback branch (evaluated last). */
  condition: JourneyCondition | null;
  name?: string;
  steps: JourneyNode[];
}

export interface JourneyBranchNode {
  id: string;
  kind: 'branch';
  branches: JourneyBranch[];
}

export interface JourneyLane {
  id: string;
  name?: string;
  steps: JourneyNode[];
}

export interface JourneyParallelNode {
  id: string;
  kind: 'parallel';
  lanes: JourneyLane[];
}

export type JourneyNode = JourneyRequestNode | JourneyBranchNode | JourneyParallelNode;

export interface Journey {
  id: string;
  name: string;
  description?: string;
  /** Recursive node tree — the flow. */
  steps: JourneyNode[];
  /** Stop the run after the first failed node (else continue to the end). */
  stopOnFailure: boolean;
  /** Iteration dataset (JSON array of objects, or CSV with header row). */
  data: string;
  /** How `data` is parsed: 'json' | 'csv' | '' (no iteration). */
  dataFormat: '' | 'json' | 'csv';
  createdAt: number;
  updatedAt: number;
}

/** Collision-safe id (same strategy as the markdown docStore). */
export function journeyUid(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `journey-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createRequestNode(requestId = ''): JourneyRequestNode {
  return { id: journeyUid(), kind: 'request', requestId, bindings: {} };
}

export function createBranch(condition: JourneyCondition | null = null): JourneyBranch {
  return { id: journeyUid(), condition, steps: [] };
}

/** A new branch node with a default pair: one conditional, one fallback. */
export function createBranchNode(): JourneyBranchNode {
  return {
    id: journeyUid(),
    kind: 'branch',
    branches: [
      createBranch({ source: 'prevStatus', op: 'eq', value: '200' }),
      createBranch(null),
    ],
  };
}

export function createLane(): JourneyLane {
  return { id: journeyUid(), steps: [] };
}

/** A new parallel node with two empty lanes. */
export function createParallelNode(): JourneyParallelNode {
  return { id: journeyUid(), kind: 'parallel', lanes: [createLane(), createLane()] };
}

export function createJourney(name: string): Journey {
  const now = Date.now();
  return {
    id: journeyUid(),
    name,
    description: '',
    steps: [],
    stopOnFailure: true,
    data: '',
    dataFormat: '',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Migrate a persisted journey whose `steps` are still legacy linear
 * `JourneyStepConfig` rows (pre-branch era) into request nodes. Safe to
 * run on already-normalized journeys (kind present → left as-is).
 */
export function normalizeJourney(journey: Journey): Journey {
  const steps = normalizeNodes(journey.steps);
  if (steps === journey.steps) return journey;
  return { ...journey, steps };
}

function normalizeNodes(nodes: unknown[] | undefined): JourneyNode[] {
  const list = nodes as JourneyNode[] | undefined;
  if (!list || list.length === 0) return list ?? [];
  let changed = false;
  const out: JourneyNode[] = (nodes as unknown[]).map((raw) => {
    const node = raw as (JourneyNode & Record<string, unknown>) | null | undefined;
    if (node && typeof node === 'object') {
      const kind = (node as { kind?: unknown }).kind;
      if (kind === 'request') return node as JourneyRequestNode;
      if (kind === 'branch' || kind === 'parallel') {
        const normalized = normalizeNode(node as JourneyBranchNode | JourneyParallelNode);
        if (normalized !== node) changed = true;
        return normalized;
      }
    }
    // Legacy linear step.
    changed = true;
    return {
      id: typeof node?.id === 'string' ? node.id : journeyUid(),
      kind: 'request',
      requestId: String(node?.requestId ?? ''),
      bindings: (node?.bindings as Record<string, string> | undefined) ?? {},
      delayMs: typeof node?.delayMs === 'number' ? node.delayMs : undefined,
      retries: typeof node?.retries === 'number' ? node.retries : undefined,
      retryDelayMs: typeof node?.retryDelayMs === 'number' ? node.retryDelayMs : undefined,
      timeoutMs: typeof node?.timeoutMs === 'number' ? node.timeoutMs : undefined,
      skipIf: node?.skipIf as JourneyCondition | undefined,
    };
  });
  return changed ? out : list;
}

function normalizeNode(node: JourneyBranchNode | JourneyParallelNode): JourneyBranchNode | JourneyParallelNode {
  if (node.kind === 'branch') {
    let changed = false;
    const branches = (node.branches ?? []).map((branch) => {
      const steps = normalizeNodes(branch.steps);
      if (steps !== branch.steps || typeof branch.id !== 'string') changed = true;
      return steps === branch.steps && typeof branch.id === 'string' ? branch : { ...branch, steps };
    });
    return changed ? { ...node, branches } : node;
  }
  let changed = false;
  const lanes = (node.lanes ?? []).map((lane) => {
    const steps = normalizeNodes(lane.steps);
    if (steps !== lane.steps || typeof lane.id !== 'string') changed = true;
    return steps === lane.steps && typeof lane.id === 'string' ? lane : { ...lane, steps };
  });
  return changed ? { ...node, lanes } : node;
}

/* ——— Tree helpers ——— */

/** Depth-first pre-order walk: containers included, so the index is the
 *  stable address used by `step:N:name` bindings. */
export function dfsNodes(nodes: JourneyNode[]): { node: JourneyNode; index: number }[] {
  const out: { node: JourneyNode; index: number }[] = [];
  const walk = (list: JourneyNode[]) => {
    for (const node of list) {
      out.push({ node, index: out.length });
      if (node.kind === 'branch') {
        for (const branch of node.branches) walk(branch.steps);
      } else if (node.kind === 'parallel') {
        for (const lane of node.lanes) walk(lane.steps);
      }
    }
  };
  walk(nodes);
  return out;
}

export function countRequestNodes(nodes: JourneyNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.kind === 'request') count++;
    else if (node.kind === 'branch') for (const b of node.branches) count += countRequestNodes(b.steps);
    else if (node.kind === 'parallel') for (const l of node.lanes) count += countRequestNodes(l.steps);
  }
  return count;
}

/** Locate a node by id anywhere in the tree. */
export function findNode(nodes: JourneyNode[], id: string): JourneyNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.kind === 'branch') {
      for (const branch of node.branches) {
        const found = findNode(branch.steps, id);
        if (found) return found;
      }
    } else if (node.kind === 'parallel') {
      for (const lane of node.lanes) {
        const found = findNode(lane.steps, id);
        if (found) return found;
      }
    }
  }
  return null;
}

/**
 * Insert `node` into the tree:
 *  - `targetId` is a node id  → insert right after it in its sequence
 *  - `targetId` is a branch/lane id → append to that container's steps
 *  - `targetId` null → append to the top-level sequence
 * Returns a new `steps` array.
 */
export function insertNode(nodes: JourneyNode[], targetId: string | null, node: JourneyNode): JourneyNode[] {
  if (targetId === null) return [...nodes, node];
  const target = findNode(nodes, targetId);
  if (target) return insertAfter(nodes, targetId, node);
  return insertIntoContainer(nodes, targetId, node);
}

function insertAfter(nodes: JourneyNode[], id: string, node: JourneyNode): JourneyNode[] {
  return nodes.flatMap((n) => {
    if (n.id === id) return [n, node];
    if (n.kind === 'branch') {
      return [{ ...n, branches: n.branches.map((b) => ({ ...b, steps: insertAfter(b.steps, id, node) })) }];
    }
    if (n.kind === 'parallel') {
      return [{ ...n, lanes: n.lanes.map((l) => ({ ...l, steps: insertAfter(l.steps, id, node) })) }];
    }
    return [n];
  });
}

function insertIntoContainer(nodes: JourneyNode[], branchOrLaneId: string, node: JourneyNode): JourneyNode[] {
  return nodes.map((n) => {
    if (n.kind === 'branch') {
      const branch = n.branches.find((b) => b.id === branchOrLaneId);
      if (branch) return { ...n, branches: n.branches.map((b) => (b.id === branchOrLaneId ? { ...b, steps: [...b.steps, node] } : b)) };
      return { ...n, branches: n.branches.map((b) => ({ ...b, steps: insertIntoContainer(b.steps, branchOrLaneId, node) })) };
    }
    if (n.kind === 'parallel') {
      const lane = n.lanes.find((l) => l.id === branchOrLaneId);
      if (lane) return { ...n, lanes: n.lanes.map((l) => (l.id === branchOrLaneId ? { ...l, steps: [...l.steps, node] } : l)) };
      return { ...n, lanes: n.lanes.map((l) => ({ ...l, steps: insertIntoContainer(l.steps, branchOrLaneId, node) })) };
    }
    return n;
  });
}

/** Remove a node by id (whole subtree). Returns a new `steps` array. */
export function removeNode(nodes: JourneyNode[], id: string): JourneyNode[] {
  return nodes.flatMap<JourneyNode>((n): JourneyNode[] => {
    if (n.id === id) return [];
    if (n.kind === 'branch') {
      return [{ ...n, branches: n.branches.map((b) => ({ ...b, steps: removeNode(b.steps, id) })) }];
    }
    if (n.kind === 'parallel') {
      return [{ ...n, lanes: n.lanes.map((l) => ({ ...l, steps: removeNode(l.steps, id) })) }];
    }
    return [n];
  });
}

/** Replace a node by id (or update it via `updater`). */
export function replaceNode(nodes: JourneyNode[], id: string, updater: (node: JourneyNode) => JourneyNode): JourneyNode[] {
  return nodes.map((n) => {
    if (n.id === id) return updater(n);
    if (n.kind === 'branch') {
      return { ...n, branches: n.branches.map((b) => ({ ...b, steps: replaceNode(b.steps, id, updater) })) };
    }
    if (n.kind === 'parallel') {
      return { ...n, lanes: n.lanes.map((l) => ({ ...l, steps: replaceNode(l.steps, id, updater) })) };
    }
    return n;
  });
}

/** Move a node within its own sequence. */
export function moveNode(nodes: JourneyNode[], id: string, direction: -1 | 1): JourneyNode[] {
  const moved = moveInSequence(nodes, id, direction);
  if (moved !== null) return moved;
  return nodes.map((n) => {
    if (n.kind === 'branch') {
      return { ...n, branches: n.branches.map((b) => ({ ...b, steps: moveNode(b.steps, id, direction) })) };
    }
    if (n.kind === 'parallel') {
      return { ...n, lanes: n.lanes.map((l) => ({ ...l, steps: moveNode(l.steps, id, direction) })) };
    }
    return n;
  });
}

/** The sequence (array) that contains `id`, or null when at top level. */
export function findSequence(nodes: JourneyNode[], id: string): JourneyNode[] | null {
  if (nodes.some((n) => n.id === id)) return nodes;
  for (const n of nodes) {
    if (n.kind === 'branch') {
      for (const b of n.branches) {
        const seq = findSequence(b.steps, id);
        if (seq) return seq;
      }
    } else if (n.kind === 'parallel') {
      for (const l of n.lanes) {
        const seq = findSequence(l.steps, id);
        if (seq) return seq;
      }
    }
  }
  return null;
}

function moveInSequence(nodes: JourneyNode[], id: string, direction: -1 | 1): JourneyNode[] | null {
  const index = nodes.findIndex((n) => n.id === id);
  if (index === -1) return null;
  const target = index + direction;
  if (target < 0 || target >= nodes.length) return nodes;
  const next = [...nodes];
  const [node] = next.splice(index, 1);
  if (!node) return nodes;
  next.splice(target, 0, node);
  return next;
}

/** Add a branch to a branch node. */
export function addBranch(nodes: JourneyNode[], nodeId: string, branch: JourneyBranch): JourneyNode[] {
  return replaceNode(nodes, nodeId, (node) =>
    node.kind === 'branch' ? { ...node, branches: [...node.branches, branch] } : node,
  );
}

/** Remove a branch (with its whole subtree) from a branch node. */
export function removeBranch(nodes: JourneyNode[], nodeId: string, branchId: string): JourneyNode[] {
  return replaceNode(nodes, nodeId, (node) =>
    node.kind === 'branch' ? { ...node, branches: node.branches.filter((b) => b.id !== branchId) } : node,
  );
}

/** Update one branch's metadata (condition / name). */
export function patchBranch(nodes: JourneyNode[], nodeId: string, branchId: string, patch: Partial<Omit<JourneyBranch, 'id' | 'steps'>>): JourneyNode[] {
  return replaceNode(nodes, nodeId, (node) =>
    node.kind === 'branch'
      ? { ...node, branches: node.branches.map((b) => (b.id === branchId ? { ...b, ...patch } : b)) }
      : node,
  );
}

/** Add a lane to a parallel node. */
export function addLane(nodes: JourneyNode[], nodeId: string, lane: JourneyLane): JourneyNode[] {
  return replaceNode(nodes, nodeId, (node) =>
    node.kind === 'parallel' ? { ...node, lanes: [...node.lanes, lane] } : node,
  );
}

/** Remove a lane (with its whole subtree) from a parallel node. */
export function removeLane(nodes: JourneyNode[], nodeId: string, laneId: string): JourneyNode[] {
  return replaceNode(nodes, nodeId, (node) =>
    node.kind === 'parallel' ? { ...node, lanes: node.lanes.filter((l) => l.id !== laneId) } : node,
  );
}

/**
 * Parse a dataset string into rows. JSON mode expects an array of objects
 * (values stringified); CSV mode expects a header row — first line names
 * the columns, remaining lines are rows. Quoted fields with commas and
 * escaped quotes are handled.
 */
export function parseDataset(data: string, format: '' | 'json' | 'csv'): Record<string, string>[] {
  const text = (data ?? '').trim();
  if (!text || !format) return [];
  if (format === 'json') {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('JSON dataset must be an array');
    return parsed.map((row) => {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        throw new Error('JSON dataset rows must be objects');
      }
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
        out[key] = typeof value === 'string' ? value : JSON.stringify(value);
      }
      return out;
    });
  }
  // CSV: header row + data rows.
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0]!.map((cell) => cell.trim());
  if (header.some((h) => !h)) throw new Error('CSV header row must not contain empty column names');
  return rows.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    header.forEach((name, index) => {
      row[name] = (cells[index] ?? '').trim();
    });
    return row;
  });
}

/** Minimal CSV parser: quotes, escaped quotes, commas, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const input = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}