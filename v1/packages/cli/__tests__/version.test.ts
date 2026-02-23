import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

describe("mecha --version", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  it("outputs the version from package.json", async () => {
    const { createProgram } = await import("../src/program.js");
    const program = createProgram({
      processManager: {} as any,
      formatter: { info: vi.fn(), error: vi.fn(), success: vi.fn(), json: vi.fn(), table: vi.fn() },
    });

    // Commander writes version to stdout and exits
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      await program.parseAsync(["--version"], { from: "user" });
    } catch {
      // expected — commander calls process.exit
    }

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain(pkg.version);

    exitSpy.mockRestore();
    writeSpy.mockRestore();
  });
});
