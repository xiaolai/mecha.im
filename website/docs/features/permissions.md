# Permissions (ACL)

Mecha uses **capability-based access control** to mediate all inter-agent communication. No grant means no access — agents are isolated by default.

## Capabilities

| Capability | Description |
|------------|-------------|
| `query` | Send a message and receive a response |
| `read_workspace` | Read files from the target's workspace |
| `write_workspace` | Write files to the target's workspace |
| `execute` | Request command execution on the target |
| `read_sessions` | View the target's chat history |
| `lifecycle` | Start, stop, or restart the target |

## Granting Permissions

```bash
# Allow coder to query reviewer
mecha acl grant coder query reviewer

# Allow researcher to read coder's workspace
mecha acl grant researcher read_workspace coder
```

## Revoking Permissions

```bash
# Revoke a specific capability
mecha acl revoke coder query reviewer
```

## Viewing Permissions

```bash
# Show all ACL rules
mecha acl show

# Show rules for a specific bot
mecha acl show coder
```

## How ACL Enforcement Works

Every inter-agent interaction goes through the ACL engine:

```mermaid
flowchart TD
  A["coder wants to query reviewer"] --> B{"ACL grant exists?"}
  B -- YES --> C["Forward the query"]
  B -- NO --> D["Reject: Access denied"]
  A --> E{"Cross-node query?"}
  E -- YES --> F["Source node checks outbound ACL"]
  E -- YES --> G["Target node checks inbound ACL"]
  F --> H{"Both approve?"}
  G --> H
  H -- YES --> C
  H -- NO --> D
```

Both sides must approve. This prevents a compromised node from unilaterally accessing agents on another node.

## ACL Storage

Rules are stored in `~/.mecha/acl.json`:

```json
{
  "rules": [
    {
      "source": "coder",
      "target": "reviewer",
      "capabilities": ["query", "read_workspace"]
    }
  ]
}
```

The file is written atomically (tmp + rename) to prevent corruption.

## Expose

bots can declare which capabilities they expose to the mesh for discovery:

```json
{
  "expose": ["query"]
}
```

When another agent discovers bots via the mesh, only those with matching exposed capabilities appear in results — and only if the ACL allows the requesting agent to use that capability.
