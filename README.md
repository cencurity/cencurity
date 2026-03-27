# Cencurity

AI code security for VS Code. Inspect, redact, and block unsafe AI-generated code in real time before it reaches the developer.

![Cencurity dashboard](./assets/screenshot-dashboard.jpg)

## VS Code Extension (Recommended)

Cencurity is now primarily a VS Code extension product.

- Main extension source: `./vscode-extension`
- Primary experience: enable protection, select a provider, and monitor activity inside Security Center
- Current focus: real-time protection for AI-generated code inside the IDE

## Quickstart

1. Open the VS Code extension project in `./vscode-extension`.
2. Install the packaged VSIX from `./vscode-extension/cencurity.vsix`, or package a fresh one from that folder with `npm run package:vsix`.
3. Open the Command Palette and run `Cencurity: Enable Protection`.
4. Select your LLM provider.
5. Run `Cencurity: Open Security Center`.

Protection is now active.

## Features

### Real-time Log Analysis

![Real-time log analysis](./assets/screenshot-log-analysis.gif)

- Inspect AI-generated code as it flows through the proxy
- Review detections, policies, actions, and request history in one place

### Dry Run

![Dry run](./assets/screenshot-dry-run.gif)

- Simulate behavior without executing risky output
- Understand what would be blocked before applying changes

### Zero-click Attack Detection

![Zero-click detection](./assets/screenshot-zero-click.gif)

- Catch unsafe patterns while code is still being generated
- Block dangerous output such as shell execution and sensitive operations

## Commands

- `Cencurity: Enable Protection` — turn on protection and configure the active provider
- `Cencurity: Disable Protection` — turn off protection and restore supported routing settings
- `Cencurity: Test Protection` — verify that traffic is reaching the local proxy
- `Cencurity: Open Security Center` — open the dashboard inside VS Code

## Limitations

- Routing applies to supported environment-based provider paths
- Some extensions may bypass VS Code environment settings and not route through the proxy
- The public repository does not include older private runtime or embedded UI source trees

## Legacy

The previous Docker-based community snapshot is preserved in `./legacy` with a minimal public layout (`docker-compose.yml`, `nginx.conf`, `.env.example`, and `data/`).
