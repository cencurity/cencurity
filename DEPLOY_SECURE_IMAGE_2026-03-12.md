# Secure image release handoff (2026-03-12)

Validated local image:

- `cencurity-community:latest`
- `cencurity-community:2026-03-12-secfix`

Optional helper:

- `./publish_secure_image.ps1 -Registry ghcr -Owner <owner> -Login`
- `./publish_secure_image.ps1 -Registry dockerhub -Owner <dockerhub_user> -Login`

What was verified locally:

- No embedded `*.db`, `*.sqlite*`, or `bootstrap_tenant_*` files in the image
- Community stack starts successfully from `cencurity/docker-compose.yml`
- Dashboard responds on `http://127.0.0.1:18080/`
- Proxy health responds on `http://127.0.0.1:18082/health`
- Unauthenticated `http://127.0.0.1:18082/v1/models` returns `401`
- Public `http://127.0.0.1:18080/index.admin.html` returns `404`

## 1) Tag for your registry

Docker Hub example:

```powershell
docker tag cencurity-community:2026-03-12-secfix <dockerhub_user>/cencurity-community:2026-03-12-secfix
```

GHCR example:

```powershell
docker tag cencurity-community:2026-03-12-secfix ghcr.io/<owner>/cencurity-community:2026-03-12-secfix
```

## 2) Push

Docker Hub example:

```powershell
docker login
docker push <dockerhub_user>/cencurity-community:2026-03-12-secfix
```

GHCR example:

```powershell
docker login ghcr.io
docker push ghcr.io/<owner>/cencurity-community:2026-03-12-secfix
```

## 3) Update deploy-only `.env`

Set `CENCURITY_IMAGE` in `cencurity/.env`:

```dotenv
CENCURITY_IMAGE=ghcr.io/<owner>/cencurity-community:2026-03-12-secfix
CENCURITY_PULL_POLICY=always
```

or

```dotenv
CENCURITY_IMAGE=<dockerhub_user>/cencurity-community:2026-03-12-secfix
CENCURITY_PULL_POLICY=always
```

## 4) Redeploy

```powershell
docker compose -f cencurity/docker-compose.yml pull
docker compose -f cencurity/docker-compose.yml up -d --force-recreate
```

## 5) Quick checks

```powershell
Invoke-WebRequest http://127.0.0.1:18080/ -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:18082/health -UseBasicParsing
```
