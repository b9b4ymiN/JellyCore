import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.append(str(Path(__file__).resolve().parents[1]))
import main


client = TestClient(main.app)


def test_health_endpoint():
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert isinstance(data["pythainlp_version"], str)
    assert data["uptime_seconds"] >= 0


def test_tokenize_returns_tokens_and_segmented():
    resp = client.post("/tokenize", json={"text": "อยากกินข้าวผัดกุ้ง"})
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data["tokens"], list)
    assert len(data["tokens"]) >= 1
    assert isinstance(data["segmented"], str)
    assert data["engine"] in {"newmm", "longest", "icu", "fallback"}


def test_tokenize_graceful_fallback(monkeypatch):
    def broken_tokenizer():
        raise RuntimeError("boom")

    monkeypatch.setattr(main, "get_tokenize", broken_tokenizer)

    resp = client.post("/tokenize", json={"text": "ทดสอบระบบ"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["engine"] == "fallback"
    assert isinstance(data["tokens"], list)


def test_chunk_returns_consistent_count():
    text = "ประโยคที่หนึ่ง ประโยคที่สอง ประโยคที่สาม"
    resp = client.post("/chunk", json={"text": text, "max_tokens": 50, "overlap": 10})
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == len(data["chunks"])
    assert data["count"] >= 1


def test_stopwords_filters_expected_tokens():
    resp = client.post("/stopwords", json={"tokens": ["ฉัน", "และ", "คุณ"]})
    assert resp.status_code == 200
    data = resp.json()
    assert "และ" in data["removed"]
    assert "ฉัน" in data["filtered"] or "ฉัน" in data["removed"]
