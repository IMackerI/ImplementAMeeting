"""
routes/transcription.py — Audio chunk transcription endpoint
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.config import RECORDINGS_DIR
from app.helpers import sanitize_session_id, transcribe_audio
from app.models import TranscribeChunkResponse

router = APIRouter()


@router.post("/transcribe-chunk", response_model=TranscribeChunkResponse)
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
        transcript = await transcribe_audio(
            audio_bytes, audio.filename or f"chunk_{chunk_index}.webm"
        )
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise exc
        print(f"ERROR: Whisper failed: {exc}")
        raise HTTPException(status_code=502, detail=f"Whisper error: {exc}") from exc

    try:
        transcript_path = RECORDINGS_DIR / f"{sid}_transcript.txt"
        with open(transcript_path, "a", encoding="utf-8") as f:
            f.write(f"--- Chunk {chunk_index} ({datetime.now().isoformat()}) ---\n")
            f.write(str(transcript) + "\n\n")
    except Exception as exc:
        print(f"ERROR: Persistence failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Persistence error: {exc}")

    return TranscribeChunkResponse(transcript=str(transcript), session_id=sid)
