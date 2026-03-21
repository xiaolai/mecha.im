import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

let mechaDir: string;

afterEach(() => {
  process.exitCode = undefined as unknown as number;
  if (mechaDir) {
    rmSync(mechaDir, { recursive: true, force: true });
    mechaDir = undefined as unknown as string;
  }
});

function setup() {
  mechaDir = mkdtempSync(join(tmpdir(), "mecha-secret-"));
  const deps = makeDeps({ mechaDir });
  const program = createProgram(deps);
  program.exitOverride();
  return { deps, program };
}

describe("secret set", () => {
  it("stores a secret", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "secret", "set", "api-key", "sk-12345"]);
    expect(deps.formatter.success).toHaveBeenCalledWith('Secret "api-key" stored');
  });
});

describe("secret list", () => {
  it("shows message when no secrets", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "secret", "list"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("No secrets stored");
  });

  it("lists stored secret names", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "secret", "set", "key-a", "val-a"]);

    const program2 = createProgram(deps);
    program2.exitOverride();
    await program2.parseAsync(["node", "mecha", "secret", "set", "key-b", "val-b"]);

    const program3 = createProgram(deps);
    program3.exitOverride();
    await program3.parseAsync(["node", "mecha", "secret", "list"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(["Name"], [["key-a"], ["key-b"]]);
  });

  it("outputs JSON when --json flag set", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "secret", "set", "my-key", "my-val"]);

    (deps.formatter as any).isJson = true;
    const program2 = createProgram(deps);
    program2.exitOverride();
    await program2.parseAsync(["node", "mecha", "secret", "list"]);
    expect(deps.formatter.json).toHaveBeenCalledWith(["my-key"]);
  });
});

describe("secret grant", () => {
  it("grants a bot access to a secret", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "secret", "grant", "alice", "api-key"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(
      'Granted "alice" access to secret "api-key"',
    );
  });
});

describe("secret revoke", () => {
  it("revokes access when grant exists", async () => {
    const { deps, program } = setup();
    // Grant first
    await program.parseAsync(["node", "mecha", "secret", "grant", "alice", "api-key"]);

    const program2 = createProgram(deps);
    program2.exitOverride();
    await program2.parseAsync(["node", "mecha", "secret", "revoke", "alice", "api-key"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(
      'Revoked "alice" access to secret "api-key"',
    );
  });

  it("reports when no grant found", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "secret", "revoke", "bob", "missing"]);
    expect(deps.formatter.info).toHaveBeenCalledWith(
      'No grant found for "bob" on secret "missing"',
    );
  });
});
