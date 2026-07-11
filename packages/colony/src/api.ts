import { consoleUrl } from './config';
import { requireToken } from './auth';

export interface Project {
  name: string;
  placement: string;
  active_deployment: string | null;
}

export interface DeployResult {
  deployment: { id: string; status: string; size: number };
  url: string;
  previewUrl: string;
}

async function api(method: string, path: string, init: { json?: unknown } = {}): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${requireToken()}` };
  let body: string | undefined;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  return fetch(`${consoleUrl()}${path}`, { method, headers, body });
}

async function asJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string; modules?: string[] };
  if (!res.ok) {
    const detail = data.message || (data.modules ? `${data.error}: ${data.modules.join(', ')}` : data.error) || `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return data;
}

export async function listProjects(): Promise<Project[]> {
  const { projects } = await asJson<{ projects: Project[] }>(await api('GET', '/api/projects'));
  return projects;
}

export async function getProject(name: string): Promise<Project | null> {
  const res = await api('GET', `/api/projects/${encodeURIComponent(name)}`);
  if (res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  const { project } = await asJson<{ project: Project }>(res);
  return project;
}

export async function createProject(name: string, placement: string): Promise<Project> {
  const { project } = await asJson<{ project: Project }>(await api('POST', '/api/projects', { json: { name, placement } }));
  return project;
}

export async function uploadDeployment(name: string, bundle: Uint8Array, hash: string): Promise<DeployResult> {
  const headers: Record<string, string> = { authorization: `Bearer ${requireToken()}`, 'content-type': 'application/octet-stream', 'x-ant-hash': hash };
  const res = await fetch(`${consoleUrl()}/api/projects/${encodeURIComponent(name)}/deployments`, { method: 'POST', headers, body: bundle });
  return asJson<DeployResult>(res);
}

// The full colony.toml-driven deploy: one manifest the control plane reconciles
// (bindings by id, vars, observability, migrations, assets + start_ant).
export interface DeployManifest {
  hash: string;
  script: string;
  placement: string;
  observability: boolean;
  vars: Record<string, string>;
  bindings: { kind: string; name: string; id: string; resourceName?: string }[];
  migrations: Record<string, { tag: string; sql: string }[]>; // keyed by binding name
  assets: { path: string; ct: string; body: string }[];
  assetsConfig: { notFound: string; startAnt: boolean | string[]; binding: string; name?: string } | null;
}

export async function deployManifest(name: string, manifest: DeployManifest): Promise<DeployResult> {
  return asJson<DeployResult>(await api('POST', `/api/projects/${encodeURIComponent(name)}/deploy`, { json: manifest }));
}

export async function deleteProject(name: string): Promise<void> {
  await asJson(await api('DELETE', `/api/projects/${encodeURIComponent(name)}`));
}
