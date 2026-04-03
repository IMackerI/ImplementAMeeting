import os
from dotenv import load_dotenv
from agno.models.openai import OpenAIChat
from agno.models.openrouter import OpenRouter

load_dotenv(".env")
if not os.environ.get("OPENAI_API_KEY") and not os.environ.get("OPEN_AI_SECRET_KEY"):
    load_dotenv("../.env")


COPILOT_MODEL = OpenAIChat(
    id="gpt-4o-mini", # or "gpt-4o"
    api_key=os.environ.get("OPENAI_API_KEY") or os.environ.get("OPEN_AI_SECRET_KEY", "")
)

SUMMARIZER_MODEL = OpenRouter(
    id="google/gemini-2.5-pro", # A strong summarization model, or gpt-4o via openrouter
    api_key=os.environ.get("OPENROUTER_API_KEY", ""),
    max_tokens=8192,
)
