# MCP Inventory

- Generated: 2026-03-07T09:37:00-05:00
- Mode: CLI Fallback (loom API unreachable)
- Total Servers: 45
- Total Tools: 472 (approx)

## Current Status

- `loom://config` read failed with `EOF`.
- `codebase_memory__codebase_stats` failed with `EOF`.
- Successfully fetched tools via `loom tools list --json` CLI fallback.

## Integration Plan

We will expose an orchestrator endpoint (`/api/v1/mcp/tools`) backed by the loom proxy/client CLI or direct HTTP so that the Node Palette can load tool inventory.
