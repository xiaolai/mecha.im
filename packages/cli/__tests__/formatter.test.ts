import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFormatter } from "../src/formatter.js";

describe("createFormatter", () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrWrite = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("default mode", () => {
    it("success writes to stdout", () => {
      const fmt = createFormatter();
      fmt.success("done");
      expect(stdoutWrite).toHaveBeenCalledWith("done\n");
    });

    it("error writes to stderr", () => {
      const fmt = createFormatter();
      fmt.error("fail");
      expect(stderrWrite).toHaveBeenCalledWith("fail\n");
    });

    it("warn writes to stderr", () => {
      const fmt = createFormatter();
      fmt.warn("caution");
      expect(stderrWrite).toHaveBeenCalledWith("caution\n");
    });

    it("info writes to stdout", () => {
      const fmt = createFormatter();
      fmt.info("detail");
      expect(stdoutWrite).toHaveBeenCalledWith("detail\n");
    });

    it("json outputs formatted JSON", () => {
      const fmt = createFormatter();
      fmt.json({ key: "value" });
      expect(stdoutWrite).toHaveBeenCalledWith(
        JSON.stringify({ key: "value" }, null, 2) + "\n",
      );
    });
  });

  describe("json mode", () => {
    it("success is suppressed", () => {
      const fmt = createFormatter({ json: true });
      fmt.success("done");
      expect(stdoutWrite).not.toHaveBeenCalled();
    });

    it("error outputs JSON to stderr", () => {
      const fmt = createFormatter({ json: true });
      fmt.error("fail");
      expect(stderrWrite).toHaveBeenCalledWith(
        JSON.stringify({ error: "fail" }) + "\n",
      );
    });

    it("warn is suppressed", () => {
      const fmt = createFormatter({ json: true });
      fmt.warn("caution");
      expect(stderrWrite).not.toHaveBeenCalled();
    });

    it("info is suppressed", () => {
      const fmt = createFormatter({ json: true });
      fmt.info("detail");
      expect(stdoutWrite).not.toHaveBeenCalled();
    });
  });

  describe("quiet mode", () => {
    it("success is suppressed", () => {
      const fmt = createFormatter({ quiet: true });
      fmt.success("done");
      expect(stdoutWrite).not.toHaveBeenCalled();
    });

    it("error still writes to stderr", () => {
      const fmt = createFormatter({ quiet: true });
      fmt.error("fail");
      expect(stderrWrite).toHaveBeenCalledWith("fail\n");
    });

    it("info is suppressed", () => {
      const fmt = createFormatter({ quiet: true });
      fmt.info("detail");
      expect(stdoutWrite).not.toHaveBeenCalled();
    });
  });

  describe("table", () => {
    it("formats a table with headers and rows", () => {
      const fmt = createFormatter();
      fmt.table(["NAME", "STATUS"], [["researcher", "running"], ["coder", "stopped"]]);

      const calls = stdoutWrite.mock.calls.map((c) => c[0]);
      expect(calls[0]).toContain("NAME");
      expect(calls[0]).toContain("STATUS");
      expect(calls[1]).toContain("---");
      expect(calls[2]).toContain("researcher");
      expect(calls[2]).toContain("running");
      expect(calls[3]).toContain("coder");
    });

    it("outputs JSON array in json mode", () => {
      const fmt = createFormatter({ json: true });
      fmt.table(["NAME", "STATUS"], [["researcher", "running"]]);

      const output = stdoutWrite.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output) as unknown;
      expect(parsed).toEqual([{ NAME: "researcher", STATUS: "running" }]);
    });

    it("is suppressed in quiet mode", () => {
      const fmt = createFormatter({ quiet: true });
      fmt.table(["NAME"], [["researcher"]]);
      expect(stdoutWrite).not.toHaveBeenCalled();
    });

    it("handles sparse rows with missing cells", () => {
      const fmt = createFormatter();
      // Row has fewer cells than headers — triggers ?? fallbacks
      fmt.table(["NAME", "STATUS", "PORT"], [["researcher"]]);

      const calls = stdoutWrite.mock.calls.map((c) => c[0]);
      expect(calls[0]).toContain("NAME");
      expect(calls[2]).toContain("researcher");
    });

    it("handles completely empty rows", () => {
      const fmt = createFormatter();
      fmt.table(["NAME"], [[]]);
      const calls = stdoutWrite.mock.calls.map((c) => c[0]);
      // Empty row should use "" fallback
      expect(calls[2]).toContain("");
    });

    it("handles sparse rows in json mode", () => {
      const fmt = createFormatter({ json: true });
      fmt.table(["NAME", "STATUS"], [["researcher"]]);

      const output = stdoutWrite.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output) as unknown;
      expect(parsed).toEqual([{ NAME: "researcher", STATUS: "" }]);
    });
  });
});
