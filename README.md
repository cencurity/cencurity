![Cencurity](./assets/banner.png?v=20260217-1)

# Cencurity


## Run

1) Create `.env` from `.env.example` and set `CENCURITY_IMAGE` to your published image.

2) From this folder:

```bash
docker compose up -d
```

Data is persisted under `data/`.

## Tenant

- On first start, a default tenant is auto-created: `customer`
- A bootstrap API key is generated and written to:
  - `data/bootstrap_tenant_customer_api_key.txt`
- Open the Dashboard and paste that API key when prompted.
