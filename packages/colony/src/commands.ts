import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadColonyToml, findColonyToml } from './config';
import { bundle, collectAssets, collectMigrations, type Asset, type Migration } from './build';
import { getProject, deployManifest, deleteProject, listProjects } from './api';
import { sha256hex, styleText } from './utils';

// Vendor ants.land deps before bundling (deps come from the registry, not a live
// CDN at runtime). Reuses the antland resolver via its CLI. No-op if there are no
// deps or node_modules already exists.
function ensureDeps(): void {
  if (!fs.existsSync('package.json')) return;
  let deps: Record<string, string> = {};
  try {
    deps = (JSON.parse(fs.readFileSync('package.json', 'utf-8')).dependencies ?? {}) as Record<string, string>;
  } catch {
    return;
  }
  if (Object.keys(deps).length === 0 || fs.existsSync('node_modules')) return;
  console.log(styleText('dim', 'Installing deps from ants.land (antland install)…'));
  let r = spawnSync('antland', ['install'], { stdio: 'inherit' });
  if (r.error) r = spawnSync('npx', ['antland', 'install'], { stdio: 'inherit' });
  if (r.error || r.status) throw new Error('could not vendor deps — run `antland install` manually, then `colony deploy`.');
}

export async function deploy(): Promise<void> {
  const cfg = loadColonyToml();
  ensureDeps();
  console.log(`Building ${styleText('cyan', cfg.name)} ${styleText('dim', `(${cfg.main})`)}…`);
  const bytes = await bundle(cfg.main);
  const script = new TextDecoder().decode(bytes);
  const hash = sha256hex(bytes);

  // per-sql-binding migrations from their migrations_dir
  const migrations: Record<string, Migration[]> = {};
  for (const b of cfg.bindings) {
    if (b.kind === 'sql' && b.migrationsDir) {
      const m = collectMigrations(b.migrationsDir);
      if (m.length) migrations[b.binding] = m;
    }
  }

  let assets: Asset[] = [];
  if (cfg.assets) {
    assets = collectAssets(cfg.assets.directory);
    console.log(styleText('dim', `  ${assets.length} asset(s) from ${cfg.assets.directory}`));
  }
  console.log(styleText('dim', `  bundle ${bytes.byteLength} bytes · sha256 ${hash.slice(0, 12)}`));

  if (!(await getProject(cfg.name))) console.log(`Creating project ${styleText('cyan', cfg.name)} ${styleText('dim', `(placement=${cfg.placement})`)}…`);
  for (const b of cfg.bindings) console.log(styleText('dim', `  bind env.${b.binding} -> ${b.kind} ${b.id}`));

  const r = await deployManifest(cfg.name, {
    hash,
    script,
    placement: cfg.placement,
    observability: cfg.observability,
    vars: cfg.vars,
    bindings: cfg.bindings.map(b => ({ kind: b.kind, name: b.binding, id: b.id, resourceName: b.name })),
    migrations,
    assets,
    assetsConfig: cfg.assets ? { notFound: cfg.assets.notFound, startAnt: cfg.assets.startAnt, binding: cfg.assets.binding, name: cfg.assets.name } : null
  });
  console.log();
  console.log(`${styleText('green', 'Deployed')} ${styleText('cyan', r.url)}`);
  console.log(styleText('dim', `  preview ${r.previewUrl}  ·  ${r.deployment.id}`));
}

export async function destroy(name?: string): Promise<void> {
  const target = name ?? (findColonyToml() ? loadColonyToml().name : undefined);
  if (!target) throw new Error('which project? Usage: colony delete <name> (or run in a dir with colony.toml).');
  await deleteProject(target);
  console.log(`${styleText('green', 'Deleted')} ${target}`);
}

export async function list(): Promise<void> {
  const projects = await listProjects();
  if (!projects.length) {
    console.log('No projects yet. Run `colony deploy` to create one.');
    return;
  }
  for (const p of projects) {
    const active = p.active_deployment ?? styleText('dim', '(no deployment)');
    console.log(`  ${styleText('cyan', p.name.padEnd(22))} ${p.placement.padEnd(8)} ${active}`);
  }
}

export function init(name?: string): void {
  const p = path.join(process.cwd(), 'colony.toml');
  if (fs.existsSync(p)) throw new Error('colony.toml already exists here.');
  const projName = (name ?? path.basename(process.cwd())).toLowerCase();
  fs.writeFileSync(
    p,
    `name = "${projName}"
main = "server.js"
placement = "default"

[observability]
enabled = false

# [vars]
# GREETING = "hello"

# Bindings reference a resource by a stable id; env.<binding> is just an alias.
# [[kv]]
# binding = "CACHE"
# id = "kv_change_me"

# [[sql]]
# binding = "DB"
# id = "sql_change_me"
# migrations_dir = "schema"

# A worker WITH [assets] serves static files; start_ant routes requests to your
# code (true = all, or a glob list like ["/api/*"]). Without it, it's script-only.
# [assets]
# directory = "./dist"
# not_found_handling = "single-page-application"
# start_ant = ["/api/*"]
`
  );
  console.log(`${styleText('green', 'Created')} colony.toml ${styleText('dim', `(name="${projName}")`)}`);
}
