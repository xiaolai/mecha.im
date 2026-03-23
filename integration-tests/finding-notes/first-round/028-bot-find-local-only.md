# 028 - bot find --tag Only Searches Local Bots

**Severity:** Low
**Tests affected:** 5.13

## Problem

`mecha bot find --tag dev` only returns bots from the local node. The test specification expects it to "find bots on all nodes matching tag," performing a cross-node search across the mesh.

```
$ mecha bot find --tag dev
Name    State    Port  Tags
------  -------  ----  -------------
tagged  stopped  7703  dev, research
```

No remote nodes (linode02, mac-mini) are queried.

## Expected

`bot find --tag` should query all registered mesh nodes via their `/discover?tag=...` endpoints and merge results, similar to how `bot ls` is expected to show remote bots.

## Context

This is consistent with existing finding 006 (bot ls no remote bots). The discover REST API (`/discover?tag=dev`) works correctly for the local node but does not fan out to remote nodes either.
