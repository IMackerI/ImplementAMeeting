"""
routes/summary.py — Summarise and edit-summary endpoints
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.config import AVAILABLE_MODELS, DEFAULT_MODEL, RECORDINGS_DIR
from app.helpers import (
    build_interlaced_timeline,
    gemini_generate,
    get_full_context,
    sanitize_session_id,
)
from app.models import (
    EditSummaryRequest,
    EditSummaryResponse,
    SummariseRequest,
    SummariseResponse,
)

router = APIRouter()


@router.post("/summarise", response_model=SummariseResponse)
async def summarise(req: SummariseRequest) -> SummariseResponse:
    """
    Create the initial PM summary and save it.
    Uses interlaced timeline (transcript + chat) plus pre-session context.
    """
    if not req.full_transcript.strip():
        raise HTTPException(status_code=400, detail="Transcript is empty.")

    model_id = req.model if req.model in AVAILABLE_MODELS else DEFAULT_MODEL
    sid = sanitize_session_id(req.session_id)

    # Build enriched prompt
    context = get_full_context(sid)
    timeline = build_interlaced_timeline(sid)

    prompt_parts = []
    prompt_parts.append(
        "Below is the full context and timeline of a meeting. "
        "Please produce the structured project-manager report as instructed."
    )

    if context:
        prompt_parts.append(f"\nPRE-MEETING CONTEXT:\n{context}")

    if timeline:
        prompt_parts.append(
            f"\nMEETING TIMELINE (transcript and chat messages interlaced chronologically):\n{timeline}"
        )
    else:
        # Fallback to raw transcript if timeline building fails
        prompt_parts.append(f"\nTRANSCRIPT:\n{req.full_transcript}")

    prompt = "\n\n".join(prompt_parts)

    try:
        summary = gemini_generate(prompt, model_id)
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise exc
        print(f"ERROR: Gemini failed: {exc}")
        raise HTTPException(status_code=502, detail=f"Gemini error: {exc}") from exc

    try:
        summary_path = RECORDINGS_DIR / f"{sid}_summary.md"
        summary_path.write_text(summary, encoding="utf-8")
    except Exception as exc:
        print(f"ERROR: Summary persistence failed: {exc}")

    return SummariseResponse(summary=summary)


@router.post("/edit-summary", response_model=EditSummaryResponse)
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
        summary_path = RECORDINGS_DIR / f"{sid}_summary.md"
        summary_path.write_text(new_summary, encoding="utf-8")
    except Exception as exc:
        print(f"ERROR: Edit persistence failed: {exc}")

    return EditSummaryResponse(summary=new_summary)
