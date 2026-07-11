import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseTomlDoc, type TomlVal } from './utils';

// The control-plane API (the console is not self-hostable, so this is fixed).
export function consoleUrl(): string {
  return 'https://console.antjs.org';
}

export interface BindingDef {
  kind: 'kv' | 'sql';
  binding: string; // the env.<binding> alias
  id: string; // stable resource id (storage is keyed by this, not the name)
  name?: string; // human resource name shown in the UI (like wrangler database_name)
  migrationsDir?: string; // sql only
}

export interface AssetsDef {
  binding: string; // shown in the bindings UI (like Cloudflare's ASSETS binding)
  name?: string; // optional display name
  directory: string;
  notFound: 'single-page-application' | 'none';
  // When Ant runs first: true = all paths, a glob (string) or list of globs =
  // those paths; everything else is served as a static asset.
  startAnt: boolean | string[];
}

export interface ColonyConfig {
  name: string;
  main: string;
  placement: string; // default (free) | smart (paid)
  observability: boolean;
  vars: Record<string, string>;
  bindings: BindingDef[];
  assets?: AssetsDef;
}

export function findColonyToml(dir = process.cwd()): string | null {
  const p = path.join(dir, 'colony.toml');
  return fs.existsSync(p) ? p : null;
}

const str = (v: TomlVal | undefined, d = ''): string => (typeof v === 'string' ? v : d);

export function loadColonyToml(dir = process.cwd()): ColonyConfig {
  const p = findColonyToml(dir);
  if (!p) throw new Error('no colony.toml here. Run `colony init` first.');
  const doc = parseTomlDoc(fs.readFileSync(p, 'utf-8'));
  const name = str(doc.root.name);
  if (!name) throw new Error('colony.toml is missing `name`.');

  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(doc.tables.vars ?? {})) vars[k] = String(v);

  const bindings: BindingDef[] = [];
  for (const b of doc.arrays.kv ?? []) bindings.push({ kind: 'kv', binding: str(b.binding), id: str(b.id), name: str(b.name) || undefined });
  for (const b of doc.arrays.sql ?? []) bindings.push({ kind: 'sql', binding: str(b.binding), id: str(b.id), name: str(b.name) || undefined, migrationsDir: str(b.migrations_dir) || undefined });
  for (const b of bindings) {
    if (!b.binding) throw new Error(`a [[${b.kind}]] binding is missing \`binding\`.`);
    if (!b.id) throw new Error(`[[${b.kind}]] "${b.binding}" is missing \`id\`.`);
  }

  let assets: AssetsDef | undefined;
  const a = doc.tables.assets;
  if (a) {
    const sa = a.start_ant;
    assets = {
      binding: str(a.binding) || 'ASSETS',
      name: str(a.name) || undefined,
      directory: str(a.directory, './dist'),
      notFound: str(a.not_found_handling) === 'single-page-application' ? 'single-page-application' : 'none',
      startAnt: sa === true ? true : typeof sa === 'string' ? [sa] : Array.isArray(sa) ? sa.map(String) : []
    };
  }

  return {
    name: name.toLowerCase(),
    main: str(doc.root.main) || str(doc.root.entry) || 'server.js',
    placement: str(doc.root.placement) || 'default',
    observability: doc.tables.observability?.enabled === true,
    vars,
    bindings,
    assets
  };
}
