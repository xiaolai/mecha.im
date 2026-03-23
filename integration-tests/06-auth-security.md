# 06 - Auth & Security

Tests for authentication, authorization, ACL, and security boundaries.

## Prerequisites

- Mecha daemon running
- At least one bot spawned

## Tests

### Auth Profiles

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 6.1 | Add auth profile | `mecha auth add my-key --api-key --token sk-ant-...` | Profile saved | P0 | |
| 6.2 | List profiles | `mecha auth ls` | Shows all profiles with default marker | P0 | |
| 6.3 | Set default | `mecha auth default my-key` | Default profile updated | P0 | |
| 6.4 | Test profile (online) | `mecha auth test my-key` | Validates against Anthropic API | P0 | |
| 6.5 | Test profile (offline) | `mecha auth test my-key --offline` | Checks token exists locally | P1 | |
| 6.6 | Remove profile | `mecha auth rm my-key` | Profile deleted | P0 | |
| 6.7 | Switch bot auth | `mecha auth switch coder my-key` | Bot uses specified profile | P1 | |
| 6.8 | Renew token | `mecha auth renew my-key <new-token>` | Token updated | P1 | |
| 6.9 | Tag profile | `mecha auth tag my-key prod research` | Tags saved | P2 | |

### TOTP Authentication

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 6.10 | TOTP setup | `mecha totp setup` | QR code + secret displayed | P0 | |
| 6.11 | TOTP verify valid | `mecha totp verify <valid-code>` | Verification succeeds | P0 | |
| 6.12 | TOTP verify invalid | `mecha totp verify 000000` | Verification fails | P0 | |
| 6.13 | TOTP status | `mecha totp status` | Shows whether TOTP is configured | P1 | |
| 6.14 | Dashboard login with TOTP | Login via dashboard with TOTP code | Session cookie issued | P0 | |

### ACL (Inter-Bot Permissions)

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 6.15 | Grant capability | `mecha acl grant bob query alice` | Rule created | P0 | |
| 6.16 | Show ACL | `mecha acl show` | Lists all rules | P0 | |
| 6.17 | Show per-bot ACL | `mecha acl show alice` | Filtered rules for alice | P1 | |
| 6.18 | Revoke capability | `mecha acl revoke bob query alice` | Rule removed | P0 | |
| 6.19 | ACL enforcement - allowed | Grant + query via API | Query succeeds | P0 | |
| 6.20 | ACL enforcement - denied | No grant + query via API | 403 Forbidden | P0 | |

### Security Boundaries

| # | Test | Command | Expected | P | Result |
|---|------|---------|----------|---|--------|
| 6.21 | Bearer token required | `curl http://127.0.0.1:<port>/api/sessions` (no auth) | 401 Unauthorized | P0 | |
| 6.22 | Path traversal blocked | `curl .../bots/coder/files/read?path=../../etc/passwd` (with auth) | 400 or 403 (not file contents) | P0 | |

## Verification

```bash
# Auth profiles stored at:
cat ~/.mecha/auth/profiles.json

# ACL rules stored at:
cat ~/.mecha/acl.json

# TOTP secret stored at:
cat ~/.mecha/totp-secret.json

# Bot-level auth token:
cat ~/.mecha/<bot>/config.json | jq .token
```
