from agno.agent import Agent
from models import SUMMARIZER_MODEL
from prompts import SUMMARIZER_SYSTEM_PROMPT

def run_summarizer(transcript: str, chat_history: str) -> str:
    agent = Agent(
        model=SUMMARIZER_MODEL,
        instructions=[SUMMARIZER_SYSTEM_PROMPT],
        markdown=True
    )
    
    prompt = f"Here is the meeting transcript:\n\n{transcript}\n\nHere is the chat history during the meeting:\n\n{chat_history}"
    
    response = agent.run(prompt)
    if hasattr(response, 'content'):
        return response.content
    return str(response)
