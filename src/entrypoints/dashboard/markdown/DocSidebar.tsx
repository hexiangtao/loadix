import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { docDisplayTitle, type MarkdownDoc, type MarkdownFolder } from './docStore';

interface DocSidebarProps {
  docs: MarkdownDoc[];
  folders: MarkdownFolder[];
  activeDocId: string | null;
  /** Rendered as nothing at all (fullscreen reading). */
  hidden?: boolean;
  onOpenDoc: (id: string) => void;
  onCreateDoc: (folderId: string | null) => void;
  onCreateFolder: (name: string) => void;
  onRenameDoc: (id: string, title: string) => void;
  onMoveDoc: (id: string, folderId: string | null) => void;
  onDeleteDoc: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
}

const COLLAPSED_KEY = 'loadix-tool:markdown.sidebarCollapsed';

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
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
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

/** Small popover with a transparent backdrop; content is the caller's. */
function Popover({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div className="absolute right-0 top-full z-30 mt-0.5 w-44 overflow-hidden rounded-lg border border-line bg-panel py-1 shadow-2xl">
        {children}
      </div>
    </>
  );
}

function MenuItem({
  danger,
  onClick,
  children,
}: {
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors duration-100 ${
        danger ? 'text-danger hover:bg-danger/10' : 'text-muted hover:bg-hover hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

/** A document row: title, active highlight, ⋯ menu (rename / move / delete). */
function DocRow({
  doc,
  title,
  active,
  folders,
  onOpen,
  onRename,
  onMove,
  onDelete,
}: {
  doc: MarkdownDoc;
  title: string;
  active: boolean;
  folders: MarkdownFolder[];
  onOpen: () => void;
  onRename: (title: string) => void;
  onMove: (folderId: string | null) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const close = () => {
    setMenuOpen(false);
    setMoveOpen(false);
  };

  return (
    <div className="group relative flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-hover">
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
          className={`min-w-0 flex-1 truncate text-left text-[13px] transition-colors duration-150 ${
            active ? 'font-semibold text-primary' : 'text-ink'
          }`}
        >
          {title}
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
        <Popover onClose={close}>
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

/** A folder row: expand chevron, ⋯ menu (new doc here / rename / delete). */
function FolderRow({
  folder,
  count,
  open,
  onToggle,
  onCreateDoc,
  onRename,
  onDelete,
}: {
  folder: MarkdownFolder;
  count: number;
  open: boolean;
  onToggle: () => void;
  onCreateDoc: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const close = () => setMenuOpen(false);

  return (
    <div
      className="group relative flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-hover"
      onClick={onToggle}
    >
      {open ? (
        <ChevronDown size={13} className="shrink-0 text-muted" />
      ) : (
        <ChevronRight size={13} className="shrink-0 text-muted" />
      )}
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
        <Popover onClose={close}>
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

/**
 * Document workspace rail: folder tree + document list with inline rename,
 * move-to-folder and delete, plus the new-document / new-folder actions.
 * Collapsible to an icon strip; hidden entirely in fullscreen reading.
 */
export function DocSidebar(props: DocSidebarProps) {
  const { docs, folders, activeDocId, hidden, onOpenDoc } = props;
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [namingFolder, setNamingFolder] = useState(false);

  // New folders default to expanded; the toggle sticks for the session.
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const f of folders) {
        if (!next.has(f.id)) {
          next.add(f.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [folders]);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  if (hidden) return null;

  const untitled = t('tools.markdown.untitled');
  const byFolder = (folderId: string | null) =>
    docs.filter((d) => d.folderId === folderId).sort((a, b) => b.updatedAt - a.updatedAt);
  const sortedFolders = [...folders].sort((a, b) => a.createdAt - b.createdAt);

  // Icon strip when collapsed: reopen + quick new document.
  if (collapsed) {
    return (
      <div className="flex w-12 shrink-0 flex-col items-center gap-1.5 rounded-xl border border-line bg-panel py-3">
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
    );
  }

  return (
    <div className="flex w-60 shrink-0 flex-col rounded-xl border border-line bg-panel">
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
          onClick={() => props.onCreateDoc(null)}
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

      {/* Tree */}
      <div className="app-scroller min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {namingFolder && (
          <div className="px-2 py-1">
            <RenameInput
              initial=""
              placeholder={t('tools.markdown.folderNamePlaceholder')}
              onCommit={(v) => {
                setNamingFolder(false);
                if (v.trim()) props.onCreateFolder(v.trim());
              }}
              onCancel={() => setNamingFolder(false)}
            />
          </div>
        )}

        {docs.length === 0 && !namingFolder ? (
          <p className="px-3 py-8 text-center text-xs leading-relaxed text-muted">{t('tools.markdown.emptyDocs')}</p>
        ) : (
          <>
            {/* Root group */}
            <div className="mb-0.5 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-muted/70">
              {t('tools.markdown.root')}
            </div>
            {byFolder(null).map((doc) => (
              <DocRow
                key={doc.id}
                doc={doc}
                title={docDisplayTitle(doc, untitled)}
                active={doc.id === activeDocId}
                folders={folders}
                onOpen={() => onOpenDoc(doc.id)}
                onRename={(title) => props.onRenameDoc(doc.id, title)}
                onMove={(folderId) => props.onMoveDoc(doc.id, folderId)}
                onDelete={() => props.onDeleteDoc(doc.id)}
              />
            ))}

            {/* Folder groups */}
            {sortedFolders.map((folder) => {
              const open = expanded.has(folder.id);
              const items = byFolder(folder.id);
              return (
                <div key={folder.id} className="mb-0.5">
                  <FolderRow
                    folder={folder}
                    count={items.length}
                    open={open}
                    onToggle={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(folder.id)) next.delete(folder.id);
                        else next.add(folder.id);
                        return next;
                      })
                    }
                    onCreateDoc={() => props.onCreateDoc(folder.id)}
                    onRename={(name) => props.onRenameFolder(folder.id, name)}
                    onDelete={() => props.onDeleteFolder(folder.id)}
                  />
                  {open && (
                    <div className="ml-3 border-l border-line pl-2">
                      {items.map((doc) => (
                        <DocRow
                          key={doc.id}
                          doc={doc}
                          title={docDisplayTitle(doc, untitled)}
                          active={doc.id === activeDocId}
                          folders={folders}
                          onOpen={() => onOpenDoc(doc.id)}
                          onRename={(title) => props.onRenameDoc(doc.id, title)}
                          onMove={(folderId) => props.onMoveDoc(doc.id, folderId)}
                          onDelete={() => props.onDeleteDoc(doc.id)}
                        />
                      ))}
                      {items.length === 0 && (
                        <p className="px-2 py-1 text-[11px] text-muted/60">{t('tools.markdown.emptyFolder')}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}