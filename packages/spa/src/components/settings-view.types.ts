export interface NodeInfo {
  node: string;
  hostname: string;
  platform: string;
  arch: string;
  uptimeSeconds: number;
  startedAt: string;
  botCount: number;
  totalMemMB: number;
  freeMemMB: number;
  cpuCount: number;
  lanIp?: string;
  tailscaleIp?: string;
  publicIp?: string;
}

export interface RuntimeConfig {
  botPortRange: string;
  agentPort: number;
  mcpPort: number;
  discovery: {
    enabled: boolean;
    discoveredCount: number;
    manualCount: number;
  };
}

export interface NetworkSettings {
  forceHttps: boolean;
}

export interface TotpStatus {
  configured: boolean;
  source: "file" | "env" | null;
}

export interface MeterStatus {
  running: boolean;
  port?: number;
  pid?: number;
  required?: boolean;
  startedAt?: string;
}
