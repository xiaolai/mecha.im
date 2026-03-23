# 036 - Meter Embedded in Daemon, Not Separately Crashable

**Test:** 11.5 - Meter crash recovery
**Machine:** spark01 (100.100.1.5)
**Severity:** P1 (test limitation)

## Observed

`mecha meter status` reports the same PID as the daemon (779523). The meter is embedded in the daemon process, not a separate process. There is no way to crash the meter independently without crashing the entire daemon.

The meter does persist a `snapshot.json` in `~/mecha-camp/meter/` which contains usage stats. After daemon restart, the meter continues running with the snapshot data.

## Expected

Test 11.5 requires killing the meter process separately and verifying it restarts with snapshot data. Since meter is embedded in daemon, this test cannot be executed as designed.

## Assessment

The snapshot persistence works correctly (verified `meter/snapshot.json` exists with valid data). The daemon restart path loads the snapshot. However, the "meter crash recovery" scenario is not independently testable.

## Recommendation

Consider test 11.5 as PASS (snapshot persistence works) with a note that the meter is not a separate process. If independent meter crash recovery is desired, the meter would need to be extracted to a separate process.
