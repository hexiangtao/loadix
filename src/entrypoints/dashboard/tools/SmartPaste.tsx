import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardPaste, CornerDownLeft } from 'lucide-react';
import { TOOLS } from './registry';
import { detectContent } from './detect';

interface SmartPasteProps {
  onOpen: (id: string, payload?: string) => void;
}

/**
 * Smart paste box: paste anything and it detects the content type, offering a
 * one-click jump into the matching tool with the content pre-filled. Falls
 * back to a plain tool search when nothing is recognized.
 */
export function SmartPaste({ onOpen }: SmartPasteProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const detection = detectContent(value);

  const submit = () => {
    if (detection) {
      onOpen(detection.toolId, value.trim());
    }
  };

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 rounded-xl border border-line bg-panel px-3.5 py-3 transition-colors duration-150 focus-within:border-primary">
        <ClipboardPaste size={18} className="shrink-0 text-muted" />
        <input
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
          placeholder={t('tools.smartPaste')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && detection) submit();
          }}
        />
        {detection && (
          <button
            onClick={submit}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary transition-colors duration-150 hover:bg-primary hover:text-white"
          >
            {t('tools.openWith', { label: detection.label })}
            <CornerDownLeft size={12} />
          </button>
        )}
      </div>
      {value.trim() && !detection && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">{t('tools.pickTool')}</span>
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                onClick={() => onOpen(tool.id, value.trim())}
                className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-muted transition-colors duration-150 hover:border-primary hover:text-primary"
              >
                <Icon size={12} />
                {t(tool.nameKey)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
