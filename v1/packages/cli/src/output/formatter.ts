import type { GlobalOptions } from "@mecha/core";

export interface Formatter {
  info(msg: string): void;
  error(msg: string): void;
  success(msg: string): void;
  json(data: unknown): void;
  table(rows: Record<string, string>[], headers: string[]): void;
}

export function createFormatter(opts: GlobalOptions): Formatter {
  const useColor = !opts.noColor && !process.env["NO_COLOR"];
  const quiet = opts.quiet ?? false;

  function colorize(code: number, text: string): string {
    if (!useColor) return text;
    return `\x1b[${code}m${text}\x1b[0m`;
  }

  return {
    info(msg: string): void {
      if (quiet) return;
      console.log(colorize(36, msg));
    },

    error(msg: string): void {
      console.error(colorize(31, `Error: ${msg}`));
    },

    success(msg: string): void {
      if (quiet) return;
      console.log(colorize(32, msg));
    },

    json(data: unknown): void {
      console.log(JSON.stringify(data, null, 2));
    },

    table(rows: Record<string, string>[], headers: string[]): void {
      if (quiet) return;
      if (rows.length === 0) {
        console.log("(no results)");
        return;
      }

      // Calculate column widths
      const widths: Record<string, number> = Object.fromEntries(headers.map((h) => [h, h.length]));
      for (const row of rows)
        for (const h of headers)
          widths[h] = Math.max(widths[h]!, (row[h] ?? "").length);

      // Print header
      const headerLine = headers.map((h) => h.padEnd(widths[h]!)).join("  ");
      console.log(colorize(1, headerLine));
      console.log(headers.map((h) => "-".repeat(widths[h]!)).join("  "));

      // Print rows
      for (const row of rows) {
        const line = headers
          .map((h) => (row[h] ?? "").padEnd(widths[h]!))
          .join("  ");
        console.log(line);
      }
    },
  };
}
