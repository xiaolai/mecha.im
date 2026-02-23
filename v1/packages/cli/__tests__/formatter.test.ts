import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFormatter } from "../src/output/formatter.js";

describe("createFormatter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("info() prints to stdout", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fmt = createFormatter({});
    fmt.info("hello");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toContain("hello");
  });

  it("error() prints to stderr", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fmt = createFormatter({});
    fmt.error("bad");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toContain("bad");
  });

  it("success() prints to stdout", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fmt = createFormatter({});
    fmt.success("done");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toContain("done");
  });

  it("json() prints JSON to stdout", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fmt = createFormatter({});
    fmt.json({ key: "value" });
    expect(spy).toHaveBeenCalledWith(JSON.stringify({ key: "value" }, null, 2));
  });

  it("quiet mode suppresses info and success", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fmt = createFormatter({ quiet: true });
    fmt.info("should not appear");
    fmt.success("should not appear");
    expect(spy).not.toHaveBeenCalled();
  });

  it("quiet mode still shows errors", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fmt = createFormatter({ quiet: true });
    fmt.error("should appear");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("noColor disables color codes", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fmt = createFormatter({ noColor: true });
    fmt.info("plain");
    const output = spy.mock.calls[0]![0] as string;
    expect(output).toBe("plain");
    expect(output).not.toContain("\x1b[");
  });

  it("table() prints rows with headers", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fmt = createFormatter({ noColor: true });
    fmt.table(
      [
        { A: "1", B: "2" },
        { A: "10", B: "20" },
      ],
      ["A", "B"],
    );
    // header + separator + 2 data rows = 4 calls
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("table() prints empty message for no rows", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fmt = createFormatter({});
    fmt.table([], ["A", "B"]);
    expect(spy).toHaveBeenCalledWith("(no results)");
  });

  it("table() is suppressed in quiet mode", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fmt = createFormatter({ quiet: true });
    fmt.table([{ A: "1" }], ["A"]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("table() handles missing values in rows", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fmt = createFormatter({ noColor: true });
    fmt.table([{ A: "1" }], ["A", "B"]);
    // header + separator + 1 data row = 3 calls
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
