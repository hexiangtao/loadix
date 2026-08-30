import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface CopyButtonProps {
  text: string;
  className?: string;
}

/** One-click copy with transient "copied" feedback. */
export function CopyButton({ text, className }: CopyButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      onClick={copy}
      className={`ghost-btn px-2.5 py-1.5 text-xs ${className ?? ''} ${copied ? 'border-success text-success' : ''}`}
    >
      {copied ? t('tools.copied') : t('tools.copy')}
    </button>
  );
}
