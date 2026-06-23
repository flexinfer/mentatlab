# MentatLab Docs

MentatLab is an AI agent orchestration platform with a Mission Control UI for building, running, and monitoring DAG-based workflows.

## Who This Is For

- Platform engineers running private agent workflows
- Application teams authoring flows and integrating agents
- Operators managing runtime, observability, and deployment health

## Documentation Map

- [Getting Started](getting-started.md)
- [Architecture](architecture.md)
- [API Reference](api-reference.md)
- [Deployment](deployment.md)

## Source Repositories

- Service code: `services/mentatlab`
- Public docs host: `services/flexinfer-site`

## Runtime Topology

```text
Browser -> Gateway (:8080) -> Orchestrator (:7070) -> Agents
                 \            \-> Redis (:6379)
```

For end-to-end local setup, start with [Getting Started](getting-started.md).
