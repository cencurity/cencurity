![Cencurity](./assets/banner.png?v=20260217-012245)

# Cencurity

Policy-driven security proxy for LLM apps — inspect and block risky code in real time.

- Dashboard: http://localhost:18080
- Proxy: http://localhost:18082

## What’s included

- [x] Deploy-only Docker Compose package (no source code required)
- [x] Nginx gateway in front of the app
- [x] Single-tenant default (`customer`) for localhost
- [x] Persistent data volume under `data/`
- [x] No admin UI exposed

## Preview

Add your screenshot at `assets/preview.png`, then it will show here:

![Preview](./assets/preview.png)

## Quickstart

1) Create `.env` from `.env.example` and set `CENCURITY_IMAGE` to your published image.

2) Start:

```bash
docker compose up -d
```

## Tenant & API key

- On first start, a default tenant is auto-created: `customer`
- A bootstrap API key is generated and written to: `data/bootstrap_tenant_customer_api_key.txt`
- Open the Dashboard and paste that API key when prompted

## Data

Data is persisted under `data/`.

## Docs

- Security reporting: see `SECURITY.md`
- Contributing: see `CONTRIBUTING.md`
- Community rules: see `CODE_OF_CONDUCT.md`
