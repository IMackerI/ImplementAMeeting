import os
from agno.agent import Agent
from agno.db.sqlite import SqliteDb
from agno.tools.duckduckgo import DuckDuckGoTools
from models import COPILOT_MODEL
from prompts import COPILOT_SYSTEM_PROMPT

# Keep agent storage separate from our metadata db
agent_db = SqliteDb(
    session_table="copilot_sessions",
    db_file="agents.db"
)

def get_copilot_agent(session_id: str, transcript: str = "") -> Agent:
    return Agent(
        model=COPILOT_MODEL,
        db=agent_db,
        session_id=session_id,
        add_history_to_context=True,
        num_history_runs=10,
        instructions=[
            COPILOT_SYSTEM_PROMPT,
            f"Here is the context of the meeting so far:\n<meeting_transcript>\n{transcript}\n</meeting_transcript>\n"
            "Use this transcript to answer the user's queries accurately."
        ],
        tools=[DuckDuckGoTools()],
        markdown=True
    )

