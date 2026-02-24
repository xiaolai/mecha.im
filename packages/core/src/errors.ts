/**
 * Base error class for all mecha errors.
 * Carries HTTP status code and CLI exit code for consistent error handling.
 */
export class MechaError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly exitCode: number;

  constructor(
    message: string,
    opts: { code: string; statusCode: number; exitCode: number },
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.exitCode = opts.exitCode;
  }
}

export class InvalidNameError extends MechaError {
  constructor(input: string) {
    super(
      `Invalid name: "${input}" (must be lowercase, alphanumeric, hyphens)`,
      { code: "INVALID_NAME", statusCode: 400, exitCode: 1 },
    );
  }
}
