# Developer Testing Quick Reference Guide

## Quick Commands for Local Testing

### 🚀 Test Everything
```bash
# From project root - run all tests
pytest -v

# Or with PDM (if installed globally)
pdm run pytest -v
```

### 🔧 Test Individual Services

#### Gateway Service
```bash
cd services/gateway
pdm install --dev
pdm run pytest tests/ -v
```

#### Orchestrator Service
```bash
cd services/orchestrator
pdm install --dev
pdm run pytest app/tests/ -v
```

#### Frontend
```bash
cd services/frontend
npm install
npm test
npm run build
```

#### Echo Agent
```bash
cd services/agents/echo
pip install pytest
pytest src/ -v
```

## 🐛 Common Issues & Fixes

### Import Errors
**Problem**: `ModuleNotFoundError: No module named 'app.models'`
**Fix**: Run tests from service directory with PDM
```bash
cd services/gateway
pdm run pytest  # NOT just 'pytest'
```

### Missing Dependencies
**Problem**: `ModuleNotFoundError: No module named 'boto3'`
**Fix**: Install service dependencies
```bash
cd services/orchestrator
pdm install --dev
```

### Path Issues
**Problem**: Can't find modules when running tests
**Fix**: The orchestrator has special path configuration
```bash
# From services/orchestrator/
pdm run pytest  # This uses pytest.ini which sets pythonpath
```

## 📋 Pre-Push Checklist

1. **Run Service Tests**
   ```bash
   # Gateway
   cd services/gateway && pdm run pytest
   
   # Orchestrator  
   cd services/orchestrator && pdm run pytest
   
   # Frontend
   cd services/frontend && npm test
   ```

2. **Check Imports**
   - Use absolute imports: `from services.gateway.app.models import Flow`
   - NOT relative: `from app.models import Flow`

3. **Update Dependencies**
   ```bash
   # If you added new packages
   cd services/[service-name]
   pdm add [package-name]
   git add pdm.lock pyproject.toml
   ```

## 🔄 CI/CD Pipeline

### What Happens When You Push?
1. **Parallel Testing**: Each service tested independently
2. **Dependency Caching**: Fast builds if dependencies unchanged
3. **Security Scanning**: Checks for vulnerabilities
4. **Docker Validation**: Ensures images build correctly

### View CI Status
- Go to GitHub → Actions tab
- Click on your commit
- Each service has its own job

### If CI Fails
1. Click on the failed job
2. Expand the failed step
3. Common fixes:
   - Missing dependency → Add to `pyproject.toml`
   - Import error → Check absolute imports
   - Test failure → Run locally to debug

## 🛠️ Development Setup

### First Time Setup
```bash
# Install PDM globally
pip install pdm

# Clone and setup
git clone [repo]
cd mentatlab
./setup.sh  # If available
```

### After Pulling Changes
```bash
# Update each service you're working on
cd services/gateway
pdm install

cd ../orchestrator
pdm install

cd ../frontend
npm install
```

## 📚 Key Files

| File | Purpose |
|------|---------|
| `services/*/pyproject.toml` | Service dependencies |
| `services/*/pdm.lock` | Locked dependency versions |
| `pytest.ini` | Test configuration |
| `.github/workflows/ci.yml` | CI pipeline definition |

## 💡 Pro Tips

1. **Speed Up Tests**
   ```bash
   # Run only specific test file
   pdm run pytest tests/test_routes.py
   
   # Run tests matching pattern
   pdm run pytest -k "test_flow"
   ```

2. **Debug Failing Tests**
   ```bash
   # Show print statements
   pdm run pytest -s
   
   # Stop on first failure
   pdm run pytest -x
   
   # Verbose output
   pdm run pytest -vv
   ```

3. **Check Coverage**
   ```bash
   pdm run pytest --cov=app
   ```

## 🆘 Getting Help

- **Import Issues**: Check `pytest.ini` for pythonpath settings
- **Dependency Issues**: Ensure you're in the right service directory
- **CI Issues**: Check `.github/workflows/ci.yml` for the exact commands
- **Still Stuck?**: Check the full guides:
  - [`docs/ci-cd-setup.md`](./ci-cd-setup.md)
  - [`docs/github-actions-assessment.md`](./github-actions-assessment.md)

---

Remember: **Always test locally before pushing!** The CI will catch issues, but local testing is faster for debugging.