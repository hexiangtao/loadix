import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ToolShellProps {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}

/**
 * Shared outer shell for every tool. Gives a consistent header (icon + title +
 * "local" badge) so the user learns the layout once and every tool feels the
 * same. The tool only fills in its own input/output body.
 */
export function ToolShell({ icon: Icon, title, children }: ToolShellProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-line bg-panel shadow-sm">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Icon size={18} className="text-primary" />
          <span className="text-[15px] font-bold">{title}</span>
        </div>
        <span
          className="flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-semibold text-success"
          title={t('tools.localHint')}
        >
          <span className="inline-block size-1.5 rounded-full bg-success" />
          {t('tools.local')}
        </span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
