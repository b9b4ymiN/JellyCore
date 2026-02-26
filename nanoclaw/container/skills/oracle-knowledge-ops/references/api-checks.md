# Oracle API Checklists

## Health

```bash
curl -fsS http://localhost:47778/api/health
```

Expect JSON with `status: ok`.

## Search

```bash
curl -fsS "http://localhost:47778/api/search?q=memory&limit=10"
```

Check:
- non-empty result set for known terms
- reasonable latency
- correct `type` and `source_file` fields

## Learn Path

```bash
curl -fsS -X POST http://localhost:47778/api/learn \
  -H "Content-Type: application/json" \
  -d "{\"pattern\":\"test pattern\",\"source\":\"ops-check\"}"
```

Check:
- success response
- new searchable content appears after indexing flow

## Admin Proxy (when enabled)

```bash
curl -fsS http://localhost:47778/api/nanoclaw/health
curl -fsS http://localhost:47778/api/nanoclaw/status
```

If unauthorized, include proper bearer token.
