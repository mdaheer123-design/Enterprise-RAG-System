"""
Tests for API endpoints.
"""

import uuid
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.database import close_db

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest_asyncio.fixture(loop_scope="session", scope="session")
async def client():
    """Create async test client."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    await close_db()


async def test_health_check(client):
    """Test the health endpoint."""
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"


async def test_root(client):
    """Test the root endpoint."""
    response = await client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "Enterprise AI Knowledge Assistant" in data["name"]


async def test_list_documents_empty(client):
    """Test listing documents when none exist."""
    response = await client.get("/api/documents/")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 0


async def test_list_collections_empty(client):
    """Test listing collections when none exist."""
    response = await client.get("/api/collections/")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


async def test_list_chats_empty(client):
    """Test listing chats when none exist."""
    response = await client.get("/api/chat/")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 0


async def test_create_collection(client):
    """Test creating a collection."""
    unique_name = f"Test Collection {uuid.uuid4().hex[:8]}"
    response = await client.post("/api/collections/", json={
        "name": unique_name,
        "description": "Test description",
        "color": "#6366F1",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == unique_name
    assert "id" in data
    # Clean up
    await client.delete(f"/api/collections/{data['id']}")


async def test_create_chat(client):
    """Test creating a chat session."""
    response = await client.post("/api/chat/", json={
        "title": "Test Chat",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Test Chat"
    assert "id" in data


async def test_get_nonexistent_document(client):
    """Test getting a non-existent document returns 404."""
    response = await client.get("/api/documents/nonexistent-id")
    assert response.status_code == 404


async def test_analytics_overview(client):
    """Test analytics overview endpoint."""
    response = await client.get("/api/analytics/overview")
    assert response.status_code == 200
    data = response.json()
    assert "total_documents" in data
    assert "total_collections" in data


async def test_search_empty(client):
    """Test search with no documents."""
    response = await client.post("/api/search/", json={
        "query": "test query",
        "top_k": 5,
    })
    assert response.status_code == 200
    data = response.json()
    assert "results" in data


async def test_list_comparisons(client):
    """Test listing comparisons."""
    response = await client.get("/api/compare/")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


async def test_update_and_delete_collection(client):
    """Test updating and deleting a collection."""
    # Create
    create_res = await client.post("/api/collections/", json={
        "name": "Temp Collection",
        "description": "Temp description",
        "color": "#10B981",
    })
    assert create_res.status_code == 200
    col_id = create_res.json()["id"]

    # Update
    update_res = await client.put(f"/api/collections/{col_id}", json={
        "name": "Updated Collection",
        "description": "Updated description",
    })
    assert update_res.status_code == 200
    assert update_res.json()["name"] == "Updated Collection"

    # Delete
    del_res = await client.delete(f"/api/collections/{col_id}")
    assert del_res.status_code == 200

    # Verify 404
    get_res = await client.get(f"/api/collections/{col_id}")
    assert get_res.status_code == 404
