import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from database import Base, get_db


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db_path = tmp_path / "test_app_data.db"
    db_url = f"sqlite:///{db_path}"
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app = main.app
    app.dependency_overrides[get_db] = override_get_db

    class DummyResponse:
        def __init__(self, content: str):
            self.content = content

    class DummyAgent:
        def run(self, _message: str):
            return DummyResponse("Mock copilot response")

    monkeypatch.setattr(main, "get_copilot_agent", lambda *args, **kwargs: DummyAgent())
    monkeypatch.setattr(main, "_transcribe_audio", lambda *_args, **_kwargs: {"ok": True, "text": "mock transcript", "error": None})
    monkeypatch.setattr(main, "_build_chat_history_for_session", lambda _session_id: "**User**: test\n\n**Copilot**: test")
    monkeypatch.setattr(main, "run_summarizer", lambda **_kwargs: "# Generated plan\n\n- [ ] Do work")

    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_meeting_lifecycle_and_context_crud(client: TestClient):
    create = client.post("/api/meeting/create", json={"title": "Lifecycle Test"})
    assert create.status_code == 200
    session_id = create.json()["session_id"]

    start = client.post(f"/api/meeting/{session_id}/start")
    assert start.status_code == 200

    add_note = client.post(
        f"/api/meeting/{session_id}/context/text",
        json={"name": "Agenda", "text": "Discuss roadmap"},
    )
    assert add_note.status_code == 200
    assert len(add_note.json()["items"]) == 1

    context = client.get(f"/api/meeting/{session_id}/context")
    assert context.status_code == 200
    assert context.json()["items"][0]["name"] == "Agenda"

    delete_note = client.delete(f"/api/meeting/{session_id}/context/0")
    assert delete_note.status_code == 200
    assert delete_note.json()["items"] == []

    chat = client.post("/api/chat/text", json={"session_id": session_id, "message": "hello"})
    assert chat.status_code == 200
    assert chat.json()["response"] == "Mock copilot response"

    summarize = client.post(f"/api/meeting/summarize?session_id={session_id}")
    assert summarize.status_code == 200
    assert "Generated plan" in summarize.json()["summary_markdown"]

    versions = client.get(f"/api/meetings/{session_id}/summaries")
    assert versions.status_code == 200
    assert len(versions.json()["versions"]) == 1

    reactivate = client.post(f"/api/meetings/{session_id}/reactivate")
    assert reactivate.status_code == 200
    assert reactivate.json()["ok"] is True

    meeting_detail = client.get(f"/api/meetings/{session_id}")
    assert meeting_detail.status_code == 200
    assert meeting_detail.json()["is_active"] is True
    assert meeting_detail.json()["summary_markdown"] is None


def test_summary_version_regeneration_and_activation(client: TestClient, monkeypatch):
    summaries = iter([
        "# Plan V1\n\n- [ ] first",
        "# Plan V2\n\n- [ ] second",
    ])

    monkeypatch.setattr(main, "run_summarizer", lambda **_kwargs: next(summaries))

    create = client.post("/api/meeting/create", json={"title": "Versioning"})
    session_id = create.json()["session_id"]
    client.post(f"/api/meeting/{session_id}/start")

    first = client.post(f"/api/meeting/summarize?session_id={session_id}")
    assert first.status_code == 200
    assert "Plan V1" in first.json()["summary_markdown"]

    regenerate = client.post(
        f"/api/meeting/{session_id}/summaries/regenerate",
        json={"instruction": "Make it shorter"},
    )
    assert regenerate.status_code == 200
    assert "Plan V2" in regenerate.json()["summary_markdown"]

    versions_resp = client.get(f"/api/meetings/{session_id}/summaries")
    assert versions_resp.status_code == 200
    versions = versions_resp.json()["versions"]
    assert [v["version"] for v in versions] == [2, 1]
    assert versions[0]["instruction"] == "Make it shorter"

    activate = client.post(f"/api/meetings/{session_id}/summaries/1/activate")
    assert activate.status_code == 200
    assert activate.json()["ok"] is True

    meeting_detail = client.get(f"/api/meetings/{session_id}")
    assert meeting_detail.status_code == 200
    assert "Plan V1" in meeting_detail.json()["summary_markdown"]


def test_extract_chat_history_handles_double_encoded_and_malformed_runs():
    runs = [
        {"input": {"input_content": "User asks"}, "content": "Assistant answers"},
        "{\"input\": {\"input_content\": \"Second\"}, \"content\": \"Reply\"}",
        {"invalid": True},
    ]

    raw = json.dumps(json.dumps(runs))
    history = main._extract_chat_history_from_runs(raw)

    assert "**User**: User asks" in history
    assert "**Copilot**: Assistant answers" in history
    assert "**User**: Second" in history
    assert "**Copilot**: Reply" in history
