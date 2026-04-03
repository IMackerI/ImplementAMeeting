import os
import uuid
import tempfile
from typing import List, Optional
from pydantic import BaseModel
from fastapi import FastAPI, UploadFile, File, Form, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from openai import OpenAI
from dotenv import load_dotenv

# Search for .env from backend up to root
load_dotenv(".env")
if not os.environ.get("OPENAI_API_KEY") and not os.environ.get("OPEN_AI_SECRET_KEY"):
    load_dotenv("../.env")


from database import Meeting, get_db
from agents.copilot import get_copilot_agent, agent_db
from agents.summarizer import run_summarizer

app = FastAPI(title="Meeting Co-Pilot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

openai_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("OPEN_AI_SECRET_KEY")
openai_client = OpenAI(api_key=openai_key)


class MeetingCreateResponse(BaseModel):
    session_id: str

class ChatTextRequest(BaseModel):
    session_id: str
    message: str

class ChatResponse(BaseModel):
    response: str
    
class SummarizeResponse(BaseModel):
    summary_markdown: str

@app.post("/api/meeting/start", response_model=MeetingCreateResponse)
def start_meeting(db: Session = Depends(get_db)):
    session_id = str(uuid.uuid4())
    new_meeting = Meeting(id=session_id, title=f"Meeting {session_id[:8]}")
    db.add(new_meeting)
    db.commit()
    return {"session_id": session_id}

@app.post("/api/chat/text", response_model=ChatResponse)
def chat_text(req: ChatTextRequest, db: Session = Depends(get_db)):
    meeting = db.query(Meeting).filter(Meeting.id == req.session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
        
    # Append message to transcript
    meeting.transcript += f"\nUser: {req.message}\n"
    
    agent = get_copilot_agent(req.session_id)
    response = agent.run(req.message)
    content = response.content if hasattr(response, 'content') else str(response)
    
    meeting.transcript += f"Copilot: {content}\n"
    db.commit()
    
    return {"response": content}

@app.post("/api/chat/audio", response_model=ChatResponse)
def chat_audio(session_id: str = Form(...), file: UploadFile = File(...), db: Session = Depends(get_db)):
    meeting = db.query(Meeting).filter(Meeting.id == session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # Transcription
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
        tmp.write(file.file.read())
        tmp_path = tmp.name

    try:
        with open(tmp_path, "rb") as audio_file:
            transcription = openai_client.audio.transcriptions.create(
                model="whisper-1", 
                file=("audio.webm", audio_file)
            )

        text = transcription.text
    except Exception as e:
        print(f"Transcription error: {e}")
        text = ""
    finally:
        os.unlink(tmp_path)


    if not text:
        return {"response": ""}

    meeting.transcript += f"\nSpoken (User): {text}\n"

    agent = get_copilot_agent(session_id)
    response = agent.run(text)
    content = response.content if hasattr(response, 'content') else str(response)
    
    meeting.transcript += f"Copilot: {content}\n"
    db.commit()
    
    return {"response": content}

@app.post("/api/meeting/transcript", response_model=ChatResponse)
def meeting_transcript(session_id: str = Form(...), file: UploadFile = File(...), db: Session = Depends(get_db)):
    meeting = db.query(Meeting).filter(Meeting.id == session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
        tmp.write(file.file.read())
        tmp_path = tmp.name

    try:
        with open(tmp_path, "rb") as audio_file:
            transcription = openai_client.audio.transcriptions.create(
                model="whisper-1", 
                file=("audio.webm", audio_file)
            )

        text = transcription.text
    except Exception as e:
        print(f"Transcription error: {e}")
        text = ""
    finally:
        os.unlink(tmp_path)


    if text:
        meeting.transcript += f" {text}"
        db.commit()

    return {"response": text}


@app.post("/api/meeting/summarize", response_model=SummarizeResponse)
def summarize_meeting(session_id: str, db: Session = Depends(get_db)):
    meeting = db.query(Meeting).filter(Meeting.id == session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
        
    transcript = meeting.transcript
    
    if len(transcript.strip()) < 10:
        summary = "No meaningful discussion occurred in this meeting."
    else:
        summary = run_summarizer(transcript=transcript, chat_history="")
        
    meeting.summary_markdown = summary
    meeting.is_active = False
    db.commit()
    
    return {"summary_markdown": summary}

@app.get("/api/meetings")
def get_meetings(db: Session = Depends(get_db)):
    meetings = db.query(Meeting).order_by(Meeting.created_at.desc()).all()
    return [{
        "id": m.id, 
        "title": m.title, 
        "created_at": m.created_at, 
        "is_active": m.is_active
    } for m in meetings]

@app.get("/api/meetings/{session_id}")
def get_meeting(session_id: str, db: Session = Depends(get_db)):
    meeting = db.query(Meeting).filter(Meeting.id == session_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return {
        "id": meeting.id,
        "title": meeting.title,
        "created_at": meeting.created_at,
        "is_active": meeting.is_active,
        "summary_markdown": meeting.summary_markdown,
        "transcript": meeting.transcript
    }
