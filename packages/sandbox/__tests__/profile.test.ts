import { describe, it, expect } from "vitest";
import { profileFromConfig } from "../src/profile.js";
import type { CasaConfig } from "@mecha/core";

describe("profileFromConfig", () => {
  const baseConfig: CasaConfig = {
    port: 7700,
    token: "mecha_test",
    workspace: "/home/user/project",
  };

  it("includes node binary in read paths and allowed processes", () => {
    const profile = profileFromConfig({
      config: baseConfig,
      casaDir: "/mecha/alice",
      mechaDir: "/mecha",
    });

    expect(profile.readPaths).toContain(process.execPath);
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

  it("includes runtime entrypoint in read paths when provided", () => {
    const profile = profileFromConfig({
      config: baseConfig,
      casaDir: "/mecha/alice",
      mechaDir: "/mecha",
      runtimeEntrypoint: "/mecha/runtime/dist/main.js",
    });

    expect(profile.readPaths).toContain("/mecha/runtime/dist/main.js");
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

  it("omits runtime entrypoint from read paths when not provided", () => {
    const profile = profileFromConfig({
      config: baseConfig,
      casaDir: "/mecha/alice",
      mechaDir: "/mecha",
    });

    // Only: execPath, discovery.json, casaDir, workspace
    expect(profile.readPaths).toHaveLength(4);
  });
});
