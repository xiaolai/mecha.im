import type { BackendCommand } from "../types";

export function buildCommand(prompt: string): BackendCommand {
  const args = ["exec"];

  const model = process.env.CODEX_MODEL;
  if (model) args.push("--model", model);

  const sandbox = process.env.CODEX_SANDBOX;
  if (sandbox) args.push("--sandbox", sandbox);

  const approval = process.env.CODEX_APPROVAL;
  if (approval) args.push("--ask-for-approval", approval);

  const effort = process.env.CODEX_EFFORT;
  if (effort) args.push("-c", `model_reasoning_effort='"${effort}"'`);

  if (process.env.CODEX_JSON === "true") {
    args.push("--json");
  }

  args.push(prompt);

  return { command: "codex", args };
}
