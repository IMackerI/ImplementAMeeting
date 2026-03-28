"""
app — Meeting Recorder FastAPI application
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import AVAILABLE_MODELS, DEFAULT_MODEL
from app.routes import transcription, summary, chat
from app.context import router as context_router

app = FastAPI(title="Meeting Recorder", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Include routers
app.include_router(transcription.router)
app.include_router(summary.router)
app.include_router(chat.router)
app.include_router(context_router)


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
