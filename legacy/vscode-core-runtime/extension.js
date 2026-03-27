const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');

const PANEL_TYPE = 'cencurity.securityCenter';
const DEV_CONFIG_KEY = 'cencurity.devConfig';

let securityPanel;

const DEFAULT_CONFIG = {
  alertLevel: 'OFF',
  webhooks: {
    slack: '',
    telegram: '',
    discord: '',
    jandi: '',
    custom: ''
  }
};

const DEFAULT_POLICIES = [
  { id: 999, name: 'Cencurity Code Analysis', severity: 'CRITICAL', action: 'block' },
  { id: 27, name: 'Universal API Key Detection', severity: 'CRITICAL', action: 'mask' },
  { id: 25, name: 'Email Masking', severity: 'INFO', action: 'mask' },
  { id: 26, name: 'Phone Number Masking', severity: 'INFO', action: 'mask' },
  { id: 73, name: 'Sensitive Data Detection', severity: 'WARNING', action: 'mask' }
];

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('cencurity.bootstrapSession', async () => {
      await openSecurityCenter(context);
    }),
    vscode.commands.registerCommand('cencurity.openSecurityCenter', async () => {
      await openSecurityCenter(context);
    }),
    vscode.commands.registerCommand('cencurity.startLocalStack', async () => {
      await startLocalStack();
    }),
    vscode.commands.registerCommand('cencurity.openBrowserDashboard', async () => {
      await openBrowserDashboard();
    }),
    vscode.commands.registerCommand('cencurity.copyProxyBaseUrl', async () => {
      const proxyBaseUrl = getProxyBaseUrl();
      await vscode.env.clipboard.writeText(proxyBaseUrl);
      vscode.window.showInformationMessage(`Cencurity proxy URL copied: ${proxyBaseUrl}`);
    })
  );
}

function deactivate() {}

function getWorkspaceRoot() {
  return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
    ? vscode.workspace.workspaceFolders[0].uri.fsPath
    : undefined;
}

function getExtensionConfig() {
  return vscode.workspace.getConfiguration('cencurity');
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function getDashboardBaseUrl() {
  return trimTrailingSlash(getExtensionConfig().get('dashboardBaseUrl', 'http://localhost:18080'));
}

function getProxyBaseUrl() {
  return trimTrailingSlash(getExtensionConfig().get('proxyBaseUrl', 'http://localhost:18082'));
}

function getFixturePaths() {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    return [];
  }

  return [
    path.join(workspaceRoot, 'audit_after_stream.json'),
    path.join(workspaceRoot, 'audit_after_real_block.json'),
    path.join(workspaceRoot, 'audit.json'),
    path.join(workspaceRoot, 'audit_logs_after_mock.json')
  ];
}

async function readJsonFile(filePath, fallbackValue) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

async function getPersistedDevConfig(context) {
  const stored = context.globalState.get(DEV_CONFIG_KEY);
  if (!stored || typeof stored !== 'object') {
    return { ...DEFAULT_CONFIG };
  }

  return {
    alertLevel: stored.alertLevel || DEFAULT_CONFIG.alertLevel,
    webhooks: {
      ...DEFAULT_CONFIG.webhooks,
      ...(stored.webhooks || {})
    }
  };
}

async function savePersistedDevConfig(context, payload) {
  const nextValue = {
    alertLevel: payload.alertLevel || DEFAULT_CONFIG.alertLevel,
    webhooks: {
      ...DEFAULT_CONFIG.webhooks,
      ...(payload.webhooks || {})
    }
  };

  await context.globalState.update(DEV_CONFIG_KEY, nextValue);
  return nextValue;
}

async function loadFixtureLogs() {
  for (const fixturePath of getFixturePaths()) {
    const payload = await readJsonFile(fixturePath, undefined);
    if (Array.isArray(payload) && payload.length > 0) {
      return payload;
    }
  }

  return [];
}

async function tryLocalApi(endpoint, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }

  const url = endpoint.startsWith('http') ? endpoint : `${getDashboardBaseUrl()}${endpoint}`;
  try {
    const response = await fetch(url, {
      ...init,
      headers
    });

    if (!response.ok) {
      return { ok: false, status: response.status, response };
    }

    return { ok: true, status: response.status, response };
  } catch (error) {
    return { ok: false, status: 0, error };
  }
}

async function safeReadJson(response, fallbackValue) {
  try {
    return await response.json();
  } catch {
    return fallbackValue;
  }
}

async function safeReadText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function maskDetected(input) {
  const text = String(input || '');
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[MASKED_EMAIL]')
    .replace(/\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{4}\b/g, '[MASKED_PHONE]')
    .replace(/\b(?:sk|rk|pk)_[A-Za-z0-9_-]{8,}\b/g, '[MASKED_API_KEY]');
}

function simulateDryRun(payload) {
  const input = String(payload && payload.input ? payload.input : '');
  const lowered = input.toLowerCase();
  const hasDangerousCode = ['subprocess', 'os.system', 'eval(', 'exec(', 'shell=true'].some((keyword) => lowered.includes(keyword));
  const masked = maskDetected(input);

  if (hasDangerousCode) {
    return {
      action: 'block',
      severity: 'CRITICAL',
      policy_name: 'Cencurity Code Analysis',
      matched_text: 'Dangerous local dev pattern',
      input,
      masked_output: '[BLOCKED IN LOCAL DEV SESSION]',
      finding: {
        source: 'local-dev',
        reason: 'Matched dangerous code keyword during local simulation.'
      }
    };
  }

  if (masked !== input) {
    return {
      action: 'mask',
      severity: 'WARNING',
      policy_name: 'Sensitive Data Detection',
      matched_text: 'Sensitive text detected',
      input,
      masked_output: masked,
      finding: {
        source: 'local-dev',
        reason: 'Applied local masking rules.'
      }
    };
  }

  return {
    action: 'allow',
    severity: 'INFO',
    policy_name: 'Local Dev Session',
    matched_text: 'No issues found',
    input,
    masked_output: input,
    finding: {
      source: 'local-dev',
      reason: 'No blocking or masking rule matched.'
    }
  };
}

async function loadConfig(context) {
  const api = await tryLocalApi('/api/config');
  if (api.ok) {
    return {
      config: await safeReadJson(api.response, { ...DEFAULT_CONFIG }),
      source: 'live-api'
    };
  }

  return {
    config: await getPersistedDevConfig(context),
    source: 'local-dev'
  };
}

async function loadAuditLogs() {
  const api = await tryLocalApi('/api/audit-logs');
  if (api.ok) {
    const payload = await safeReadJson(api.response, []);
    return {
      logs: Array.isArray(payload) ? payload : [],
      source: 'live-api'
    };
  }

  return {
    logs: await loadFixtureLogs(),
    source: 'local-dev'
  };
}

async function loadPolicies() {
  const api = await tryLocalApi('/api/policies');
  if (api.ok) {
    const payload = await safeReadJson(api.response, []);
    if (Array.isArray(payload)) {
      return { policies: payload, source: 'live-api' };
    }
    if (payload && Array.isArray(payload.policies)) {
      return { policies: payload.policies, source: 'live-api' };
    }
  }

  return {
    policies: DEFAULT_POLICIES,
    source: 'local-dev'
  };
}

async function detectRuntimeMode() {
  const api = await tryLocalApi('/api/config');
  return api.ok
    ? { mode: 'live-api', message: 'Connected to local Cencurity runtime.' }
    : { mode: 'local-dev', message: 'Running in local dev session with no auth and no bootstrap flow.' };
}

async function loadPanelState(context) {
  const [runtime, configResult, logsResult, policiesResult] = await Promise.all([
    detectRuntimeMode(),
    loadConfig(context),
    loadAuditLogs(),
    loadPolicies()
  ]);

  return {
    dashboardBaseUrl: getDashboardBaseUrl(),
    proxyBaseUrl: getProxyBaseUrl(),
    config: configResult.config,
    logs: logsResult.logs,
    policies: policiesResult.policies,
    runtimeMode: runtime.mode,
    runtimeMessage: runtime.message,
    dataSourceSummary: {
      config: configResult.source,
      logs: logsResult.source,
      policies: policiesResult.source
    },
    errors: []
  };
}

async function runDryRun(context, payload) {
  const api = await tryLocalApi('/api/dry-run', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  if (api.ok) {
    return {
      result: await safeReadJson(api.response, {}),
      source: 'live-api'
    };
  }

  return {
    result: simulateDryRun(payload),
    source: 'local-dev'
  };
}

async function saveConfig(context, payload) {
  const api = await tryLocalApi('/api/config', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  if (api.ok) {
    const config = await loadConfig(context);
    return {
      config: config.config,
      source: 'live-api'
    };
  }

  return {
    config: await savePersistedDevConfig(context, payload),
    source: 'local-dev'
  };
}

async function startLocalStack() {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('Open the Cencurity workspace first.');
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: 'Cencurity Local Stack',
    cwd: workspaceRoot
  });
  terminal.show(true);
  terminal.sendText('docker compose up -d');
  vscode.window.showInformationMessage('Starting Cencurity local stack with docker compose.');
}

async function openBrowserDashboard() {
  await vscode.env.openExternal(vscode.Uri.parse(getDashboardBaseUrl()));
}

async function openSecurityCenter(context) {
  if (securityPanel) {
    securityPanel.reveal(vscode.ViewColumn.One);
    securityPanel.webview.postMessage({ type: 'loading', value: true });
    securityPanel.webview.postMessage({ type: 'state', payload: await loadPanelState(context) });
    securityPanel.webview.postMessage({ type: 'loading', value: false });
    return;
  }

  securityPanel = vscode.window.createWebviewPanel(
    PANEL_TYPE,
    'Cencurity Security Center',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
    }
  );

  securityPanel.onDidDispose(() => {
    securityPanel = undefined;
  }, null, context.subscriptions);

  securityPanel.webview.html = getWebviewHtml(context, securityPanel.webview);
  securityPanel.webview.onDidReceiveMessage(async (message) => {
    try {
      switch (message.type) {
        case 'init': {
          securityPanel.webview.postMessage({ type: 'loading', value: true });
          securityPanel.webview.postMessage({ type: 'state', payload: await loadPanelState(context) });
          securityPanel.webview.postMessage({ type: 'loading', value: false });
          break;
        }
        case 'refresh': {
          securityPanel.webview.postMessage({ type: 'loading', value: true });
          securityPanel.webview.postMessage({ type: 'state', payload: await loadPanelState(context) });
          securityPanel.webview.postMessage({ type: 'loading', value: false });
          break;
        }
        case 'dryRun': {
          const result = await runDryRun(context, message.payload || {});
          securityPanel.webview.postMessage({ type: 'dryRunResult', payload: result.result, source: result.source });
          break;
        }
        case 'saveConfig': {
          const saved = await saveConfig(context, message.payload || {});
          securityPanel.webview.postMessage({ type: 'configSaved', payload: saved.config, source: saved.source });
          securityPanel.webview.postMessage({ type: 'state', payload: await loadPanelState(context) });
          break;
        }
        case 'startLocalStack': {
          await startLocalStack();
          break;
        }
        case 'openBrowserDashboard': {
          await openBrowserDashboard();
          break;
        }
        case 'copyProxyBaseUrl': {
          const proxyBaseUrl = getProxyBaseUrl();
          await vscode.env.clipboard.writeText(proxyBaseUrl);
          vscode.window.showInformationMessage(`Cencurity proxy URL copied: ${proxyBaseUrl}`);
          break;
        }
        default:
          break;
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      securityPanel.webview.postMessage({ type: 'error', payload: messageText });
      vscode.window.showErrorMessage(`Cencurity: ${messageText}`);
    }
  }, undefined, context.subscriptions);
}

function getWebviewHtml(context, webview) {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'panel.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'panel.css'));
  const nonce = String(Date.now());

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}">
  <title>Cencurity Security Center</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

module.exports = {
  activate,
  deactivate
};
