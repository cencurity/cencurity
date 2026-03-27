const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_PANEL_TYPE = 'cencurity.securityCenter';
const DEFAULT_CONFIG_KEY = 'cencurity.devConfig';

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

const panels = new Map();

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function getWorkspaceRoot() {
  return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
    ? vscode.workspace.workspaceFolders[0].uri.fsPath
    : undefined;
}

function getExtensionConfig(configurationNamespace) {
  return vscode.workspace.getConfiguration(configurationNamespace);
}

function getDashboardBaseUrl(configurationNamespace) {
  return trimTrailingSlash(getExtensionConfig(configurationNamespace).get('dashboardBaseUrl', 'http://localhost:18080'));
}

function getProxyBaseUrl(configurationNamespace) {
  return trimTrailingSlash(getExtensionConfig(configurationNamespace).get('proxyBaseUrl', 'http://localhost:18082'));
}

function getFixturePaths(rootDir) {
  const workspaceRoot = getWorkspaceRoot();
  const searchRoot = workspaceRoot || path.resolve(rootDir, '..');
  return [
    path.join(searchRoot, 'audit_after_stream.json'),
    path.join(searchRoot, 'audit_after_real_block.json'),
    path.join(searchRoot, 'audit.json'),
    path.join(searchRoot, 'audit_logs_after_mock.json')
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

async function getPersistedDevConfig(context, configKey) {
  const stored = context.globalState.get(configKey);
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

async function savePersistedDevConfig(context, configKey, payload) {
  const nextValue = {
    alertLevel: payload.alertLevel || DEFAULT_CONFIG.alertLevel,
    webhooks: {
      ...DEFAULT_CONFIG.webhooks,
      ...(payload.webhooks || {})
    }
  };

  await context.globalState.update(configKey, nextValue);
  return nextValue;
}

async function loadFixtureLogs(rootDir) {
  for (const fixturePath of getFixturePaths(rootDir)) {
    const payload = await readJsonFile(fixturePath, undefined);
    if (Array.isArray(payload) && payload.length > 0) {
      return payload;
    }
  }

  return [];
}

async function tryLocalApi(configurationNamespace, endpoint, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }

  const url = endpoint.startsWith('http') ? endpoint : `${getDashboardBaseUrl(configurationNamespace)}${endpoint}`;
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

async function loadConfig(context, options) {
  const api = await tryLocalApi(options.configurationNamespace, '/api/config');
  if (api.ok) {
    return {
      config: await safeReadJson(api.response, { ...DEFAULT_CONFIG }),
      source: 'live-api'
    };
  }

  return {
    config: await getPersistedDevConfig(context, options.devConfigKey),
    source: 'local-dev'
  };
}

async function loadAuditLogs(options) {
  const api = await tryLocalApi(options.configurationNamespace, '/api/audit-logs');
  if (api.ok) {
    const payload = await safeReadJson(api.response, []);
    return {
      logs: Array.isArray(payload) ? payload : [],
      source: 'live-api'
    };
  }

  return {
    logs: await loadFixtureLogs(options.rootDir),
    source: 'local-dev'
  };
}

async function loadPolicies(options) {
  const api = await tryLocalApi(options.configurationNamespace, '/api/policies');
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

async function detectRuntimeMode(options) {
  const api = await tryLocalApi(options.configurationNamespace, '/api/config');
  return api.ok
    ? { mode: 'live-api', message: 'Connected to local Cencurity runtime.' }
    : { mode: 'local-dev', message: 'Running in local dev session with no auth and no bootstrap flow.' };
}

async function loadPanelState(context, options) {
  const [runtime, configResult, logsResult, policiesResult] = await Promise.all([
    detectRuntimeMode(options),
    loadConfig(context, options),
    loadAuditLogs(options),
    loadPolicies(options)
  ]);

  return {
    dashboardBaseUrl: getDashboardBaseUrl(options.configurationNamespace),
    proxyBaseUrl: getProxyBaseUrl(options.configurationNamespace),
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

async function runDryRun(options, payload) {
  const api = await tryLocalApi(options.configurationNamespace, '/api/dry-run', {
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

async function saveConfig(context, options, payload) {
  const api = await tryLocalApi(options.configurationNamespace, '/api/config', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  if (api.ok) {
    const config = await loadConfig(context, options);
    return {
      config: config.config,
      source: 'live-api'
    };
  }

  return {
    config: await savePersistedDevConfig(context, options.devConfigKey, payload),
    source: 'local-dev'
  };
}

async function startLocalStack(rootDir) {
  const workspaceRoot = getWorkspaceRoot() || path.resolve(rootDir, '..');
  const terminal = vscode.window.createTerminal({
    name: 'Cencurity Local Stack',
    cwd: workspaceRoot
  });
  terminal.show(true);
  terminal.sendText('docker compose up -d');
  vscode.window.showInformationMessage('Starting Cencurity local stack with docker compose.');
}

async function openBrowserDashboard(options) {
  await vscode.env.openExternal(vscode.Uri.parse(getDashboardBaseUrl(options.configurationNamespace)));
}

function getWebviewHtml(webview, options) {
  const mediaRootUri = vscode.Uri.file(path.join(options.rootDir, 'media'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRootUri, 'panel.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRootUri, 'panel.css'));
  const nonce = String(Date.now());

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}">
  <title>${options.panelTitle}</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

async function openSecurityCenter(context, inputOptions = {}) {
  const options = {
    rootDir: inputOptions.rootDir || __dirname,
    panelType: inputOptions.panelType || DEFAULT_PANEL_TYPE,
    panelTitle: inputOptions.panelTitle || 'Cencurity Security Center',
    configurationNamespace: inputOptions.configurationNamespace || 'cencurity',
    devConfigKey: inputOptions.devConfigKey || DEFAULT_CONFIG_KEY
  };

  const existingPanel = panels.get(options.panelType);
  if (existingPanel) {
    existingPanel.reveal(vscode.ViewColumn.One);
    existingPanel.webview.postMessage({ type: 'loading', value: true });
    existingPanel.webview.postMessage({ type: 'state', payload: await loadPanelState(context, options) });
    existingPanel.webview.postMessage({ type: 'loading', value: false });
    return existingPanel;
  }

  const panel = vscode.window.createWebviewPanel(
    options.panelType,
    options.panelTitle,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(path.join(options.rootDir, 'media'))]
    }
  );

  panels.set(options.panelType, panel);
  panel.onDidDispose(() => {
    panels.delete(options.panelType);
  }, null, context.subscriptions);

  panel.webview.html = getWebviewHtml(panel.webview, options);
  panel.webview.onDidReceiveMessage(async (message) => {
    try {
      switch (message.type) {
        case 'init':
        case 'refresh': {
          panel.webview.postMessage({ type: 'loading', value: true });
          panel.webview.postMessage({ type: 'state', payload: await loadPanelState(context, options) });
          panel.webview.postMessage({ type: 'loading', value: false });
          break;
        }
        case 'dryRun': {
          const result = await runDryRun(options, message.payload || {});
          panel.webview.postMessage({ type: 'dryRunResult', payload: result.result, source: result.source });
          break;
        }
        case 'saveConfig': {
          const saved = await saveConfig(context, options, message.payload || {});
          panel.webview.postMessage({ type: 'configSaved', payload: saved.config, source: saved.source });
          panel.webview.postMessage({ type: 'state', payload: await loadPanelState(context, options) });
          break;
        }
        case 'startLocalStack': {
          await startLocalStack(options.rootDir);
          break;
        }
        case 'openBrowserDashboard': {
          await openBrowserDashboard(options);
          break;
        }
        case 'copyProxyBaseUrl': {
          const proxyBaseUrl = getProxyBaseUrl(options.configurationNamespace);
          await vscode.env.clipboard.writeText(proxyBaseUrl);
          vscode.window.showInformationMessage(`Cencurity proxy URL copied: ${proxyBaseUrl}`);
          break;
        }
        default:
          break;
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      panel.webview.postMessage({ type: 'error', payload: messageText });
      vscode.window.showErrorMessage(`Cencurity: ${messageText}`);
    }
  }, undefined, context.subscriptions);

  return panel;
}

module.exports = {
  activateCore: openSecurityCenter,
  openSecurityCenter,
  deactivateCore() {}
};
