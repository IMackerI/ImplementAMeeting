"""
helpers.py — Shared helper functions (transcription, generation, session utils)
"""

from __future__ import annotations

import io
import json
from datetime import datetime
from pathlib import Path

from google.genai import types as genai_types

from app.config import (
    SUMMARY_PROMPT,
    gemini_client,
    openai_client,
    RECORDINGS_DIR,
)


def sanitize_session_id(sid: str | None) -> str:
    """Ensure session_id is a valid-ish string or generate a new one."""
    if not sid or str(sid).lower() in ("null", "undefined", "none", ""):
        return datetime.now().strftime("%Y%m%d_%H%M%S")
    return str(sid).strip()


async def transcribe_audio(audio_bytes: bytes, filename: str) -> str:
    """Send audio bytes to Whisper and return the transcript."""
    audio_file = io.BytesIO(audio_bytes)
    audio_file.name = filename

    response = await openai_client.audio.transcriptions.create(
        model="whisper-1",
        file=audio_file,
        response_format="text",
    )
    return str(response).strip()


def gemini_generate(
    prompt: str,
    model_id: str,
    system_instruction: str = SUMMARY_PROMPT,
    enable_search: bool = False,
) -> str:
    """Generate text via Gemini. Returns the text response."""
    config_params = {"system_instruction": system_instruction}

    if enable_search:
        config_params["tools"] = [
            genai_types.Tool(google_search=genai_types.GoogleSearch())
        ]

    response = gemini_client.models.generate_content(
        model=model_id,
        contents=prompt,
        config=genai_types.GenerateContentConfig(**config_params),
    )
    return response.text.strip()


# ---------------------------------------------------------------------------
# Context helpers
# ---------------------------------------------------------------------------
def get_context_path(session_id: str) -> Path:
    return RECORDINGS_DIR / f"{session_id}_context.json"


def load_context_items(session_id: str) -> list[dict]:
    path = get_context_path(session_id)
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data.get("items", [])
    except (json.JSONDecodeError, KeyError):
        return []


def save_context_items(session_id: str, items: list[dict]) -> None:
    path = get_context_path(session_id)
    path.write_text(json.dumps({"items": items}, ensure_ascii=False, indent=2), encoding="utf-8")


def get_full_context(session_id: str) -> str:
    """Concatenate all context items into a single text block."""
    items = load_context_items(session_id)
    if not items:
        return ""
    parts = []
    for item in items:
        label = item.get("name", "Text note")
        content = item.get("content", "")
        parts.append(f"[{label}]\n{content}")
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Chat history helpers
# ---------------------------------------------------------------------------
def get_chat_path(session_id: str) -> Path:
    return RECORDINGS_DIR / f"{session_id}_chat.json"


def load_chat_history(session_id: str) -> list[dict]:
    path = get_chat_path(session_id)
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, KeyError):
        return []


def append_chat_messages(session_id: str, messages: list[dict]) -> None:
    history = load_chat_history(session_id)
    history.extend(messages)
    path = get_chat_path(session_id)
    path.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")


def build_interlaced_timeline(session_id: str) -> str:
    """
    Build a chronological timeline that interlaces transcript chunks
    with chat messages, ordered by timestamp.
    """
    transcript_path = RECORDINGS_DIR / f"{session_id}_transcript.txt"
    events: list[tuple[str, str, str]] = []  # (iso_timestamp, type, content)

    # Parse transcript chunks
    if transcript_path.exists():
        raw = transcript_path.read_text(encoding="utf-8")
        chunks = raw.split("--- Chunk ")
        for chunk in chunks:
            if not chunk.strip():
                continue
            # Extract timestamp from header: "N (ISO_TIMESTAMP) ---"
            header_end = chunk.find("---")
            if header_end == -1:
                continue
            header = chunk[:header_end].strip()
            body = chunk[header_end + 3:].strip()
            # Parse "(2026-03-27T14:10:30.123456)"
            paren_start = header.find("(")
            paren_end = header.find(")")
            if paren_start != -1 and paren_end != -1:
                ts = header[paren_start + 1:paren_end]
            else:
                ts = "0000-00-00T00:00:00"
            events.append((ts, "transcript", body))

    # Parse chat messages
    chat_history = load_chat_history(session_id)
    for msg in chat_history:
        ts = msg.get("timestamp", "9999-99-99T99:99:99")
        role = "User" if msg["role"] == "user" else "AI Assistant"
        events.append((ts, "chat", f"[{role}]: {msg['content']}"))

    # Sort by timestamp
    events.sort(key=lambda x: x[0])

    # Build output
    parts = []
    for ts, etype, content in events:
        if etype == "transcript":
            parts.append(f"[Spoken at {ts}]\n{content}")
        else:
            parts.append(f"[Chat message at {ts}]\n{content}")

    return "\n\n".join(parts)
