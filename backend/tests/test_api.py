from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}

def test_task_lifecycle_and_dependency_lock():
    # 1. Create parent task
    t1 = client.post("/api/v1/tasks", json={"title": "Design DB Schema", "priority": "HIGH", "assignee": "Vishal"})
    assert t1.status_code == 201
    t1_id = t1.json()["id"]

    # 2. Create blocked child task
    t2 = client.post("/api/v1/tasks", json={"title": "Build API Endpoints", "blocked_by_id": t1_id})
    assert t2.status_code == 201
    t2_id = t2.json()["id"]

    # 3. Verify starting blocked task fails with 400
    fail_start = client.patch(f"/api/v1/tasks/{t2_id}", json={"status": "IN_PROGRESS"})
    assert fail_start.status_code == 400

    # 4. Complete parent task, then start child task
    client.patch(f"/api/v1/tasks/{t1_id}", json={"status": "DONE"})
    success_start = client.patch(f"/api/v1/tasks/{t2_id}", json={"status": "IN_PROGRESS"})
    assert success_start.status_code == 200



def test_get_tasks():
    response = client.get("/api/v1/tasks")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_create_task_rejects_short_title():
    response = client.post(
        "/api/v1/tasks",
        json={"title": "A"}
    )
    assert response.status_code == 422


def test_create_task_rejects_missing_blocker():
    response = client.post(
        "/api/v1/tasks",
        json={
            "title": "Build frontend",
            "blocked_by_id": 999999
        }
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Blocking task ID not found"


def test_update_nonexistent_task():
    response = client.patch(
        "/api/v1/tasks/999999",
        json={"status": "DONE"}
    )
    assert response.status_code == 404


def test_delete_nonexistent_task():
    response = client.delete("/api/v1/tasks/999999")
    assert response.status_code == 404




def test_cannot_delete_task_with_dependents():
    parent = client.post(
        "/api/v1/tasks",
        json={"title": "Parent Task"}
    )
    assert parent.status_code == 201
    parent_id = parent.json()["id"]

    child = client.post(
        "/api/v1/tasks",
        json={
            "title": "Dependent Task",
            "blocked_by_id": parent_id
        }
    )
    assert child.status_code == 201

    response = client.delete(f"/api/v1/tasks/{parent_id}")

    assert response.status_code == 409
    assert "depends on it" in response.json()["detail"]


def test_can_delete_task_without_dependents():
    task = client.post(
        "/api/v1/tasks",
        json={"title": "Independent Task"}
    )
    assert task.status_code == 201

    task_id = task.json()["id"]

    response = client.delete(f"/api/v1/tasks/{task_id}")

    assert response.status_code == 204

    check = client.get("/api/v1/tasks")
    assert all(t["id"] != task_id for t in check.json())

