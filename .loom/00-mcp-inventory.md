# MCP Inventory

## 2026-02-18 Refresh (Docs Integration Task)

### Commands/Calls Run

- `functions.list_mcp_resources`
- `functions.list_mcp_resource_templates`
- `functions.read_mcp_resource` on:
  - `loom://servers`
  - `loom://health`
  - `loom://config`

### Snapshot Summary

- Active Loom profile: `full`
- Server count: `41`
- Tool count: `379`
- Health status: all listed servers reported healthy in `loom://health`

### Resources Available from `loom` Server

- `loom://servers` - server catalog and status
- `loom://tools` - aggregated tool inventory
- `loom://tools/index` - paginated tool index
- `loom://health` - per-server health
- `loom://config` - active profile/config summary

## Why

Capture the available MCP servers/resources/templates so planning and implementation can use the right tools without guesswork.

## Checklist

- [x] List MCP servers
- [x] List resource templates per server
- [x] List resources per server (if available)
- [x] Record auth/permission constraints
- [x] Record "best tool for job" notes

## Servers (via loom proxy)

All tools namespaced as `server__toolname` through the loom MCP proxy.

### Relevant to MentatLab

| Server | Category | Status | Key Tools |
|--------|----------|--------|-----------|
| `k8s_apps_k3s` | kubernetes | running | k8s_apply, k8s_getPods, k8s_logs, k8s_get, k8s_describe, k8s_exec |
| `flux` | gitops | running | flux_get_sources, flux_get_kustomizations, flux_reconcile, flux_logs |
| `gitlab` | scm | running | list_issues, get_pr, list_commits, search_code, get_file_contents |
| `redis` | cache/db | running | redis_info, redis_keys, redis_get, redis_ttl, redis_dbsize |
| `minio` | storage | running | minio_list_buckets, minio_list_objects, minio_get_object_text |
| `prometheus` | monitoring | running | query, query_range, list_metrics, list_targets |
| `loki` | logging | running | loki_query, loki_query_range, loki_labels |
| `grafana` | dashboards | running | grafana_search, grafana_get_dashboard, grafana_list_datasources |
| `alertmanager` | alerting | running | am_list_alerts, am_list_silences, am_status |
| `docker` | containers | running | docker_ps, docker_images, docker_logs, docker_exec |
| `helm` | deployment | running | helm_list, helm_status, helm_values |
| `git` | scm | running | git_status, git_diff, git_log, git_branch, git_commit, git_push |
| `devbox` | sandbox | running | devbox_exec, devbox_build, devbox_status |

### General Purpose

| Server | Category | Status | Key Tools |
|--------|----------|--------|-----------|
| `tavily` | search | running | tavily_search, tavily_extract |
| `agent_context` | memory | running | agent_session_start, agent_context_recall_enhanced, agent_memory_add |
| `memory` | knowledge | running | create_entities, search_nodes, read_graph |
| `codebase_memory` | code search | running | codebase_search, codebase_get_definition, codebase_find_callers |
| `sequentialthinking` | reasoning | running | start_thinking, add_thought, complete_chain |
| `jira` | tracking | running | jira_search, jira_get_issue, jira_add_comment |
| `neo4j` | graph db | running | neo4j_query, neo4j_schema, neo4j_labels |
| `browserkit` | screenshots | running | screenshot |

### Not Running

| Server | Category | Notes |
|--------|----------|-------|
| `postgres` | database | Not running — no PostgreSQL in MentatLab stack |
| `confluence` | docs | Not running |
| `context7` | docs | Not running |

## Resources

Loom proxy exposes 4 meta-resources:
- `loom://servers` — list of managed MCP servers with status
- `loom://tools` — cached aggregated tool list
- `loom://health` — health summary for all servers
- `loom://config` — active profile and daemon config

## Tool Selection Guide (MentatLab)

| Task | Best Tool |
|------|-----------|
| Check pod status | `k8s_apps_k3s__k8s_getPods` (namespace=mentatlab) |
| View service logs | `k8s_apps_k3s__k8s_logs` or `loki__loki_query` |
| Check Flux sync | `flux__flux_get_kustomizations` |
| Reconcile after Git push | `flux__flux_reconcile` |
| Query Redis state | `redis__redis_keys`, `redis__redis_get` |
| Check MinIO artifacts | `minio__minio_list_objects` |
| View metrics | `prometheus__query` with PromQL |
| Check Grafana dashboards | `grafana__grafana_search` |
| Run Go tests in sandbox | `devbox__devbox_exec` (project="mentatlab") |
| Search codebase | `codebase_memory__codebase_search` |
| GitLab issues/MRs | `gitlab__list_issues`, `gitlab__list_prs` |

## Notes

- All loom tools require JSON for array/object parameters
- K8s tools target the k3s apps cluster (not Harvester infra)
- Redis tools are read-only inspection — no SET/DEL operations
- Devbox should be used for builds/tests per workspace conventions
