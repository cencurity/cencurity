# Cencurity Community (Public Deploy)

Cencurity is a security gateway that **proxies LLM/agent traffic** and **detects / masks / blocks** sensitive data and risky code patterns in requests and responses, while recording everything as **Audit Logs**.

## Screenshots

### 1) Dashboard

![Dashboard](assets/screenshot-dashboard.png)

High-level security status and recent activity at a glance.

### 2) Log Analysis

![Log Analysis](assets/screenshot-log-analysis.png)

Explore audit logs (policy, severity, direction, client IP) and drill down into findings.

### 3) Dry Run

![Dry Run](assets/screenshot-dry-run.png)

Simulate a policy against an input safely, and review historical match counts/samples.

## What Cencurity Does

- AI API Proxy: Proxies OpenAI/Anthropic/Gemini-compatible endpoints.
- Policy-based masking: Applies Regex policies to replace sensitive data with `[MASKED]` (or a custom mask text) and records per-policy severity.
- Zero-click / Code-analysis blocking:
  - For inbound `tools/call` payloads, extracts arguments/code that could actually be executed.
  - Immediately blocks dangerous keywords like `os.system`, `subprocess`, `eval`, `exec`.
  - Can detect and block risky patterns using static analysis (SAST) rules.
- Streaming response protection: Even during SSE streaming, it can safely accumulate fenced code blocks (``` … ```) for scanning/blocking.
- Audit log storage & query: Stores policy match events (mask/block) in the DB and exposes recent logs via API.
- Real-time events (SSE): Broadcasts audit-log events in real time so the dashboard can update instantly.
- Dry Run:
  - Shows historical match counts and samples for a policy over the last N hours.
  - Simulates “would this be masked/blocked?” without writing audit_logs.
- Webhook alerts: Sends Slack/Discord/Telegram/Jandi/Custom webhook alerts based on severity/events.

## Run

### 1) Clone

```bash
git clone https://github.com/cencurity/cencurity.git
cd cencurity
```

### 2) Configure

Copy `.env.example` to `.env`, then set `CENCURITY_IMAGE` to an image you have already built and published (Docker Hub / GHCR).

### 3) Deploy (Docker)

```bash
docker compose up -d
```

Data is persisted under `data/`.

### 4) URLs

- Dashboard: http://localhost:18080
- Proxy: http://localhost:18082

## Tenant (first run)

- On first start, a default tenant is auto-created: `customer`
- A bootstrap API key is generated and written to:
  - `data/bootstrap_tenant_customer_api_key.txt`
- Open the Dashboard and paste that API key when prompted.

## Dashboard Login (how it works)

The dashboard prompts for an API key on first access.

- Paste the key from `data/bootstrap_tenant_customer_api_key.txt` into the login modal.
- The UI validates the key by calling `GET /api/config` with both headers:
  - `Authorization: Bearer <YOUR_TENANT_API_KEY>`
  - `X-API-Key: <YOUR_TENANT_API_KEY>`
- On success, the key is stored in `localStorage` as `apiKey`, and subsequent dashboard requests attach it automatically.

## Using the Proxy

The proxy listens on http://localhost:18082 and exposes provider-compatible endpoints:

- OpenAI-compatible: `POST /v1/chat/completions` and `GET /v1/models`
- Anthropic-compatible: `POST /v1/messages`
- Gemini-compatible: `POST /v1beta/models/...`

### Authentication behavior (local community deploy)

By default, the proxy expects your **upstream LLM provider key** on the request (for example, an OpenAI API key). The single-tenant gateway injects the tenant context automatically.

### Example: OpenAI-compatible request

Use a model name that your upstream provider actually supports.

```bash
curl http://localhost:18082/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "YOUR_MODEL",
    "messages": [{"role":"user","content":"Hello"}]
  }'
```

### Where to put the proxy URL in your client

If your IDE/agent tool supports a custom OpenAI-compatible base URL:

- Set the **Base URL** to `http://localhost:18082`
- Set the **API Key** to your upstream provider key (example: your OpenAI API key)

### Example: Anthropic-compatible request

```bash
curl http://localhost:18082/v1/messages \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "YOUR_MODEL",
    "max_tokens": 256,
    "messages": [{"role":"user","content":"Hello"}]
  }'
```

## Notes

- This public deploy runs in `CENCURITY_MODE=customer`, and the admin server/UI is not started or exposed.
