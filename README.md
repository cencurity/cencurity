![Cencurity](./assets/banner.png?v=20260217-012245)

# Cencurity

Policy-driven security proxy for LLM apps.
Inspect, log, and block risky code in real time.

- Dashboard: http://localhost:18080
- Proxy: http://localhost:18082

## Features

- Policy-based allow / block decisions for code and tool outputs
- Real-time proxy for LLM app traffic
- Audit logs for investigations and traceability
- Dashboard to review events and manage policies
- API key authentication for access control

## Preview

<details>
	<summary>Add a product screenshot (optional)</summary>

	Put your screenshot at <code>assets/preview.png</code> and it will render here:

	<img src="./assets/preview.png" alt="Preview" width="100%" />
</details>

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
