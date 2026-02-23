import type { Formatter, FormatterOptions } from "./types.js";

/** Create a formatter that adapts output based on --json, --quiet, --verbose flags */
export function createFormatter(opts: FormatterOptions = {}): Formatter {
  const { json = false, quiet = false } = opts;

  function write(stream: "stdout" | "stderr", msg: string): void {
    if (quiet && stream === "stdout") return;
    const target = stream === "stdout" ? process.stdout : process.stderr;
    target.write(msg + "\n");
  }

  return {
    success(msg: string): void {
      if (json) return;
      write("stdout", msg);
    },

    error(msg: string): void {
      if (json) {
        write("stderr", JSON.stringify({ error: msg }));
        return;
      }
      write("stderr", msg);
    },

    warn(msg: string): void {
      if (json) return;
      write("stderr", msg);
    },

    info(msg: string): void {
      if (json || quiet) return;
      write("stdout", msg);
    },

    json(data: unknown): void {
      write("stdout", JSON.stringify(data, null, 2));
    },

    table(headers: string[], rows: string[][]): void {
      if (json) {
        const objects = rows.map((row) => {
          const obj: Record<string, string> = {};
          headers.forEach((h, i) => {
            obj[h] = row[i] ?? "";
          });
          return obj;
        });
        write("stdout", JSON.stringify(objects, null, 2));
        return;
      }

      if (quiet) return;

      // Calculate column widths
      const widths = headers.map((h, i) =>
        Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
      );

      // Header row
      const headerLine = headers
        .map((h, i) => h.padEnd(widths[i]!))
        .join("  ");
      write("stdout", headerLine);

      // Separator
      const separator = widths.map((w) => "-".repeat(w)).join("  ");
      write("stdout", separator);

      // Data rows
      for (const row of rows) {
        const line = headers
          .map((_, i) => (row[i] ?? "").padEnd(widths[i]!))
          .join("  ");
        write("stdout", line);
      }
    },
  };
}
