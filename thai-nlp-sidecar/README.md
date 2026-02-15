# Thai NLP Sidecar

PyThaiNLP wrapper service for JellyCore Oracle V2.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check + PyThaiNLP version |
| POST | `/tokenize` | Word segmentation (newmm engine) |
| POST | `/normalize` | Thai text normalization |
| POST | `/spellcheck` | Spell correction |
| POST | `/chunk` | Sentence-aware document chunking |
| POST | `/stopwords` | Stop word filtering |

## Run locally

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## Docker

```bash
docker build -t thai-nlp-sidecar .
docker run -p 47780:8000 thai-nlp-sidecar
```

## Test

```bash
curl http://localhost:47780/health
curl -X POST http://localhost:47780/tokenize \
  -H 'Content-Type: application/json' \
  -d '{"text": "อยากกินข้าวผัดกุ้ง"}'
```

## Design principles

- **Graceful degradation** — every endpoint returns input unchanged on error
- **Lazy loading** — heavy PyThaiNLP modules loaded on first request
- **Single worker** — PyThaiNLP newmm is thread-safe, 1 uvicorn worker sufficient
- **Stateless** — no database, no persistence needed
