"""
routes/chat.py — Chat endpoint with context + history support
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException

from app.config import AVAILABLE_MODELS, CHAT_PROMPT, DEFAULT_MODEL, RECORDINGS_DIR
from app.helpers import (
    append_chat_messages,
    gemini_generate,
    get_full_context,
    load_chat_history,
    sanitize_session_id,
)
from app.models import ChatRequest, ChatResponse

router = APIRouter()


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    """
    Chat with the AI based on the current transcript context,
    pre-meeting context, and prior chat messages.
    """
    sid = sanitize_session_id(req.session_id)
    transcript_path = RECORDINGS_DIR / f"{sid}_transcript.txt"

    if not transcript_path.exists():
        transcript_context = "No transcript available yet."
    else:
        transcript_context = transcript_path.read_text(encoding="utf-8")

    model_id = req.model if req.model in AVAILABLE_MODELS else DEFAULT_MODEL

    # Build prompt with all available context
    prompt_parts = []

    # Pre-meeting context
    context = get_full_context(sid)
    if context:
        prompt_parts.append(f"PRE-MEETING CONTEXT:\n{context}")

    prompt_parts.append(
        "Below is the transcript of the meeting so far. "
        "Answer the user's question using this context."
    )
    prompt_parts.append(f"TRANSCRIPT:\n{transcript_context}")

    # Include prior chat history
    chat_history = load_chat_history(sid)
    if chat_history:
        history_text = "\n".join(
            f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content']}"
            for m in chat_history
        )
        prompt_parts.append(f"PRIOR CHAT MESSAGES:\n{history_text}")

    prompt_parts.append(f"USER QUESTION: {req.user_prompt}")

    prompt = "\n\n".join(prompt_parts)

    try:
        response_text = gemini_generate(
            prompt,
            model_id,
            system_instruction=CHAT_PROMPT,
            enable_search=req.enable_search,
        )
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise exc
        print(f"ERROR: Gemini chat failed: {exc}")
        raise HTTPException(status_code=502, detail=f"Gemini error: {exc}") from exc

    # Persist chat messages
    now = datetime.now().isoformat()
    append_chat_messages(
        sid,
        [
            {"role": "user", "content": req.user_prompt, "timestamp": now},
            {"role": "ai", "content": response_text, "timestamp": now},
        ],
    )

    return ChatResponse(response=response_text)
