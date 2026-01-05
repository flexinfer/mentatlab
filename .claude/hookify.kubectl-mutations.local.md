---
name: warn-kubectl-mutations
enabled: true
event: bash
pattern: kubectl\s+(apply|delete|patch|scale|edit|replace|create|set|rollout\s+undo|annotate|label)
action: warn
---

## GitOps Workflow Reminder

You're about to run a **kubectl command that modifies cluster state** directly.

**This project uses GitOps** - changes should flow through Git:

1. **Edit the manifests** in `k8s/` directory
2. **Commit and push** to trigger CI/CD
3. **Trigger deploy job** via `glab ci trigger deploy`

**Why GitOps?**
- Changes are tracked in version control
- Flux reconciles desired state automatically
- Rollback is just a `git revert`
- Audit trail for all changes

**If this is intentional** (debugging, emergency fix):
- Document why in a commit message after
- Consider if the fix should be permanent in manifests
