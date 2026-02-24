import type { ProcessManager } from "@mecha/process";

/** Output formatter for CLI commands */
export interface Formatter {
  success(msg: string): void;
  error(msg: string): void;
  warn(msg: string): void;
  info(msg: string): void;
  json(data: unknown): void;
  table(headers: string[], rows: string[][]): void;
}

/** Dependency injection container for CLI commands */
export interface CommandDeps {
  formatter: Formatter;
  processManager: ProcessManager;
  mechaDir: string;
}

/** Options controlling formatter behavior */
export interface FormatterOptions {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  color?: boolean;
}
