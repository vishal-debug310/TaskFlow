from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from datetime import datetime
from app.core.database import Base

class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(String, default="")
    status = Column(String, default="TODO")       # TODO, IN_PROGRESS, DONE
    priority = Column(String, default="MEDIUM")   # LOW, MEDIUM, HIGH
    assignee = Column(String, default="Vishal")
    blocked_by_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
