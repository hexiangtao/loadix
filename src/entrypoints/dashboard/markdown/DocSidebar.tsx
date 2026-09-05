import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Broom,
  ChevronDown,
  FileText,
  Folder,
  FolderPlus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { docDisplayTitle, type MarkdownDoc, type MarkdownFolder } from './docStore';

interface DocSidebarProps {
  docs: MarkdownDoc[];
  /** Documents currently in the recycle bin. */
  trashedDocs: MarkdownDoc[];
  folders: MarkdownFolder[];
  activeDocId: string | null;
  /** Rendered as nothing at all (fullscreen reading). */
  hidden?: boolean;
  onOpenDoc: (id: string) => void;
  onCreateDoc: (folderId: string | null) => void;
  onCreateFolder: (name: string, parentId: string | null) => void;
  onRenameDoc: (id: string, title: string) => void;
  onMoveDoc: (id: string, folderId: string | null) => void;
  onDeleteDoc: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveFolder: (id: string, parentId: string | null) => void;
  onRestoreDoc: (id: string) => void;
  onDeleteDocForever: (id: string) => void;
  onEmptyTrash: () => void;
}

const COLLAPSED_KEY = 'loadix-tool:markdown.sidebarCollapsed';
const TRASH_KEY = '__trash__';
/** How many recency-sorted documents to surface in the quick-access strip. */
const RECENT_LIMIT = 5;
const MIME_DOC = 'application/x-loadix-doc';
const MIME_FOLDER = 'application/x-loadix-folder';

/** Drag payload shared by the whole rail: which row is being dragged. */
type DragState = { type: 'doc' | 'folder'; id: string } | null;

/** Inline rename input shared by doc and folder rows. */
function RenameInput({
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

/** Small popover with a transparent backdrop; content is the caller's.
    Rendered through a portal at fixed viewport coordinates so deeply nested
    rows inside overflow scrollers can't clip it. Flips above the anchor when
    it would run past the bottom of the window. */
function Popover({
  anchor,
  onClose,
  children,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // Position right after mount (hidden until then) and again whenever the
  // menu resizes (e.g. toggling the move-to submenu) or the window resizes.
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const menuH = menuRef.current?.offsetHeight ?? 0;
      const gap = 4;
      let top = rect.bottom + gap;
      if (top + menuH > window.innerHeight - 8) {
        top = Math.max(8, rect.top - menuH - gap);
      }
      setPos({ top, right: Math.max(8, window.innerWidth - rect.right) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, children]);

  // Scrolling any container detaches the menu from its anchor — close it.
  useEffect(() => {
    window.addEventListener('scroll', onClose, true);
    return () => window.removeEventListener('scroll', onClose, true);
  }, [onClose]);

  return createPortal(
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div
        ref={menuRef}
        style={pos ?? { visibility: 'hidden' }}
        className="fixed z-50 w-44 overflow-hidden rounded-lg border border-line bg-panel py-1 shadow-2xl"
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

function MenuItem({
  danger,
  disabled,
  onClick,
  children,
}: {
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? 'text-danger hover:bg-danger/10' : 'text-muted hover:bg-hover hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Animated vertical reveal: the children wrapper transitions between a 1fr and
 * 0fr grid row, so arbitrary content heights collapse/expand smoothly.
 */
function Collapsible({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-200 ease-out ${
        open ? '[grid-template-rows:1fr]' : '[grid-template-rows:0fr]'
      }`}
    >
      <div className={`min-h-0 overflow-hidden ${open ? '' : 'pointer-events-none'}`}>{children}</div>
    </div>
  );
}

/** A live document row: draggable, title, active highlight, ⋯ menu. */
function DocRow({
  doc,
  title,
  hint,
  active,
  folders,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
  onRename,
  onMove,
  onDelete,
}: {
  doc: MarkdownDoc;
  title: string;
  /** Small muted context shown after the title (e.g. the folder a recent
      doc lives in) so shortcuts stay unambiguous. */
  hint?: string;
  active: boolean;
  folders: MarkdownFolder[];
  dragging: boolean;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onRename: (title: string) => void;
  onMove: (folderId: string | null) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const rowRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const close = () => {
    setMenuOpen(false);
    setMoveOpen(false);
  };

  return (
    <div
      ref={rowRef}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group relative flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-hover ${
        dragging ? 'opacity-40' : ''
      }`}
    >
      <FileText size={13} className={`shrink-0 ${active ? 'text-primary' : 'text-muted/70'}`} />
      {renaming ? (
        <RenameInput
          initial={title}
          placeholder={t('tools.markdown.docTitlePlaceholder')}
          onCommit={(v) => {
            setRenaming(false);
            if (v.trim()) onRename(v.trim());
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <button
          onClick={onOpen}
          className={`flex min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] transition-colors duration-150 ${
            active ? 'font-semibold text-primary' : 'text-ink'
          }`}
        >
          <span className="truncate">{title}</span>
          {hint && <span className="shrink-0 text-[11px] text-muted/60">· {hint}</span>}
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
          {moveOpen ? (
            <>
              <div className="px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-muted/70">
                {t('tools.markdown.moveTo')}
              </div>
              <MenuItem
                onClick={() => {
                  onMove(null);
                  close();
                }}
              >
                <Folder size={13} />
                {t('tools.markdown.root')}
              </MenuItem>
              {folders.map((f) => (
                <MenuItem
                  key={f.id}
                  onClick={() => {
                    onMove(f.id);
                    close();
                  }}
                >
                  <Folder size={13} />
                  <span className="truncate">{f.name}</span>
                </MenuItem>
              ))}
            </>
          ) : (
            <>
              <MenuItem
                onClick={() => {
                  setRenaming(true);
                  close();
                }}
              >
                <Pencil size={13} />
                {t('tools.markdown.rename')}
              </MenuItem>
              <MenuItem onClick={() => setMoveOpen(true)}>
                <Folder size={13} />
                {t('tools.markdown.moveTo')}
              </MenuItem>
              <MenuItem
                danger
                onClick={() => {
                  onDelete();
                  close();
                }}
              >
                <Trash2 size={13} />
                {t('tools.markdown.delete')}
              </MenuItem>
            </>
          )}
        </Popover>
      )}
    </div>
  );
}

/** A trashed document: restore + permanent-delete, both one click (the latter confirms). */
function TrashDocRow({
  title,
  onRestore,
  onDeleteForever,
}: {
  title: string;
  onRestore: () => void;
  onDeleteForever: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="group relative flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-hover">
      <FileText size={13} className="shrink-0 text-muted/60" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted line-through decoration-muted/40">
        {title}
      </span>
      <button
        onClick={onRestore}
        title={t('tools.markdown.restore')}
        className="shrink-0 rounded-md p-1 text-muted/80 transition-all duration-150 hover:bg-hover hover:text-primary"
      >
        <RotateCcw size={13} />
      </button>
      <button
        onClick={onDeleteForever}
        title={t('tools.markdown.deleteForever')}
        className="shrink-0 rounded-md p-1 text-muted/80 transition-all duration-150 hover:bg-danger/10 hover:text-danger"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

/** A folder row: expand chevron, drop target, ⋯ menu (new doc here / rename / delete). */
function FolderRow({
  folder,
  count,
  open,
  indent,
  dragging,
  over,
  onToggle,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onCreateDoc,
  onRename,
  onDelete,
}: {
  folder: MarkdownFolder;
  count: number;
  open: boolean;
  indent: number;
  dragging: boolean;
  over: boolean;
  onToggle: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onCreateDoc: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const rowRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const close = () => setMenuOpen(false);

  return (
    <div
      ref={rowRef}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onToggle}
      style={{ paddingLeft: 8 + indent * 12 }}
      className={`group relative flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-hover ${
        dragging ? 'opacity-40' : ''
      } ${over ? 'bg-primary/10 ring-1 ring-primary' : ''}`}
    >
      <ChevronDown
        size={13}
        className={`shrink-0 text-muted transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
      />
      <Folder size={14} className="shrink-0 text-primary" />
      {renaming ? (
        <RenameInput
          initial={folder.name}
          placeholder={t('tools.markdown.folderNamePlaceholder')}
          onCommit={(v) => {
            setRenaming(false);
            if (v.trim()) onRename(v.trim());
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
          {folder.name}
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
        <Popover anchor={rowRef.current} onClose={close}>
          <MenuItem
            onClick={() => {
              onCreateDoc();
              close();
            }}
          >
            <Plus size={13} />
            {t('tools.markdown.newDocIn')}
          </MenuItem>
          <MenuItem
            onClick={() => {
              setRenaming(true);
              close();
            }}
          >
            <Pencil size={13} />
            {t('tools.markdown.rename')}
          </MenuItem>
          <MenuItem
            danger
            onClick={() => {
              onDelete();
              close();
            }}
          >
            <Trash2 size={13} />
            {t('tools.markdown.delete')}
          </MenuItem>
        </Popover>
      )}
    </div>
  );
}

/** The recycle bin header row: drop target for documents, empty action in ⋯. */
function TrashRow({
  count,
  open,
  over,
  onToggle,
  onEmpty,
  onDragOver,
  onDrop,
}: {
  count: number;
  open: boolean;
  over: boolean;
  onToggle: () => void;
  onEmpty: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const { t } = useTranslation();
  const rowRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      ref={rowRef}
      onClick={onToggle}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`group relative flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-hover ${
        over ? 'bg-primary/10 ring-1 ring-primary' : ''
      }`}
    >
      <ChevronDown
        size={13}
        className={`shrink-0 text-muted transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
      />
      <Trash2 size={14} className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
        {t('tools.markdown.trash')}
        {count > 0 && <span className="ml-1.5 text-[11px] text-muted/60">{count}</span>}
      </span>
      {count > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEmpty();
          }}
          title={t('tools.markdown.emptyTrash')}
          className="shrink-0 rounded-md p-1 text-muted/80 transition-colors duration-150 hover:bg-danger/10 hover:text-danger"
        >
          <Broom size={13} />
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
        <Popover anchor={rowRef.current} onClose={() => setMenuOpen(false)}>
          <MenuItem
            danger
            disabled={count === 0}
            onClick={() => {
              onEmpty();
              setMenuOpen(false);
            }}
          >
            <Trash2 size={13} />
            {t('tools.markdown.emptyTrash')}
          </MenuItem>
        </Popover>
      )}
    </div>
  );
}

/**
 * Document workspace rail: a nested folder tree with drag-and-drop, a fixed
 * recycle bin, inline rename and move-to-folder menus. Collapsible to an icon
 * strip (width transition) and hidden entirely in fullscreen reading.
 */
export function DocSidebar(props: DocSidebarProps) {
  const { docs, trashedDocs, folders, activeDocId, hidden, onOpenDoc } = props;
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([TRASH_KEY]));
  /** Drill-down navigation: folder ids from root to the folder currently
      shown. Empty = the root view. Depth is expressed as a breadcrumb path,
      never as indentation. */
  const [navPath, setNavPath] = useState<string[]>([]);
  const [namingFolder, setNamingFolder] = useState(false);
  const [dragState, setDragState] = useState<DragState>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // If the folder open in drill-down mode disappears (deleted), step up one
  // level instead of pointing into the void.
  useEffect(() => {
    const current = navPath[navPath.length - 1];
    if (current != null && !folders.some((f) => f.id === current)) {
      setNavPath((p) => p.slice(0, -1));
    }
  }, [folders, navPath]);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  if (hidden) return null;

  const untitled = t('tools.markdown.untitled');
  const byUpdatedAt = (a: MarkdownDoc, b: MarkdownDoc) => b.updatedAt - a.updatedAt;
  const byCreatedAt = (a: MarkdownFolder, b: MarkdownFolder) => a.createdAt - b.createdAt;
  const byFolder = (folderId: string | null) =>
    docs.filter((d) => d.folderId === folderId).sort(byUpdatedAt);
  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /* ——— Recency-first, drill-down layout ——— */
  const hasFolders = folders.length > 0;
  const recentDocs = [...docs].sort(byUpdatedAt).slice(0, RECENT_LIMIT);
  const folderNameOf = (folderId: string | null) =>
    folderId == null ? undefined : folders.find((f) => f.id === folderId)?.name;

  // Current drill-down location: the last breadcrumb entry (null = root view).
  const currentFolderId = navPath.length > 0 ? (navPath[navPath.length - 1] ?? null) : null;
  const navigateInto = (folderId: string) => setNavPath((p) => [...p, folderId]);

  // The recency strip is a shortcut to docs outside the current level — hide
  // it when it would only duplicate what the level list already shows. (Note:
  // this must come after currentFolderId is declared — the .every() callback
  // runs synchronously inside this initializer.)
  const showRecent = !(recentDocs.length > 0 && recentDocs.every((d) => d.folderId === currentFolderId));

  /* ——— Drag & drop ——— */

  const startDrag = (e: React.DragEvent, type: 'doc' | 'folder', id: string) => {
    e.dataTransfer.setData(type === 'doc' ? MIME_DOC : MIME_FOLDER, id);
    e.dataTransfer.effectAllowed = 'move';
    setDragState({ type, id });
    setDropTarget(null);
  };

  const endDrag = () => {
    setDragState(null);
    setDropTarget(null);
  };

  /** Whether `target` ('root' | folder id | 'trash') accepts the current drag. */
  const canDrop = (target: string): boolean => {
    if (!dragState) return false;
    if (target === 'trash') return dragState.type === 'doc';
    if (dragState.type === 'doc') return true;
    // Folders: no self-drop, and never into their own subtree (cycles).
    if (target === 'root') return true;
    if (target === dragState.id) return false;
    let cur = folders.find((f) => f.id === target);
    while (cur) {
      if (cur.id === dragState.id) return false;
      const parentId = cur.parentId;
      cur = parentId != null ? folders.find((f) => f.id === parentId) : undefined;
    }
    return true;
  };

  const dragOver = (e: React.DragEvent, target: string) => {
    if (!canDrop(target)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(target);
  };

  const drop = (e: React.DragEvent, target: string) => {
    e.preventDefault();
    if (!dragState || !canDrop(target)) return;
    const { type, id } = dragState;
    if (type === 'doc') {
      if (target === 'trash') props.onDeleteDoc(id);
      else props.onMoveDoc(id, target === 'root' ? null : target);
    } else if (target !== 'trash') {
      props.onMoveFolder(id, target === 'root' ? null : target);
    }
    endDrag();
  };

  /** One flat level of drill-down navigation: subfolders (tap to enter) then
      documents. Depth is carried by the breadcrumb path, never indentation. */
  const renderLevel = (folderId: string | null) => {
    const subs = folders.filter((f) => (f.parentId ?? null) === folderId).sort(byCreatedAt);
    const items = byFolder(folderId);
    return (
      <div>
        {subs.map((f) => (
          <FolderRow
            key={f.id}
            folder={f}
            count={byFolder(f.id).length}
            open={false}
            indent={0}
            dragging={dragState?.type === 'folder' && dragState.id === f.id}
            over={dropTarget === f.id}
            onToggle={() => navigateInto(f.id)}
            onDragStart={(e) => startDrag(e, 'folder', f.id)}
            onDragEnd={endDrag}
            onDragOver={(e) => dragOver(e, f.id)}
            onDrop={(e) => drop(e, f.id)}
            onCreateDoc={() => props.onCreateDoc(f.id)}
            onRename={(name) => props.onRenameFolder(f.id, name)}
            onDelete={() => props.onDeleteFolder(f.id)}
          />
        ))}
        {items.map((doc) => (
          <DocRow
            key={doc.id}
            doc={doc}
            title={docDisplayTitle(doc, untitled)}
            active={doc.id === activeDocId}
            folders={folders}
            dragging={dragState?.type === 'doc' && dragState.id === doc.id}
            onOpen={() => onOpenDoc(doc.id)}
            onDragStart={(e) => startDrag(e, 'doc', doc.id)}
            onDragEnd={endDrag}
            onRename={(title) => props.onRenameDoc(doc.id, title)}
            onMove={(folderId) => props.onMoveDoc(doc.id, folderId)}
            onDelete={() => props.onDeleteDoc(doc.id)}
          />
        ))}
        {subs.length === 0 && items.length === 0 && (
          <p className="px-2 py-1 text-[11px] text-muted/60">{t('tools.markdown.emptyFolder')}</p>
        )}
      </div>
    );
  };

  // Icon strip when collapsed: reopen + quick new document. The container
  // keeps a constant frame and animates the width so the collapse glides.
  return (
    <div
      className={`shrink-0 overflow-hidden border-r border-line bg-surface transition-[width] duration-300 ease-out ${
        collapsed ? 'w-12' : 'w-60'
      }`}
    >
      {collapsed ? (
        <div className="flex w-12 flex-col items-center gap-1.5 py-3">
          <button
            onClick={() => setCollapsed(false)}
            title={t('tools.expandSidebar')}
            className="rounded-lg p-2 text-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
          >
            <PanelLeftOpen size={16} />
          </button>
          <button
            onClick={() => props.onCreateDoc(null)}
            title={t('tools.markdown.newDoc')}
            className="rounded-lg p-2 text-primary transition-colors duration-150 hover:bg-primary/10"
          >
            <Plus size={16} />
          </button>
        </div>
      ) : (
        <div className="flex h-full w-60 flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-3 pb-2 pt-3">
            <span className="pl-1 text-xs font-bold text-muted">{t('tools.markdown.documents')}</span>
            <button
              onClick={() => setCollapsed(true)}
              title={t('tools.collapseSidebar')}
              className="rounded-lg p-1.5 text-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
            >
              <PanelLeftClose size={16} />
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-1.5 px-3 pb-2">
            <button
              onClick={() => props.onCreateDoc(currentFolderId)}
              className="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg bg-primary px-2 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-primary/90"
            >
              <Plus size={13} />
              {t('tools.markdown.newDoc')}
            </button>
            <button
              onClick={() => setNamingFolder(true)}
              title={t('tools.markdown.newFolder')}
              className="cursor-pointer rounded-lg border border-line px-2 py-1.5 text-muted transition-colors duration-150 hover:border-primary hover:text-primary"
            >
              <FolderPlus size={14} />
            </button>
          </div>

          {/* Breadcrumb — the current location in the hierarchy. Deep nesting
              shows up here as a path you can jump on, never as indentation. */}
          {hasFolders && (
            <div className="app-scroller sb-hairline flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-2 py-1.5">
              <button
                onClick={() => setNavPath([])}
                className={`shrink-0 rounded px-1 py-0.5 text-[12px] transition-colors duration-150 ${
                  navPath.length === 0 ? 'font-semibold text-ink' : 'text-muted hover:bg-hover hover:text-ink'
                }`}
              >
                {t('tools.markdown.allDocs')}
              </button>
              {navPath.map((id, i) => {
                const f = folders.find((x) => x.id === id);
                if (!f) return null;
                const isLast = i === navPath.length - 1;
                return (
                  <Fragment key={id}>
                    <span className="shrink-0 text-[11px] text-muted/40">/</span>
                    <button
                      onClick={() => setNavPath(navPath.slice(0, i + 1))}
                      className={`shrink-0 rounded px-1 py-0.5 text-[12px] transition-colors duration-150 ${
                        isLast ? 'font-semibold text-ink' : 'text-muted hover:bg-hover hover:text-ink'
                      }`}
                    >
                      <span className="block max-w-28 truncate">{f.name}</span>
                    </button>
                  </Fragment>
                );
              })}
            </div>
          )}

          {/* Content — recency-first, one level at a time */}
          <div className="app-scroller sb-hairline min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {namingFolder && (
              <div className="px-2 py-1">
                <RenameInput
                  initial=""
                  placeholder={t('tools.markdown.folderNamePlaceholder')}                    onCommit={(v) => {
                      setNamingFolder(false);
                      if (v.trim()) props.onCreateFolder(v.trim(), currentFolderId);
                    }}
                  onCancel={() => setNamingFolder(false)}
                />
              </div>
            )}

            {hasFolders ? (
              <>
                {/* The recency strip only earns its space as a shortcut —
                    hidden when every recent doc is already visible in the
                    current level (e.g. a flat root view). */}
                {showRecent && (
                  <div className="border-b border-line pb-1 pt-1">
                    <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-muted/70">
                      {t('tools.markdown.recentDocs')}
                    </div>
                    {recentDocs.length === 0 ? (
                      <p className="px-3 py-6 text-center text-xs leading-relaxed text-muted">
                        {t('tools.markdown.emptyDocs')}
                      </p>
                    ) : (
                      recentDocs.map((doc) => (
                        <DocRow
                          key={doc.id}
                          doc={doc}
                          title={docDisplayTitle(doc, untitled)}
                          hint={folderNameOf(doc.folderId)}
                          active={doc.id === activeDocId}
                          folders={folders}
                          dragging={dragState?.type === 'doc' && dragState.id === doc.id}
                          onOpen={() => onOpenDoc(doc.id)}
                          onDragStart={(e) => startDrag(e, 'doc', doc.id)}
                          onDragEnd={endDrag}
                          onRename={(title) => props.onRenameDoc(doc.id, title)}
                          onMove={(folderId) => props.onMoveDoc(doc.id, folderId)}
                          onDelete={() => props.onDeleteDoc(doc.id)}
                        />
                      ))
                    )}
                  </div>
                )}

                {/* Current location — one flat level under the breadcrumb.
                    Subfolders (tap to enter) then documents. */}
                <div className="pt-1">
                  {renderLevel(currentFolderId)}
                </div>
              </>
            ) : (
              /* No folders — a flat recency list. No tree chrome at all:
                 no 根目录 pseudo-heading, no nesting, nothing to navigate. */
              docs.length === 0 && !namingFolder ? (
                <p className="px-3 py-8 text-center text-xs leading-relaxed text-muted">
                  {t('tools.markdown.emptyDocs')}
                </p>
              ) : (
                byFolder(null).map((doc) => (
                  <DocRow
                    key={doc.id}
                    doc={doc}
                    title={docDisplayTitle(doc, untitled)}
                    active={doc.id === activeDocId}
                    folders={folders}
                    dragging={dragState?.type === 'doc' && dragState.id === doc.id}
                    onOpen={() => onOpenDoc(doc.id)}
                    onDragStart={(e) => startDrag(e, 'doc', doc.id)}
                    onDragEnd={endDrag}
                    onRename={(title) => props.onRenameDoc(doc.id, title)}
                    onMove={(folderId) => props.onMoveDoc(doc.id, folderId)}
                    onDelete={() => props.onDeleteDoc(doc.id)}
                  />
                ))
              )
            )}
          </div>

          {/* Recycle bin — pinned footer so it never scrolls out of reach,
              visually separated from the document content. */}
          <div className="shrink-0 border-t border-line px-2 pb-2 pt-1">
            <TrashRow
              count={trashedDocs.length}
              open={expanded.has(TRASH_KEY)}
              over={dropTarget === 'trash'}
              onToggle={() => toggleExpanded(TRASH_KEY)}
              onEmpty={props.onEmptyTrash}
              onDragOver={(e) => dragOver(e, 'trash')}
              onDrop={(e) => drop(e, 'trash')}
            />
            <Collapsible open={expanded.has(TRASH_KEY)}>
              <div className="ml-3 border-l border-line pl-2">
                {trashedDocs.length === 0 ? (
                  <p className="px-2 py-1 text-[11px] text-muted/60">{t('tools.markdown.trashEmpty')}</p>
                ) : (
                  <div className="app-scroller sb-hairline max-h-52 overflow-y-auto pr-0.5">
                    {trashedDocs.map((doc) => (
                      <TrashDocRow
                        key={doc.id}
                        title={docDisplayTitle(doc, untitled)}
                        onRestore={() => props.onRestoreDoc(doc.id)}
                        onDeleteForever={() => props.onDeleteDocForever(doc.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </Collapsible>
          </div>
        </div>
      )}
    </div>
  );
}