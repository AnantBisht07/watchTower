"""Adapters for third-party MCP client implementations."""

from .mcp_sdk import wrap_mcp_session

__all__ = ["wrap_mcp_session"]
