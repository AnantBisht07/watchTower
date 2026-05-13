"""Rule-based safety policy for MCP tool calls."""

from __future__ import annotations

from dataclasses import dataclass, field
from fnmatch import fnmatchcase
from pathlib import Path
from typing import Any

import yaml


@dataclass(slots=True)
class RiskDecision:
    action: str
    risk: str
    reason: str


@dataclass
class PolicyRule:
    tool: str
    action: str
    risk: str
    reason: str
    server: str = "*"
    # Optional argument-level matchers: {arg_key: fnmatch_pattern}
    arguments: dict[str, str] = field(default_factory=dict)


class SafetyPolicy:
    def __init__(self, rules: list[PolicyRule] | None = None) -> None:
        self.rules = rules or default_rules()

    @classmethod
    def from_file(cls, path: str | Path) -> "SafetyPolicy":
        policy_path = Path(path)
        with policy_path.open("r", encoding="utf-8") as file:
            payload = yaml.safe_load(file) or {}
        return cls.from_dict(payload)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "SafetyPolicy":
        rules: list[PolicyRule] = []
        for index, raw_rule in enumerate(payload.get("rules", []), start=1):
            match = raw_rule.get("match") or {}
            action = raw_rule.get("action")
            risk = raw_rule.get("risk")
            if not action or not risk:
                raise ValueError(f"policy rule {index} must include action and risk")
            if action not in {"allow", "require_approval", "block"}:
                raise ValueError(f"policy rule {index} has invalid action: {action}")

            arg_matchers: dict[str, str] = {}
            raw_args = match.get("arguments")
            if isinstance(raw_args, dict):
                arg_matchers = {str(k): str(v) for k, v in raw_args.items()}

            rules.append(
                PolicyRule(
                    server=match.get("server", "*"),
                    tool=match.get("tool", "*"),
                    action=action,
                    risk=risk,
                    reason=raw_rule.get("reason") or f"Matched policy rule {index}.",
                    arguments=arg_matchers,
                )
            )

        if not rules:
            raise ValueError("policy must contain at least one rule")
        return cls(rules)

    def classify_tool(
        self,
        server: str | None,
        tool: str,
        arguments: dict[str, Any] | None = None,
    ) -> RiskDecision:
        server_name = server or ""
        args = arguments or {}
        for rule in self.rules:
            if not fnmatchcase(server_name, rule.server):
                continue
            if not fnmatchcase(tool, rule.tool):
                continue
            if rule.arguments and not _match_arguments(args, rule.arguments):
                continue
            return RiskDecision(rule.action, rule.risk, rule.reason)
        return RiskDecision("allow", "low", "No policy rule matched.")


def _match_arguments(actual: dict[str, Any], matchers: dict[str, str]) -> bool:
    """Return True only if every matcher key is present and its value matches."""
    for key, pattern in matchers.items():
        value = actual.get(key)
        if value is None:
            return False
        if not fnmatchcase(str(value), pattern):
            return False
    return True


def default_rules() -> list[PolicyRule]:
    return [
        PolicyRule(
            tool="*delete*",
            action="block",
            risk="high",
            reason="Tool name indicates destructive deletion.",
        ),
        PolicyRule(
            tool="*remove*",
            action="block",
            risk="high",
            reason="Tool name indicates destructive removal.",
        ),
        PolicyRule(
            tool="*write*",
            action="require_approval",
            risk="medium",
            reason="Tool may modify external state.",
        ),
        PolicyRule(
            tool="*send*",
            action="require_approval",
            risk="medium",
            reason="Tool may send data outside the local run.",
        ),
        PolicyRule(
            tool="*create*",
            action="require_approval",
            risk="medium",
            reason="Tool may create external state.",
        ),
        PolicyRule(
            tool="*",
            action="allow",
            risk="low",
            reason="Tool appears read-only.",
        ),
    ]
