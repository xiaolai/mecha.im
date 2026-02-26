import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerMeterStartCommand } from "./meter-start.js";
import { registerMeterStopCommand } from "./meter-stop.js";
import { registerMeterStatusCommand } from "./meter-status.js";

export function registerMeterCommand(program: Command, deps: CommandDeps): void {
  const meter = program
    .command("meter")
    .description("Metering proxy management");

  registerMeterStartCommand(meter, deps);
  registerMeterStopCommand(meter, deps);
  registerMeterStatusCommand(meter, deps);
}
