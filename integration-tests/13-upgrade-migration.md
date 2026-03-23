# 13 - Upgrade & Migration

Tests for version upgrades, data migration, and backward compatibility.

## Prerequisites

- Previous version installed (e.g., v0.2.6)
- Bots spawned and sessions created with previous version

## Tests

### Binary Upgrade

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 13.1 | Homebrew upgrade (macOS) | `brew upgrade xiaolai/tap/mecha` | New version installed, `mecha --version` correct | P0 | |
| 13.2 | Binary upgrade (Linux) | Download new tarball, replace binary | New version installed | P0 | |
| 13.3 | Version check | `mecha --version` | Shows correct new version (not hardcoded) | P0 | |

### State Preservation

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 13.4 | Bot configs survive | Upgrade binary, `mecha bot ls` | All bots listed with correct config | P0 | |
| 13.5 | Sessions survive | Upgrade, `mecha bot sessions ls <bot>` | Previous sessions still accessible | P0 | |
| 13.6 | TOTP secret preserved | Upgrade, `mecha totp status` | TOTP still configured | P1 | |
| 13.7 | Node registry preserved | Upgrade, `mecha node ls` | All nodes still registered | P1 | |

### Rolling Upgrade (Multi-Machine)

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 13.8 | Mixed version mesh | Upgrade A to new, keep B on old. Cross-node operations | Should work (backward compatible API) | P1 | |

## Upgrade Procedure

```bash
# 1. Stop daemon
mecha stop

# 2. Upgrade binary
# macOS:
brew upgrade xiaolai/tap/mecha
# Linux:
curl -sL https://github.com/xiaolai/mecha.im/releases/download/v<NEW>/mecha-<platform>.tar.gz | sudo tar xz -C /usr/local/bin

# 3. Verify version
mecha --version

# 4. Restart daemon
mecha start -d --host 0.0.0.0

# 5. Verify bots
mecha bot ls
mecha status
```

## Rollback

```bash
# If upgrade breaks things:
mecha stop
# Reinstall previous version
brew install xiaolai/tap/mecha@0.2.6   # or download old tarball
mecha start -d --host 0.0.0.0
```
