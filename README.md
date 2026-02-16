# Cencurity Community (Public Deploy)

Cencurity is a security gateway that **proxies LLM/agent traffic** and **detects / masks / blocks** sensitive data and risky code patterns in requests and responses, while recording everything as **Audit Logs**.

- Dashboard: http://localhost:18080
- Proxy: http://localhost:18082

## What Cencurity Does (based on the code)

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

1) Copy `.env.example` to `.env`, then set `CENCURITY_IMAGE` to an image you have already built and published.

2) From this folder:

```bash
docker compose up -d
```

Data is persisted under `data/`.

## Tenant (first run)

- On first start, a default tenant is auto-created: `customer`
- A bootstrap API key is generated and written to:
  - `data/bootstrap_tenant_customer_api_key.txt`
- Open the Dashboard and paste that API key when prompted.
