"""
config.py — Environment, API clients, constants
"""

from __future__ import annotations

import os
from pathlib import Path

from google import genai
from google.genai import types as genai_types
from dotenv import load_dotenv
from openai import AsyncOpenAI

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
load_dotenv()

OPENAI_API_KEY = os.getenv("OPEN_AI_SECRET_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

if not OPENAI_API_KEY:
    raise RuntimeError("OPEN_AI_SECRET_KEY is not set in .env")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY is not set in .env")

# ---------------------------------------------------------------------------
# API Clients
# ---------------------------------------------------------------------------
gemini_client = genai.Client(api_key=GEMINI_API_KEY)
openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY)

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).parent.parent.resolve()
SUMMARY_PROMPT_PATH = BASE_DIR / "prompts" / "summary_prompt.md"
CHAT_PROMPT_PATH = BASE_DIR / "prompts" / "chat_prompt.md"

SUMMARY_PROMPT = SUMMARY_PROMPT_PATH.read_text(encoding="utf-8")
CHAT_PROMPT = CHAT_PROMPT_PATH.read_text(encoding="utf-8")

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
def fetch_available_models() -> list[str]:
    try:
        models = []
        for m in gemini_client.models.list():
            is_gemini = "gemini" in m.name.lower()
            is_flash_pro = "flash" in m.name.lower() or "pro" in m.name.lower()
            if "generateContent" in m.supported_actions and is_gemini and is_flash_pro:
                models.append(m.name)
        models.sort(reverse=True)
        return models if models else ["models/gemini-2.0-flash"]
    except Exception as e:
        print(f"Error fetching models: {e}")
        return ["models/gemini-2.0-flash", "models/gemini-1.5-flash"]


AVAILABLE_MODELS = fetch_available_models()
DEFAULT_MODEL = next(
    (m for m in AVAILABLE_MODELS if "flash" in m.lower()), AVAILABLE_MODELS[0]
)

# ---------------------------------------------------------------------------
# Directories
# ---------------------------------------------------------------------------
RECORDINGS_DIR = BASE_DIR / "recordings"
if not RECORDINGS_DIR.exists():
    RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Created recordings directory at: {RECORDINGS_DIR}")
else:
    print(f"Using recordings directory at: {RECORDINGS_DIR}")
