# Project Roadmap

> Last Updated: January 2026

## Current Status

MentatLab is a robust research platform for AI agents with a comprehensive mission control UI and K8s integration. Recent work has focused on performance and production readiness.

### Completed Enhancements (v1.0)
- ✅ **Performance**: Console panel virtualization (100K+ events), Web Worker SSE parsing
- ✅ **UX**: Keyboard shortcuts system (`?`), Undo/Redo history, Canvas operations
- ✅ **Scheduling**: Enhanced K8s integration (Pod logs, Job watching, CronJobs, Retries)
- ✅ **Observability**: Lineage overlay, Network health visualization, Metrics dashboard
- ✅ **Governance**: Policy guardrails overlay (Budget, PII, Safety)
- ✅ **Persistence**: Redis RunStore with connection pooling and TTL cleanup

## Roadmap

### Phase 1: Developer Experience (Immediate)
- [ ] **Enhanced mentatctl CLI**: Improved local dev workflow
- [ ] **Agent Hot Reload**: Faster iteration cycles
- [ ] **Manifest Validator UI**: Visual validation of agent configs

### Phase 2: Observability (Short Term)
- [ ] **OpenTelemetry Integration**: Complete tracing support
- [ ] **Advanced Metrics**: Custom dashboards and alerting
- [ ] **Tracing UI**: Visual trace exploration

### Phase 3: Marketplace & Community (v1.1 - Q2 2026)
- [ ] **Agent Marketplace**: Web-based discovery platform with search & ratings
- [ ] **Publisher Profiles**: Reputation system and verification
- [ ] **Review System**: Community reviews and moderation
- [ ] **Security Scanning**: Automated vulnerability analysis for published agents
- [ ] **WASM Runtime**: Secure, sandboxed execution for marketplace agents

## References

| Document | Purpose |
|----------|---------|
| [README.md](README.md) | Project overview |
| [AGENTS.md](AGENTS.md) | Agent guidance |
| [ENHANCEMENTS_SUMMARY.md](ENHANCEMENTS_SUMMARY.md) | Detailed status of recent features |
| [docs/v1.1_milestone_spec.md](docs/v1.1_milestone_spec.md) | Detailed spec for v1.1 Marketplace |