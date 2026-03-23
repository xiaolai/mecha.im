# Finding 006: MECHA_DIR not inherited by daemon process

**Tests affected:** 5.11, 6.15-6.20 (ACL), 6.10 (TOTP)
**Severity:** P1 (testing environment issue, may affect users)
**Machines:** All three machines

## Problem

When the mecha daemon is started as a background process (`--daemon`), the `MECHA_DIR` environment variable from the parent shell is not inherited. The daemon defaults to `~/.mecha/` while CLI commands run with `MECHA_DIR=~/mecha-camp`.

This causes a split-brain condition:
- **Daemon** reads/writes: `~/.mecha/` (TOTP secret, ACL, nodes, bot configs)
- **CLI** reads/writes: `~/mecha-camp/` (different TOTP secret, ACL, nodes, bot configs)

## Symptoms

1. `mecha totp setup` (CLI) generates a new TOTP secret in `~/mecha-camp/totp-secret`, but the daemon uses `~/.mecha/totp-secret` -- different secrets
2. `mecha acl grant` (CLI) writes to `~/mecha-camp/acl.json`, but the daemon enforces ACL from `~/.mecha/acl.json`
3. `mecha node add` (CLI) writes to `~/mecha-camp/nodes.json`, but the daemon reads from `~/.mecha/nodes.json`
4. Bot configs differ: `~/mecha-camp/coder/config.json` vs `~/.mecha/coder/config.json` (different ports, tokens)

## Root Cause

The daemon fork/detach process does not preserve the `MECHA_DIR` environment variable. Related to finding 003 (env not inherited by daemon).

## TOTP Env Var Mismatch

Additionally, the `.env` file sets `MECHA_TOTP` but the code reads `MECHA_OTP` (in `readTotpSecret` fallback). This means the env var fallback for TOTP never works.

## Fix

Added `export MECHA_DIR=$(pwd)` to `scripts/hotdeploy.sh` remote script, after `source .env` and before `nohup ./mecha start`. This ensures the daemon always uses the deploy directory (`~/mecha-camp`) as its mecha directory, regardless of what's in `.env`.

**Branch:** `fix/meter-accept-encoding` (included in same branch as meter fix)

## Workaround (before fix)

For testing, use the daemon's actual mechaDir (`~/.mecha/`) by:
- Reading TOTP from `~/.mecha/totp-secret`
- Using API endpoints (with session cookie auth) for ACL grants instead of CLI
- Checking bot configs in `~/.mecha/<bot>/config.json`
