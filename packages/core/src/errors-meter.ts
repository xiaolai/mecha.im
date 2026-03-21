import { defError } from "./errors-base.js";

// --- Meter errors ---
/** Error thrown when the meter proxy is already running. */
export const MeterProxyAlreadyRunningError = defError<[number]>(
  "MeterProxyAlreadyRunningError",
  { code: "METER_PROXY_ALREADY_RUNNING", statusCode: 409, exitCode: 1 },
  (pid) => `Metering proxy already running (pid ${pid})`,
);

/** Error thrown when the meter proxy is not running. */
export const MeterProxyNotRunningError = defError<[]>(
  "MeterProxyNotRunningError",
  { code: "METER_PROXY_NOT_RUNNING", statusCode: 409, exitCode: 1 },
  () => "Metering proxy is not running",
);

/** Error thrown when metering is required but the proxy is not configured. */
export const MeterProxyRequiredError = defError<[]>(
  "MeterProxyRequiredError",
  { code: "METER_PROXY_REQUIRED", statusCode: 503, exitCode: 2 },
  () => "Metering proxy required but not running. Start with: mecha meter start",
);
