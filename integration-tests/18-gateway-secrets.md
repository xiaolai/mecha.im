# 18 - Gateway & Secrets

End-to-end tests for the credential store and gateway features.

## Prerequisites

- mecha v0.2.17+
- At least one bot spawned

## Secret Management

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 18.1 | Set secret | `mecha secret set GITHUB_TOKEN ghp_xxx123` | Secret stored, confirmation | P0 | |
| 18.2 | List secrets | `mecha secret list` | Shows GITHUB_TOKEN (not the value) | P0 | |
| 18.3 | Grant access | `mecha secret grant developer GITHUB_TOKEN` | Access granted | P0 | |
| 18.4 | Revoke access | `mecha secret revoke developer GITHUB_TOKEN` | Access revoked | P0 | |
| 18.5 | Multiple secrets | Set 3 secrets, list all | All 3 shown | P0 | |
| 18.6 | Overwrite secret | Set same secret name with new value | Value updated silently | P0 | |

## Secret File Security

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 18.7 | File permissions | `ls -la ~/.mecha/secrets/secrets.json` | Permissions = 600 (owner only) | P0 | |
| 18.8 | Values not in plaintext | `cat ~/.mecha/secrets/secrets.json` | Values are base64-encoded, not raw plaintext | P1 | |

## Circuit Breaker (observational)

| # | Test | Steps | Expected | P | Result |
|---|------|-------|----------|---|--------|
| 18.9 | Normal operation | Gateway HTTP request to allowed host | Request succeeds | P1 | |
| 18.10 | Denied host | Gateway HTTP request to non-allowlisted host | GatewayDeniedError | P1 | |
