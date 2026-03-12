import Docker from "dockerode";
import { docker } from "./docker.utils.js";

export type CheckResult = { ok: boolean; label: string; detail?: string };

const PASS = "  PASS  ";
const FAIL = "  FAIL  ";
const INFO = "  INFO  ";

export function report(checks: CheckResult[]): { passed: number; failed: number } {
  let passed = 0, failed = 0;
  for (const c of checks) {
    if (c.ok) { console.log(`${PASS}${c.label}`); passed++; }
    else { console.log(`${FAIL}${c.label}${c.detail ? ` — ${c.detail}` : ""}`); failed++; }
  }
  return { passed, failed };
}

export function info(label: string, detail?: string): void {
  console.log(`${INFO}${label}${detail ? `: ${detail}` : ""}`);
}

export function warn(label: string, detail?: string): void {
  console.log(`  WARN  ${label}${detail ? ` — ${detail}` : ""}`);
}

// ─── Docker container run helpers ───

export async function dockerRun(container: Docker.Container, cmd: string[]): Promise<{ stdout: string; exitCode: number }> {
  const runInst = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true, User: "appuser" });
  const stream = await runInst.start({ hijack: true, stdin: false });
  let out = "";
  stream.on("data", (chunk: Buffer) => { out += chunk.toString(); });
  await new Promise<void>(r => stream.on("end", r));
  const result = await runInst.inspect();
  return { stdout: out.replace(/[\x00-\x08]/g, "").trim(), exitCode: result.ExitCode ?? 1 };
}

export async function lsDir(container: Docker.Container, dir: string): Promise<string[]> {
  const { stdout } = await dockerRun(container, ["ls", dir]);
  return stdout.split("\n").filter(f => f && !f.includes("No such file"));
}

export async function fileExists(container: Docker.Container, path: string): Promise<boolean> {
  const { exitCode } = await dockerRun(container, ["test", "-f", path]);
  return exitCode === 0;
}

export async function dirWritable(container: Docker.Container, dirPath: string): Promise<boolean> {
  const testFile = `${dirPath}/.doctor-test`;
  const { exitCode } = await dockerRun(container, ["sh", "-c", "touch '$1' && rm '$1'", "sh", testFile]);
  return exitCode === 0;
}

// ─── Bot check sections ───

export async function checkContainer(name: string): Promise<{ checks: CheckResult[]; container?: Docker.Container; cInfo?: Docker.ContainerInspectInfo }> {
  const checks: CheckResult[] = [];
  try {
    const container = docker.getContainer(`mecha-${name}`);
    const cInfo = await container.inspect();
    const running = cInfo.State?.Running === true;
    checks.push({ ok: running, label: `Container "mecha-${name}" running`, detail: running ? undefined : `state: ${cInfo.State?.Status}` });
    return { checks, container: running ? container : undefined, cInfo };
  } catch {
    checks.push({ ok: false, label: `Container "mecha-${name}" exists`, detail: "not found" });
    return { checks };
  }
}

export async function checkHealth(cInfo: Docker.ContainerInspectInfo): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const hostPort = cInfo.NetworkSettings?.Ports?.["3000/tcp"]?.[0]?.HostPort;
  if (!hostPort) {
    checks.push({ ok: false, label: "Health endpoint", detail: "no host port binding" });
    return checks;
  }
  try {
    const resp = await fetch(`http://localhost:${hostPort}/health`, { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      const data = await resp.json() as { status: string; name: string };
      checks.push({ ok: true, label: `Health OK (port ${hostPort}, name: ${data.name})` });
    } else {
      checks.push({ ok: false, label: "Health endpoint", detail: `status ${resp.status}` });
    }
  } catch (err) {
    checks.push({ ok: false, label: "Health endpoint", detail: err instanceof Error ? err.message : String(err) });
  }
  return checks;
}

export function checkMounts(cInfo: Docker.ContainerInspectInfo): CheckResult[] {
  const checks: CheckResult[] = [];
  const mounts = (cInfo.Mounts ?? []).map(m => ({ source: m.Source ?? "", dest: m.Destination ?? "" }));

  for (const e of [
    { dest: "/state", label: "State" },
    { dest: "/config/bot.yaml", label: "Config" },
    { dest: "/home/appuser/.claude", label: "dot-claude" },
    { dest: "/home/appuser/.codex", label: "dot-codex" },
  ]) {
    const found = mounts.find(m => m.dest === e.dest);
    checks.push(found
      ? { ok: true, label: `${e.label} → ${e.dest} (${found.source})` }
      : { ok: false, label: `${e.label} → ${e.dest}`, detail: "missing" });
  }

  const ws = mounts.find(m => m.dest === "/home/appuser/workspace");
  const legacy = mounts.find(m => m.dest === "/workspace");
  if (ws) checks.push({ ok: true, label: `Workspace → /home/appuser/workspace (${ws.source})` });
  else if (legacy) checks.push({ ok: false, label: "Workspace", detail: "at /workspace (legacy) — should be /home/appuser/workspace" });

  return checks;
}

export function checkEnv(cInfo: Docker.ContainerInspectInfo): CheckResult[] {
  const checks: CheckResult[] = [];
  const envList: string[] = cInfo.Config?.Env ?? [];
  const env = Object.fromEntries(envList.map(e => { const i = e.indexOf("="); return i >= 0 ? [e.slice(0, i), e.slice(i + 1)] : [e, ""]; }));

  const hasAuth = !!env.ANTHROPIC_API_KEY || !!env.CLAUDE_CODE_OAUTH_TOKEN;
  checks.push(hasAuth
    ? { ok: true, label: `Auth: ${env.CLAUDE_CODE_OAUTH_TOKEN ? "CLAUDE_CODE_OAUTH_TOKEN" : "ANTHROPIC_API_KEY"}` }
    : { ok: false, label: "Auth credential", detail: "neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN" });

  const cwd = env.MECHA_WORKSPACE_CWD;
  if (cwd) {
    const ok = cwd.startsWith("/home/appuser/") || cwd.startsWith("/state/");
    checks.push({ ok, label: `MECHA_WORKSPACE_CWD = ${cwd}`, detail: ok ? undefined : "unexpected path" });
  } else { checks.push({ ok: false, label: "MECHA_WORKSPACE_CWD", detail: "not set" }); }

  const ps = env.MECHA_ENABLE_PROJECT_SETTINGS;
  const hasExplicitWorkspace = cwd?.startsWith("/home/appuser/");
  const psExpected = hasExplicitWorkspace ? ps === "1" : true; // only fail if workspace set but settings disabled
  checks.push({ ok: psExpected, label: `MECHA_ENABLE_PROJECT_SETTINGS = ${ps ?? "(unset)"}`,
    detail: !psExpected ? "skills, rules, CLAUDE.md won't load from workspace" : undefined });

  checks.push({ ok: !!env.MECHA_BOT_NAME, label: `MECHA_BOT_NAME = ${env.MECHA_BOT_NAME ?? "(unset)"}` });
  checks.push({ ok: !!env.MECHA_BOT_TOKEN, label: `MECHA_BOT_TOKEN ${env.MECHA_BOT_TOKEN ? "set" : "(unset)"}` });

  return checks;
}

export async function checkRuntime(container: Docker.Container): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  const claude = await dockerRun(container, ["claude", "--version"]);
  const cv = claude.stdout.split("\n")[0]?.replace(/[^\x20-\x7e]/g, "").trim() ?? "";
  checks.push(cv ? { ok: true, label: `claude: ${cv}` } : { ok: false, label: "claude CLI", detail: "not found" });

  const node = await dockerRun(container, ["node", "--version"]);
  const nv = node.stdout.replace(/[^\x20-\x7ev.]/g, "").trim();
  checks.push(nv.startsWith("v") ? { ok: true, label: `node: ${nv}` } : { ok: false, label: "node", detail: "not found" });

  const npm = await dockerRun(container, ["npm", "--version"]);
  const npmv = npm.stdout.replace(/[^\x20-\x7e.]/g, "").trim();
  checks.push(npmv ? { ok: true, label: `npm: ${npmv}` } : { ok: false, label: "npm", detail: "not found — MCP servers may fail" });

  const home = await dockerRun(container, ["sh", "-c", "echo $HOME"]);
  const hd = home.stdout.replace(/[^\x20-\x7e/]/g, "").trim();
  checks.push({ ok: hd === "/home/appuser", label: `appuser HOME = ${hd}`, detail: hd !== "/home/appuser" ? "expected /home/appuser" : undefined });

  return checks;
}

export async function checkClaudePickup(container: Docker.Container): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const base = "/home/appuser/.claude";

  const skills = (await lsDir(container, `${base}/skills`)).filter(f => f.endsWith(".md"));
  if (skills.length > 0) checks.push({ ok: true, label: `User skills: ${skills.length} (${skills.join(", ")})` });
  else info("User skills", `none in ${base}/skills/`);

  const rules = (await lsDir(container, `${base}/rules`)).filter(f => f.endsWith(".md"));
  if (rules.length > 0) checks.push({ ok: true, label: `User rules: ${rules.length} (${rules.join(", ")})` });
  else info("User rules", `none in ${base}/rules/`);

  const cmds = (await lsDir(container, `${base}/commands`)).filter(f => f.endsWith(".md"));
  if (cmds.length > 0) checks.push({ ok: true, label: `User commands: ${cmds.length} (${cmds.join(", ")})` });
  else info("User commands", `none in ${base}/commands/`);

  if (await fileExists(container, `${base}/settings.json`)) checks.push({ ok: true, label: "User settings.json present" });
  else info("User settings.json", "not present (optional)");

  const plugins = await lsDir(container, `${base}/plugins`);
  if (plugins.length > 0) checks.push({ ok: true, label: `Plugins: ${plugins.length} entries` });
  else info("Plugins", `none in ${base}/plugins/ (add via dot-claude/plugins/)`);

  const memOk = await dirWritable(container, base);
  checks.push({ ok: memOk, label: "~/.claude writable (auto memory)", detail: memOk ? undefined : "appuser cannot write — memory will fail" });

  if (await fileExists(container, "/home/appuser/workspace/CLAUDE.md")) checks.push({ ok: true, label: "Project CLAUDE.md present" });
  else info("Project CLAUDE.md", "not in workspace (optional)");

  const projClaude = await lsDir(container, "/home/appuser/workspace/.claude");
  if (projClaude.length > 0) checks.push({ ok: true, label: `Project .claude/: ${projClaude.join(", ")}` });
  else info("Project .claude/", "not in workspace (optional)");

  if (await fileExists(container, "/home/appuser/workspace/.mcp.json")) checks.push({ ok: true, label: "Project .mcp.json present" });
  else info("Project .mcp.json", "not in workspace (optional)");

  return checks;
}
