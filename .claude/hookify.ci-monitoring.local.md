---
name: remind-ci-monitoring
enabled: true
event: bash
pattern: git\s+push
action: warn
---

## CI Pipeline Reminder

You just pushed to the remote repository.

**Monitor the CI pipeline:**
```bash
glab ci status --live    # Watch pipeline progress
glab ci list             # List recent pipelines
glab ci view             # View current pipeline
glab ci trigger deploy   # Trigger manual deploy job
```

**If pipeline fails:**
1. Check logs: `glab ci trace <job-name>`
2. Fix the issue locally
3. Commit and push the fix

**Don't forget:** The deploy job is **manual** - trigger it when ready!
