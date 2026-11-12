from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime

class TaskCreate(BaseModel):
    title: str = Field(..., min_length=2, max_length=150)
    description: Optional[str] = ""
    status: Optional[str] = "TODO"
    priority: Optional[str] = "MEDIUM"
    assignee: Optional[str] = "Vishal"
    blocked_by_id: Optional[int] = None

class TaskUpdate(BaseModel):
    status: Optional[str] = None
    assignee: Optional[str] = None
    priority: Optional[str] = None

class TaskResponse(BaseModel):
    id: int
    title: str
    description: str
    status: str
    priority: str
    assignee: str
    blocked_by_id: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True
