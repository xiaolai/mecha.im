import type { CasaAddress, NodeName, NodeEntry } from "@mecha/core";
import { readCasaConfig } from "@mecha/core";
import { join } from "node:path";
import type { ProcessManager } from "@mecha/process";

export type LocateResult =
  | { location: "local"; port: number; token: string }
  | { location: "remote"; node: NodeEntry }
  | { location: "not_found" };

export interface MechaLocator {
  locate(target: CasaAddress): LocateResult;
}

const LOCAL_NODE = "local" as NodeName;

export interface CreateLocatorOpts {
  mechaDir: string;
  pm: ProcessManager;
  getNodes: () => NodeEntry[];
}

export function createLocator(opts: CreateLocatorOpts): MechaLocator {
  const { mechaDir, pm, getNodes } = opts;

  return {
    locate(target) {
      const isLocal = target.node === LOCAL_NODE;

      if (isLocal) {
        // Check if running via ProcessManager
        const info = pm.get(target.casa);
        if (info && info.state === "running" && info.port) {
          const config = readCasaConfig(join(mechaDir, target.casa));
          /* v8 ignore start -- defensive: process running but config missing */
          if (!config) return { location: "not_found" };
          /* v8 ignore stop */
          return { location: "local", port: config.port, token: config.token };
        }

        // Not running locally — check if config exists (stopped CASA)
        const config = readCasaConfig(join(mechaDir, target.casa));
        if (config) {
          return { location: "local", port: config.port, token: config.token };
        }

        return { location: "not_found" };
      }

      // Remote: look up in node registry
      const nodes = getNodes();
      const node = nodes.find((n) => n.name === target.node);
      if (node) {
        return { location: "remote", node };
      }

      return { location: "not_found" };
    },
  };
}
