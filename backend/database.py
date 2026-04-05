from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime

DATABASE_URL = "sqlite:///./app_data.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class Meeting(Base):
    __tablename__ = "meetings"

    id = Column(String, primary_key=True, index=True)
    title = Column(String, default="Meeting")
    created_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=False)  # starts inactive until explicitly started
    summary_markdown = Column(Text, nullable=True)
    transcript = Column(Text, default="")
    # JSON array of {"type": "text"|"file", "name": str, "content": str}
    context_items = Column(Text, default="[]")
    # Model overrides (store model ids as strings)
    copilot_model_id = Column(String, nullable=True)
    summarizer_model_id = Column(String, nullable=True)


class SummaryVersion(Base):
    __tablename__ = "summary_versions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    meeting_id = Column(String, index=True, nullable=False)
    version_number = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    instruction = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
