import semiver from 'semiver';
import { AntPackage } from './utils';

export const REGISTRY_URL = process.env.ANTS_REGISTRY ?? 'https://npm.ants.land';
export const SITE_URL = process.env.ANTS_SITE ?? REGISTRY_URL.replace('://npm.', '://');

export interface Packument {
  name: string;
  description?: string;
  'dist-tags': { latest?: string };
  versions: Record<
    string,
    {
      name: string;
      version: string;
      description?: string;
      dist: { tarball: string; shasum?: string; integrity?: string };
    }
  >;
  time: Record<string, string>;
}

export async function getPackument(pkg: AntPackage): Promise<Packument> {
  const url = `${REGISTRY_URL}/${pkg.id}`;
  const res = await fetch(url);
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Received ${res.status} from ${url}`);
  }
  return (await res.json()) as Packument;
}

export function resolveVersion(meta: Packument, requested: string | null): string {
  if (requested !== null) {
    if (!meta.versions[requested]) throw new Error(`Version ${requested} not found`);
    return requested;
  }
  const latest = meta['dist-tags']?.latest;
  if (latest && meta.versions[latest]) return latest;
  const versions = Object.keys(meta.versions);
  if (versions.length === 0) throw new Error('No published versions');
  return versions.sort(semiver).reverse()[0];
}

export async function getTarballUrl(pkg: AntPackage): Promise<string> {
  const meta = await getPackument(pkg);
  const version = resolveVersion(meta, pkg.version);
  const tarball = meta.versions[version]?.dist?.tarball;
  if (!tarball) throw new Error(`No tarball for ${pkg.id}@${version}`);
  return tarball;
}

export interface ScoreCheck {
  id: string;
  got: number;
  max: number;
  disabled: boolean;
  passed: boolean;
}

export interface PackageScore {
  id: string;
  version: string;
  score: number;
  checks: ScoreCheck[];
  flags: { minified: boolean; obfuscated: boolean; verified: boolean };
  risks: string[];
  typosquat: string | null;
  publisher: { name: string; handle: string; githubLogin: string | null; githubVerified: boolean } | null;
}

export async function getScore(pkg: AntPackage): Promise<PackageScore | null> {
  const params = new URLSearchParams({ id: pkg.id });
  if (pkg.version) params.set('version', pkg.version);
  const url = `${SITE_URL}/api/package/score?${params.toString()}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    return (await res.json()) as PackageScore;
  } catch {
    return null;
  }
}

export interface GistUpload {
  id: string;
  filename: string;
  url: string;
  run: string;
}

export async function uploadGist(token: string, filename: string, content: string): Promise<GistUpload> {
  const res = await fetch(`${SITE_URL}/api/gist`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ filename, content })
  });
  const data = (await res.json().catch(() => ({}))) as GistUpload & { error?: string };
  if (!res.ok) throw new Error(data.error || `gist upload failed (${res.status})`);
  return data;
}

export async function fetchGist(id: string): Promise<{ filename: string; content: string }> {
  const res = await fetch(`${SITE_URL}/g/${encodeURIComponent(id)}`);
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Gist "${id}" not found`);
  }
  const filename = res.headers.get('x-gist-filename') || `${id}.js`;
  return { filename, content: await res.text() };
}
