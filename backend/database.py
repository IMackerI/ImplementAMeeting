import os
from sqlalchemy import create_engine, Column, String, DateTime, Text, Boolean
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
    is_active = Column(Boolean, default=True)
    summary_markdown = Column(Text, nullable=True)
    transcript = Column(Text, default="")

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
