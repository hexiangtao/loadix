import type { ComponentType } from 'react';
import { Binary, Braces, KeyRound, Regex, type LucideIcon } from 'lucide-react';
import { Base64Tool } from './tools/Base64Tool';
import { JsonTool } from './tools/JsonTool';
import { JwtTool } from './tools/JwtTool';
import { RegexTool } from './tools/RegexTool';

export type ToolGroup = 'encode' | 'format' | 'auth' | 'text';

export interface ToolProps {
  /** Content routed from the smart-paste box (pre-fills the tool input). */
  initialPayload?: string;
}

export interface Tool {
  id: string;
  nameKey: string;
  descKey: string;
  /** Searchable keywords (keep lowercase, include both en + zh terms). */
  keywords: string[];
  group: ToolGroup;
  icon: LucideIcon;
  component: ComponentType<ToolProps>;
}

export const GROUPS: { id: ToolGroup; labelKey: string }[] = [
  { id: 'encode', labelKey: 'tools.group_encode' },
  { id: 'format', labelKey: 'tools.group_format' },
  { id: 'auth', labelKey: 'tools.group_auth' },
  { id: 'text', labelKey: 'tools.group_text' },
];

export const TOOLS: Tool[] = [
  {
    id: 'base64',
    nameKey: 'tools.base64.name',
    descKey: 'tools.base64.desc',
    keywords: ['base64', 'encode', 'decode', '编码', '解码'],
    group: 'encode',
    icon: Binary,
    component: Base64Tool,
  },
  {
    id: 'json',
    nameKey: 'tools.json.name',
    descKey: 'tools.json.desc',
    keywords: ['json', 'format', 'formatter', 'minify', 'beautify', '格式化', '压缩'],
    group: 'format',
    icon: Braces,
    component: JsonTool,
  },
  {
    id: 'jwt',
    nameKey: 'tools.jwt.name',
    descKey: 'tools.jwt.desc',
    keywords: ['jwt', 'token', 'decode', 'claims', 'bearer', '解码'],
    group: 'auth',
    icon: KeyRound,
    component: JwtTool,
  },
  {
    id: 'regex',
    nameKey: 'tools.regex.name',
    descKey: 'tools.regex.desc',
    keywords: ['regex', 'regexp', 'regular expression', 'pattern', '正则', '匹配'],
    group: 'text',
    icon: Regex,
    component: RegexTool,
  },
];

export function findTool(id: string): Tool | undefined {
  return TOOLS.find((t) => t.id === id);
}
