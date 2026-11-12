
import os
from neo4j import GraphDatabase

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password123")


class Neo4jClient:
    def __init__(self):
        self.driver = None

    def connect(self):
        if not self.driver:
            self.driver = GraphDatabase.driver(
                NEO4J_URI,
                auth=(NEO4J_USER, NEO4J_PASSWORD)
            )

    def sync_task_dependency(
        self,
        task_id: int,
        title: str,
        assignee: str,
        blocked_by_id: int | None,
        task_status: str = "TODO"
    ):
        try:
            self.connect()

            with self.driver.session() as session:
                session.run(
                    """
                    MERGE (t:Task {id: $task_id})
                    SET t.title = $title,
                        t.assignee = $assignee,
                        t.status = $task_status
                    """,
                    task_id=task_id,
                    title=title,
                    assignee=assignee,
                    task_status=task_status
                )

                # Remove any previous blocker relationship
                session.run(
                    """
                    MATCH (blocker:Task)-[r:BLOCKS]->(blocked:Task {id: $task_id})
                    DELETE r
                    """,
                    task_id=task_id
                )

                # Create the current blocker relationship
                if blocked_by_id is not None:
                    session.run(
                        """
                        MATCH (blocker:Task {id: $blocked_by_id})
                        MATCH (blocked:Task {id: $task_id})
                        MERGE (blocker)-[:BLOCKS]->(blocked)
                        """,
                        blocked_by_id=blocked_by_id,
                        task_id=task_id
                    )

        except Exception as e:
            print(f"Neo4j sync warning (non-blocking): {e}")

    def sync_task_update(
        self,
        task_id: int,
        title: str,
        assignee: str,
        task_status: str,
        blocked_by_id: int | None
    ):
        self.sync_task_dependency(
            task_id,
            title,
            assignee,
            blocked_by_id,
            task_status
        )

    def delete_task(self, task_id: int):
        try:
            self.connect()

            with self.driver.session() as session:
                session.run(
                    """
                    MATCH (t:Task {id: $task_id})
                    DETACH DELETE t
                    """,
                    task_id=task_id
                )

        except Exception as e:
            print(f"Neo4j deletion warning (non-blocking): {e}")

    def get_recommended_assignee(self) -> str:
        try:
            self.connect()

            with self.driver.session() as session:
                result = session.run(
                    """
                    MATCH (t:Task)
                    WHERE t.assignee IS NOT NULL
                      AND t.assignee <> ''
                      AND coalesce(t.status, 'TODO') <> 'DONE'
                    RETURN t.assignee AS assignee,
                           count(t) AS task_count
                    ORDER BY task_count ASC, assignee ASC
                    LIMIT 1
                    """
                )

                record = result.single()
                return record["assignee"] if record else "Vishal"

        except Exception as e:
            print(f"Neo4j recommendation warning: {e}")
            return "Vishal"


neo4j_client = Neo4jClient()
