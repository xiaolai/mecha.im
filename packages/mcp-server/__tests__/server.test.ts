import { describe, it, expect, vi } from "vitest";

const mockLocate = vi.fn();
const mockInvalidate = vi.fn();
const mockClear = vi.fn();

vi.mock("@mecha/service", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    MechaLocator: class {
      locate = mockLocate;
      invalidate = mockInvalidate;
      clear = mockClear;
    },
  };
});

// Must import after mock setup
const { createMeshMcpServer } = await import("../src/server.js");

function makeMockDocker() {
  return { docker: {} } as any;
}

describe("createMeshMcpServer", () => {
  it("returns handle with mcpServer and locator", () => {
    const handle = createMeshMcpServer({
      docker: makeMockDocker(),
      getNodes: () => [],
    });

    expect(handle.mcpServer).toBeDefined();
    expect(handle.locator).toBeDefined();
  });

  it("uses provided locator when given", () => {
    const locator = { locate: vi.fn(), invalidate: vi.fn(), clear: vi.fn() } as any;
    const handle = createMeshMcpServer({
      docker: makeMockDocker(),
      getNodes: () => [],
      locator,
    });

    expect(handle.locator).toBe(locator);
  });

  it("registers all 12 tools", () => {
    const handle = createMeshMcpServer({
      docker: makeMockDocker(),
      getNodes: () => [],
    });

    const server = handle.mcpServer as any;
    const toolNames = Object.keys(server._registeredTools ?? {});
    expect(toolNames).toHaveLength(12);
    expect(toolNames).toContain("mesh_list_nodes");
    expect(toolNames).toContain("mesh_list_mechas");
    expect(toolNames).toContain("mesh_mecha_status");
    expect(toolNames).toContain("mesh_list_sessions");
    expect(toolNames).toContain("mesh_get_session");
    expect(toolNames).toContain("mesh_create_session");
    expect(toolNames).toContain("mesh_query");
    expect(toolNames).toContain("mesh_delete_session");
    expect(toolNames).toContain("mesh_star_session");
    expect(toolNames).toContain("mesh_rename_session");
    expect(toolNames).toContain("mesh_workspace_list");
    expect(toolNames).toContain("mesh_workspace_read");
  });
});
