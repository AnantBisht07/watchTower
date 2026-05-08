from pathlib import Path

import pytest

from mcp_watchtower import SafetyPolicy, Watchtower


def test_default_policy_blocks_delete_and_requires_write_approval() -> None:
    policy = SafetyPolicy()

    delete_decision = policy.classify_tool("filesystem", "delete_file")
    assert delete_decision.action == "block"
    assert delete_decision.risk == "high"

    write_decision = policy.classify_tool("filesystem", "write_file")
    assert write_decision.action == "require_approval"
    assert write_decision.risk == "medium"

    read_decision = policy.classify_tool("filesystem", "read_file")
    assert read_decision.action == "allow"
    assert read_decision.risk == "low"


def test_policy_uses_first_matching_rule() -> None:
    policy = SafetyPolicy.from_dict(
        {
            "rules": [
                {
                    "match": {"server": "filesystem", "tool": "write_file"},
                    "action": "allow",
                    "risk": "low",
                    "reason": "Test override.",
                },
                {
                    "match": {"tool": "*write*"},
                    "action": "require_approval",
                    "risk": "medium",
                    "reason": "Fallback write rule.",
                },
            ]
        }
    )

    decision = policy.classify_tool("filesystem", "write_file")
    assert decision.action == "allow"
    assert decision.reason == "Test override."


def test_policy_loads_from_yaml_file(tmp_path: Path) -> None:
    policy_path = tmp_path / "policy.yaml"
    policy_path.write_text(
        """
rules:
  - match:
      server: github
      tool: create_issue
    action: require_approval
    risk: medium
    reason: Creating issues changes GitHub state.
  - match:
      tool: "*"
    action: allow
    risk: low
    reason: Default allow.
""",
        encoding="utf-8",
    )

    policy = SafetyPolicy.from_file(policy_path)

    create_issue = policy.classify_tool("github", "create_issue")
    assert create_issue.action == "require_approval"
    assert create_issue.reason == "Creating issues changes GitHub state."

    search = policy.classify_tool("github", "search_issues")
    assert search.action == "allow"


def test_watchtower_loads_policy_path_even_when_safety_flag_is_false(tmp_path: Path) -> None:
    policy_path = tmp_path / "policy.yaml"
    policy_path.write_text(
        """
rules:
  - match:
      tool: "*"
    action: block
    risk: high
    reason: Test blocks every tool.
""",
        encoding="utf-8",
    )

    watchtower = Watchtower("policy-test", db_path=tmp_path / "watchtower.db", policy_path=policy_path)

    assert watchtower.safety_policy is not None
    decision = watchtower.safety_policy.classify_tool("github", "search_issues")
    assert decision.action == "block"


def test_invalid_policy_action_is_rejected() -> None:
    with pytest.raises(ValueError, match="invalid action"):
        SafetyPolicy.from_dict(
            {
                "rules": [
                    {
                        "match": {"tool": "*"},
                        "action": "ask_nicely",
                        "risk": "medium",
                    }
                ]
            }
        )
