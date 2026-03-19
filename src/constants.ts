import { homedir } from "node:os";
import { join } from "node:path";

export const IMAGE_NAME = "mecha-agent";
export const REGISTRY_IMAGE = "ghcr.io/xiaolai/mecha.im";
export const BOTS_BASE = join(homedir(), ".mecha", "bots");
export const HEALTH_CHECK_TIMEOUT_MS = 30_000;
