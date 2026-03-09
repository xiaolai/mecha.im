import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import {
  pluginName,
  addPlugin,
  MechaError,
  StdioPluginInputSchema,
  HttpPluginInputSchema,
  type StdioPluginConfig,
  type HttpPluginConfig,
} from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

interface PluginAddOpts {
  url?: string;
  type?: "stdio" | "http" | "sse";
  command?: string;
  args?: string;
  env?: string[];
  header?: string[];
  description?: string;
  force?: boolean;
}

function parseKeyValue(pairs: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq < 1) {
      throw new MechaError(`Invalid KEY=VALUE pair: "${pair}" (key must be non-empty)`, {
        code: "INVALID_KEY_VALUE", statusCode: 400, exitCode: 1,
      });
    }
    result[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return result;
}

/** Register the 'plugin add' subcommand. */
export function registerPluginAddCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("add")
    .description("Register a new MCP server plugin")
    .argument("<name>", "Plugin name (lowercase, alphanumeric, hyphens)")
    .option("--url <url>", "MCP endpoint URL (implies type=http)")
    .option("--type <type>", "Transport type: stdio, http, sse")
    .option("--command <cmd>", "Executable command (implies type=stdio)")
    .option("--args <args>", "Comma-separated arguments")
    .option("--env <KEY=VALUE...>", "Environment variable (repeatable)", collectRepeat, [])
    .option("--header <KEY=VALUE...>", "HTTP header (repeatable)", collectRepeat, [])
    .option("-d, --description <text>", "Human-readable description")
    .option("--force", "Overwrite if plugin already exists", false)
    .action(async (rawName: string, opts: PluginAddOpts) => withErrorHandler(deps, async () => {
      const name = pluginName(rawName);

      // Infer type: explicit --type wins, else infer from --url or --command
      const inferredType = opts.type ?? (opts.url ? "http" : opts.command ? "stdio" : undefined);
      if (!inferredType) {
        deps.formatter.error("Either --url (for http/sse) or --command (for stdio) is required");
        process.exitCode = 1;
        return;
      }

      const now = new Date().toISOString();

      if (inferredType === "stdio") {
        if (!opts.command) {
          deps.formatter.error("--command is required for stdio plugins");
          process.exitCode = 1;
          return;
        }
        const input = StdioPluginInputSchema.safeParse({
          type: "stdio",
          command: opts.command,
          args: opts.args ? opts.args.split(",") : undefined,
          env: opts.env && opts.env.length > 0 ? parseKeyValue(opts.env) : undefined,
          description: opts.description,
        });
        /* v8 ignore start -- Zod validation catches malformed input after Commander parsing */
        if (!input.success) {
          deps.formatter.error(`Invalid plugin config: ${input.error.issues[0]?.message}`);
          process.exitCode = 1;
          return;
        }
        /* v8 ignore stop */
        const config: StdioPluginConfig = { ...input.data, addedAt: now };
        addPlugin(deps.mechaDir, name, config, opts.force);
      } else {
        if (!opts.url) {
          deps.formatter.error("--url is required for http/sse plugins");
          process.exitCode = 1;
          return;
        }
        const input = HttpPluginInputSchema.safeParse({
          type: inferredType,
          url: opts.url,
          headers: opts.header && opts.header.length > 0 ? parseKeyValue(opts.header) : undefined,
          description: opts.description,
        });
        /* v8 ignore start -- Zod validation catches malformed input after Commander parsing */
        if (!input.success) {
          deps.formatter.error(`Invalid plugin config: ${input.error.issues[0]?.message}`);
          process.exitCode = 1;
          return;
        }
        /* v8 ignore stop */
        const config: HttpPluginConfig = { ...input.data, addedAt: now };
        addPlugin(deps.mechaDir, name, config, opts.force);
      }

      deps.formatter.success(`Plugin added: ${name} (${inferredType})`);
    }));
}

function collectRepeat(value: string, prev: string[]): string[] {
  return [...prev, value];
}
