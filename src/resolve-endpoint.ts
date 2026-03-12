import Docker from "dockerode";
import { isValidUrl } from "../shared/validation.js";
import { log } from "../shared/logger.js";
import { readSettings } from "./store.js";

const docker = new Docker();
const BOT_PORT = "3000/tcp";

export interface EndpointCandidate {
  baseUrl: string;
  via: string;
}

async function probeBaseUrl(baseUrl: string, path = "/health", timeoutMs = 2000): Promise<boolean> {
  try {
    const resp = await fetch(`${baseUrl}${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function listLocalCandidates(name: string): Promise<EndpointCandidate[]> {
  try {
    const info = await docker.getContainer(`mecha-${name}`).inspect();
    const candidates: EndpointCandidate[] = [];
    const portBinding =
      info.NetworkSettings?.Ports?.[BOT_PORT]?.[0]
      ?? (info.HostConfig?.PortBindings?.[BOT_PORT] as Array<{ HostIp?: string; HostPort?: string }> | undefined)?.[0];

    if (portBinding?.HostPort) {
      const host = portBinding.HostIp && portBinding.HostIp !== "0.0.0.0" && portBinding.HostIp !== "::"
        ? portBinding.HostIp
        : "127.0.0.1";
      candidates.push({
        baseUrl: `http://${host}:${portBinding.HostPort}`,
        via: "localhost-port",
      });
    }

    const dockerIp = info.NetworkSettings?.IPAddress;
    if (dockerIp) {
      candidates.push({
        baseUrl: `http://${dockerIp}:3000`,
        via: "docker-ip",
      });
    }

    return candidates;
  } catch (err) {
    log.debug(`resolve-endpoint: local inspect failed for "${name}"`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

async function lookupHeadscaleCandidate(name: string): Promise<EndpointCandidate | null> {
  const settings = readSettings();
  if (!settings.headscale_url || !settings.headscale_api_key || !isValidUrl(settings.headscale_url)) {
    return null;
  }

  try {
    const resp = await fetch(`${settings.headscale_url}/api/v1/machine`, {
      headers: { Authorization: `Bearer ${settings.headscale_api_key}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;

    const data = await resp.json() as {
      machines?: Array<{ name: string; ipAddresses?: string[] }>;
    };
    const machine = data.machines?.find((m) => m.name === `mecha-${name}`);
    const ip = machine?.ipAddresses?.[0];
    if (!ip) return null;

    return {
      baseUrl: `http://${ip}:3000`,
      via: "headscale-ip",
    };
  } catch (err) {
    log.debug(`resolve-endpoint: headscale lookup failed for "${name}"`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function listHostBotEndpointCandidates(
  name: string,
  opts?: { allowRemote?: boolean },
): Promise<EndpointCandidate[]> {
  const candidates = await listLocalCandidates(name);

  if (opts?.allowRemote !== false) {
    candidates.push({
      baseUrl: `http://mecha-${name}:3000`,
      via: "magicdns",
    });

    const headscaleCandidate = await lookupHeadscaleCandidate(name);
    if (headscaleCandidate) candidates.push(headscaleCandidate);
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.baseUrl)) return false;
    seen.add(candidate.baseUrl);
    return true;
  });
}

export async function resolveHostBotBaseUrl(
  name: string,
  opts?: { allowRemote?: boolean; probePath?: string; probeTimeoutMs?: number },
): Promise<EndpointCandidate | null> {
  const probePath = opts?.probePath ?? "/health";
  const probeTimeoutMs = opts?.probeTimeoutMs ?? 2000;
  const candidates = await listHostBotEndpointCandidates(name, opts);

  for (const candidate of candidates) {
    if (await probeBaseUrl(candidate.baseUrl, probePath, probeTimeoutMs)) {
      return candidate;
    }
    log.debug(`resolve-endpoint: candidate unreachable for "${name}"`, {
      via: candidate.via,
      baseUrl: candidate.baseUrl,
    });
  }

  return null;
}
