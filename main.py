"""
main.py — Meeting Recorder Backend
FastAPI app: Whisper transcription + Gemini summarisation
"""

from __future__ import annotations

import io
import os
from pathlib import Path

from google import genai
from google.genai import types as genai_types
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from openai import AsyncOpenAI
from pydantic import BaseModel

from datetime import datetime

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
load_dotenv()

OPENAI_API_KEY = os.getenv("OPEN_AI_SECRET_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

if not OPENAI_API_KEY:
    raise RuntimeError("OPEN_AI_SECRET_KEY is not set in .env")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY is not set in .env")

gemini_client = genai.Client(api_key=GEMINI_API_KEY)
openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY)

# Load system prompts at startup
SUMMARY_PROMPT_PATH = Path(__file__).parent / "prompts" / "summary_prompt.md"
CHAT_PROMPT_PATH = Path(__file__).parent / "prompts" / "chat_prompt.md"

SUMMARY_PROMPT = SUMMARY_PROMPT_PATH.read_text(encoding="utf-8")
CHAT_PROMPT = CHAT_PROMPT_PATH.read_text(encoding="utf-8")

# Dynamically fetch available Flash models
def fetch_available_models():
    try:
        models = []
        for m in gemini_client.models.list():
            if 'generateContent' in m.supported_actions and 'flash' in m.name.lower():
                models.append(m.name)
        # Sort so newest/pro might be first, or just alphabetical
        models.sort(reverse=True)
        return models if models else ["models/gemini-2.0-flash"]
    except Exception as e:
        print(f"Error fetching models: {e}")
        return ["models/gemini-2.0-flash", "models/gemini-1.5-flash"]

AVAILABLE_MODELS = fetch_available_models()
DEFAULT_MODEL = AVAILABLE_MODELS[0]

RECORDINGS_DIR = Path(__file__).parent.resolve() / "recordings"
if not RECORDINGS_DIR.exists():
    RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Created recordings directory at: {RECORDINGS_DIR}")
else:
    print(f"Using recordings directory at: {RECORDINGS_DIR}")

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="Meeting Recorder", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def serve_ui() -> FileResponse:
    return FileResponse("static/index.html")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse("static/favicon.ico")


@app.get("/models")
async def list_models() -> dict:
    """Return the list of available Gemini models and the default."""
    return {"models": AVAILABLE_MODELS, "default": DEFAULT_MODEL}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def transcribe_audio(audio_bytes: bytes, filename: str) -> str:
    """Send audio bytes to Whisper and return the transcript."""
    audio_file = io.BytesIO(audio_bytes)
    audio_file.name = filename  # OpenAI SDK uses name to determine format

    response = await openai_client.audio.transcriptions.create(
        model="whisper-1",
        file=audio_file,
        response_format="text",
    )
    # response is plain text when response_format="text"
    return str(response).strip()


def gemini_generate(prompt: str, model_id: str, system_instruction: str = SUMMARY_PROMPT, enable_search: bool = False) -> str:
    """Generate text via Gemini. Returns the text response."""
    config_params = {"system_instruction": system_instruction}
    
    if enable_search:
        # Use the Google Search tool for real-time web information
        # The new GenAI SDK uses google_search for AI Studio
        config_params["tools"] = [
            genai_types.Tool(
                google_search=genai_types.GoogleSearch()
            )
        ]

    response = gemini_client.models.generate_content(
        model=model_id,
        contents=prompt,
        config=genai_types.GenerateContentConfig(**config_params),
    )
    return response.text.strip()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

class TranscribeChunkResponse(BaseModel):
    transcript: str
    session_id: str


def sanitize_session_id(sid: str | None) -> str:
    """Ensure session_id is a valid-ish string or generate a new one."""
    if not sid or str(sid).lower() in ("null", "undefined", "none", ""):
        return datetime.now().strftime("%Y%m%d_%H%M%S")
    return str(sid).strip()


@app.post("/transcribe-chunk")
async def transcribe_chunk(
    audio: UploadFile = File(...),
    chunk_index: int = Form(0),
    session_id: str = Form(None),
) -> TranscribeChunkResponse:
    """
    Transcribe a single audio chunk and append it to the session's transcript file.
    """
    sid = sanitize_session_id(session_id)
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file received.")

    try:
        transcript = await transcribe_audio(audio_bytes, audio.filename or f"chunk_{chunk_index}.webm")
    except Exception as exc:
        # Check if it's already an HTTPException
        if isinstance(exc, HTTPException): raise exc
        print(f"ERROR: Whisper failed: {exc}")
        raise HTTPException(status_code=502, detail=f"Whisper error: {exc}") from exc

    try:
        # Persist the transcript chunk
        transcript_path = RECORDINGS_DIR / f"{sid}_transcript.txt"
        with open(transcript_path, "a", encoding="utf-8") as f:
            f.write(f"--- Chunk {chunk_index} ({datetime.now().isoformat()}) ---\n")
            f.write(str(transcript) + "\n\n")
    except Exception as exc:
        print(f"ERROR: Persistence failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Persistence error: {exc}")

    return TranscribeChunkResponse(transcript=str(transcript), session_id=sid)


class SummariseRequest(BaseModel):
    full_transcript: str
    model: str = DEFAULT_MODEL
    session_id: str | None = None


class SummariseResponse(BaseModel):
    summary: str


@app.post("/summarise", response_model=SummariseResponse)
async def summarise(req: SummariseRequest) -> SummariseResponse:
    """
    Create the initial PM summary and save it.
    """
    if not req.full_transcript.strip():
        raise HTTPException(status_code=400, detail="Transcript is empty.")

    model_id = req.model if req.model in AVAILABLE_MODELS else DEFAULT_MODEL
    sid = sanitize_session_id(req.session_id)

    prompt = (
        "Below is the full transcript of a meeting. "
        "Please produce the structured project-manager report as instructed.\n\n"
        f"TRANSCRIPT:\n{req.full_transcript}"
    )

    try:
        summary = gemini_generate(prompt, model_id)
    except Exception as exc:
        if isinstance(exc, HTTPException): raise exc
        print(f"ERROR: Gemini failed: {exc}")
        raise HTTPException(status_code=502, detail=f"Gemini error: {exc}") from exc

    try:
        # Persist the summary
        summary_path = RECORDINGS_DIR / f"{sid}_summary.md"
        summary_path.write_text(summary, encoding="utf-8")
    except Exception as exc:
        print(f"ERROR: Summary persistence failed: {exc}")
        # We still return the summary even if saving fails
        
    return SummariseResponse(summary=summary)


class EditSummaryRequest(BaseModel):
    current_summary: str
    edit_prompt: str
    model: str = DEFAULT_MODEL
    session_id: str | None = None


class EditSummaryResponse(BaseModel):
    summary: str


@app.post("/edit-summary", response_model=EditSummaryResponse)
async def edit_summary(req: EditSummaryRequest) -> EditSummaryResponse:
    """
    Iteratively rewrite the current summary and update the saved file.
    """
    if not req.current_summary.strip():
        raise HTTPException(status_code=400, detail="Summary is empty.")
    if not req.edit_prompt.strip():
        raise HTTPException(status_code=400, detail="Edit prompt is empty.")

    model_id = req.model if req.model in AVAILABLE_MODELS else DEFAULT_MODEL
    sid = sanitize_session_id(req.session_id)

    prompt = (
        "You are given an existing meeting summary and an editing instruction. "
        "Rewrite the summary according to the instruction while preserving all factual content "
        "that is not explicitly changed by the instruction.\n\n"
        f"EDITING INSTRUCTION:\n{req.edit_prompt}\n\n"
        f"CURRENT SUMMARY:\n{req.current_summary}"
    )

    try:
        new_summary = gemini_generate(prompt, model_id)
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise exc
        print(f"ERROR: Gemini edit failed: {exc}")
        raise HTTPException(status_code=502, detail=f"Gemini error: {exc}") from exc

    try:
        # Update persistent summary
        summary_path = RECORDINGS_DIR / f"{sid}_summary.md"
        summary_path.write_text(new_summary, encoding="utf-8")
    except Exception as exc:
        print(f"ERROR: Edit persistence failed: {exc}")

    return EditSummaryResponse(summary=new_summary)


class ChatRequest(BaseModel):
    session_id: str
    user_prompt: str
    model: str = DEFAULT_MODEL
    enable_search: bool = False


class ChatResponse(BaseModel):
    response: str


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    """
    Chat with the AI based on the current transcript context.
    """
    sid = sanitize_session_id(req.session_id)
    transcript_path = RECORDINGS_DIR / f"{sid}_transcript.txt"

    if not transcript_path.exists():
        # It's possible no chunks have been finalized yet
        transcript_context = "No transcript available yet."
    else:
        transcript_context = transcript_path.read_text(encoding="utf-8")

    model_id = req.model if req.model in AVAILABLE_MODELS else DEFAULT_MODEL

    prompt = (
        "Below is the transcript of the meeting so far. "
        "Answer the user's question using this context.\n\n"
        f"TRANSCRIPT:\n{transcript_context}\n\n"
        f"USER QUESTION: {req.user_prompt}"
    )

    try:
        response_text = gemini_generate(
            prompt, 
            model_id, 
            system_instruction=CHAT_PROMPT,
            enable_search=req.enable_search
        )
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise exc
        print(f"ERROR: Gemini chat failed: {exc}")
        raise HTTPException(status_code=502, detail=f"Gemini error: {exc}") from exc

    return ChatResponse(response=response_text)
