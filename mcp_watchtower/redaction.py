"""Event payload redaction — strip secrets before SQLite persistence."""

from __future__ import annotations

import re
from typing import Any

_SENTINEL = "[REDACTED]"


def redact(
    value: Any,
    fields: frozenset[str],
    pattern: re.Pattern[str] | None,
) -> Any:
    """Recursively redact matching keys in dicts and list elements."""
    if isinstance(value, dict):
        return {
            k: _SENTINEL if _should_redact(k, fields, pattern) else redact(v, fields, pattern)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [redact(item, fields, pattern) for item in value]
    return value


def _should_redact(key: str, fields: frozenset[str], pattern: re.Pattern[str] | None) -> bool:
    if key in fields:
        return True
    if pattern is not None and pattern.search(key):
        return True
    return False


def build_redactor(
    redact_fields: list[str] | None = None,
    redact_pattern: str | None = None,
) -> "Redactor | None":
    if not redact_fields and not redact_pattern:
        return None
    return Redactor(
        fields=frozenset(redact_fields or []),
        pattern=re.compile(redact_pattern) if redact_pattern else None,
    )


class Redactor:
    def __init__(self, fields: frozenset[str], pattern: re.Pattern[str] | None) -> None:
        self.fields = fields
        self.pattern = pattern

    def scrub(self, event: dict[str, Any]) -> dict[str, Any]:
        """Return a copy of the event with sensitive values replaced."""
        return redact(event, self.fields, self.pattern)  # type: ignore[return-value]
