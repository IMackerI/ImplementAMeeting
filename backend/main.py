import os
import io
import uuid
import json
import tempfile
from typing import Optional, TypedDict
from pydantic import BaseModel
from fastapi import FastAPI, UploadFile, File, Form, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from sqlalchemy.orm import Session
from openai import OpenAI
from dotenv import load_dotenv
from datetime import datetime, timedelta

# Search for .env from backend up to root
load_dotenv(".env")
if not os.environ.get("OPENAI_API_KEY") and not os.environ.get("OPEN_AI_SECRET_KEY"):
    load_dotenv("../.env")


from database import Meeting, SummaryVersion, get_db
from agents.copilot import AGENTS_DB_PATH, get_copilot_agent
from agents.summarizer import run_summarizer

app = FastAPI(title="Meeting Co-Pilot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

openai_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("OPEN_AI_SECRET_KEY")
openai_client = OpenAI(api_key=openai_key)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class MeetingCreateRequest(BaseModel):
    title: Optional[str] = None
    copilot_model_id: Optional[str] = None
    summarizer_model_id: Optional[str] = None

class MeetingCreateResponse(BaseModel):
    session_id: str

class MeetingUpdateRequest(BaseModel):
    title: Optional[str] = None
    copilot_model_id: Optional[str] = None
    summarizer_model_id: Optional[str] = None

class ChatTextRequest(BaseModel):
    session_id: str
    message: str

class ChatResponse(BaseModel):
    response: str
    transcription_ok: Optional[bool] = None
    transcription_error: Optional[str] = None

class SummarizeResponse(BaseModel):
    summary_markdown: str


class RegenerateSummaryRequest(BaseModel):
    instruction: Optional[str] = None

class ContextTextRequest(BaseModel):
    text: str
    name: Optional[str] = "Text note"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_context_text(meeting: Meeting) -> str:
    """Extract all context items as a single text block."""
    try:
        items = json.loads(meeting.context_items or "[]")
    except (json.JSONDecodeError, TypeError):
        items = []
    if not items:
        return ""
    parts = []
    for item in items:
        label = item.get("name", "Note")
        content = item.get("content", "")
        parts.append(f"[{label}]\n{content}")
    return "\n\n".join(parts)


def _extract_text_from_file(content: bytes, filename: str) -> str:
    """Extract plain text from uploaded file bytes."""
    name_lower = filename.lower()

    if name_lower.endswith((".txt", ".md", ".csv", ".json", ".log", ".py", ".js",
                            ".ts", ".html", ".css", ".yaml", ".yml", ".toml",
                            ".xml", ".ini", ".cfg", ".sh", ".bat")):
        return content.decode("utf-8", errors="replace")

    if name_lower.endswith(".pdf"):
        try:
            import pdfplumber
            pdf = pdfplumber.open(io.BytesIO(content))
            text_parts = [p.extract_text() for p in pdf.pages if p.extract_text()]
            pdf.close()
            return "\n\n".join(text_parts) if text_parts else "(PDF contained no extractable text)"
        except ImportError:
            return "(PDF support requires pdfplumber — install with: uv add pdfplumber)"
        except Exception as e:
            return f"(Failed to extract PDF: {e})"

    if name_lower.endswith(".docx"):
        try:
            from docx import Document
            doc = Document(io.BytesIO(content))
            return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
        except ImportError:
            return "(DOCX support requires python-docx — install with: uv add python-docx)"
        except Exception as e:
            return f"(Failed to extract DOCX: {e})"

    return content.decode("utf-8", errors="replace")


_AUDIO_SUFFIX_BY_MIME = {
    "audio/webm": ".webm",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/mp4": ".mp4",
    "audio/ogg": ".ogg",
}
_ALLOWED_AUDIO_SUFFIXES = {".webm", ".wav", ".mp3", ".m4a", ".mp4", ".ogg"}


class TranscriptionResult(TypedDict):
    ok: bool
    text: str
    error: Optional[str]


def _resolve_audio_suffix(
    filename: Optional[str],
    mime_type: Optional[str] = None,
    file_ext: Optional[str] = None,
) -> str:
    if file_ext:
        normalized = file_ext.strip().lower()
        if normalized and not normalized.startswith("."):
            normalized = f".{normalized}"
        if normalized in _ALLOWED_AUDIO_SUFFIXES:
            return normalized

    if mime_type:
        normalized_mime = mime_type.strip().lower().split(";")[0]
        mapped = _AUDIO_SUFFIX_BY_MIME.get(normalized_mime)
        if mapped:
            return mapped

    if filename:
        suffix = os.path.splitext(filename)[1].lower()
        if suffix in _ALLOWED_AUDIO_SUFFIXES:
            return suffix

    return ".webm"


def _validate_audio_mime(mime_type: Optional[str]) -> Optional[str]:
    if not mime_type:
        return None
    normalized = mime_type.strip().lower()
    if not normalized.startswith("audio/"):
        return "Uploaded file must be an audio content type."
    return None


def _transcribe_audio(file_bytes: bytes, suffix: str = ".webm") -> TranscriptionResult:
    """Write bytes to a temp file, transcribe with Whisper, and return structured result."""
    if len(file_bytes) < 512:
        return {"ok": False, "text": "", "error": "Audio chunk too short to transcribe."}

    if suffix not in _ALLOWED_AUDIO_SUFFIXES:
        suffix = ".webm"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    filename = f"audio{suffix}"
    try:
        with open(tmp_path, "rb") as audio_file:
            transcription = openai_client.audio.transcriptions.create(
                model="whisper-1",
                file=(filename, audio_file),
            )
        text = (transcription.text or "").strip()
        if not text:
            return {"ok": False, "text": "", "error": "Transcription returned empty text."}
        return {"ok": True, "text": text, "error": None}
    except Exception as e:
        print(f"Transcription error ({suffix}): {e}")
        return {"ok": False, "text": "", "error": str(e)}
    finally:
        os.unlink(tmp_path)


def _safe_json_loads(value):
    try:
        return json.loads(value)
    except Exception:
        return value


def _normalize_runs_payload(raw_runs) -> list[dict]:
    payload = raw_runs

    # Some rows store JSON list directly, some store a double-encoded JSON string.
    for _ in range(2):
        if isinstance(payload, str):
            payload = _safe_json_loads(payload)
        else:
            break

    if isinstance(payload, dict):
        payload = payload.get("runs", [])

    if not isinstance(payload, list):
        return []

    normalized: list[dict] = []
    for item in payload:
        candidate = item
        if isinstance(candidate, str):
            candidate = _safe_json_loads(candidate)
        if isinstance(candidate, dict):
            normalized.append(candidate)

    return normalized


def _extract_user_text_from_run(run: dict) -> str:
    user_input = run.get("input")
    if isinstance(user_input, dict):
        for key in ("input_content", "message", "query", "prompt", "text"):
            value = user_input.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    elif isinstance(user_input, str) and user_input.strip():
        return user_input.strip()

    for key in ("user_message", "query", "prompt", "message"):
        value = run.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    return ""


def _extract_chat_history_from_runs(raw_runs, max_runs: int = 60) -> str:
    runs = _normalize_runs_payload(raw_runs)
    if not runs:
        return ""

    sliced_runs = runs[-max_runs:]
    lines: list[str] = []

    for run in sliced_runs:
        user_text = _extract_user_text_from_run(run)
        assistant_text = run.get("content", "")

        if isinstance(user_text, str) and user_text.strip():
            lines.append(f"**User**: {user_text.strip()}")

        if isinstance(assistant_text, str) and assistant_text.strip():
            lines.append(f"**Copilot**: {assistant_text.strip()}")

    return "\n\n".join(lines)


def _build_chat_history_for_session(session_id: str) -> str:
    try:
        import sqlite3 as _sqlite3

        with _sqlite3.connect(AGENTS_DB_PATH) as _conn:
            _cur = _conn.cursor()
            _cur.execute("SELECT runs FROM copilot_sessions WHERE session_id = ?", (session_id,))
            _row = _cur.fetchone()

        raw_runs = _row[0] if _row and _row[0] else None
        return _extract_chat_history_from_runs(raw_runs)
    except Exception as e:
        print(f"Could not fetch copilot history: {e}")
        return ""


def _save_summary_version(
    db: Session,
    meeting: Meeting,
    summary_markdown: str,
    instruction: Optional[str] = None,
) -> SummaryVersion:
    max_version = (
        db.query(func.max(SummaryVersion.version_number))
        .filter(SummaryVersion.meeting_id == meeting.id)
        .scalar()
    )
    next_version = int(max_version or 0) + 1

    version = SummaryVersion(
        meeting_id=meeting.id,
        version_number=next_version,
        content=summary_markdown,
        instruction=instruction.strip() if instruction and instruction.strip() else None,
    )

    db.add(version)
    meeting.summary_markdown = summary_markdown
    db.commit()
    db.refresh(version)
    return version


# ---------------------------------------------------------------------------
# Meeting lifecycle
# ---------------------------------------------------------------------------

@app.post("/api/meeting/create", response_model=MeetingCreateResponse)
def create_meeting(req: MeetingCreateRequest, db: Session = Depends(get_db)):
    """Create a new meeting in 'setup' state (not yet active)."""
    session_id = str(uuid.uuid4())
    title = (req.title or "").strip() or f"Meeting {session_id[:8]}"
    new_meeting = Meeting(
        id=session_id,
        title=title,
        is_active=False,
        context_items="[]",
        copilot_model_id=req.copilot_model_id,
        summarizer_model_id=req.summarizer_model_id,
    )
    db.add(new_meeting)
    db.commit()
    return {"session_id": session_id}


@app.post("/api/meeting/{session_id}/start", response_model=MeetingCreateResponse)
def start_meeting(session_id: str, db: Session = Depends(get_db)):
    """Activate a meeting that was previously created (start recording)."""
    meeting = db.query(Meeting).filter(Meeting.id == session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    meeting.is_active = True
    db.commit()
    return {"session_id": session_id}


@app.patch("/api/meetings/{session_id}")
def update_meeting(session_id: str, req: MeetingUpdateRequest, db: Session = Depends(get_db)):
    """Update meeting metadata (title, model selections)."""
    meeting = db.query(Meeting).filter(Meeting.id == session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if req.title is not None:
        meeting.title = req.title.strip() or meeting.title
    if req.copilot_model_id is not None:
        meeting.copilot_model_id = req.copilot_model_id
    if req.summarizer_model_id is not None:
        meeting.summarizer_model_id = req.summarizer_model_id
    db.commit()
    return {"ok": True}


@app.delete("/api/meetings/{session_id}")
def delete_meeting(session_id: str, db: Session = Depends(get_db)):
    """Permanently remove a meeting."""
    meeting = db.query(Meeting).filter(Meeting.id == session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    db.delete(meeting)
    db.commit()
    return {"ok": True}


@app.post("/api/meeting/cleanup-stale-drafts")
def cleanup_stale_drafts(
    max_age_minutes: int = Query(120, ge=1, le=60 * 24 * 30),
    db: Session = Depends(get_db),
):
    """Delete old inactive empty meetings created by abandoned setup flows."""
    cutoff = datetime.utcnow() - timedelta(minutes=max_age_minutes)
    drafts = (
        db.query(Meeting)
        .filter(Meeting.is_active == False)
        .filter(Meeting.created_at < cutoff)
        .all()
    )

    deleted = 0
    for draft in drafts:
        transcript = (draft.transcript or "").strip()
        summary = (draft.summary_markdown or "").strip()

        try:
            context_items = json.loads(draft.context_items or "[]")
            has_context = bool(context_items)
        except Exception:
            has_context = bool((draft.context_items or "").strip())

        if transcript or summary or has_context:
            continue

        db.delete(draft)
        deleted += 1

    if deleted:
        db.commit()

    return {"deleted": deleted, "max_age_minutes": max_age_minutes}


@app.post("/api/meetings/{session_id}/reactivate")
def reactivate_meeting(session_id: str, db: Session = Depends(get_db)):
    """Re-open a finished meeting. Appends the existing summary to the transcript as context."""
    meeting = db.query(Meeting).filter(Meeting.id == session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # Append summary to transcript so the copilot retains full context
    if meeting.summary_markdown:
        ts = datetime.now().strftime("%H:%M:%S")
        separator = (
            f"\n\n---\n\n**[{ts}] ⟳ Meeting Resumed — Previous Summary:**\n\n"
            f"{meeting.summary_markdown}\n\n---\n\n"
        )
        meeting.transcript += separator
        meeting.summary_markdown = None  # clear so UI doesn't jump to old summary

    meeting.is_active = True
    db.commit()
    return {"ok": True, "transcript": meeting.transcript}


# ---------------------------------------------------------------------------
# Context management
# ---------------------------------------------------------------------------

@app.post("/api/meeting/{session_id}/context/text")
def add_context_text(session_id: str, req: ContextTextRequest, db: Session = Depends(get_db)):
    """Add a text note to the meeting context."""
    meeting = db.query(Meeting).filter(Meeting.id == session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    items = json.loads(meeting.context_items or "[]")
    items.append({"type": "text", "name": req.name or "Text note", "content": req.text})
    meeting.context_items = json.dumps(items)
    db.commit()
    return {"items": items}


@app.post("/api/meeting/{session_id}/context/file")
def add_context_file(
    session_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Upload a file, extract its text, and add to meeting context."""
    meeting = db.query(Meeting).filter(Meeting.id == session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    content = file.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file received.")
    extracted = _extract_text_from_file(content, file.filename or "uploaded_file.txt")
    items = json.loads(meeting.context_items or "[]")
    items.append({"type": "file", "name": file.filename or "uploaded_file", "content": extracted})
    meeting.context_items = json.dumps(items)
    db.commit()
    return {"items": items}


@app.delete("/api/meeting/{session_id}/context/{index}")
def delete_context_item(session_id: str, index: int, db: Session = Depends(get_db)):
    """Remove a context item by index."""
    meeting = db.query(Meeting).filter(Meeting.id == session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    items = json.loads(meeting.context_items or "[]")
    if 0 <= index < len(items):
        items.pop(index)
    meeting.context_items = json.dumps(items)
    db.commit()
    return {"items": items}


@app.get("/api/meeting/{session_id}/context")
def get_context(session_id: str, db: Session = Depends(get_db)):
    """Get all context items for a meeting."""
    meeting = db.query(Meeting).filter(Meeting.id == session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    items = json.loads(meeting.context_items or "[]")
    return {"items": items}


# ---------------------------------------------------------------------------
# Models config
# ---------------------------------------------------------------------------

@app.get("/api/models")
def get_models():
    """Return available model configurations from models_config.json."""
    config_path = os.path.join(os.path.dirname(__file__), "models_config.json")
    try:
        with open(config_path) as f:
            return json.load(f)
    except Exception as e:
        return {"copilot_models": [], "summarizer_models": [], "error": str(e)}


# ---------------------------------------------------------------------------
# Chat endpoints
# ---------------------------------------------------------------------------

@app.post("/api/chat/text", response_model=ChatResponse)
def chat_text(req: ChatTextRequest, db: Session = Depends(get_db)):
    meeting = db.query(Meeting).filter(Meeting.id == req.session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    ts = datetime.now().strftime("%H:%M:%S")
    meeting.transcript += f"\n\n**[{ts}] User Query:** {req.message}\n"

    context_text = _get_context_text(meeting)
    agent = get_copilot_agent(
        req.session_id,
        transcript=meeting.transcript,
        context_text=context_text,
        model_id=meeting.copilot_model_id
    )
    response = agent.run(req.message)
    content = response.content if hasattr(response, 'content') else str(response)

    meeting.transcript += f"\n**Copilot Response:**\n\n{content}\n\n---"
    db.commit()

    return {"response": content}


@app.post("/api/chat/audio", response_model=ChatResponse)
def chat_audio(
    session_id: str = Form(...),
    file: UploadFile = File(...),
    mime_type: Optional[str] = Form(None),
    file_ext: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    meeting = db.query(Meeting).filter(Meeting.id == session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    mime_error = _validate_audio_mime(mime_type) or _validate_audio_mime(file.content_type)
    if mime_error:
        raise HTTPException(status_code=400, detail=mime_error)

    suffix = _resolve_audio_suffix(file.filename, mime_type=mime_type or file.content_type, file_ext=file_ext)
    result = _transcribe_audio(file.file.read(), suffix=suffix)
    if not result["ok"]:
        return {
            "response": "",
            "transcription_ok": False,
            "transcription_error": result["error"],
        }

    text = result["text"]
    ts = datetime.now().strftime("%H:%M:%S")
    meeting.transcript += f"\n\n**[{ts}] User Query:** {text}\n"

    context_text = _get_context_text(meeting)
    agent = get_copilot_agent(
        session_id,
        transcript=meeting.transcript,
        context_text=context_text,
        model_id=meeting.copilot_model_id,
    )
    response = agent.run(text)
    content = response.content if hasattr(response, "content") else str(response)

    meeting.transcript += f"\n**Copilot Response:**\n\n{content}\n\n---"
    db.commit()

    return {"response": content, "transcription_ok": True, "transcription_error": None}


@app.post("/api/meeting/transcript", response_model=ChatResponse)
def meeting_transcript(
    session_id: str = Form(...),
    file: UploadFile = File(...),
    mime_type: Optional[str] = Form(None),
    file_ext: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    meeting = db.query(Meeting).filter(Meeting.id == session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if not meeting.is_active:
        return {"response": "", "transcription_ok": False, "transcription_error": "Meeting is not active."}

    mime_error = _validate_audio_mime(mime_type) or _validate_audio_mime(file.content_type)
    if mime_error:
        raise HTTPException(status_code=400, detail=mime_error)

    suffix = _resolve_audio_suffix(file.filename, mime_type=mime_type or file.content_type, file_ext=file_ext)
    result = _transcribe_audio(file.file.read(), suffix=suffix)
    if result["ok"]:
        text = result["text"]
        ts = datetime.now().strftime("%H:%M:%S")
        meeting.transcript += f"\n\n**[{ts}]** {text}"
        db.commit()
        return {"response": text, "transcription_ok": True, "transcription_error": None}

    return {"response": "", "transcription_ok": False, "transcription_error": result["error"]}


# ---------------------------------------------------------------------------
# Summarize / end meeting
# ---------------------------------------------------------------------------

@app.post("/api/meeting/summarize", response_model=SummarizeResponse)
def summarize_meeting(session_id: str, db: Session = Depends(get_db)):
    meeting = db.query(Meeting).filter(Meeting.id == session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # Mark as inactive first so background recorder stops sending
    meeting.is_active = False
    db.commit()

    transcript = meeting.transcript
    context_text = _get_context_text(meeting)

    chat_history = _build_chat_history_for_session(session_id)

    if len(transcript.strip()) < 10 and not chat_history:
        summary = "No meaningful discussion occurred in this meeting."
    else:
        summary = run_summarizer(
            transcript=transcript,
            chat_history=chat_history,
            context_text=context_text,
            model_id=meeting.summarizer_model_id
        )

    _save_summary_version(db, meeting, summary)

    return {"summary_markdown": summary}


@app.post("/api/meeting/{session_id}/summaries/regenerate", response_model=SummarizeResponse)
def regenerate_summary(
    session_id: str,
    req: RegenerateSummaryRequest,
    db: Session = Depends(get_db),
):
    meeting = db.query(Meeting).filter(Meeting.id == session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    transcript = meeting.transcript
    context_text = _get_context_text(meeting)
    chat_history = _build_chat_history_for_session(session_id)

    if len(transcript.strip()) < 10 and not chat_history:
        summary = "No meaningful discussion occurred in this meeting."
    else:
        summary = run_summarizer(
            transcript=transcript,
            chat_history=chat_history,
            context_text=context_text,
            model_id=meeting.summarizer_model_id,
            instruction=req.instruction,
        )

    _save_summary_version(db, meeting, summary, instruction=req.instruction)
    return {"summary_markdown": summary}


@app.get("/api/meetings/{session_id}/summaries")
def get_summary_versions(session_id: str, db: Session = Depends(get_db)):
    meeting = db.query(Meeting).filter(Meeting.id == session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    versions = (
        db.query(SummaryVersion)
        .filter(SummaryVersion.meeting_id == session_id)
        .order_by(SummaryVersion.version_number.desc())
        .all()
    )

    active_content = (meeting.summary_markdown or "").strip()

    return {
        "versions": [
            {
                "version": v.version_number,
                "created_at": v.created_at,
                "instruction": v.instruction,
                "content": v.content,
                "is_active": bool(active_content and v.content.strip() == active_content),
            }
            for v in versions
        ]
    }


@app.post("/api/meetings/{session_id}/summaries/{version_number}/activate")
def activate_summary_version(session_id: str, version_number: int, db: Session = Depends(get_db)):
    meeting = db.query(Meeting).filter(Meeting.id == session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    version = (
        db.query(SummaryVersion)
        .filter(SummaryVersion.meeting_id == session_id)
        .filter(SummaryVersion.version_number == version_number)
        .first()
    )
    if not version:
        raise HTTPException(status_code=404, detail="Summary version not found")

    meeting.summary_markdown = version.content
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Meeting list / detail
# ---------------------------------------------------------------------------

@app.get("/api/meetings")
def get_meetings(db: Session = Depends(get_db)):
    meetings = db.query(Meeting).order_by(Meeting.created_at.desc()).all()
    return [{
        "id": m.id,
        "title": m.title,
        "created_at": m.created_at,
        "is_active": m.is_active,
        "copilot_model_id": m.copilot_model_id,
        "summarizer_model_id": m.summarizer_model_id,
    } for m in meetings]


@app.get("/api/meetings/{session_id}")
def get_meeting(session_id: str, db: Session = Depends(get_db)):
    meeting = db.query(Meeting).filter(Meeting.id == session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return {
        "id": meeting.id,
        "title": meeting.title,
        "created_at": meeting.created_at,
        "is_active": meeting.is_active,
        "summary_markdown": meeting.summary_markdown,
        "transcript": meeting.transcript,
        "context_items": json.loads(meeting.context_items or "[]"),
        "copilot_model_id": meeting.copilot_model_id,
        "summarizer_model_id": meeting.summarizer_model_id,
    }
