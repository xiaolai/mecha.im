import type { Command } from "commander";

const BASH_COMPLETION = `_mecha_completions() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="init spawn start stop restart rm ls query exec logs config sessions costs schedule webhooks auth token doctor dashboard mcp ssh-key version completion push-dashboard"

  case "\${prev}" in
    start|stop|restart|rm|logs|config|sessions|costs|schedule|webhooks|exec|ssh-key|query)
      # Complete with bot names
      local bots
      bots=$(mecha ls -q 2>/dev/null)
      COMPREPLY=( $(compgen -W "\${bots}" -- "\${cur}") )
      return 0
      ;;
    mecha)
      COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
      return 0
      ;;
  esac

  COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
}
complete -F _mecha_completions mecha`;

const ZSH_COMPLETION = `#compdef mecha

_mecha() {
  local -a commands bots
  commands=(
    'init:Initialize mecha and build Docker image'
    'spawn:Spawn a new bot'
    'start:Start a stopped bot'
    'stop:Stop a running bot'
    'restart:Restart a running bot'
    'rm:Remove a bot'
    'ls:List bots'
    'query:Send a prompt to a bot'
    'exec:Run command inside a container'
    'logs:Show bot logs'
    'config:View or edit bot config'
    'sessions:Browse conversation history'
    'costs:Show cost breakdown'
    'schedule:Manage bot schedules'
    'webhooks:Manage bot webhooks'
    'auth:Manage auth profiles'
    'token:Generate a bot token'
    'doctor:Diagnose mecha'
    'dashboard:Start fleet dashboard'
    'ssh-key:Show SSH public key'
    'version:Show version info'
    'completion:Generate shell completions'
    'mcp:Start MCP stdio server'
    'push-dashboard:Build and push dashboard to a bot'
  )

  _arguments -C \\
    '1:command:->cmds' \\
    '*::arg:->args'

  case $state in
    cmds)
      _describe 'command' commands
      ;;
    args)
      case $words[1] in
        start|stop|restart|rm|logs|config|sessions|costs|schedule|webhooks|exec|ssh-key|query)
          bots=(\${(f)"$(mecha ls -q 2>/dev/null)"})
          _describe 'bot' bots
          ;;
      esac
      ;;
  esac
}

_mecha`;

const FISH_COMPLETION = `# mecha completions for fish
set -l commands init spawn start stop restart rm ls query exec logs config sessions costs schedule webhooks auth token doctor dashboard ssh-key version completion push-dashboard

complete -c mecha -f
complete -c mecha -n "not __fish_seen_subcommand_from $commands" -a "$commands"

# Bot name completions for commands that take a bot name
for cmd in start stop restart rm logs config sessions exec ssh-key query
  complete -c mecha -n "__fish_seen_subcommand_from $cmd" -a "(mecha ls -q 2>/dev/null)"
end`;

export function registerCompletionCommand(program: Command): void {
  program
    .command("completion <shell>")
    .description("Generate shell completions (bash, zsh, fish)")
    .action((shell: string) => {
      switch (shell) {
        case "bash":
          console.log(BASH_COMPLETION);
          break;
        case "zsh":
          console.log(ZSH_COMPLETION);
          break;
        case "fish":
          console.log(FISH_COMPLETION);
          break;
        default:
          console.error(`Unknown shell: "${shell}". Supported: bash, zsh, fish`);
          console.error('Usage: eval "$(mecha completion bash)"');
          process.exit(1);
      }
    });
}
