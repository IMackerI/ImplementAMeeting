import os
import io
import uuid
import json
import tempfile
from typing import List, Optional
from pydantic import BaseModel
from fastapi import FastAPI, UploadFile, File, Form, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from openai import OpenAI
from dotenv import load_dotenv
from datetime import datetime

# Search for .env from backend up to root
load_dotenv(".env")
if not os.environ.get("OPENAI_API_KEY") and not os.environ.get("OPEN_AI_SECRET_KEY"):
    load_dotenv("../.env")


from database import Meeting, get_db
from agents.copilot import get_copilot_agent, agent_db
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

class SummarizeResponse(BaseModel):
    summary_markdown: str

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


def _transcribe_audio(file_bytes: bytes, suffix: str = ".webm") -> str:
    """Write bytes to a temp file, transcribe with Whisper, return text."""
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name
    try:
        with open(tmp_path, "rb") as audio_file:
            transcription = openai_client.audio.transcriptions.create(
                model="whisper-1",
                file=("audio.webm", audio_file)
            )
        return transcription.text
    except Exception as e:
        print(f"Transcription error: {e}")
        return ""
    finally:
        os.unlink(tmp_path)


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
def chat_audio(session_id: str = Form(...), file: UploadFile = File(...), db: Session = Depends(get_db)):
    meeting = db.query(Meeting).filter(Meeting.id == session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    text = _transcribe_audio(file.file.read())
    if not text:
        return {"response": ""}

    ts = datetime.now().strftime("%H:%M:%S")
    meeting.transcript += f"\n\n**[{ts}] User Query:** {text}\n"

    context_text = _get_context_text(meeting)
    agent = get_copilot_agent(
        session_id,
        transcript=meeting.transcript,
        context_text=context_text,
        model_id=meeting.copilot_model_id
    )
    response = agent.run(text)
    content = response.content if hasattr(response, 'content') else str(response)

    meeting.transcript += f"\n**Copilot Response:**\n\n{content}\n\n---"
    db.commit()

    return {"response": content}


@app.post("/api/meeting/transcript", response_model=ChatResponse)
def meeting_transcript(session_id: str = Form(...), file: UploadFile = File(...), db: Session = Depends(get_db)):
    meeting = db.query(Meeting).filter(Meeting.id == session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if not meeting.is_active:
        return {"response": ""}

    text = _transcribe_audio(file.file.read())
    if text:
        ts = datetime.now().strftime("%H:%M:%S")
        meeting.transcript += f"\n\n**[{ts}]** {text}"
        db.commit()

    return {"response": text}


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

    # Fetch copilot conversation history from agents.db
    chat_history = ""
    try:
        import sqlite3 as _sqlite3
        import json as _json
        with _sqlite3.connect("agents.db") as _conn:
            _cur = _conn.cursor()
            _cur.execute("SELECT runs FROM copilot_sessions WHERE session_id = ?", (session_id,))
            _row = _cur.fetchone()
        if _row and _row[0]:
            _runs = _json.loads(_row[0])
            _lines = []
            for _run in _runs:
                _content = _run.get("content", "")
                if _content:
                    _lines.append(f"**Copilot**: {_content}")
            chat_history = "\n\n".join(_lines)
    except Exception as e:
        print(f"Could not fetch copilot history: {e}")

    if len(transcript.strip()) < 10 and not chat_history:
        summary = "No meaningful discussion occurred in this meeting."
    else:
        summary = run_summarizer(
            transcript=transcript,
            chat_history=chat_history,
            context_text=context_text,
            model_id=meeting.summarizer_model_id
        )

    meeting.summary_markdown = summary
    db.commit()

    return {"summary_markdown": summary}


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
