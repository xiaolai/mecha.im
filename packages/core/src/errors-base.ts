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
    opts: { code: string; statusCode: number; exitCode: number; cause?: unknown },
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = this.constructor.name;
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.exitCode = opts.exitCode;
  }
}

// --- Domain errors (factory pattern) ---

type ErrorOpts = { code: string; statusCode: number; exitCode: number };

export function defError<A extends unknown[]>(
  name: string,
  opts: ErrorOpts,
  msg: (...args: A) => string,
) {
  const arity = msg.length;
  const cls = class extends MechaError {
    constructor(...args: [...A] | [...A, { cause?: unknown }]) {
      // Only treat the last arg as cause-opts when there's an extra argument
      // beyond the message function's arity AND it's a plain object with "cause".
      // This avoids misclassifying legitimate object args (all current factories
      // use string/number args, so any trailing object is unambiguously cause-opts).
      const last = args.length > arity ? args[args.length - 1] : undefined;
      const hasCauseOpt = typeof last === "object" && last !== null && "cause" in last;
      const cause = hasCauseOpt ? (last as { cause?: unknown }).cause : undefined;
      const msgArgs = (hasCauseOpt ? args.slice(0, -1) : args) as unknown as A;
      super(msg(...msgArgs), { ...opts, cause });
      this.name = name;
    }
  };
  Object.defineProperty(cls, "name", { value: name });
  return cls;
}
