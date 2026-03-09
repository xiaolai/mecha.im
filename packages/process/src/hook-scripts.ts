import { join } from "node:path";
import { writeFileSync } from "node:fs";

/**
 * Write sandbox enforcement hook scripts and settings.json for a bot.
 * Hook scripts receive JSON on stdin per Claude Code PreToolUse spec.
 * Uses Node.js one-liner for JSON parsing (no jq dependency, no grep/sed injection risk).
 */
export function writeHookScripts(claudeDir: string, hooksDir: string): void {
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: "Read|Write|Edit|Glob|Grep",
          hooks: [{
            type: "command",
            command: "$HOME/.claude/hooks/sandbox-guard.sh",
            timeout: 5,
          }],
        },
        {
          matcher: "Bash",
          hooks: [{
            type: "command",
            command: "$HOME/.claude/hooks/bash-guard.sh",
            timeout: 5,
          }],
        },
      ],
    },
  };
  writeFileSync(join(claudeDir, "settings.json"), JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });

  // Hook scripts — hooks receive JSON on stdin per Claude Code PreToolUse spec
  // Use Node.js one-liner for JSON parsing (no jq dependency, no grep/sed injection risk)
  const sandboxGuard = `#!/bin/bash
# Sandbox guard: block file access outside bot root
# Claude Code PreToolUse hooks receive JSON on stdin with tool_name + tool_input
INPUT=$(cat)
# Parse JSON structurally via Node.js to extract the path field
TARGET=$(echo "$INPUT" | node -e "
  const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
  const i=d.tool_input||{};
  const p=i.file_path||i.path||i.directory||'';
  process.stdout.write(String(p));
" 2>/dev/null)
if [ -z "$TARGET" ]; then
  exit 2  # No path extracted — deny by default (fail-closed)
fi
# Canonicalize target path, following symlinks
RESOLVED=$(realpath -m "$TARGET" 2>/dev/null || (cd "$(dirname "$TARGET")" 2>/dev/null && pwd)/$(basename "$TARGET"))
# Canonicalize allowed roots
SANDBOX=$(realpath -m "$MECHA_SANDBOX_ROOT" 2>/dev/null || echo "$MECHA_SANDBOX_ROOT")
WORKSPACE=$(realpath -m "$MECHA_WORKSPACE" 2>/dev/null || echo "$MECHA_WORKSPACE")
case "$RESOLVED" in
  "$SANDBOX"/*|"$SANDBOX") exit 0 ;;
  "$WORKSPACE"/*|"$WORKSPACE") exit 0 ;;
  *) echo "BLOCKED: $RESOLVED is outside sandbox" >&2; exit 2 ;;
esac
`;
  const bashGuard = `#!/bin/bash
# Bash guard: validate Bash tool calls
# Claude Code PreToolUse hooks receive JSON on stdin with tool_input.command
# Exit 0 = allow command as-is, Exit 2 = block
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | node -e "
  const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
  const i=d.tool_input||{};
  process.stdout.write(String(i.command||''));
" 2>/dev/null)
if [ -z "$COMMAND" ]; then
  exit 2  # No command extracted — deny by default (fail-closed)
fi
# Canonicalize allowed roots
SANDBOX=$(realpath -m "$MECHA_SANDBOX_ROOT" 2>/dev/null || echo "$MECHA_SANDBOX_ROOT")
WORKSPACE=$(realpath -m "$MECHA_WORKSPACE" 2>/dev/null || echo "$MECHA_WORKSPACE")
# Block commands that explicitly reference paths outside sandbox/workspace
# Extract file path arguments from the command
# Use process substitution to avoid subshell — exit 2 exits the main script
while read -r FPATH; do
  RESOLVED=$(realpath -m "$FPATH" 2>/dev/null || echo "$FPATH")
  case "$RESOLVED" in
    "$SANDBOX"/*|"$SANDBOX") ;;
    "$WORKSPACE"/*|"$WORKSPACE") ;;
    /usr/bin/*|/usr/local/bin/*|/bin/*|/usr/sbin/*|/dev/null|/dev/stdin|/dev/stdout|/dev/stderr|/tmp/*) ;;
    *) echo "BLOCKED: $RESOLVED is outside sandbox" >&2; exit 2 ;;
  esac
done < <(echo "$COMMAND" | grep -oE '((~|/|\\.\\./|\\./)([^ ;"'"'"'|&>]*))')
# Also block shell variable expansions that could reference paths outside sandbox
if echo "$COMMAND" | grep -qE '\\$HOME|\\$\\{HOME\\}|\\$MECHA_DIR'; then
  echo "BLOCKED: command references shell variable paths" >&2; exit 2
fi
exit 0
`;
  writeFileSync(join(hooksDir, "sandbox-guard.sh"), sandboxGuard, { mode: 0o755 });
  writeFileSync(join(hooksDir, "bash-guard.sh"), bashGuard, { mode: 0o755 });
}
