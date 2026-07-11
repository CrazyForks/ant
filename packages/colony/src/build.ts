import * as fs from 'node:fs';
import * as path from 'node:path';
import { rolldown, type Plugin } from 'rolldown';

// Modules a deployed app may not import. The console and the fleet daemon also
// reject these at upload/spawn time; failing here gives the developer the error
// at build time, before anything leaves their machine.
const FORBIDDEN = new Set(['fs', 'fs/promises', 'child_process']);

const strip = (spec: string): string => spec.replace(/^node:/, '').replace(/^ant:/, '');
const denied = (spec: string): never => {
  throw new Error(`"${spec}" is not allowed on ants.page — filesystem and subprocess access are blocked.`);
};

// Treat node:/ant: builtins as external (the Ant runtime provides them) but
// hard-error on the denied ones — in both prefixed and bare form.
const antPlugin: Plugin = {
  name: 'ant-platform',
  resolveId(source) {
    if (/^(node:|ant:)/.test(source)) {
      if (FORBIDDEN.has(strip(source))) denied(source);
      return { id: source, external: true };
    }
    if (FORBIDDEN.has(source)) denied(source);
    return null;
  }
};

// Bundle + minify the entry into a single ESM artifact, returned as bytes.
export async function bundle(entry: string): Promise<Uint8Array> {
  if (!fs.existsSync(entry)) throw new Error(`entry not found: ${entry}`);
  const build = await rolldown({ input: entry, plugins: [antPlugin], logLevel: 'silent' });
  try {
    const result = await build.generate({ format: 'es', minify: true });
    const chunk = result.output.find(o => o.type === 'chunk');
    if (!chunk || !('code' in chunk)) throw new Error('rolldown produced no output chunk');
    return new TextEncoder().encode(chunk.code);
  } finally {
    await build.close();
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

export interface Asset {
  path: string; // url path, e.g. "/assets/index.js"
  ct: string;
  body: string; // base64
}

const ASSET_LIMIT = 5 * 1024 * 1024; // per-file cap (keeps the manifest sane)

// Walk an assets directory into a flat list of url-pathed, base64-encoded files.
export function collectAssets(dir: string): Asset[] {
  if (!fs.existsSync(dir)) throw new Error(`assets directory not found: ${dir}`);
  const out: Asset[] = [];
  const walk = (abs: string, rel: string) => {
    for (const name of fs.readdirSync(abs)) {
      const a = path.join(abs, name);
      const r = rel + '/' + name;
      const st = fs.statSync(a);
      if (st.isDirectory()) {
        walk(a, r);
      } else {
        if (st.size > ASSET_LIMIT) throw new Error(`asset too large (>${ASSET_LIMIT} bytes): ${r}`);
        out.push({ path: r, ct: MIME[path.extname(name).toLowerCase()] || 'application/octet-stream', body: fs.readFileSync(a).toString('base64') });
      }
    }
  };
  walk(dir, '');
  return out;
}

export interface Migration {
  tag: string;
  sql: string;
}

// Read *.sql files from a migrations dir, sorted by filename (the tag).
export function collectMigrations(dir: string): Migration[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => ({ tag: f.replace(/\.sql$/, ''), sql: fs.readFileSync(path.join(dir, f), 'utf-8') }));
}
