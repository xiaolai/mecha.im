import type { Command } from "commander";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pc, success } from "../cli-output.js";
import { getMechaDir } from "../store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolve the package root (where adapters/ lives) */
function packageRoot(): string {
  // src/commands/adapter.ts → ../../ → package root
  // dist/src/commands/adapter.js → ../../../ → package root
  return join(__dirname, "..", "..", "..");
}

interface AdapterInfo {
  name: string;
  description: string;
  builtin: boolean;
  path: string;
}

/** Find all available adapters from built-in + user directories */
function discoverAdapters(): AdapterInfo[] {
  const adapters: AdapterInfo[] = [];

  // Built-in adapters (ship with npm package)
  const builtinDir = join(packageRoot(), "adapters");
  if (existsSync(builtinDir)) {
    for (const entry of readdirSync(builtinDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const adapterPath = join(builtinDir, entry.name);
      const pkg = readPkg(adapterPath);
      adapters.push({
        name: entry.name,
        description: pkg?.description ?? "",
        builtin: true,
        path: adapterPath,
      });
    }
  }

  // User adapters: <mecha-dir>/adapters/
  const userDir = join(getMechaDir(), "adapters");
  if (existsSync(userDir)) {
    for (const entry of readdirSync(userDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      // User adapters override built-in with same name
      if (adapters.some(a => a.name === entry.name)) continue;
      const adapterPath = join(userDir, entry.name);
      const pkg = readPkg(adapterPath);
      adapters.push({
        name: entry.name,
        description: pkg?.description ?? "",
        builtin: false,
        path: adapterPath,
      });
    }
  }

  return adapters;
}

function readPkg(dir: string): { description?: string; scripts?: Record<string, string> } | null {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
  } catch { return null; }
}

function resolveAdapter(name: string): AdapterInfo | null {
  return discoverAdapters().find(a => a.name === name) ?? null;
}

export function registerAdapterCommand(program: Command): void {
  const adapter = program
    .command("adapter")
    .description("Manage and run protocol adapters (Telegram, etc.)");

  adapter
    .command("list")
    .alias("ls")
    .description("List available adapters")
    .action(() => {
      const adapters = discoverAdapters();
      if (adapters.length === 0) {
        console.log("No adapters found.");
        return;
      }
      console.log(pc.bold("\nAvailable Adapters\n"));
      for (const a of adapters) {
        const tag = a.builtin ? pc.dim("(built-in)") : pc.dim("(user)");
        console.log(`  ${pc.green(a.name)}  ${tag}`);
        if (a.description) console.log(`    ${pc.dim(a.description)}`);
      }
      console.log();
    });

  adapter
    .command("start <name>")
    .description("Start an adapter")
    .option("--bot <bot>", "Default bot to route messages to")
    .option("--env <vars...>", "Extra environment variables (KEY=VALUE)")
    .option("--background", "Run in background (detached)")
    .action(async (name: string, opts: { bot?: string; env?: string[]; background?: boolean }) => {
      const info = resolveAdapter(name);
      if (!info) {
        console.error(`Adapter "${name}" not found. Run ${pc.cyan("mecha adapter list")} to see available adapters.`);
        process.exit(1);
      }

      // Auto-install deps if node_modules missing
      const nmPath = join(info.path, "node_modules");
      if (!existsSync(nmPath)) {
        console.log(`Installing ${name} adapter dependencies...`);
        const { execFileSync } = await import("node:child_process");
        execFileSync("npm", ["install", "--production"], { cwd: info.path, stdio: "inherit" });
      }

      // Build environment — auto-inject mecha connection info
      const env: Record<string, string> = { ...process.env as Record<string, string> };

      // Auto-detect daemon URL
      if (!env.MECHA_URL) {
        const { getDaemonUrl } = await import("../daemon.js");
        const url = getDaemonUrl();
        if (url) env.MECHA_URL = url;
      }

      // Dashboard token comes from env (MECHA_DASHBOARD_TOKEN) or --env flag

      // --bot flag → MECHA_DEFAULT_BOT
      if (opts.bot) env.MECHA_DEFAULT_BOT = opts.bot;

      // Extra --env vars
      if (opts.env) {
        for (const kv of opts.env) {
          const eq = kv.indexOf("=");
          if (eq > 0) env[kv.slice(0, eq)] = kv.slice(eq + 1);
        }
      }

      const pkg = readPkg(info.path);
      const startScript = pkg?.scripts?.start;
      if (!startScript) {
        console.error(`Adapter "${name}" has no start script in package.json.`);
        process.exit(1);
      }

      console.log(success(`Starting ${name} adapter...`));
      if (env.MECHA_URL) console.log(`  ${pc.dim("Daemon:")} ${env.MECHA_URL}`);
      if (env.MECHA_DEFAULT_BOT) console.log(`  ${pc.dim("Default bot:")} ${env.MECHA_DEFAULT_BOT}`);

      const { spawn } = await import("node:child_process");

      if (opts.background) {
        const child = spawn("npm", ["run", "start"], {
          cwd: info.path,
          env,
          detached: true,
          stdio: "ignore",
        });
        child.unref();
        console.log(`  ${pc.dim("PID:")} ${child.pid} (background)`);
        return;
      }

      // Foreground — inherit stdio, forward signals
      const child = spawn("npm", ["run", "start"], {
        cwd: info.path,
        env,
        stdio: "inherit",
      });

      const cleanup = () => { child.kill("SIGTERM"); };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);

      child.on("exit", (code) => {
        process.exit(code ?? 1);
      });
    });
}
