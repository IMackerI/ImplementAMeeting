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

# Load system prompt once at startup
SYSTEM_PROMPT_PATH = Path(__file__).parent / "prompts" / "system_prompt.md"
SYSTEM_PROMPT = SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")

# Supported Gemini Flash models (shown in UI dropdown)
AVAILABLE_MODELS: list[str] = [
    "gemini-2.5-flash-preview-04-17",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
]
DEFAULT_MODEL = AVAILABLE_MODELS[0]

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


def gemini_generate(prompt: str, model_id: str) -> str:
    """Generate text via Gemini. Returns the text response."""
    response = gemini_client.models.generate_content(
        model=model_id,
        contents=prompt,
        config=genai_types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
        ),
    )
    return response.text.strip()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

class TranscribeChunkResponse(BaseModel):
    transcript: str



@app.post("/transcribe-chunk")
async def transcribe_chunk(
    audio: UploadFile = File(...),
    chunk_index: int = Form(0),
) -> TranscribeChunkResponse:
    """
    Transcribe a single audio chunk (called periodically during long recordings).
    Returns only the transcript — no summarisation yet.
    This allows the frontend to accumulate text safely throughout a long meeting.
    """
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file received.")

    try:
        transcript = await transcribe_audio(audio_bytes, audio.filename or f"chunk_{chunk_index}.webm")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Whisper error: {exc}") from exc

    return TranscribeChunkResponse(transcript=transcript)


class SummariseRequest(BaseModel):
    full_transcript: str
    model: str = DEFAULT_MODEL


class SummariseResponse(BaseModel):
    summary: str


@app.post("/summarise", response_model=SummariseResponse)
async def summarise(req: SummariseRequest) -> SummariseResponse:
    """
    Create the initial PM summary from the full accumulated transcript.
    Called once the recording is finished.
    """
    if not req.full_transcript.strip():
        raise HTTPException(status_code=400, detail="Transcript is empty.")

    model_id = req.model if req.model in AVAILABLE_MODELS else DEFAULT_MODEL

    prompt = (
        "Below is the full transcript of a meeting. "
        "Please produce the structured project-manager report as instructed.\n\n"
        f"TRANSCRIPT:\n{req.full_transcript}"
    )

    try:
        summary = gemini_generate(prompt, model_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini error: {exc}") from exc

    return SummariseResponse(summary=summary)


class EditSummaryRequest(BaseModel):
    current_summary: str
    edit_prompt: str
    model: str = DEFAULT_MODEL


class EditSummaryResponse(BaseModel):
    summary: str


@app.post("/edit-summary", response_model=EditSummaryResponse)
async def edit_summary(req: EditSummaryRequest) -> EditSummaryResponse:
    """
    Iteratively rewrite the current summary based on an AI edit prompt.
    """
    if not req.current_summary.strip():
        raise HTTPException(status_code=400, detail="Summary is empty.")
    if not req.edit_prompt.strip():
        raise HTTPException(status_code=400, detail="Edit prompt is empty.")

    model_id = req.model if req.model in AVAILABLE_MODELS else DEFAULT_MODEL

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
        raise HTTPException(status_code=502, detail=f"Gemini error: {exc}") from exc

    return EditSummaryResponse(summary=new_summary)
