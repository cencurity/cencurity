![Cencurity](./assets/banner.png?v=20260217-012245)

# Cencurity

Cencurity is a security proxy that integrates with any IDE and LLM.
It inspects, logs, and blocks risky code in real time.

## Features

- Policy-based allow / block decisions for code and tool outputs
- Custom policies (extend and tailor rules to your environment)
- Dry-run mode (simulate enforcement without blocking)
- Zero-click defense for high-risk patterns
- Real-time proxy for LLM app traffic
- Audit logs for investigations and traceability
- Audit log download/export for reviews and reporting
- Dashboard to review events and manage policies
- API key authentication for access control

## Video

Add your demo video as `assets/demo.mp4`.

<video src="./assets/demo.mp4" controls width="100%"></video>

If your browser/GitHub view doesn’t render the video tag, use this direct link instead: [assets/demo.mp4](assets/demo.mp4)

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
