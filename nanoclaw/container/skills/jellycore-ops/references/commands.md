# JellyCore Command Reference

## Compose Files

- Development:
```bash
docker compose up -d --build
```

- Production:
```bash
docker compose -f docker-compose.production.yml up -d --build
```

## Service Diagnostics

```bash
docker compose ps
docker compose top
docker compose logs --tail=200 <service>
docker stats --no-stream
```

## Controlled Recovery

```bash
docker compose restart <service>
docker compose up -d --force-recreate <service>
```

## Oracle Checks

```bash
curl -fsS http://localhost:47778/api/health
curl -fsS "http://localhost:47778/api/stats"
```

## NanoClaw Checks

```bash
curl -fsS http://localhost:47779/health
curl -fsS http://localhost:47779/status
```
