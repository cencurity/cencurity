# Cencurity

Real-time security for AI-generated code inside VS Code.

![Dashboard](https://raw.githubusercontent.com/cencurity/cencurity/main/assets/screenshot-dashboard.jpg)

## The problem

AI coding tools generate code instantly.

But security checks happen too late — during review or after execution.

This creates a blind spot where insecure code can slip through unnoticed.

---

## What Cencurity does

Cencurity sits between your IDE and the model.

It inspects generated code in real-time and blocks unsafe patterns before they reach your system.

---

## What it does

- Opens the Cencurity Security Center inside VS Code.
- Routes supported LLM traffic through a local protection proxy.
- Keeps your existing provider API key where it already lives.
- Verifies routing automatically when protection is enabled.
- Shows live audit activity for real protected requests.

## Quickstart

1. Install the extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=cencurity-labs.cencurity).
2. Open Command Palette `Ctrl+Shift+P` or `Command+Shift+P` (macOS) and run `Cencurity: Enable Protection`.
3. Select your LLM provider.
4. Open Command Palette again and run `Cencurity: Open Security Center`.

That's it — protection is now active.

---

## Features

### Real-time Log Analysis
![Log Analysis](https://raw.githubusercontent.com/cencurity/cencurity/main/assets/screenshot-log-analysis.gif)

- Inspect generated code as it flows through the system
- See exactly what was detected and why

---

### Dry Run Mode
![Dry Run](https://raw.githubusercontent.com/cencurity/cencurity/main/assets/screenshot-dry-run.gif)

- Simulate execution without risk
- Understand behavior before anything runs

---

### Zero-click Attack Detection
![Zero Click](https://raw.githubusercontent.com/cencurity/cencurity/main/assets/screenshot-zero-click.gif)

- Detect dangerous patterns instantly
- Block risky operations like `subprocess`, shell execution, and similar unsafe flows

## Command Palette

Search for `cencurity` in the VS Code Command Palette to access the main actions:

- `Cencurity: Open Security Center` — open the Security Center dashboard inside VS Code
- `Cencurity: Enable Protection` — turn protection on and select your LLM provider
- `Cencurity: Disable Protection` — turn protection off and restore previous supported routing settings
- `Cencurity: Test Protection` — verify that requests are reaching the local proxy
- `Cencurity: Show Runtime Info` — inspect the local runtime and protection state
- `Cencurity: Install or Update Core` — install or refresh the local core runtime

## Supported providers

- OpenAI
- Anthropic
- Gemini
- OpenRouter
- Other OpenAI-compatible LLMs

## How it works

IDE → Cencurity Proxy → LLM Provider

- Your API key stays in your IDE.
- Requests are routed through a local proxy.
- Code is analyzed in real-time before execution.

## What is CAST?

CAST (Code-Aware Security Transformation) protects a moment that existing tools don't cover.

| Model | When it runs | Main job | Typical result |
|-------|-------------|----------|----------------|
| **CAST** | while the model is still writing code | stop unsafe output before it reaches the developer | `allow`, `redact`, `block` |
| SAST | after code already exists | scan code for vulnerabilities | findings after generation |
| DAST | against a running app | test runtime behavior | runtime issues after deployment or staging |
| IAST | inside an instrumented app | watch real execution paths | internal runtime findings |

The point is not that CAST replaces SAST.
The point is that CAST protects a different moment: **while code is being generated.**

Cencurity is the first tool built on CAST.

## Notes

- Routing applies to supported env-based routing paths.
- Some extensions may bypass VS Code environment settings and not route through the proxy.
- Public source exposure is intentionally minimized; older private runtime and embedded UI trees are not included here.
