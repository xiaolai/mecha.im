import type { ProcessManager } from "@mecha/process";
import {
  NoPortBindingError,
  TokenNotFoundError,
} from "@mecha/contracts";
import type {
  MechaLogsInputType,
  MechaLsItemType,
  MechaStatusResultType,
  UiUrlResultType,
  McpEndpointResultType,
  MechaTokenResultType,
  MechaEnvResultType,
} from "@mecha/contracts";

// --- mechaLs ---
export async function mechaLs(pm: ProcessManager): Promise<MechaLsItemType[]> {
  const processes = pm.list();
  return processes.map((p) => ({
    id: p.id,
    name: p.id,
    state: p.state,
    status: p.state === "running" ? `Up (PID ${p.pid})` : `Stopped`,
    path: p.projectPath,
    port: p.port || undefined,
    created: new Date(p.createdAt).getTime() / 1000,
  }));
}

// --- mechaStatus ---
export async function mechaStatus(pm: ProcessManager, id: string): Promise<MechaStatusResultType> {
  const info = pm.get(id);
  if (!info) throw new Error(`Mecha not found: ${id}`);
  return {
    id,
    name: info.id,
    state: info.state,
    running: info.state === "running",
    port: info.port || undefined,
    path: info.projectPath,
    pid: info.pid,
    startedAt: info.startedAt,
  };
}

// --- mechaLogs ---
export async function mechaLogs(
  pm: ProcessManager,
  input: MechaLogsInputType,
): Promise<NodeJS.ReadableStream> {
  return pm.logs(input.id, {
    follow: input.follow,
    tail: input.tail,
  });
}

// --- mechaEnv ---
export async function mechaEnv(
  pm: ProcessManager,
  id: string,
): Promise<MechaEnvResultType> {
  const { env } = pm.getPortAndEnv(id);
  const envList = Object.entries(env).map(([key, value]) => ({ key, value: String(value) }));
  return { id, env: envList };
}

// --- mechaToken ---
export async function mechaToken(
  pm: ProcessManager,
  id: string,
): Promise<MechaTokenResultType> {
  const { env } = pm.getPortAndEnv(id);
  const token = env.MECHA_AUTH_TOKEN;
  if (!token) throw new TokenNotFoundError(id);
  return { id, token };
}

// --- resolveUiUrl ---
export async function resolveUiUrl(pm: ProcessManager, id: string): Promise<UiUrlResultType> {
  const { port } = pm.getPortAndEnv(id);
  if (!port) throw new NoPortBindingError(id);
  return { url: `http://127.0.0.1:${port}` };
}

// --- resolveMcpEndpoint ---
export async function resolveMcpEndpoint(pm: ProcessManager, id: string): Promise<McpEndpointResultType> {
  const { port, env } = pm.getPortAndEnv(id);
  if (!port) throw new NoPortBindingError(id);
  const token = env.MECHA_AUTH_TOKEN;
  return { endpoint: `http://127.0.0.1:${port}/mcp`, token };
}
