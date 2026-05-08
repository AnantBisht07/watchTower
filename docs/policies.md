# Safety Policies

Safety policies classify tool calls before execution. A rule can allow the call, require local approval, or block the call.

## Actions

- `allow`: execute immediately.
- `require_approval`: emit `approval_required` and pause until approved or rejected.
- `block`: emit `tool_call_rejected` and do not call the underlying MCP client.

## Example

```yaml
rules:
  - match:
      server: "filesystem"
      tool: "*write*"
    action: require_approval
    risk: medium
    reason: "Writing files requires human approval."

  - match:
      tool: "*delete*"
    action: block
    risk: high
    reason: "Delete tools are blocked locally."

  - match:
      tool: "*"
    action: allow
    risk: low
    reason: "Default allow."
```

Load a policy file with:

```python
from mcp_watchtower import Watchtower

watchtower = Watchtower(
    app_name="repo-writer-agent",
    policy_path="watchtower.policy.yaml",
)
```
