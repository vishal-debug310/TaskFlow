from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List
from celery.result import AsyncResult

from app.core.database import get_db
from app.core.neo4j_db import neo4j_client
from app.models.task_model import Task
from app.models.schemas import TaskCreate, TaskUpdate, TaskResponse
from app.worker.celery_app import celery_app, export_tasks_csv

router = APIRouter()

@router.get("/tasks", response_model=List[TaskResponse])
def get_tasks(db: Session = Depends(get_db)):
    return db.query(Task).order_by(Task.id.desc()).all()

@router.post("/tasks", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
def create_task(payload: TaskCreate, db: Session = Depends(get_db)):
    if payload.blocked_by_id:
        blocker = db.query(Task).filter(Task.id == payload.blocked_by_id).first()
        if not blocker:
            raise HTTPException(status_code=404, detail="Blocking task ID not found")

    new_task = Task(**payload.model_dump())
    db.add(new_task)
    db.commit()
    db.refresh(new_task)

    # Sync graph relationships in Neo4j
    neo4j_client.sync_task_dependency(
    new_task.id,
    new_task.title,
    new_task.assignee,
    new_task.blocked_by_id,
    new_task.status
    )

    return new_task

@router.patch("/tasks/{task_id}", response_model=TaskResponse)
def update_task(task_id: int, payload: TaskUpdate, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Enforce Neo4j / Relational dependency check before starting work
    if payload.status == "IN_PROGRESS" and task.blocked_by_id:
        blocker = db.query(Task).filter(Task.id == task.blocked_by_id).first()
        if blocker and blocker.status != "DONE":
            raise HTTPException(
                status_code=400,
                detail=f"Cannot start task: Blocked by Task #{blocker.id} ({blocker.title})"
            )

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(task, key, value)

        db.commit()
        db.refresh(task)

        neo4j_client.sync_task_update(
            task.id,
            task.title,
            task.assignee,
            task.status,
            task.blocked_by_id
        )

        return task


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()

    if not task:
        raise HTTPException(
            status_code=404,
            detail="Task not found"
        )

    # Prevent deleting tasks that other tasks depend on
    dependent_task = (
        db.query(Task)
        .filter(Task.blocked_by_id == task_id)
        .first()
    )

    if dependent_task:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete task: Task #{dependent_task.id} depends on it"
        )

    task_id_to_delete = task.id

    db.delete(task)
    db.commit()

    neo4j_client.delete_task(task_id_to_delete)

@router.get("/tasks/suggest-assignee")
def suggest_assignee():
    return {"recommended_assignee": neo4j_client.get_recommended_assignee()}

@router.post("/jobs/export", status_code=status.HTTP_202_ACCEPTED)
def trigger_export():
    job = export_tasks_csv.delay()
    return {"job_id": job.id, "status": "PENDING"}

@router.get("/jobs/{job_id}")
def check_job_status(job_id: str):
    result = AsyncResult(job_id, app=celery_app)
    return {
        "job_id": job_id,
        "status": result.status,
        "result": result.result if result.ready() else None
    }

@router.get("/exports/{filename}")
def download_export(filename: str):
    return FileResponse(path=f"/app/exports/{filename}", filename=filename, media_type="text/csv")
