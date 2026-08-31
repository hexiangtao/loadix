export interface Detection {
  toolId: string;
  label: string;
}

/**
 * Best-effort content sniffing for the smart-paste box. Only high-confidence
 * matches are returned; ambiguous text returns null and the user picks a tool
 * manually (the box then behaves as a normal search).
 */
export function detectContent(text: string): Detection | null {
  const t = text.trim();
  if (!t || t.length < 8) return null;

  // JWT: three base64url segments.
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t)) {
    return { toolId: 'jwt', label: 'JWT' };
  }

  // JSON object / array.
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try {
      JSON.parse(t);
      return { toolId: 'json', label: 'JSON' };
    } catch {
      /* fall through */
    }
  }

  // Base64: canonical charset, sane length, multiple of 4 after padding strip.
  const compact = t.replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(compact) && compact.length >= 12 && compact.replace(/=+$/, '').length % 4 === 0) {
    return { toolId: 'base64', label: 'Base64' };
  }

  // Unicode \uXXXX escape sequences.
  if (/\\u(?:\{[0-9a-fA-F]{1,5}\}|[0-9a-fA-F]{4})/.test(t)) {
    return { toolId: 'unicode', label: 'Unicode' };
  }

  return null;
}
