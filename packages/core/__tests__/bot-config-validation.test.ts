import { describe, it, expect } from "vitest";
import { validateBotConfig } from "../src/bot-config-validation.js";

describe("validateBotConfig", () => {
  it("returns ok for empty input", () => {
    const result = validateBotConfig({});
    expect(result).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it("returns ok for a valid config with no conflicts", () => {
    const result = validateBotConfig({
      permissionMode: "default",
      sandboxMode: "require",
      systemPrompt: "You are helpful.",
      allowedTools: ["bash"],
      maxBudgetUsd: 5,
      meterOff: false,
    });
    expect(result).toEqual({ ok: true, errors: [], warnings: [] });
  });

  // Rule 1: REJECT bypassPermissions without sandboxMode require
  it("rejects bypassPermissions when sandboxMode is not require", () => {
    const result = validateBotConfig({
      permissionMode: "bypassPermissions",
      sandboxMode: "off",
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "permissionMode 'bypassPermissions' requires sandboxMode 'require'",
    );
  });

  it("rejects bypassPermissions when sandboxMode is undefined", () => {
    const result = validateBotConfig({
      permissionMode: "bypassPermissions",
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "permissionMode 'bypassPermissions' requires sandboxMode 'require'",
    );
  });

  it("allows bypassPermissions with sandboxMode require", () => {
    const result = validateBotConfig({
      permissionMode: "bypassPermissions",
      sandboxMode: "require",
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  // Rule 2: WARN auto + off
  it("warns when permissionMode auto with sandboxMode off", () => {
    const result = validateBotConfig({
      permissionMode: "auto",
      sandboxMode: "off",
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toContain(
      "permissionMode 'auto' with sandboxMode 'off' has no safety net",
    );
  });

  // Rule 3: REJECT systemPrompt + appendSystemPrompt
  it("rejects both systemPrompt and appendSystemPrompt set", () => {
    const result = validateBotConfig({
      systemPrompt: "You are a bot.",
      appendSystemPrompt: "Extra instructions.",
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "systemPrompt and appendSystemPrompt are mutually exclusive",
    );
  });

  // Rule 4: REJECT allowedTools + tools both non-empty
  it("rejects both allowedTools and tools non-empty", () => {
    const result = validateBotConfig({
      allowedTools: ["bash"],
      tools: ["web"],
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "allowedTools and tools are mutually exclusive",
    );
  });

  it("allows allowedTools empty with tools non-empty", () => {
    const result = validateBotConfig({
      allowedTools: [],
      tools: ["web"],
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("allows allowedTools non-empty with tools empty", () => {
    const result = validateBotConfig({
      allowedTools: ["bash"],
      tools: [],
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // Rule 5: WARN maxBudgetUsd with meterOff
  it("warns when maxBudgetUsd set with meterOff true", () => {
    const result = validateBotConfig({
      maxBudgetUsd: 10,
      meterOff: true,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toContain(
      "maxBudgetUsd set but metering is off — session cap works but no aggregate tracking",
    );
  });

  // Multiple errors
  it("collects multiple errors", () => {
    const result = validateBotConfig({
      permissionMode: "bypassPermissions",
      sandboxMode: "off",
      systemPrompt: "a",
      appendSystemPrompt: "b",
      allowedTools: ["x"],
      tools: ["y"],
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(3);
  });

  // Multiple warnings
  it("collects multiple warnings", () => {
    const result = validateBotConfig({
      permissionMode: "auto",
      sandboxMode: "off",
      maxBudgetUsd: 5,
      meterOff: true,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(2);
  });
});
