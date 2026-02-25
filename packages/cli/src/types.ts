import type { ProcessManager } from "@mecha/process";
import type { AclEngine } from "@mecha/core";

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
  acl: AclEngine;
}

/** Options controlling formatter behavior */
export interface FormatterOptions {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  color?: boolean;
}
