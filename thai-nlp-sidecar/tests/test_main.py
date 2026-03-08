import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.append(str(Path(__file__).resolve().parents[1]))
import main


client = TestClient(main.app)


def test_health_endpoint():
    resp = client.get('/health')
    assert resp.status_code == 200
    data = resp.json()
    assert data['status'] == 'ok'
    assert isinstance(data['pythainlp_version'], str)
    assert data['uptime_seconds'] >= 0


def test_tokenize_returns_tokens_and_segmented():
    resp = client.post('/tokenize', json={'text': 'อยากกินข้าวผัดกุ้ง'})
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data['tokens'], list)
    assert len(data['tokens']) >= 1
    assert isinstance(data['segmented'], str)
    assert data['engine'] in {'newmm', 'longest', 'icu', 'fallback'}


def test_tokenize_graceful_fallback(monkeypatch):
    def broken_tokenizer():
        raise RuntimeError('boom')

    monkeypatch.setattr(main, 'get_tokenize', broken_tokenizer)

    resp = client.post('/tokenize', json={'text': 'ทดสอบระบบ'})
    assert resp.status_code == 200
    data = resp.json()
    assert data['engine'] == 'fallback'
    assert isinstance(data['tokens'], list)


def test_chunk_returns_consistent_count():
    text = 'ประโยคที่หนึ่ง ประโยคที่สอง ประโยคที่สาม'
    resp = client.post('/chunk', json={'text': text, 'max_tokens': 50, 'overlap': 10})
    assert resp.status_code == 200
    data = resp.json()
    assert data['count'] == len(data['chunks'])
    assert data['count'] >= 1


def test_stopwords_filters_expected_tokens():
    resp = client.post('/stopwords', json={'tokens': ['ฉัน', 'และ', 'คุณ']})
    assert resp.status_code == 200
    data = resp.json()
    assert 'และ' in data['removed']
    assert 'ฉัน' in data['filtered'] or 'ฉัน' in data['removed']


def test_tokenize_handles_thai_tone_marks_and_spacing():
    text = 'ไม่ได้ไปนะจ๊ะ แต่คิดถึงมากๆ'
    resp = client.post('/tokenize', json={'text': text})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data['tokens']) >= 3
    assert 'ไม่' in data['segmented']
    assert 'ได้' in data['segmented']


def test_tokenize_handles_mixed_emoji_and_thai_compound():
    text = 'อยากกินข้าวผัดกุ้ง🍤กับเพื่อน555'
    resp = client.post('/tokenize', json={'text': text})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data['tokens']) >= 2
    assert '🍤' in data['segmented']


def test_normalize_handles_zero_width_and_repeated_marks():
    text = 'ก\u200bา\u0e49\u0e49\u0e49แฟ   อร่อย'
    resp = client.post('/normalize', json={'text': text})
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data['normalized'], str)
    assert isinstance(data['changed'], bool)


def test_normalize_graceful_fallback(monkeypatch):
    def broken_normalize():
        raise RuntimeError('boom')

    monkeypatch.setattr(main, 'get_normalize', broken_normalize)
    resp = client.post('/normalize', json={'text': 'ทดสอบ normalize'})
    assert resp.status_code == 200
    data = resp.json()
    assert data['normalized'] == 'ทดสอบ normalize'
    assert data['changed'] is False


def test_spellcheck_endpoint_returns_payload():
    resp = client.post('/spellcheck', json={'text': 'ฉันกินข้าวอร่อย'})
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data['corrected'], str)
    assert isinstance(data['changed'], bool)


def test_spellcheck_graceful_fallback(monkeypatch):
    def broken_correct(_text: str):
        raise RuntimeError('boom')

    monkeypatch.setattr(main, 'get_correct', lambda: broken_correct)
    resp = client.post('/spellcheck', json={'text': 'ทดสอบสะกดคำ'})
    assert resp.status_code == 200
    data = resp.json()
    assert data['corrected'] == 'ทดสอบสะกดคำ'
    assert data['changed'] is False


def test_chunk_handles_long_thai_text_over_1000_chars():
    sentence = 'วันนี้อากาศดีมากและอยากออกไปเดินเล่นที่สวนสาธารณะพร้อมเพื่อนๆ. '
    text = sentence * 30
    assert len(text) > 1000

    resp = client.post('/chunk', json={'text': text, 'max_tokens': 80, 'overlap': 20})
    assert resp.status_code == 200
    data = resp.json()
    assert data['count'] == len(data['chunks'])
    assert data['count'] >= 1
    assert all(chunk.strip() for chunk in data['chunks'])


def test_chunk_handles_empty_sentence_list(monkeypatch):
    monkeypatch.setattr(main, 'get_sent_tokenize', lambda: (lambda _text: []))
    text = 'ข้อความยาวที่อยากลองแบ่ง'
    resp = client.post('/chunk', json={'text': text, 'max_tokens': 80, 'overlap': 20})
    assert resp.status_code == 200
    data = resp.json()
    assert data['count'] == 1
    assert data['chunks'][0] == text


def test_chunk_graceful_fallback(monkeypatch):
    def broken_sent_tokenize():
        raise RuntimeError('boom')

    monkeypatch.setattr(main, 'get_sent_tokenize', broken_sent_tokenize)
    text = 'ทดสอบ fallback chunk'
    resp = client.post('/chunk', json={'text': text, 'max_tokens': 80, 'overlap': 20})
    assert resp.status_code == 200
    data = resp.json()
    assert data['count'] == 1
    assert data['chunks'][0] == text


def test_stopwords_graceful_fallback(monkeypatch):
    def broken_stopwords():
        raise RuntimeError('boom')

    monkeypatch.setattr(main, 'get_stopwords', broken_stopwords)
    resp = client.post('/stopwords', json={'tokens': ['ฉัน', 'และ', 'คุณ']})
    assert resp.status_code == 200
    data = resp.json()
    assert data['filtered'] == ['ฉัน', 'และ', 'คุณ']
    assert data['removed'] == []


def test_tokenize_latency_is_reasonable_for_long_input():
    text = ('สวัสดีโลก ' * 300).strip()
    t0 = time.perf_counter()
    resp = client.post('/tokenize', json={'text': text})
    wall_ms = (time.perf_counter() - t0) * 1000

    assert resp.status_code == 200
    data = resp.json()
    assert data['elapsed_ms'] < 2000
    assert wall_ms < 3000
