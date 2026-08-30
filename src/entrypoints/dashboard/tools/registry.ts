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
  Palette,
  TextQuote,
  Search,
  Globe,
  GitCompareArrows,
  Sigma,
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
import { HashTool } from './tools/HashTool';
import { ColorTool } from './tools/ColorTool';
import { MarkdownTool } from './tools/MarkdownTool';
import { JsonPathTool } from './tools/JsonPathTool';
import { UrlParserTool } from './tools/UrlParserTool';
import { DiffTool } from './tools/DiffTool';
import { BaseConverterTool } from './tools/BaseConverterTool';

export type ToolGroup = 'encode' | 'format' | 'auth' | 'text' | 'generate' | 'query';

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
  { id: 'query', labelKey: 'tools.group_query' },
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
    id: 'urlparser',
    nameKey: 'tools.urlparser.name',
    descKey: 'tools.urlparser.desc',
    keywords: ['url', 'parser', 'parse', 'query', 'params', 'host', 'port', 'path', 'fragment', '拆解', '解析', '参数'],
    group: 'encode',
    icon: Globe,
    component: UrlParserTool,
  },
  {
    id: 'diff',
    nameKey: 'tools.diff.name',
    descKey: 'tools.diff.desc',
    keywords: ['diff', 'compare', 'text', '对比', '差异', '差别', 'compare text'],
    group: 'format',
    icon: GitCompareArrows,
    component: DiffTool,
  },
  {
    id: 'baseconv',
    nameKey: 'tools.baseconv.name',
    descKey: 'tools.baseconv.desc',
    keywords: ['base', 'radix', 'binary', 'octal', 'decimal', 'hex', 'hexadecimal', '转换', '进制'],
    group: 'encode',
    icon: Sigma,
    component: BaseConverterTool,
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
    keywords: ['jwt', 'token', 'decode', 'encode', 'sign', 'hs256', 'claims', 'bearer', '签名', '解码'],
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
    keywords: ['uuid', 'guid', 'uuidv1', 'uuidv3', 'uuidv4', 'uuidv5', 'uuidv7', 'id', '生成', 'namespace'],
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
  {
    id: 'hash',
    nameKey: 'tools.hash.name',
    descKey: 'tools.hash.desc',
    keywords: ['hash', 'md5', 'sha', 'sha1', 'sha256', 'sha512', 'digest', 'checksum', '哈希', '校验'],
    group: 'encode',
    icon: Binary,
    component: HashTool,
  },
  {
    id: 'markdown',
    nameKey: 'tools.markdown.name',
    descKey: 'tools.markdown.desc',
    keywords: ['markdown', 'md', 'preview', 'readme', '预览', '文档'],
    group: 'format',
    icon: TextQuote,
    component: MarkdownTool,
  },
  {
    id: 'color',
    nameKey: 'tools.color.name',
    descKey: 'tools.color.desc',
    keywords: ['color', 'hex', 'rgb', 'hsl', 'picker', '颜色', '色值'],
    group: 'generate',
    icon: Palette,
    component: ColorTool,
  },
  {
    id: 'jsonpath',
    nameKey: 'tools.jsonpath.name',
    descKey: 'tools.jsonpath.desc',
    keywords: ['jsonpath', 'path', 'query', 'extract', 'json path', '查询', '提取'],
    group: 'query',
    icon: Search,
    component: JsonPathTool,
  },
];

export function findTool(id: string): Tool | undefined {
  return TOOLS.find((t) => t.id === id);
}
