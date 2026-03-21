import type { BotAddress, NodeEntry } from "@mecha/core";
import { readBotConfig, nodeName } from "@mecha/core";
import { join } from "node:path";
import type { ProcessManager } from "@mecha/process";

/** Result of locating a bot: local with port/token, remote with node entry, or not found. */
export type LocateResult =
  | { location: "local"; port: number; token: string }
  | { location: "remote"; node: NodeEntry }
  | { location: "remote-channel"; node: NodeEntry }
  | { location: "not_found" };

/** Resolves a bot address to a local or remote endpoint. */
export interface MechaLocator {
  locate(target: BotAddress): LocateResult;
}

const LOCAL_NODE = nodeName("local");

/** Options for creating a MechaLocator. */
export interface CreateLocatorOpts {
  mechaDir: string;
  pm: ProcessManager;
  getNodes: () => NodeEntry[];
}

/** Create a locator that resolves bot addresses to local or remote endpoints. */
export function createLocator(opts: CreateLocatorOpts): MechaLocator {
  const { mechaDir, pm, getNodes } = opts;

  return {
    locate(target) {
      const isLocal = target.node === LOCAL_NODE;

      if (isLocal) {
        // Check if running via ProcessManager
        const info = pm.get(target.bot);
        if (info && info.state === "running" && info.port) {
          const config = readBotConfig(join(mechaDir, target.bot));
          /* v8 ignore start -- defensive: process running but config missing */
          if (!config) return { location: "not_found" };
          /* v8 ignore stop */
          return { location: "local", port: config.port, token: config.token };
        }

        // bot exists but is not running — don't return stale port/token
        return { location: "not_found" };
      }

      // Remote: look up in node registry
      const nodes = getNodes();
      const node = nodes.find((n) => n.name === target.node);
      if (node) {
        // Phase 6: managed nodes use SecureChannel
        if (node.managed) {
          return { location: "remote-channel", node };
        }
        return { location: "remote", node };
      }

      return { location: "not_found" };
    },
  };
}
