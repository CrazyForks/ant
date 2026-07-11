import { createHash } from 'node:crypto';

const COLORS: Record<string, string> = {
  red: '31',
  green: '32',
  yellow: '33',
  blue: '34',
  magenta: '35',
  cyan: '36',
  dim: '2',
  bold: '1'
};

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;

export function styleText(color: keyof typeof COLORS | string, text: string): string {
  const code = COLORS[color];
  if (!useColor || !code) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

export class ExecError extends Error {
  code: number;
  constructor(message: string, code = 1) {
    super(message);
    this.code = code;
  }
}

export function prettyTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function sha256hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export type TomlVal = string | number | boolean | TomlVal[];
export interface TomlDoc {
  root: Record<string, TomlVal>;
  tables: Record<string, Record<string, TomlVal>>;
  arrays: Record<string, Record<string, TomlVal>[]>;
}

function parseValue(raw: string): TomlVal {
  const s = raw.trim();
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(p => parseValue(p)); // no nested arrays in colony.toml
  }
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

// Structured TOML reader: top-level keys, `[table]`, and `[[array]]` (one nesting
// level — all colony.toml needs). Values: string / number / bool / array.
export function parseTomlDoc(src: string): TomlDoc {
  const doc: TomlDoc = { root: {}, tables: {}, arrays: {} };
  let target: Record<string, TomlVal> = doc.root;
  for (let line of src.split('\n')) {
    line = line.replace(/#.*$/, '').trim();
    if (!line) continue;
    if (line.startsWith('[[') && line.endsWith(']]')) {
      const name = line.slice(2, -2).trim();
      target = {};
      (doc.arrays[name] ||= []).push(target);
      continue;
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      const name = line.slice(1, -1).trim();
      target = doc.tables[name] ||= {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (key) target[key] = parseValue(line.slice(eq + 1));
  }
  return doc;
}
