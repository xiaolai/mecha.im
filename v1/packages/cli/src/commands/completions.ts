import type { Command } from "commander";
import type { CommandDeps } from "../types.js";

function getCommandNames(parent: Command): string[] {
  return parent.commands.map((c) => c.name());
}

function bashScript(commands: string[]): string {
  return `# mecha bash completions
_mecha_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local commands="${commands.join(" ")}"
  COMPREPLY=( $(compgen -W "$commands --json --quiet --verbose --no-color --version --help" -- "$cur") )
}
complete -F _mecha_completions mecha`;
}

function zshScript(commands: string[]): string {
  return `# mecha zsh completions
#compdef mecha

_mecha() {
  local -a commands
  commands=(
${commands.map((c) => `    '${c}:${c} command'`).join("\n")}
  )
  _arguments '1:command:->cmds' '*::arg:->args'
  case $state in
    cmds) _describe 'command' commands ;;
  esac
}

compdef _mecha mecha`;
}

function fishScript(commands: string[]): string {
  return `# mecha fish completions
${commands.map((c) => `complete -c mecha -n "__fish_use_subcommand" -a "${c}" -d "${c} command"`).join("\n")}
complete -c mecha -l json -d "Output results as JSON"
complete -c mecha -l quiet -s q -d "Suppress non-essential output"
complete -c mecha -l verbose -s v -d "Enable verbose output"
complete -c mecha -l no-color -d "Disable colored output"`;
}

export function registerCompletionsCommand(parent: Command, _deps: CommandDeps): void {
  parent
    .command("completions <shell>")
    .description("Generate shell completion scripts (bash, zsh, fish)")
    .action((shell: string) => {
      const commands = getCommandNames(parent);
      switch (shell) {
        case "bash":
          console.log(bashScript(commands));
          break;
        case "zsh":
          console.log(zshScript(commands));
          break;
        case "fish":
          console.log(fishScript(commands));
          break;
        default:
          console.error(`Unknown shell: ${shell}. Supported: bash, zsh, fish`);
          process.exitCode = 1;
      }
    });
}
