"""
context.py — Context management routes (text notes + file uploads)
"""

from __future__ import annotations

import io

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.helpers import (
    load_context_items,
    save_context_items,
    get_full_context,
    sanitize_session_id,
)
from app.models import ContextResponse, ContextTextRequest

router = APIRouter(prefix="/context", tags=["context"])


def extract_text_from_file(content: bytes, filename: str) -> str:
    """Extract plain text from uploaded file bytes based on extension."""
    name_lower = filename.lower()

    # Plain text formats
    if name_lower.endswith((".txt", ".md", ".csv", ".json", ".log", ".py", ".js", ".ts", ".html", ".css", ".yaml", ".yml", ".toml", ".xml", ".ini", ".cfg", ".sh", ".bat")):
        return content.decode("utf-8", errors="replace")

    # PDF
    if name_lower.endswith(".pdf"):
        try:
            import pdfplumber
            pdf = pdfplumber.open(io.BytesIO(content))
            text_parts = []
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)
            pdf.close()
            return "\n\n".join(text_parts) if text_parts else "(PDF contained no extractable text)"
        except ImportError:
            return "(PDF support requires pdfplumber — install with: uv add pdfplumber)"
        except Exception as e:
            return f"(Failed to extract PDF: {e})"

    # DOCX
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


@router.post("/text", response_model=ContextResponse)
async def add_text_context(req: ContextTextRequest) -> ContextResponse:
    """Add a free-text note to the session context."""
    sid = sanitize_session_id(req.session_id)
    items = load_context_items(sid)
    items.append({"type": "text", "name": "Text note", "content": req.text})
    save_context_items(sid, items)
    return ContextResponse(items=items, full_text=get_full_context(sid))


@router.post("/upload", response_model=ContextResponse)
async def upload_context_file(
    file: UploadFile = File(...),
    session_id: str = Form(...),
) -> ContextResponse:
    """Upload a file, extract text, and add to session context."""
    sid = sanitize_session_id(session_id)
    content = await file.read()

    if not content:
        raise HTTPException(status_code=400, detail="Empty file received.")

    extracted = extract_text_from_file(content, file.filename or "unknown.txt")
    items = load_context_items(sid)
    items.append({
        "type": "file",
        "name": file.filename or "uploaded_file",
        "content": extracted,
    })
    save_context_items(sid, items)
    return ContextResponse(items=items, full_text=get_full_context(sid))


@router.get("/{session_id}", response_model=ContextResponse)
async def get_context(session_id: str) -> ContextResponse:
    """Return the current context for a session."""
    sid = sanitize_session_id(session_id)
    items = load_context_items(sid)
    return ContextResponse(items=items, full_text=get_full_context(sid))


@router.delete("/{session_id}/{index}", response_model=ContextResponse)
async def delete_context_item(session_id: str, index: int) -> ContextResponse:
    """Remove a context item by index."""
    sid = sanitize_session_id(session_id)
    items = load_context_items(sid)
    if 0 <= index < len(items):
        items.pop(index)
        save_context_items(sid, items)
    return ContextResponse(items=items, full_text=get_full_context(sid))
