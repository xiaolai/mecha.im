import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProgram } from "../src/program.js";
import { makeDeps } from "./test-utils.js";
import type { CommandDeps } from "../src/types.js";

// Mock the service layer
vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    botActivitySnapshot: vi.fn().mockResolvedValue({
      name: "alice",
      activity: "thinking",
      timestamp: "2026-03-11T00:00:00.000Z",
    }),
  };
});

import { botActivitySnapshot } from "@mecha/service";

describe("bot activity command", () => {
  let deps: CommandDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    (botActivitySnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({
      name: "alice",
      activity: "thinking",
      timestamp: "2026-03-11T00:00:00.000Z",
    });
    deps = makeDeps({
      pm: {
        getPortAndToken: vi.fn().mockReturnValue({ port: 7700, token: "t" }),
        get: vi.fn().mockReturnValue({ name: "alice", state: "running" }),
      },
    });
  });

  function run(args: string[]) {
    const program = createProgram(deps);
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    return program.parseAsync(["node", "mecha", ...args]);
  }

  it("registers the activity subcommand", () => {
    const program = createProgram(deps);
    const botCmd = program.commands.find((c) => c.name() === "bot");
    expect(botCmd).toBeDefined();
    const activityCmd = botCmd!.commands.find((c) => c.name() === "activity");
    expect(activityCmd).toBeDefined();
    expect(activityCmd!.description()).toContain("activity");
  });

  it("displays snapshot in table format", async () => {
    await run(["bot", "activity", "alice"]);

    expect(botActivitySnapshot).toHaveBeenCalledWith(deps.processManager, "alice");
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Field", "Value"],
      [
        ["name", "alice"],
        ["activity", "thinking"],
        ["timestamp", "2026-03-11T00:00:00.000Z"],
      ],
    );
  });

  it("displays snapshot in JSON format", async () => {
    (deps.formatter as { isJson: boolean }).isJson = true;
    await run(["bot", "activity", "alice"]);

    expect(deps.formatter.json).toHaveBeenCalledWith({
      name: "alice",
      activity: "thinking",
      timestamp: "2026-03-11T00:00:00.000Z",
    });
  });
});
