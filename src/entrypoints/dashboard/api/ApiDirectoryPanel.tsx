/**
 * ApiDirectoryPanel — the built-in free API directory.
 *
 * Browse ~120 curated free APIs (search + category + auth filters), star
 * the ones you want to keep, and hit Try to open a ready-to-send draft in
 * the Requests editor. Favorites persist locally and form the user's own
 * API toolkit.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, BookOpen, KeyRound, Lock, Play, Search, ShieldCheck, Star } from 'lucide-react';
import { API_DIRECTORY, API_DIRECTORY_CATEGORY_BY_ID, type DirectoryApi } from './apiDirectory';

interface ApiDirectoryPanelProps {
  favorites: string[];
  onToggleFavorite: (id: string) => void;
  onTryApi: (api: DirectoryApi) => void;
  onClose: () => void;
}

type AuthFilter = 'all' | 'none' | 'key';

export function ApiDirectoryPanel({ favorites, onToggleFavorite, onTryApi, onClose }: ApiDirectoryPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [auth, setAuth] = useState<AuthFilter>('all');
  const [onlyFavorites, setOnlyFavorites] = useState(false);

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return API_DIRECTORY.filter((api) => {
      if (onlyFavorites && !favoriteSet.has(api.id)) return false;
      if (category && api.category !== category) return false;
      if (auth === 'none' && api.auth !== 'none') return false;
      if (auth === 'key' && api.auth === 'none') return false;
      if (q && !`${api.name} ${api.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [query, category, auth, onlyFavorites, favoriteSet]);

  const categories = useMemo(() => [{ id: null, label: t('api.dirAll') }, ...API_DIRECTORY_CATEGORY_BY_ID.values()], [t]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-panel">
      {/* ——— Header ——— */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <button
          onClick={onClose}
          title={t('api.dirBack')}
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
        >
          <ArrowLeft size={15} />
        </button>
        <div className="flex min-w-0 items-center gap-1.5">
          <BookOpen size={14} className="shrink-0 text-primary" />
          <span className="truncate text-[13px] font-semibold text-ink">{t('api.dirTitle')}</span>
          <span className="shrink-0 rounded-full bg-hover px-1.5 py-0.5 text-[10px] font-semibold text-muted">{API_DIRECTORY.length}</span>
        </div>
        <div className="relative ml-1 min-w-0 flex-1">
          <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('api.dirSearch')}
            spellCheck={false}
            className="field w-full !py-1.5 !pl-7 !text-xs"
          />
        </div>
        <button
          onClick={() => setOnlyFavorites((v) => !v)}
          title={t('api.dirFavorites')}
          className={`flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-colors duration-150 ${
            onlyFavorites ? 'border-amber-400/50 bg-amber-400/10 text-amber-500' : 'border-line text-muted hover:border-primary/40 hover:text-primary'
          }`}
        >
          <Star size={12} className={favoriteSet.size > 0 ? 'fill-current' : ''} />
          {favoriteSet.size > 0 ? favoriteSet.size : t('api.dirFavorites')}
        </button>
      </div>

      {/* ——— Filters ——— */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <div className="app-scroller sb-hairline flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {categories.map((c) => (
            <button
              key={c.id ?? 'all'}
              onClick={() => setCategory(c.id)}
              className={`shrink-0 cursor-pointer rounded-full px-2.5 py-1 text-[11px] transition-colors duration-150 ${
                category === c.id ? 'bg-primary font-semibold text-white' : 'bg-hover text-muted hover:text-ink'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-line bg-hover p-0.5">
          {([['all', t('api.dirAuthAll')], ['none', t('api.dirAuthNone')], ['key', t('api.dirAuthKey')]] as [AuthFilter, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setAuth(id)}
              className={`cursor-pointer rounded-md px-2 py-0.5 text-[11px] transition-colors duration-150 ${
                auth === id ? 'bg-panel font-semibold text-ink shadow-sm' : 'text-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ——— List ——— */}
      <div className="app-scroller sb-hairline min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10">
            <Search size={20} className="text-muted/40" />
            <p className="text-[12px] text-muted">{onlyFavorites ? t('api.dirNoFavorites') : t('api.dirNoResults')}</p>
          </div>
        )}
        <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-2">
          {filtered.map((api) => {
            const cat = API_DIRECTORY_CATEGORY_BY_ID.get(api.category);
            const fav = favoriteSet.has(api.id);
            return (
              <div key={api.id} className="group flex items-start gap-2 rounded-xl border border-line bg-surface/60 p-2.5 transition-colors duration-150 hover:border-primary/30">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px] font-semibold text-ink">{api.name}</span>
                    {api.auth === 'none' ? (
                      <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-success/12 px-1.5 py-px text-[9.5px] font-bold text-success" title={t('api.dirNoKeyHint')}>
                        <ShieldCheck size={9} />
                        {t('api.dirFree')}
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-warning/12 px-1.5 py-px text-[9.5px] font-bold text-warning" title={api.auth === 'bearer' ? t('api.dirBearerHint') : t('api.dirKeyHint')}>
                        {api.auth === 'bearer' ? <Lock size={9} /> : <KeyRound size={9} />}
                        {t('api.dirKey')}
                      </span>
                    )}
                    {!api.cors && (
                      <span className="shrink-0 rounded-full bg-hover px-1.5 py-px text-[9.5px] font-semibold text-muted" title={t('api.dirCorsHint')}>
                        ⚠ CORS
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted">{api.description}</p>
                  {cat && <span className="mt-1 inline-block rounded-full bg-primary/8 px-1.5 py-px text-[9.5px] font-semibold text-primary/80">{cat.label}</span>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <button
                    onClick={() => onToggleFavorite(api.id)}
                    title={fav ? t('api.dirUnfavorite') : t('api.dirFavorite')}
                    className={`flex size-6 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 ${
                      fav ? 'text-amber-500' : 'text-muted/50 opacity-0 hover:bg-hover hover:text-amber-500 group-hover:opacity-100'
                    }`}
                  >
                    <Star size={13} className={fav ? 'fill-current' : ''} />
                  </button>
                  <button
                    onClick={() => onTryApi(api)}
                    title={t('api.dirTryHint')}
                    className="flex cursor-pointer items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-semibold text-white transition-colors duration-150 hover:bg-primary/90"
                  >
                    <Play size={10} className="fill-current" />
                    {t('api.dirTry')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="pb-1 pt-3 text-center text-[10px] leading-relaxed text-muted/60">
          {t('api.dirNotice')}
        </p>
      </div>
    </div>
  );
}