import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "engine" in data

def test_generate_song_validation():
    # Missing topic
    response = client.post("/generate-song", json={"topic": "a"})
    assert response.status_code == 422

    # Invalid duration
    response = client.post("/generate-song", json={"topic": "Valid topic", "duration": 10})
    assert response.status_code == 422

def test_separate_unsupported_file():
    files = {"file": ("test.txt", b"not audio data", "text/plain")}
    response = client.post("/separate", files=files)
    assert response.status_code == 400
