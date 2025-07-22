import sys, pathlib; sys.path.append(str(pathlib.Path(__file__).resolve().parents[3]))
import json
from fastapi.testclient import TestClient
from services.gateway.app.main import app

client = TestClient(app)


def test_healthz():
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_flow():
    resp = client.get("/flows/hello_chat")
    assert resp.status_code == 200
    data = resp.json()
    assert data["kind"] == "Flow"
