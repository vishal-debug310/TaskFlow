
import os
import csv
import time
from celery import Celery

from app.core.database import SessionLocal
from app.models.task_model import Task

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "taskflow_worker",
    broker=REDIS_URL,
    backend=REDIS_URL
)


@celery_app.task(name="export_tasks_csv")
def export_tasks_csv():
    time.sleep(2)

    db = SessionLocal()

    try:
        tasks = db.query(Task).order_by(Task.id.asc()).all()

        export_dir = "/app/exports"
        os.makedirs(export_dir, exist_ok=True)

        filename = f"tasks_report_{time.time_ns()}.csv"
        filepath = os.path.join(export_dir, filename)

        with open(filepath, mode="w", newline="", encoding="utf-8") as file:
            writer = csv.writer(file)

            writer.writerow([
                "ID",
                "Title",
                "Status",
                "Priority",
                "Assignee",
                "Blocked By"
            ])

            for task in tasks:
                writer.writerow([
                    task.id,
                    task.title,
                    task.status,
                    task.priority,
                    task.assignee,
                    task.blocked_by_id if task.blocked_by_id is not None else "None"
                ])

        return {
            "filename": filename,
            "total_tasks": len(tasks)
        }

    finally:
        db.close()
