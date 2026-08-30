import type { ComponentType } from 'react';
import {
  Binary,
  Braces,
  KeyRound,
  Regex,
  Link as LinkIcon,
  Code,
  Fingerprint,
  Clock,
  CalendarClock,
  Database,
  type LucideIcon,
} from 'lucide-react';
import { Base64Tool } from './tools/Base64Tool';
import { JsonTool } from './tools/JsonTool';
import { JwtTool } from './tools/JwtTool';
import { RegexTool } from './tools/RegexTool';
import { UrlTool } from './tools/UrlTool';
import { HtmlEntityTool } from './tools/HtmlEntityTool';
import { UuidTool } from './tools/UuidTool';
import { TimestampTool } from './tools/TimestampTool';
import { CronTool } from './tools/CronTool';
import { SqlTool } from './tools/SqlTool';

export type ToolGroup = 'encode' | 'format' | 'auth' | 'text' | 'generate';

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
  { id: 'generate', labelKey: 'tools.group_generate' },
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
    id: 'url',
    nameKey: 'tools.url.name',
    descKey: 'tools.url.desc',
    keywords: ['url', 'encode', 'decode', 'percent', 'uri', '编码', '解码'],
    group: 'encode',
    icon: LinkIcon,
    component: UrlTool,
  },
  {
    id: 'htmlentity',
    nameKey: 'tools.html.name',
    descKey: 'tools.html.desc',
    keywords: ['html', 'entity', 'escape', 'unescape', '转义', '实体'],
    group: 'encode',
    icon: Code,
    component: HtmlEntityTool,
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
    id: 'sql',
    nameKey: 'tools.sql.name',
    descKey: 'tools.sql.desc',
    keywords: ['sql', 'format', 'formatter', 'beautify', '格式化'],
    group: 'format',
    icon: Database,
    component: SqlTool,
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
  {
    id: 'uuid',
    nameKey: 'tools.uuid.name',
    descKey: 'tools.uuid.desc',
    keywords: ['uuid', 'guid', 'uuidv4', 'uuidv7', 'id', '生成'],
    group: 'generate',
    icon: Fingerprint,
    component: UuidTool,
  },
  {
    id: 'timestamp',
    nameKey: 'tools.timestamp.name',
    descKey: 'tools.timestamp.desc',
    keywords: ['timestamp', 'epoch', 'unix', 'date', '时间戳', '日期'],
    group: 'generate',
    icon: Clock,
    component: TimestampTool,
  },
  {
    id: 'cron',
    nameKey: 'tools.cron.name',
    descKey: 'tools.cron.desc',
    keywords: ['cron', 'crontab', 'schedule', '定时', '表达式'],
    group: 'generate',
    icon: CalendarClock,
    component: CronTool,
  },
];

export function findTool(id: string): Tool | undefined {
  return TOOLS.find((t) => t.id === id);
}
