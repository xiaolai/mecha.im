# 032 - Parallel Spawn Port Allocation Race Condition

**Test:** 11.15 - Simultaneous spawn (5 parallel)
**Machine:** spark01 (100.100.1.5)
**Severity:** P1

## Observed

Five parallel `mecha bot spawn par-{1..5}` all got assigned port 7701. Only one (par-1) successfully started; the other four crashed immediately because the port was already bound.

```
Spawned par-1 on port 7701
Spawned par-5 on port 7701
Spawned par-3 on port 7701
Spawned par-2 on port 7701
Spawned par-4 on port 7701
```

After settling:
```
par-1  running  7701
par-2  stopped  7701
par-3  stopped  7701
par-4  stopped  7701
par-5  stopped  7701
```

## Expected

Each bot should receive a unique port (7701, 7702, 7703, 7704, 7705). Port allocation must be atomic or use a locking mechanism.

## Root Cause

Port scanning (check if port is free) and port assignment are not atomic. All five processes scan at the same time, all see 7701 as free, all try to bind.

## Fix

Use a mutex/lock file during port allocation, or use an atomic port reservation in the daemon (request port from daemon, not from each CLI process independently).
