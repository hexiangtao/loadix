/**
 * Requests sidebar — collections tree, auto Drafts bucket, and send History.
 *
 * The whole "no bookkeeping" philosophy lives here: unnamed requests sit in
 * Drafts automatically, and the only act of saving is the Keep dialog
 * (name + destination). History is a browser-like list — every send lands
 * here, one click reopens it as a fresh draft.
 *
 * Drag & drop is position-aware: row edges show an insertion line (reorder
 * within the sibling group), folder middles show the drop ring (move inside),
 * and container bodies append. All reorder math lives in ../ordering.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  Copy,
  Download,
  Folder,
  FolderPlus,
  Globe,
  History as HistoryIcon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import type { ApiCollection, ApiHistoryEntry, ApiMethod, ApiRequest } from './apiTypes';
import { METHOD_CHIP, requestDisplayTitle } from './apiTypes';
import { MenuItem, Popover } from '../components/Popover';
import { DropLine } from '../components/DropLine';
import { byOrderCreated, byOrderRecency, zoneFromEvent, type ReorderZone } from '../ordering';
import { timeAgo } from './time';

const COLLAPSED_KEY = 'loadix-api:sidebarCollapsed';
/** DnD payload types — same convention as the markdown sidebar. */
const MIME_REQUEST = 'application/x-loadix-request';
const MIME_COLLECTION = 'application/x-loadix-collection';
/** Container drop targets that are not rows. */
const DRAFTS_TARGET = '__drafts__';
const ROOT_TARGET = '__root__';
type ContainerTarget = typeof DRAFTS_TARGET | typeof ROOT_TARGET;

/** What is currently being dragged (kept in state for drop-target styling). */
type DragState = { type: 'request' | 'collection'; id: string } | null;
/** Where a drag currently hovers: a row/collection id, or a container target. */
type DropTarget = { id: string; zone: ReorderZone } | null;

interface ApiSidebarProps {
  requests: ApiRequest[];
  collections: ApiCollection[];
  history: ApiHistoryEntry[];
  currentId: string | null;
  /** The import hint is noise after the first successful import. */
  showImportHint: boolean;
  onOpenRequest: (id: string) => void;
  onNewRequest: () => void;
  onNewRequestIn: (collectionId: string) => void;
  onNewCollection: (name: string) => void;
  onKeepRequest: (id: string, name: string, collectionId: string | null) => void;
  onRenameCollection: (id: string, name: string) => void;
  /** Move + reorder in one: parent change (optional) plus position within
      the target sibling group (anchor null = append at the end). */
  onReorderRequest: (id: string, collectionId: string | null, anchorId: string | null, zone: 'before' | 'after') => void;
  onReorderCollection: (id: string, parentId: string | null, anchorId: string | null, zone: 'before' | 'after') => void;
  onDuplicateRequest: (id: string) => void;
  onDeleteRequest: (id: string) => void;
  onDeleteCollection: (id: string) => void;
  onImportFile: (file: File) => void;
  onExportPostman: () => void;
  onExportOpenApi: () => void;
  onOpenHistory: (entry: ApiHistoryEntry) => void;
  onClearHistory: () => void;
}

/**
 * Double-click detection on a row: fires `onDoubleClick` only when both
 * clicks land within the system double-click threshold (time + distance),
 * so two slow, far-apart clicks never trigger a rename.
 */
function useDoubleClick(onDoubleClick: () => void) {
  const last = useRef<{ t: number; x: number; y: number } | null>(null);
  const onClick = (e: React.MouseEvent) => {
    const now = performance.now();
    const prev = last.current;
    last.current = { t: now, x: e.clientX, y: e.clientY };
    if (prev && now - prev.t < 500 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 6) {
      last.current = null;
      onDoubleClick();
    }
  };
  return onClick;
}

/** Inline text input used for naming a collection. */
function NameInput({
  initial,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  return (
    <input
      autoFocus
      defaultValue={initial}
      placeholder={placeholder}
      className="w-full min-w-0 rounded-md border border-primary bg-panel px-1.5 py-0.5 text-[13px] text-ink outline-none"
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(e.currentTarget.value);
        else if (e.key === 'Escape') onCancel();
      }}
      onBlur={(e) => onCommit(e.currentTarget.value)}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/* ———————————————————————————————————————————————— */

export function ApiSidebar(props: ApiSidebarProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1');
  const [namingCollection, setNamingCollection] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportBtnRef = useRef<HTMLButtonElement>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  const untitled = t('api.untitled');
  const drafts = props.requests.filter((r) => r.collectionId == null);
  const saved = props.requests.filter((r) => r.collectionId != null);
  const collectionsUnder = (parentId: string | null) =>
    props.collections.filter((c) => (c.parentId ?? null) === parentId).sort(byOrderCreated);
  const requestsIn = (collectionId: string | null) =>
    props.requests.filter((r) => (r.collectionId ?? null) === collectionId).sort(byOrderRecency);
  const sortedHistory = [...props.history].sort((a, b) => b.sentAt - a.sentAt);

  /* ——— Position-aware drag & drop ——— */

  const startDrag = (e: React.DragEvent, type: 'request' | 'collection', id: string) => {
    e.dataTransfer.setData(type === 'request' ? MIME_REQUEST : MIME_COLLECTION, id);
    e.dataTransfer.effectAllowed = 'move';
    setDragState({ type, id });
    setDropTarget(null);
  };

  const endDrag = () => {
    setDragState(null);
    setDropTarget(null);
  };

  /** Whether dropping on `targetId` (a request/collection id) in `zone` is
      meaningful. No-op drops (own bucket) stay unhighlighted. */
  const canDropRow = (targetId: string, zone: ReorderZone): boolean => {
    if (!dragState) return false;
    if (dragState.type === 'request') {
      const dragged = props.requests.find((r) => r.id === dragState.id);
      if (!dragged) return false;
      const target = props.requests.find((r) => r.id === targetId);
      if (!target) {
        // A collection row: edges = move/append into it, middle = same.
        return zone === 'into' ? dragged.collectionId !== targetId : true;
      }
      // A request row: edges reorder within the anchor's group — always fine.
      return true;
    }
    const dragged = props.collections.find((c) => c.id === dragState.id);
    if (!dragged) return false;
    const target = props.collections.find((c) => c.id === targetId);
    if (!target) return false;
    if (zone === 'into') {
      if (target.id === dragged.id) return false;
      // Never into the dragged collection's own subtree (cycles).
      let cur = target.parentId != null ? props.collections.find((c) => c.id === target.parentId) : undefined;
      while (cur) {
        if (cur.id === dragged.id) return false;
        const parentId = cur.parentId;
        cur = parentId != null ? props.collections.find((c) => c.id === parentId) : undefined;
      }
      return true;
    }
    return target.id !== dragged.id;
  };

  const handleRowDragOver = (e: React.DragEvent, targetId: string, supportInto: boolean) => {
    const zone = zoneFromEvent(e, supportInto);
    if (!canDropRow(targetId, zone)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget({ id: targetId, zone });
  };

  const handleRowDrop = (e: React.DragEvent, targetId: string, supportInto: boolean) => {
    e.preventDefault();
    const zone = zoneFromEvent(e, supportInto);
    const ds = dragState;
    endDrag();
    if (!ds || !canDropRow(targetId, zone)) return;
    if (ds.type === 'request') {
      const target = props.requests.find((r) => r.id === targetId);
      if (!target) {
        // Dropped on a collection row (any zone) → move into it, appended.
        props.onReorderRequest(ds.id, targetId, null, 'after');
      } else {
        props.onReorderRequest(ds.id, target.collectionId ?? null, target.id, zone === 'before' ? 'before' : 'after');
      }
    } else {
      const target = props.collections.find((c) => c.id === targetId);
      if (!target) return;
      if (zone === 'into') props.onReorderCollection(ds.id, target.id, null, 'after');
      else props.onReorderCollection(ds.id, target.parentId ?? null, target.id, zone === 'before' ? 'before' : 'after');
    }
  };

  /** Container bodies (Drafts bucket, root list): pointer over a gap appends
      to that group. The target guard keeps row-level zones from being
      overridden by the bubbling container event. */
  const canDropContainer = (container: ContainerTarget): boolean => {
    if (!dragState) return false;
    return container === DRAFTS_TARGET ? dragState.type === 'request' : dragState.type === 'collection';
  };

  const handleContainerDragOver = (e: React.DragEvent, container: ContainerTarget) => {
    if (e.target !== e.currentTarget) return;
    if (!canDropContainer(container)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget({ id: container, zone: 'into' });
  };

  const handleContainerDrop = (e: React.DragEvent, container: ContainerTarget) => {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    const ds = dragState;
    endDrag();
    if (!ds || !canDropContainer(container)) return;
    if (container === DRAFTS_TARGET) props.onReorderRequest(ds.id, null, null, 'after');
    else props.onReorderCollection(ds.id, null, null, 'after');
  };

  /** Row visuals: insertion line at the hovered edge, ring for "into". */
  const indicatorOf = (rowId: string): 'before' | 'after' | null =>
    dropTarget?.id === rowId && dropTarget.zone !== 'into' ? dropTarget.zone : null;
  const intoOf = (rowId: string) => dropTarget?.id === rowId && dropTarget.zone === 'into';

  const requestRow = (request: ApiRequest) => (
    <RequestRow
      key={request.id}
      request={request}
      title={requestDisplayTitle(request, untitled)}
      active={request.id === props.currentId}
      collections={props.collections}
      dragging={dragState?.type === 'request' && dragState.id === request.id}
      indicator={indicatorOf(request.id)}
      onOpen={() => props.onOpenRequest(request.id)}
      onKeep={(name, cid) => props.onKeepRequest(request.id, name, cid)}
      onMove={(cid) => props.onReorderRequest(request.id, cid, null, 'after')}
      onDuplicate={() => props.onDuplicateRequest(request.id)}
      onDelete={() => props.onDeleteRequest(request.id)}
      onDragStart={(e) => startDrag(e, 'request', request.id)}
      onDragEnd={endDrag}
      onDragOver={(e) => handleRowDragOver(e, request.id, false)}
      onDrop={(e) => handleRowDrop(e, request.id, false)}
    />
  );

  const collectionRows = (parentId: string | null, depth: number) =>
    collectionsUnder(parentId).map((collection) => (
      <CollectionRow
        key={collection.id}
        collection={collection}
        count={requestsIn(collection.id).length}
        depth={depth}
        dragging={dragState?.type === 'collection' && dragState.id === collection.id}
        over={intoOf(collection.id)}
        indicator={indicatorOf(collection.id)}
        onNewRequest={() => props.onNewRequestIn(collection.id)}
        onRename={(name) => props.onRenameCollection(collection.id, name)}
        onDelete={() => props.onDeleteCollection(collection.id)}
        onDragStart={(e) => startDrag(e, 'collection', collection.id)}
        onDragEnd={endDrag}
        onDragOver={(e) => handleRowDragOver(e, collection.id, true)}
        onDrop={(e) => handleRowDrop(e, collection.id, true)}
        onChildDragOver={(e) => handleRowDragOver(e, collection.id, true)}
        onChildDrop={(e) => handleRowDrop(e, collection.id, true)}
      >
        {requestsIn(collection.id).map(requestRow)}
        {collectionRows(collection.id, depth + 1)}
      </CollectionRow>
    ));

  const onFile = (file: File | undefined) => {
    if (file) props.onImportFile(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  // Icon strip when collapsed — reopen + quick new request, same shape as
  // the markdown sidebar's collapse.
  if (collapsed) {
    return (
      <div className="flex h-full w-12 shrink-0 flex-col items-center gap-1.5 border-r border-line bg-surface py-3">
        <button
          onClick={() => setCollapsed(false)}
          title={t('tools.expandSidebar')}
          className="rounded-lg p-2 text-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
        >
          <PanelLeftOpen size={16} />
        </button>
        <button
          onClick={props.onNewRequest}
          title={t('api.newRequest')}
          className="rounded-lg p-2 text-primary transition-colors duration-150 hover:bg-primary/10"
        >
          <Plus size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-60 shrink-0 flex-col border-r border-line bg-surface">
      {/* Header + actions */}
      <div className="px-3 pb-2 pt-3">
        <div className="mb-2 flex items-center justify-between pl-1">
          <span className="text-xs font-bold text-muted">{t('api.collections')}</span>
          <button
            onClick={() => setCollapsed(true)}
            title={t('tools.collapseSidebar')}
            className="rounded-lg p-1.5 text-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
          >
            <PanelLeftClose size={16} />
          </button>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={props.onNewRequest}
            className="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg bg-primary px-2 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-primary/90"
          >
            <Plus size={13} />
            {t('api.newRequest')}
          </button>
          <button
            onClick={() => setNamingCollection(true)}
            title={t('api.newCollection')}
            className="cursor-pointer rounded-lg border border-line px-2 py-1.5 text-muted transition-colors duration-150 hover:border-primary hover:text-primary"
          >
            <FolderPlus size={14} />
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            title={t('api.importPostman')}
            className="cursor-pointer rounded-lg border border-line px-2 py-1.5 text-muted transition-colors duration-150 hover:border-primary hover:text-primary"
          >
            <Upload size={14} />
          </button>
          <button
            ref={exportBtnRef}
            onClick={() => setExportOpen((v) => !v)}
            title={t('api.export')}
            className={`cursor-pointer rounded-lg border border-line px-2 py-1.5 transition-colors duration-150 hover:border-primary ${
              exportOpen ? 'border-primary text-primary' : 'text-muted hover:text-primary'
            }`}
          >
            <Download size={14} />
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".json,.yaml,.yml,application/json,text/yaml,application/x-yaml" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        {exportOpen && (
          <Popover anchor={exportBtnRef.current} onClose={() => setExportOpen(false)} width="w-52">
            <div className="py-1">
              <MenuItem onClick={() => { setExportOpen(false); props.onExportPostman(); }}>
                {t('api.exportPostman')}
              </MenuItem>
              <MenuItem onClick={() => { setExportOpen(false); props.onExportOpenApi(); }}>
                {t('api.exportOpenApi')}
              </MenuItem>
            </div>
          </Popover>
        )}
        {props.showImportHint && (
          <p className="mt-1.5 px-0.5 text-[11px] leading-snug text-muted/70">{t('api.importHint')}</p>
        )}
      </div>

      {/* Scrollable content */}
      <div className="app-scroller sb-hairline min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {namingCollection && (
          <div className="px-2 py-1">
            <NameInput
              initial=""
              placeholder={t('api.collectionNamePlaceholder')}
              onCommit={(v) => {
                setNamingCollection(false);
                if (v.trim()) props.onNewCollection(v.trim());
              }}
              onCancel={() => setNamingCollection(false)}
            />
          </div>
        )}

        {/* Collections tree — the root list is itself a drop container
            (append to root); rows carry their own edge/into zones. */}
        {collectionsUnder(null).length === 0 && saved.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs leading-relaxed text-muted">{t('api.emptyCollections')}</p>
        ) : (
          <div
            onDragOver={(e) => handleContainerDragOver(e, ROOT_TARGET)}
            onDrop={(e) => handleContainerDrop(e, ROOT_TARGET)}
            className={`pt-1 ${dropTarget?.id === ROOT_TARGET ? 'rounded-lg ring-1 ring-primary/50' : ''}`}
          >
            {collectionRows(null, 0)}
          </div>
        )}

        {/* Drafts */}
        {drafts.length > 0 && (
          <div
            onDragOver={(e) => handleContainerDragOver(e, DRAFTS_TARGET)}
            onDrop={(e) => handleContainerDrop(e, DRAFTS_TARGET)}
            className={`border-t border-line pt-2 ${dropTarget?.id === DRAFTS_TARGET ? 'rounded-lg bg-primary/10 ring-1 ring-primary' : ''}`}
          >
            <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-muted/70">
              {t('api.drafts')}
              <span className="ml-1.5 text-[10px] font-normal text-muted/50">{drafts.length}</span>
            </div>
            {drafts.map(requestRow)}
          </div>
        )}

        {/* History */}
        <div className="border-t border-line pt-2">
          <div className="flex items-center justify-between px-2 pb-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted/70">
              {t('api.history')}
              <span className="ml-1.5 text-[10px] font-normal text-muted/50">{sortedHistory.length}</span>
            </span>
            {sortedHistory.length > 0 && (
              <button
                onClick={props.onClearHistory}
                title={t('api.clearHistory')}
                className="cursor-pointer rounded p-0.5 text-muted/60 transition-colors duration-150 hover:bg-hover hover:text-danger"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
          {sortedHistory.length === 0 ? (
            <p className="px-3 py-1 text-[11px] leading-snug text-muted/70">{t('api.historyEmpty')}</p>
          ) : (
            sortedHistory.slice(0, 20).map((entry) => (
              <HistoryRow key={entry.id} entry={entry} onOpen={() => props.onOpenHistory(entry)} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ———————————————————————————————————————————————— */

function CollectionRow({
  collection,
  count,
  depth,
  dragging,
  over,
  indicator,
  onNewRequest,
  onRename,
  onDelete,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onChildDragOver,
  onChildDrop,
  children,
}: {
  collection: ApiCollection;
  count: number;
  depth: number;
  /** True while this row is the one being dragged. */
  dragging: boolean;
  /** True while a valid drag hovers the row's middle — drop-inside highlight. */
  over: boolean;
  /** Insertion line at the hovered edge ('before' | 'after' | none). */
  indicator: 'before' | 'after' | null;
  onNewRequest: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  /** Body (children area) of the open collection: gap drops land inside. */
  onChildDragOver: (e: React.DragEvent) => void;
  onChildDrop: (e: React.DragEvent) => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  // Double-click the name to rename (single click still toggles open/closed).
  const handleNameClick = useDoubleClick(() => {
    setOpen(true);
    setRenaming(true);
  });

  return (
    <div>
      <div
        ref={rowRef}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={() => setOpen((v) => !v)}
        style={{ paddingLeft: 8 + depth * 12 }}
        className={`group relative flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-hover ${
          dragging ? 'opacity-40' : ''
        } ${over ? 'bg-primary/10 ring-1 ring-primary' : ''}`}
      >
        {indicator === 'before' && <DropLine position="top" />}
        {indicator === 'after' && <DropLine position="bottom" />}
        <ChevronDown size={13} className={`shrink-0 text-muted transition-transform duration-200 ${open ? '' : '-rotate-90'}`} />
        <Folder size={14} className={`shrink-0 transition-colors duration-150 ${open ? 'text-primary' : 'text-muted/60'}`} />
        {renaming ? (
          <NameInput
            initial={collection.name}
            placeholder={t('api.collectionNamePlaceholder')}
            onCommit={(v) => {
              setRenaming(false);
              if (v.trim()) onRename(v.trim());
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className="min-w-0 flex-1 cursor-text truncate text-[13px] text-ink" onClick={handleNameClick} onDoubleClick={(e) => e.stopPropagation()} title={collection.name}>
            {collection.name}
            {count > 0 && <span className="ml-1.5 text-[11px] text-muted/60">{count}</span>}
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className={`shrink-0 rounded-md p-1 text-muted transition-all duration-150 hover:bg-hover hover:text-ink ${
            menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <MoreHorizontal size={14} />
        </button>
        {menuOpen && (
          <Popover anchor={rowRef.current} onClose={() => setMenuOpen(false)}>
            <MenuItem
              onClick={() => {
                onNewRequest();
                setMenuOpen(false);
              }}
            >
              <Plus size={13} />
              {t('api.newRequestHere')}
            </MenuItem>
            <MenuItem
              onClick={() => {
                setRenaming(true);
                setMenuOpen(false);
              }}
            >
              <Pencil size={13} />
              {t('api.rename')}
            </MenuItem>
            <MenuItem
              danger
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
            >
              <Trash2 size={13} />
              {t('api.deleteCollection')}
            </MenuItem>
          </Popover>
        )}
      </div>
      {open && children && (
        <div className="ml-2.5 border-l border-line/70 pl-1" onDragOver={onChildDragOver} onDrop={onChildDrop}>
          {children}
        </div>
      )}
    </div>
  );
}

function RequestRow({
  request,
  title,
  active,
  collections,
  dragging,
  indicator,
  onOpen,
  onKeep,
  onMove,
  onDuplicate,
  onDelete,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  request: ApiRequest;
  title: string;
  active: boolean;
  collections: ApiCollection[];
  /** True while this row is the one being dragged. */
  dragging: boolean;
  /** Insertion line at the hovered edge ('before' | 'after' | none). */
  indicator: 'before' | 'after' | null;
  onOpen: () => void;
  onKeep: (name: string, collectionId: string | null) => void;
  onMove: (collectionId: string | null) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const { t } = useTranslation();
  const rowRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<'keep' | 'move' | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(request.name);
  const [target, setTarget] = useState(request.collectionId ?? '');
  // Double-click the title to rename inline — commits as a Keep that keeps
  // the request's current place (name + existing collection). A draft stays
  // a draft until it is deliberately kept into a collection.
  const handleTitleClick = useDoubleClick(() => setRenaming(true));

  const close = () => {
    setMenuOpen(false);
    setDialog(null);
  };

  return (
    <div
      ref={rowRef}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`group relative flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-hover ${
        active ? 'bg-primary/5' : ''
      } ${dragging ? 'opacity-40' : ''}`}
    >
      {indicator === 'before' && <DropLine position="top" />}
      {indicator === 'after' && <DropLine position="bottom" />}
      <Globe size={13} className={`shrink-0 ${active ? 'text-primary' : 'text-muted/70'}`} />
      {active && <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary" />}
      {renaming ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className={`shrink-0 rounded px-1 py-px text-[9.5px] font-bold leading-4 ${METHOD_CHIP[request.method as ApiMethod] ?? 'bg-muted/10 text-muted'}`}>{request.method}</span>
          <NameInput
            initial={request.name}
            placeholder={t('api.requestNamePlaceholder')}
            onCommit={(v) => {
              setRenaming(false);
              if (v.trim() !== request.name) onKeep(v.trim(), request.collectionId);
            }}
            onCancel={() => setRenaming(false)}
          />
        </div>
      ) : (
        <button onClick={(e) => { if (e.detail === 1) onOpen(); }} onDoubleClick={handleTitleClick} title={title} className={`flex min-w-0 flex-1 cursor-text items-center gap-1.5 text-left text-[13px] ${active ? 'font-semibold text-primary' : 'text-ink'}`}>
          <span className={`shrink-0 rounded px-1 py-px text-[9.5px] font-bold leading-4 ${METHOD_CHIP[request.method as ApiMethod] ?? 'bg-muted/10 text-muted'}`}>{request.method}</span>
          <span className="truncate">{title}</span>
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        className={`shrink-0 rounded-md p-1 text-muted transition-all duration-150 hover:bg-hover hover:text-ink ${
          menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <MoreHorizontal size={14} />
      </button>
      {menuOpen && (
        <Popover anchor={rowRef.current} onClose={close}>
          {dialog === 'keep' ? (
            <div className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted/70">
                {request.collectionId == null ? t('api.keep') : t('api.rename')}
              </div>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('api.requestNamePlaceholder')}
                className="field mb-1.5 w-full !px-2 !py-1 !text-xs"
              />
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="field mb-2 w-full !px-2 !py-1 !text-xs">
                <option value="">{t('api.drafts')}</option>
                {flattenCollections(collections).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              <div className="flex justify-end gap-1.5">
                <button onClick={close} className="ghost-btn !px-2.5 !py-1 !text-xs">
                  {t('api.cancel')}
                </button>
                <button
                  onClick={() => {
                    onKeep(name.trim(), target || null);
                    close();
                  }}
                  className="primary-btn !px-3 !py-1 !text-xs"
                >
                  {t('api.save')}
                </button>
              </div>
            </div>
          ) : dialog === 'move' ? (
            <div className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted/70">{t('api.moveTo')}</div>
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="field mb-2 w-full !px-2 !py-1 !text-xs">
                <option value="">{t('api.drafts')}</option>
                {flattenCollections(collections).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              <div className="flex justify-end gap-1.5">
                <button onClick={close} className="ghost-btn !px-2.5 !py-1 !text-xs">
                  {t('api.cancel')}
                </button>
                <button
                  onClick={() => {
                    onMove(target || null);
                    close();
                  }}
                  className="primary-btn !px-3 !py-1 !text-xs"
                >
                  {t('api.save')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <MenuItem
                onClick={() => {
                  setName(request.name);
                  setTarget(request.collectionId ?? '');
                  setDialog('keep');
                }}
              >
                <Pencil size={13} />
                {request.collectionId == null ? t('api.keep') : t('api.rename')}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setTarget(request.collectionId ?? '');
                  setDialog('move');
                }}
              >
                <Folder size={13} />
                {t('api.moveTo')}
              </MenuItem>
              <MenuItem onClick={onDuplicate}>
                <Copy size={13} />
                {t('api.duplicate')}
              </MenuItem>
              <MenuItem
                danger
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
              >
                <Trash2 size={13} />
                {t('api.deleteRequest')}
              </MenuItem>
            </>
          )}
        </Popover>
      )}
    </div>
  );
}

function HistoryRow({ entry, onOpen }: { entry: ApiHistoryEntry; onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  const method = entry.request.method;
  const statusClass =
    entry.status === 0
      ? 'bg-danger/15 text-danger'
      : entry.status < 300
        ? 'bg-success/15 text-success'
        : entry.status < 500
          ? 'bg-warning/15 text-warning'
          : 'bg-danger/15 text-danger';
  return (
    <button
      onClick={onOpen}
      title={t('api.historyOpen')}
      className="group flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-hover"
    >
      <HistoryIcon size={12} className="shrink-0 text-muted/60" />      <span className={`shrink-0 rounded px-1 py-px text-[9.5px] font-bold leading-4 ${METHOD_CHIP[method]}`}>{method}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-ink/80">{requestDisplayTitle(entry.request, t('api.untitled'))}</span>
      <span className="shrink-0 text-[10px] text-muted/50">{timeAgo(entry.sentAt, i18n.language)}</span>
      <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-bold ${statusClass}`}>
        {entry.status > 0 ? entry.status : 'ERR'}
      </span>
    </button>
  );
}

/** Flatten the collection tree into indented options for selects. */
function flattenCollections(collections: ApiCollection[]): [string, string][] {
  const out: [string, string][] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const c of collections.filter((x) => (x.parentId ?? null) === parentId)) {
      out.push([c.id, `${'　'.repeat(depth)}${c.name}`]);
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
