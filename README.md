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

## Demos (Videos)

GitHub README typically does not render inline video players.
Use the links below (they open a playable `raw` URL in the browser):

- Log analysis: https://github.com/cencurity/cencurity/raw/main/assets/%EB%A1%9C%EA%B7%B8%EB%B6%84%EC%84%9D.mp4
- Dry run: https://github.com/cencurity/cencurity/raw/main/assets/%EB%93%9C%EB%9D%BC%EC%9D%B4%EB%9F%B0.mp4
- Zero-click defense: https://github.com/cencurity/cencurity/raw/main/assets/%EC%A0%9C%EB%A1%9C%ED%81%B4%EB%A6%AD.mp4

Tip: If you add thumbnails (PNG) next to each video, we can render them as big clickable previews.

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
