import { describe, it, expect } from "vitest";
import { wrapLinux } from "../../src/platforms/linux.js";
import type { SandboxProfile } from "../../src/types.js";

describe("wrapLinux", () => {
  const profile: SandboxProfile = {
    readPaths: ["/usr/bin/node", "/mecha/discovery.json"],
    writePaths: ["/mecha/alice/home"],
    allowedProcesses: ["/usr/bin/node"],
    allowNetwork: true,
  };

  it("returns bwrap as the binary", () => {
    const result = wrapLinux(profile, "/usr/bin/node", ["app.js"]);
    expect(result.bin).toBe("bwrap");
  });

  it("includes read-only binds for read paths", () => {
    const result = wrapLinux(profile, "/usr/bin/node", ["app.js"]);
    const args = result.args;
    const roBindIdx = args.indexOf("--ro-bind");
    expect(roBindIdx).toBeGreaterThanOrEqual(0);
    expect(args[roBindIdx + 1]).toBe("/usr/bin/node");
    expect(args[roBindIdx + 2]).toBe("/usr/bin/node");
  });

  it("includes read-write binds for write paths", () => {
    const result = wrapLinux(profile, "/usr/bin/node", ["app.js"]);
    const args = result.args;
    const bindIdx = args.indexOf("--bind");
    expect(bindIdx).toBeGreaterThanOrEqual(0);
    expect(args[bindIdx + 1]).toBe("/mecha/alice/home");
  });

  it("shares network when allowed", () => {
    const result = wrapLinux(profile, "/usr/bin/node", ["app.js"]);
    expect(result.args).toContain("--share-net");
    expect(result.args).not.toContain("--unshare-net");
  });

  it("unshares network when not allowed", () => {
    const result = wrapLinux({ ...profile, allowNetwork: false }, "/usr/bin/node", ["app.js"]);
    expect(result.args).toContain("--unshare-net");
    expect(result.args).not.toContain("--share-net");
  });

  it("does NOT include --die-with-parent", () => {
    const result = wrapLinux(profile, "/usr/bin/node", ["app.js"]);
    expect(result.args).not.toContain("--die-with-parent");
  });

  it("includes essential system paths", () => {
    const result = wrapLinux(profile, "/usr/bin/node", ["app.js"]);
    expect(result.args).toContain("/usr");
    expect(result.args).toContain("/lib");
    // /etc is not mounted wholesale — only specific files (resolv.conf, hosts, etc.)
    expect(result.args).toContain("/etc/resolv.conf");
    expect(result.args).toContain("/dev");
    expect(result.args).toContain("/proc");
  });

  it("separates command with -- delimiter", () => {
    const result = wrapLinux(profile, "/usr/bin/node", ["app.js"]);
    const dashIdx = result.args.indexOf("--");
    expect(dashIdx).toBeGreaterThanOrEqual(0);
    expect(result.args[dashIdx + 1]).toBe("/usr/bin/node");
    expect(result.args[dashIdx + 2]).toBe("app.js");
  });

  it("unshares PID and IPC namespaces", () => {
    const result = wrapLinux(profile, "/usr/bin/node", ["app.js"]);
    expect(result.args).toContain("--unshare-pid");
    expect(result.args).toContain("--unshare-ipc");
  });

  it("skips system bind when path does not exist", () => {
    const exists = (p: string) => p !== "/lib64";
    const result = wrapLinux(profile, "/usr/bin/node", ["app.js"], exists);
    expect(result.args).not.toContain("/lib64");
    expect(result.args).toContain("/usr");
    expect(result.args).toContain("/lib");
  });

  it("skips all missing system paths", () => {
    const exists = () => false;
    const result = wrapLinux(profile, "/usr/bin/node", ["app.js"], exists);
    // No system paths should be bound
    expect(result.args).not.toContain("/usr");
    expect(result.args).not.toContain("/lib");
    expect(result.args).not.toContain("/lib64");
    expect(result.args).not.toContain("/etc");
  });
});
