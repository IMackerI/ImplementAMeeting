"""
models.py — Pydantic request/response models
"""

from __future__ import annotations

from pydantic import BaseModel

from app.config import DEFAULT_MODEL


class TranscribeChunkResponse(BaseModel):
    transcript: str
    session_id: str


class SummariseRequest(BaseModel):
    full_transcript: str
    model: str = DEFAULT_MODEL
    session_id: str | None = None


class SummariseResponse(BaseModel):
    summary: str


class EditSummaryRequest(BaseModel):
    current_summary: str
    edit_prompt: str
    model: str = DEFAULT_MODEL
    session_id: str | None = None


class EditSummaryResponse(BaseModel):
    summary: str


class ChatRequest(BaseModel):
    session_id: str
    user_prompt: str
    model: str = DEFAULT_MODEL
    enable_search: bool = False


class ChatResponse(BaseModel):
    response: str


class ContextTextRequest(BaseModel):
    session_id: str
    text: str


class ContextResponse(BaseModel):
    items: list[dict]
    full_text: str
