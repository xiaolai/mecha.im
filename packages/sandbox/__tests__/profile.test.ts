import { dirname } from "node:path";
import { describe, it, expect } from "vitest";
import { profileFromConfig, nodePrefix, findProjectRoot } from "../src/profile.js";
import type { CasaConfig } from "@mecha/core";

describe("nodePrefix", () => {
  it("returns grandparent of process.execPath", () => {
    const expected = dirname(dirname(process.execPath));
    expect(nodePrefix()).toBe(expected);
  });
});

describe("findProjectRoot", () => {
  it("finds the nearest ancestor with node_modules", () => {
    // The test file itself is inside the monorepo which has node_modules
    const root = findProjectRoot(__filename);
    expect(root).toBeTruthy();
    // The root should be an ancestor of this file
    expect(__filename.startsWith(root)).toBe(true);
  });
});

describe("profileFromConfig", () => {
  const baseConfig: CasaConfig = {
    port: 7700,
    token: "mecha_test",
    workspace: "/home/user/project",
  };

  it("includes node prefix in read paths and binary in allowed processes", () => {
    const profile = profileFromConfig({
      config: baseConfig,
      casaDir: "/mecha/alice",
      mechaDir: "/mecha",
    });

    expect(profile.readPaths).toContain(nodePrefix());
    expect(profile.allowedProcesses).toContain(process.execPath);
  });

  it("includes discovery.json as a read path", () => {
    const profile = profileFromConfig({
      config: baseConfig,
      casaDir: "/mecha/alice",
      mechaDir: "/mecha",
    });

    expect(profile.readPaths).toContain("/mecha/discovery.json");
  });

  it("includes project root in read paths when runtimeEntrypoint provided", () => {
    // Use a real path so findProjectRoot can locate node_modules
    const profile = profileFromConfig({
      config: baseConfig,
      casaDir: "/mecha/alice",
      mechaDir: "/mecha",
      runtimeEntrypoint: __filename,
    });

    const projRoot = findProjectRoot(__filename);
    expect(profile.readPaths).toContain(projRoot);
  });

  it("includes casaDir and workspace in read paths", () => {
    const profile = profileFromConfig({
      config: baseConfig,
      casaDir: "/mecha/alice",
      mechaDir: "/mecha",
    });

    expect(profile.readPaths).toContain("/mecha/alice");
    expect(profile.readPaths).toContain("/home/user/project");
  });

  it("includes correct write paths", () => {
    const profile = profileFromConfig({
      config: baseConfig,
      casaDir: "/mecha/alice",
      mechaDir: "/mecha",
    });

    expect(profile.writePaths).toEqual([
      "/mecha/alice",
      "/mecha/alice/home",
      "/mecha/alice/logs",
      "/mecha/alice/tmp",
      "/home/user/project",
    ]);
  });

  it("allows network access by default", () => {
    const profile = profileFromConfig({
      config: baseConfig,
      casaDir: "/mecha/alice",
      mechaDir: "/mecha",
    });

    expect(profile.allowNetwork).toBe(true);
  });

  it("disables network when config.allowNetwork is false", () => {
    const profile = profileFromConfig({
      config: { ...baseConfig, allowNetwork: false },
      casaDir: "/mecha/alice",
      mechaDir: "/mecha",
    });

    expect(profile.allowNetwork).toBe(false);
  });

  it("deduplicates paths", () => {
    // If casaDir equals workspace, writePaths should have no duplicates
    const profile = profileFromConfig({
      config: { ...baseConfig, workspace: "/mecha/alice" },
      casaDir: "/mecha/alice",
      mechaDir: "/mecha",
    });

    const unique = new Set(profile.writePaths);
    expect(profile.writePaths.length).toBe(unique.size);
  });

  it("omits project root from read paths when runtimeEntrypoint not provided", () => {
    const profile = profileFromConfig({
      config: baseConfig,
      casaDir: "/mecha/alice",
      mechaDir: "/mecha",
    });

    // Only: nodePrefix, discovery.json, casaDir, workspace
    expect(profile.readPaths).toHaveLength(4);
  });
});
