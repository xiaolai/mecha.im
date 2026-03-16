export interface SpawnOptions {
  allowRegistryEntry?: boolean;
  replaceExisting?: boolean;
}

export interface BotInfo {
  name: string;
  status: string;
  model: string;
  containerId: string;
  ports: string;
  startedAt?: string;
}
