import type { BackendCommand } from "../types";

export function buildCommand(prompt: string): BackendCommand {
  const args: string[] = [];

  const model = process.env.GEMINI_MODEL;
  if (model) args.push("--model", model);

  if (process.env.GEMINI_SANDBOX === "true") {
    args.push("--sandbox");
  }

  const approvalMode = process.env.GEMINI_APPROVAL_MODE;
  if (approvalMode) args.push("--approval-mode", approvalMode);

  const outputFormat = process.env.GEMINI_OUTPUT_FORMAT;
  if (outputFormat) args.push("--output-format", outputFormat);

  args.push("-p", prompt);

  return { command: "gemini", args };
}
