const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const CONNECTOR_STATE_KEY = 'cencurityConnector.installedCore';
const PROTECTION_STATE_KEY = 'cencurityConnector.protectionState';
const PROTECTION_PROMPTED_KEY = 'cencurityConnector.protectionPrompted';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 38180;
const ORIGINAL_UI_PANEL_TYPE = 'cencurityConnector.originalUiPanel';
const LEGACY_ROUTING_WARNING = 'Routing may not apply to extensions that bypass terminal.integrated env settings or manage provider URLs internally.';
const DEFAULT_ROUTING_WARNING = 'Protection applies to supported env-based routing paths.';

const PROVIDERS = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    upstreamBaseUrl: 'https://api.openai.com',
    envKeys: ['OPENAI_BASE_URL', 'OPENAI_API_BASE']
  },
  openaiCompatible: {
    id: 'openaiCompatible',
    label: 'OpenAI Compatible',
    upstreamBaseUrl: '',
    envKeys: ['OPENAI_BASE_URL', 'OPENAI_API_BASE'],
    requiresCustomUpstream: true,
    customUpstreamPrompt: 'Enter the OpenAI-compatible base URL (for example: https://your-provider.example.com)',
    quickPickDescription: 'Custom OpenAI-compatible /v1 endpoint'
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    upstreamBaseUrl: 'https://api.anthropic.com',
    envKeys: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_URL']
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    upstreamBaseUrl: 'https://generativelanguage.googleapis.com',
    envKeys: ['GEMINI_BASE_URL', 'GOOGLE_GENERATIVE_AI_BASE_URL']
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    upstreamBaseUrl: 'https://openrouter.ai/api',
    envKeys: ['OPENROUTER_BASE_URL', 'OPENAI_BASE_URL', 'OPENAI_API_BASE']
  }
};

const TERMINAL_ENV_SCOPE_KEYS = ['env.windows', 'env.linux', 'env.osx'];

let coreProcess;
let outputChannel;
let originalUiPanel;
let statusBarItem;
let runtimeStartPromise;

function getWorkspaceRoots() {
  return (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath);
}

function getSettingsTarget() {
  return vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
}

function createDefaultProtectionState(proxyUrl = '') {
  return {
    enabled: false,
    providerId: '',
    providerLabel: 'Not selected',
    proxyUrl,
    upstreamBaseUrl: '',
    modifiedSettings: [],
    routingWarning: DEFAULT_ROUTING_WARNING,
    lastTest: {
      status: 'not-run',
      message: 'No protection test has been run yet.',
      httpStatus: undefined,
      proxyVerified: false,
      testedAt: ''
    },
    savedTerminalEnv: {},
    updatedAt: ''
  };
}

function normalizeProtectionState(rawValue, proxyUrl = '') {
  const normalizedRawValue = rawValue && typeof rawValue === 'object'
    ? {
        ...rawValue,
        routingWarning: rawValue.routingWarning === LEGACY_ROUTING_WARNING
          ? DEFAULT_ROUTING_WARNING
          : rawValue.routingWarning
      }
    : rawValue;
  return {
    ...createDefaultProtectionState(proxyUrl),
    ...(normalizedRawValue && typeof normalizedRawValue === 'object' ? normalizedRawValue : {}),
    proxyUrl: rawValue && typeof rawValue === 'object' && rawValue.proxyUrl ? rawValue.proxyUrl : proxyUrl
  };
}

function getProtectionState(context, proxyUrl) {
  return normalizeProtectionState(context.workspaceState.get(PROTECTION_STATE_KEY), proxyUrl);
}

async function setProtectionState(context, nextState) {
  await context.workspaceState.update(PROTECTION_STATE_KEY, nextState);
  updateStatusBar(context, nextState.proxyUrl);
  await pushProtectionStateToPanel(context, nextState.proxyUrl);
}

async function pushProtectionStateToPanel(context, runtimeUrlOverride) {
  if (!originalUiPanel) {
    return;
  }
  const runtimeUrl = runtimeUrlOverride || buildRuntimeUrl(getConfig());
  const protectionState = getProtectionState(context, runtimeUrl);
  await originalUiPanel.webview.postMessage({
    type: 'protectionStateChanged',
    protectionState
  });
}

function logLine(message) {
  outputChannel?.appendLine(message);
}

function logError(prefix, error) {
  const details = error instanceof Error ? error.stack || error.message : String(error);
  logLine(`${prefix}: ${details}`);
}

function buildStatusTooltip(state) {
  return [
    `Protection: ${state.enabled ? 'ON' : 'OFF'}`,
    `Provider: ${state.providerLabel || 'Not selected'}`,
    `Proxy URL: ${state.proxyUrl || 'Unavailable'}`
  ].join('\n');
}

function updateStatusBar(context, proxyUrl) {
  if (!statusBarItem) {
    return;
  }
  const state = getProtectionState(context, proxyUrl);
  statusBarItem.text = state.enabled
    ? `$(shield) Cencurity ${state.providerLabel}`
    : '$(shield) Cencurity Off';
  statusBarItem.tooltip = buildStatusTooltip(state);
  statusBarItem.command = state.enabled
    ? 'cencurityConnector.openSecurityCenter'
    : 'cencurityConnector.enableProtection';
  statusBarItem.show();
}

function activate(context) {
  outputChannel = vscode.window.createOutputChannel('Cencurity Connector');
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  context.subscriptions.push(outputChannel, statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('cencurityConnector.installOrUpdateCore', async () => {
      const install = await ensureCoreBinary(context, true);
      if (install) {
        vscode.window.showInformationMessage(`Cencurity core is ready: ${install.version} (${install.target})`);
      }
    }),
    vscode.commands.registerCommand('cencurityConnector.showRuntimeInfo', async () => {
      await showRuntimeInfo(context);
    }),
    vscode.commands.registerCommand('cencurityConnector.enableProtection', async () => {
      await enableProtection(context);
    }),
    vscode.commands.registerCommand('cencurityConnector.disableProtection', async () => {
      await disableProtection(context);
    }),
    vscode.commands.registerCommand('cencurityConnector.testProtection', async () => {
      await testProtection(context, true);
    }),
    vscode.commands.registerCommand('cencurityConnector.openSecurityCenter', async () => {
      const runtime = await ensureRuntime(context);
      if (!runtime) {
        return;
      }
      updateStatusBar(context, runtime.url);
      await openDashboard(context, runtime.url, shouldOpenInSimpleBrowser());
    })
  );

  updateStatusBar(context, buildRuntimeUrl(getConfig()));
  void bootstrapConnector(context);
}

function deactivate() {
  stopCoreProcess();
}

function getConfig() {
  const config = vscode.workspace.getConfiguration('cencurityConnector');
  return {
    manifestUrl: String(config.get('manifestUrl', '') || '').trim(),
    releaseChannel: String(config.get('releaseChannel', 'stable') || 'stable').trim(),
    binaryName: String(config.get('binaryName', '') || '').trim(),
    host: String(config.get('host', DEFAULT_HOST) || DEFAULT_HOST).trim(),
    port: Number(config.get('port', DEFAULT_PORT) || DEFAULT_PORT),
    openInSimpleBrowser: Boolean(config.get('openInSimpleBrowser', true))
  };
}

function shouldOpenInSimpleBrowser() {
  return getConfig().openInSimpleBrowser;
}

function getPlatformTarget() {
  const target = `${process.platform}-${process.arch}`;
  const supported = new Set([
    'win32-x64',
    'win32-arm64',
    'linux-x64',
    'linux-arm64',
    'darwin-x64',
    'darwin-arm64'
  ]);
  if (!supported.has(target)) {
    throw new Error(`Unsupported platform target: ${target}`);
  }
  return target;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureStorageDir(context) {
  const baseDir = context.globalStorageUri.fsPath;
  await fs.mkdir(baseDir, { recursive: true });
  return baseDir;
}

async function findLocalWorkspaceCoreScript() {
  for (const workspaceRoot of getWorkspaceRoots()) {
    const candidate = path.join(workspaceRoot, 'legacy', 'vscode-core-runtime', 'core-server.js');
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function findLocalWorkspaceClientBuild() {
  for (const workspaceRoot of getWorkspaceRoots()) {
    const distRoot = path.join(workspaceRoot, 'legacy', 'd', 'dist');
    const indexPath = path.join(distRoot, 'index.client.html');
    if (await pathExists(indexPath)) {
      return { distRoot, indexPath };
    }
  }
  return undefined;
}

async function findLocalWorkspaceBinary(target) {
  const binaryName = target.startsWith('win32') ? 'cencurity-core.exe' : 'cencurity-core';
  for (const workspaceRoot of getWorkspaceRoots()) {
    const candidate = path.join(workspaceRoot, 'legacy', 'vscode-core-runtime', 'dist', 'releases', target, binaryName);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

async function postJson(url, value) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(value)
  });
  if (!response.ok) {
    throw new Error(`Failed to post ${url}: ${response.status}`);
  }
  return response.json();
}

function resolveArtifact(manifest, target) {
  if (!manifest || typeof manifest !== 'object' || !manifest.artifacts || typeof manifest.artifacts !== 'object') {
    throw new Error('Manifest is missing artifacts.');
  }

  const artifact = manifest.artifacts[target];
  if (!artifact) {
    throw new Error(`No artifact found for target ${target}`);
  }
  if (!artifact.url) {
    throw new Error(`Artifact for ${target} is missing url`);
  }
  if (!artifact.sha256) {
    throw new Error(`Artifact for ${target} is missing sha256`);
  }
  return artifact;
}

function inferBinaryFileName(artifact, config, target) {
  if (artifact.fileName) {
    return artifact.fileName;
  }
  if (config.binaryName) {
    return config.binaryName;
  }
  return target.startsWith('win32') ? 'cencurity-core.exe' : 'cencurity-core';
}

async function sha256File(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function downloadBinary(url, destinationPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download binary: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, buffer);
}

async function ensureExecutable(binaryPath) {
  if (process.platform !== 'win32') {
    await fs.chmod(binaryPath, 0o755);
  }
}

async function ensureCoreBinary(context, forceDownload = false) {
  const config = getConfig();
  if (!config.manifestUrl) {
    const target = getPlatformTarget();
    const localScriptPath = await findLocalWorkspaceCoreScript();
    if (localScriptPath) {
      const install = {
        version: 'local-workspace-source',
        target,
        binaryPath: localScriptPath,
        launchStrategy: 'node-script',
        manifestUrl: '(local-workspace-source)',
        downloadedAt: new Date().toISOString(),
        channel: config.releaseChannel
      };
      await context.globalState.update(CONNECTOR_STATE_KEY, install);
      outputChannel.appendLine(`[connector] using local workspace source: ${localScriptPath}`);
      return install;
    }

    const localBinaryPath = await findLocalWorkspaceBinary(target);
    if (localBinaryPath) {
      const install = {
        version: 'local-workspace',
        target,
        binaryPath: localBinaryPath,
        launchStrategy: 'binary',
        manifestUrl: '(local-workspace)',
        downloadedAt: new Date().toISOString(),
        channel: config.releaseChannel
      };
      await context.globalState.update(CONNECTOR_STATE_KEY, install);
      outputChannel.appendLine(`[connector] using local workspace core: ${localBinaryPath}`);
      return install;
    }

    const action = await vscode.window.showWarningMessage(
      'Set cencurityConnector.manifestUrl or build a local core binary under legacy/vscode-core-runtime/dist/releases before installing the Cencurity core binary.',
      'Open Settings'
    );
    if (action === 'Open Settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'cencurityConnector.manifestUrl');
    }
    return undefined;
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Preparing Cencurity core',
      cancellable: false
    },
    async () => {
      const manifest = await fetchJson(config.manifestUrl);
      const target = getPlatformTarget();
      const artifact = resolveArtifact(manifest, target);
      const version = String(manifest.version || artifact.version || 'dev');
      const fileName = inferBinaryFileName(artifact, config, target);
      const storageDir = await ensureStorageDir(context);
      const installDir = path.join(storageDir, 'core', version, target);
      const binaryPath = path.join(installDir, fileName);

      let shouldDownload = forceDownload || !(await pathExists(binaryPath));
      if (!shouldDownload) {
        const currentHash = await sha256File(binaryPath);
        shouldDownload = currentHash.toLowerCase() !== String(artifact.sha256).toLowerCase();
      }

      if (shouldDownload) {
        outputChannel.appendLine(`[connector] downloading ${artifact.url}`);
        await downloadBinary(artifact.url, binaryPath);
        await ensureExecutable(binaryPath);
        const downloadedHash = await sha256File(binaryPath);
        if (downloadedHash.toLowerCase() !== String(artifact.sha256).toLowerCase()) {
          throw new Error(`Checksum mismatch for ${fileName}`);
        }
      }

      const install = {
        version,
        target,
        binaryPath,
        launchStrategy: 'binary',
        manifestUrl: config.manifestUrl,
        downloadedAt: new Date().toISOString(),
        channel: config.releaseChannel
      };
      await context.globalState.update(CONNECTOR_STATE_KEY, install);
      return install;
    }
  );
}

function stopCoreProcess() {
  if (coreProcess && !coreProcess.killed) {
    coreProcess.kill();
  }
  coreProcess = undefined;
}

function buildRuntimeUrl(config) {
  return `http://${config.host}:${config.port}`;
}

async function pingHealth(url) {
  try {
    const response = await fetch(`${url}/healthz`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(url, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await pingHealth(url)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function attachProcessLogging(child) {
  child.stdout?.on('data', (chunk) => {
    outputChannel.append(chunk.toString());
  });
  child.stderr?.on('data', (chunk) => {
    outputChannel.append(chunk.toString());
  });
}

async function ensureRuntime(context) {
  if (runtimeStartPromise) {
    return runtimeStartPromise;
  }

  runtimeStartPromise = (async () => {
  const config = getConfig();
  const runtimeUrl = buildRuntimeUrl(config);

  const alreadyHealthy = await pingHealth(runtimeUrl);
  if (alreadyHealthy) {
    return { url: runtimeUrl, source: 'existing-runtime' };
  }

  if (coreProcess && !coreProcess.killed) {
    const healthy = await pingHealth(runtimeUrl);
    if (healthy) {
      return { url: runtimeUrl, source: 'running-process' };
    }
    stopCoreProcess();
  }

  const install = await ensureCoreBinary(context, false);
  if (!install) {
    return undefined;
  }

  outputChannel.show(true);
  outputChannel.appendLine(`[connector] launching ${install.binaryPath}`);
  const launchStrategy = install.launchStrategy || 'binary';
  if (launchStrategy === 'node-script') {
    coreProcess = spawn('node', [install.binaryPath, 'serve', '--host', config.host, '--port', String(config.port)], {
      cwd: path.dirname(install.binaryPath),
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } else {
    coreProcess = spawn(install.binaryPath, ['serve', '--host', config.host, '--port', String(config.port)], {
      cwd: path.dirname(install.binaryPath),
      stdio: ['ignore', 'pipe', 'pipe']
    });
  }
  attachProcessLogging(coreProcess);
  coreProcess.on('exit', (code, signal) => {
    outputChannel.appendLine(`[connector] core exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    coreProcess = undefined;
  });

  const healthy = await waitForHealth(runtimeUrl);
  if (!healthy) {
    throw new Error('Cencurity core did not become healthy in time.');
  }

  return { url: runtimeUrl, source: 'fresh-process', install };
  })();

  try {
    return await runtimeStartPromise;
  } finally {
    runtimeStartPromise = undefined;
  }
}

async function bootstrapConnector(context) {
  try {
    const runtime = await ensureRuntime(context);
    if (!runtime) {
      return;
    }

    const state = getProtectionState(context, runtime.url);
    if (state.proxyUrl !== runtime.url) {
      await setProtectionState(context, {
        ...state,
        proxyUrl: runtime.url
      });
    } else {
      updateStatusBar(context, runtime.url);
    }

    await syncRuntimeProtection(runtime.url, getProtectionState(context, runtime.url));

    if (!state.enabled && !context.workspaceState.get(PROTECTION_PROMPTED_KEY)) {
      await context.workspaceState.update(PROTECTION_PROMPTED_KEY, true);
      const action = await vscode.window.showInformationMessage(
        'Cencurity Protection is ready. Select your provider to route requests through the local proxy.',
        'Enable Protection'
      );
      if (action === 'Enable Protection') {
        await enableProtection(context);
      }
    }
  } catch (error) {
    logError('[connector] bootstrap failed', error);
  }
}

function getProviderOptions() {
  return Object.values(PROVIDERS).map((provider) => ({
    label: provider.label,
    description: provider.quickPickDescription || provider.upstreamBaseUrl,
    provider
  }));
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function buildModifiedSettingsSummary(provider) {
  return TERMINAL_ENV_SCOPE_KEYS.map((scopeKey) => `${scopeKey}: ${['CENCURITY_PROXY_URL', ...provider.envKeys].join(', ')}`);
}

function createTestRequest(runtimeUrl, providerId) {
  switch (providerId) {
    case 'anthropic':
      return {
        url: `${runtimeUrl}/v1/messages`,
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            'X-Cencurity-Test': '1'
          },
          body: JSON.stringify({
            model: 'cencurity-test',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }]
          })
        }
      };
    case 'gemini':
      return {
        url: `${runtimeUrl}/v1beta/models`,
        init: {
          method: 'GET',
          headers: {
            'X-Cencurity-Test': '1'
          }
        }
      };
    case 'openrouter':
    case 'openai':
    default:
      return {
        url: `${runtimeUrl}/v1/models`,
        init: {
          method: 'GET',
          headers: {
            'X-Cencurity-Test': '1'
          }
        }
      };
  }
}

function buildTestResult({ ok, message, httpStatus, proxyVerified, providerLabel }) {
  return {
    status: ok ? 'success' : 'failure',
    message,
    httpStatus,
    proxyVerified: Boolean(proxyVerified),
    providerLabel,
    testedAt: new Date().toISOString()
  };
}

function buildRoutingStatusMessage({ enabled, proxyVerified, upstreamStatus, fallbackStatus, errorMessage }) {
  if (!enabled) {
    return 'Protection is off';
  }
  if (errorMessage) {
    return 'Could not verify protection';
  }
  if (proxyVerified && (upstreamStatus === 401 || upstreamStatus === 403)) {
    return 'Upstream rejected probe (routing OK)';
  }
  if (proxyVerified) {
    return 'Connected to local proxy';
  }
  if (fallbackStatus) {
    return 'Could not verify local proxy';
  }
  return 'Routing status unavailable';
}

async function promptForProvider() {
  const choice = await vscode.window.showQuickPick(getProviderOptions(), {
    placeHolder: 'Select the LLM provider whose base URL should be routed through the local Cencurity proxy',
    ignoreFocusOut: true
  });
  return choice ? choice.provider : undefined;
}

async function resolveProviderUpstreamBaseUrl(provider, currentState) {
  if (!provider.requiresCustomUpstream) {
    return provider.upstreamBaseUrl;
  }

  const suggestedValue = currentState.providerId === provider.id && currentState.upstreamBaseUrl
    ? currentState.upstreamBaseUrl
    : 'https://your-provider.example.com';

  const enteredValue = await vscode.window.showInputBox({
    title: `${provider.label} Base URL`,
    prompt: provider.customUpstreamPrompt,
    placeHolder: suggestedValue,
    value: suggestedValue,
    ignoreFocusOut: true,
    validateInput: (value) => {
      const normalized = normalizeBaseUrl(value);
      if (!normalized) {
        return 'Base URL is required.';
      }
      if (!isValidHttpUrl(normalized)) {
        return 'Enter a valid http:// or https:// URL.';
      }
      return undefined;
    }
  });

  if (!enteredValue) {
    return undefined;
  }

  return normalizeBaseUrl(enteredValue);
}

async function applyProviderProxySettings(provider, proxyUrl) {
  const terminalConfig = vscode.workspace.getConfiguration('terminal.integrated');
  const target = getSettingsTarget();
  const envKeys = ['CENCURITY_PROXY_URL', ...provider.envKeys];
  const snapshot = {};

  for (const scopeKey of TERMINAL_ENV_SCOPE_KEYS) {
    const current = { ...(terminalConfig.get(scopeKey, {}) || {}) };
    const next = { ...current };
    const scopeSnapshot = {};
    for (const envKey of envKeys) {
      scopeSnapshot[envKey] = {
        hadValue: Object.prototype.hasOwnProperty.call(current, envKey),
        value: current[envKey]
      };
      next[envKey] = proxyUrl;
    }
    snapshot[scopeKey] = scopeSnapshot;
    await terminalConfig.update(scopeKey, next, target);
  }

  return snapshot;
}

async function restoreTerminalEnvSnapshot(snapshot) {
  const terminalConfig = vscode.workspace.getConfiguration('terminal.integrated');
  const target = getSettingsTarget();

  for (const scopeKey of TERMINAL_ENV_SCOPE_KEYS) {
    const current = { ...(terminalConfig.get(scopeKey, {}) || {}) };
    const next = { ...current };
    const scopeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot[scopeKey] : undefined;
    if (!scopeSnapshot || typeof scopeSnapshot !== 'object') {
      continue;
    }
    for (const [envKey, metadata] of Object.entries(scopeSnapshot)) {
      if (metadata && metadata.hadValue) {
        next[envKey] = metadata.value;
      } else {
        delete next[envKey];
      }
    }
    await terminalConfig.update(scopeKey, next, target);
  }
}

async function syncRuntimeProtection(runtimeUrl, state) {
  const currentConfig = await fetchJson(`${runtimeUrl}/api/config`).catch(() => ({}));
  const mergedConfig = {
    ...currentConfig,
    protection: {
      enabled: Boolean(state.enabled),
      provider: state.providerId || '',
      providerLabel: state.providerLabel || 'Not selected',
      proxyBaseUrl: state.proxyUrl || runtimeUrl,
      upstreamBaseUrl: state.enabled ? state.upstreamBaseUrl || '' : '',
      updatedAt: new Date().toISOString()
    }
  };
  await postJson(`${runtimeUrl}/api/config`, mergedConfig);
}

async function enableProtection(context) {
  try {
    const runtime = await ensureRuntime(context);
    if (!runtime) {
      return;
    }

    const previousState = getProtectionState(context, runtime.url);
    const provider = await promptForProvider();
    if (!provider) {
      return;
    }

    const upstreamBaseUrl = await resolveProviderUpstreamBaseUrl(provider, previousState);
    if (!upstreamBaseUrl) {
      return;
    }

    if (previousState.savedTerminalEnv && Object.keys(previousState.savedTerminalEnv).length > 0) {
      await restoreTerminalEnvSnapshot(previousState.savedTerminalEnv);
    }

    const savedTerminalEnv = await applyProviderProxySettings(provider, runtime.url);
    const nextState = {
      enabled: true,
      providerId: provider.id,
      providerLabel: provider.label,
      proxyUrl: runtime.url,
      upstreamBaseUrl,
      modifiedSettings: buildModifiedSettingsSummary(provider),
      lastTest: {
        status: 'pending',
        message: 'Verifying routing...',
        httpStatus: undefined,
        proxyVerified: false,
        providerLabel: provider.label,
        testedAt: ''
      },
      savedTerminalEnv,
      updatedAt: new Date().toISOString()
    };

    await syncRuntimeProtection(runtime.url, nextState);
    await setProtectionState(context, nextState);
    await context.workspaceState.update(PROTECTION_PROMPTED_KEY, true);
    await testProtection(context, false);

    vscode.window.showInformationMessage(
      `Cencurity Protection is ON for ${provider.label}. Requests now route through ${runtime.url} without changing your API key.`
    );
  } catch (error) {
    logError('[connector] failed to enable protection', error);
    vscode.window.showErrorMessage(`Failed to enable Cencurity Protection: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function enableProtectionFromPanel(context) {
  await new Promise((resolve) => setTimeout(resolve, 30));
  originalUiPanel?.reveal(vscode.ViewColumn.One, false);
  await enableProtection(context);
}

async function testProtection(context, showMessage) {
  const fallbackProxyUrl = buildRuntimeUrl(getConfig());
  const currentState = getProtectionState(context, fallbackProxyUrl);
  if (!currentState.enabled || !currentState.providerId) {
    const failedState = {
      ...currentState,
      lastTest: buildTestResult({
        ok: false,
        message: buildRoutingStatusMessage({ enabled: false }),
        proxyVerified: false,
        providerLabel: currentState.providerLabel
      })
    };
    await setProtectionState(context, failedState);
    if (showMessage) {
      vscode.window.showWarningMessage(failedState.lastTest.message);
    }
    return failedState.lastTest;
  }

  try {
    const runtime = await ensureRuntime(context);
    if (!runtime) {
      throw new Error('Local proxy runtime is unavailable.');
    }

    const request = createTestRequest(runtime.url, currentState.providerId);
    const response = await fetch(request.url, request.init);
    const proxyVerified = response.headers.get('x-cencurity-proxy') === 'active';
    const upstreamStatus = Number(response.headers.get('x-cencurity-upstream-status') || response.status);
    const ok = proxyVerified;
    const message = buildRoutingStatusMessage({
      enabled: true,
      proxyVerified,
      upstreamStatus,
      fallbackStatus: response.status
    });

    const nextState = {
      ...currentState,
      proxyUrl: runtime.url,
      lastTest: buildTestResult({
        ok,
        message,
        httpStatus: upstreamStatus,
        proxyVerified,
        providerLabel: currentState.providerLabel
      }),
      updatedAt: new Date().toISOString()
    };
    await setProtectionState(context, nextState);

    if (showMessage) {
      if (ok) {
        vscode.window.showInformationMessage(nextState.lastTest.message);
      } else {
        vscode.window.showWarningMessage(nextState.lastTest.message);
      }
    }
    return nextState.lastTest;
  } catch (error) {
    const nextState = {
      ...currentState,
      lastTest: buildTestResult({
        ok: false,
        message: buildRoutingStatusMessage({
          enabled: true,
          proxyVerified: false,
          errorMessage: error instanceof Error ? error.message : String(error)
        }),
        proxyVerified: false,
        providerLabel: currentState.providerLabel
      }),
      updatedAt: new Date().toISOString()
    };
    await setProtectionState(context, nextState);
    logError('[connector] protection test failed', error);
    if (showMessage) {
      vscode.window.showErrorMessage(nextState.lastTest.message);
    }
    return nextState.lastTest;
  }
}

async function disableProtection(context) {
  try {
    const currentState = getProtectionState(context, buildRuntimeUrl(getConfig()));
    if (currentState.savedTerminalEnv && Object.keys(currentState.savedTerminalEnv).length > 0) {
      await restoreTerminalEnvSnapshot(currentState.savedTerminalEnv);
    }

    let runtimeUrl = currentState.proxyUrl || buildRuntimeUrl(getConfig());
    try {
      const runtime = await ensureRuntime(context);
      if (runtime) {
        runtimeUrl = runtime.url;
      }
    } catch (error) {
      logError('[connector] runtime unavailable during disable', error);
    }

    const nextState = {
      ...currentState,
      enabled: false,
      proxyUrl: runtimeUrl,
      upstreamBaseUrl: '',
      modifiedSettings: [],
      lastTest: buildTestResult({
        ok: false,
        message: 'Protection is off',
        proxyVerified: false,
        providerLabel: currentState.providerLabel
      }),
      savedTerminalEnv: {},
      updatedAt: new Date().toISOString()
    };
    if (runtimeUrl) {
      await syncRuntimeProtection(runtimeUrl, nextState).catch((error) => {
        logError('[connector] failed to sync disabled protection', error);
      });
    }
    await setProtectionState(context, nextState);
    vscode.window.showInformationMessage('Cencurity Protection is OFF and previous base URL settings were restored.');
  } catch (error) {
    logError('[connector] failed to disable protection', error);
    vscode.window.showErrorMessage(`Failed to disable Cencurity Protection: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function createProxyBootstrapScript(runtimeUrl, nonce, protectionState) {
  return `<script nonce="${nonce}">
    const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
    localStorage.setItem('apiKey', localStorage.getItem('apiKey') || 'local-dev-session');
    const runtimeBaseUrl = ${JSON.stringify(runtimeUrl)};
    let protectionState = ${JSON.stringify(protectionState)};
    const originalFetch = window.fetch.bind(window);
    let auditLogSignature = '';
    let auditRefreshTimer;
    let protectionBanner;
    let detailsExpanded = false;
    let testInProgress = false;
    function mergeHeaders(input, init) {
      const headers = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined) || {});
      const apiKey = localStorage.getItem('apiKey') || 'local-dev-session';
      if (!headers.has('X-API-KEY')) headers.set('X-API-KEY', apiKey);
      if (!headers.has('X-API-Key')) headers.set('X-API-Key', apiKey);
      if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + apiKey);
      return headers;
    }
    function getProtectionStatusColor() {
      return protectionState.enabled ? '#4ade80' : '#f87171';
    }
    function getProtectionTestColor() {
      return protectionState.lastTest && protectionState.lastTest.status === 'success' ? '#4ade80' : '#fbbf24';
    }
    function buildModifiedSettingsMarkup() {
      if (!protectionState.enabled) {
        return '<div style="opacity:.7">Protection is currently off.</div>';
      }
      return '<div style="opacity:.92">' + (protectionState.providerLabel || 'Provider') + ' routing enabled for terminal environments.</div>' +
        '<div style="margin-top:6px;opacity:.72">Previous values will be restored when protection is turned off.</div>';
    }
    function formatTestedAt(value) {
      if (!value) {
        return 'Not run yet';
      }
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return 'Updated just now';
      }
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    function mountProtectionBanner() {
      if (protectionBanner) {
        protectionBanner.remove();
      }
      const banner = document.createElement('div');
      protectionBanner = banner;
      banner.setAttribute('data-cencurity-protection-banner', 'true');
      banner.style.cssText = 'position:fixed;top:14px;right:14px;z-index:2147483647;padding:5px 7px;border-radius:999px;background:rgba(12,12,14,0.78);border:1px solid rgba(255,255,255,0.06);box-shadow:0 8px 18px rgba(0,0,0,0.16);backdrop-filter:blur(12px);font:11px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#e6edf7;max-width:min(520px,calc(100vw - 28px))';
      const statusColor = getProtectionStatusColor();
      const testColor = getProtectionTestColor();
      const modifiedSettings = buildModifiedSettingsMarkup();
      const lastTestMessage = testInProgress
        ? 'Running protection test...'
        : ((protectionState.lastTest && protectionState.lastTest.message) || 'No protection test has been run yet.');
      const lastTestTime = testInProgress
        ? 'Checking now...'
        : formatTestedAt(protectionState.lastTest && protectionState.lastTest.testedAt);
      const testButtonLabel = testInProgress ? 'Testing...' : 'Run test';
      const protectionMeaning = protectionState.enabled
        ? ((protectionState.providerLabel || 'Provider') + ' via local proxy')
        : 'Protection is off';
      const testButtonStyle = testInProgress
        ? 'display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 10px;border-radius:10px;border:1px solid rgba(74,222,128,0.22);background:rgba(74,222,128,0.08);color:#eef3ff;cursor:default;font:12px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;opacity:.92'
        : 'display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 10px;border-radius:10px;border:1px solid rgba(120,140,255,0.16);background:rgba(255,255,255,0.03);color:#eef3ff;cursor:pointer;font:12px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif';
      const protectionToggleButtonStyle = protectionState.enabled
        ? 'display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 10px;border-radius:10px;border:1px solid rgba(248,113,113,0.18);background:rgba(248,113,113,0.08);color:#fee2e2;cursor:pointer;font:12px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif'
        : 'display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 10px;border-radius:10px;border:1px solid rgba(74,222,128,0.2);background:rgba(74,222,128,0.08);color:#dcfce7;cursor:pointer;font:12px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif';
      banner.innerHTML = '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
        '<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:999px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);white-space:nowrap">' +
          '<span style="display:inline-block;width:7px;height:7px;border-radius:999px;background:' + statusColor + ';box-shadow:0 0 10px ' + statusColor + '66"></span>' +
          '<strong style="letter-spacing:.12em;text-transform:uppercase;color:#eef3ff;font-size:10px">' + (protectionState.enabled ? 'Protected' : 'Inactive') + '</strong>' +
        '</span>' +
        '<span style="padding:4px 8px;border-radius:999px;background:rgba(255,255,255,0.018);border:1px solid rgba(255,255,255,0.04);opacity:.78;white-space:nowrap">' + protectionMeaning + '</span>' +
        '<span style="padding:4px 8px;border-radius:999px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.045);opacity:.62;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px">' + (protectionState.proxyUrl || runtimeBaseUrl) + '</span>' +
        '<div style="display:flex;gap:6px;align-items:center;margin-left:auto">' +
          '<button type="button" title="Toggle Details" aria-label="Toggle Details" data-cencurity-action="toggle-details" aria-expanded="false" style="width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid rgba(255,255,255,0.06);background:transparent;color:#cfd8ef;cursor:pointer;font-size:14px">⋯</button>' +
        '</div>' +
      '</div>' +
      '<div data-cencurity-details hidden style="position:absolute;top:calc(100% + 8px);right:0;width:min(440px,calc(100vw - 28px));padding:12px 14px;border-radius:16px;background:rgba(14,14,16,0.98);border:1px solid rgba(255,255,255,0.08);box-shadow:0 18px 34px rgba(0,0,0,0.3)">' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
          '<button type="button" title="' + (protectionState.enabled ? 'Turn protection off' : 'Turn protection on') + '" aria-label="' + (protectionState.enabled ? 'Turn protection off' : 'Turn protection on') + '" data-cencurity-action="toggle-protection" style="' + protectionToggleButtonStyle + '">' + (protectionState.enabled ? 'Protection off' : 'Protection on') + '</button>' +
          '<button type="button" title="Verify protection" aria-label="Verify protection" data-cencurity-action="test-protection"' + (testInProgress ? ' disabled' : '') + ' style="' + testButtonStyle + '">' + (testInProgress ? 'Testing...' : 'Verify protection') + '</button>' +
        '</div>' +
        '<div style="display:flex;gap:20px;flex-wrap:wrap">' +
          '<div style="min-width:240px;flex:1 1 240px"><div style="font-weight:600;margin-bottom:4px;color:' + testColor + '">Routing status</div><div style="opacity:.92">' + lastTestMessage + '</div><div style="margin-top:6px;opacity:.56;font-size:11px">Last checked: ' + lastTestTime + '</div></div>' +
          '<div style="min-width:240px;flex:1 1 240px"><div style="font-weight:600;margin-bottom:4px">Routing settings</div>' + modifiedSettings + '</div>' +
          '<div style="min-width:240px;flex:1 1 240px"><div style="font-weight:600;margin-bottom:4px;color:#fbbf24">Coverage warning</div><div style="opacity:.84">' + (protectionState.routingWarning || '') + '</div></div>' +
        '</div>' +
      '</div>';
      const details = banner.querySelector('[data-cencurity-details]');
        const toggleButton = banner.querySelector('[data-cencurity-action="toggle-details"]');
        if (details && detailsExpanded) {
          details.removeAttribute('hidden');
        }
        if (toggleButton) {
          toggleButton.setAttribute('aria-expanded', String(detailsExpanded));
          toggleButton.textContent = detailsExpanded ? '–' : '⋯';
        }
      banner.querySelector('[data-cencurity-action="test-protection"]')?.addEventListener('click', () => {
          if (testInProgress) {
            return;
          }
          detailsExpanded = true;
          testInProgress = true;
          mountProtectionBanner();
        vscodeApi && vscodeApi.postMessage({ type: 'testProtection' });
      });
      banner.querySelector('[data-cencurity-action="toggle-protection"]')?.addEventListener('click', () => {
        if (testInProgress) {
          return;
        }
        detailsExpanded = true;
        vscodeApi && vscodeApi.postMessage({ type: protectionState.enabled ? 'disableProtection' : 'enableProtection' });
      });
      banner.querySelector('[data-cencurity-action="toggle-details"]')?.addEventListener('click', (event) => {
        if (!details) {
          return;
        }
        const isHidden = details.hasAttribute('hidden');
        if (isHidden) {
          details.removeAttribute('hidden');
        } else {
          details.setAttribute('hidden', 'hidden');
        }
          detailsExpanded = isHidden;
        event.currentTarget.setAttribute('aria-expanded', String(isHidden));
        event.currentTarget.textContent = isHidden ? '–' : '⋯';
      });
      document.body.prepend(banner);
      document.body.style.paddingTop = '0px';
    }
    window.addEventListener('message', (event) => {
      const message = event && event.data;
      if (!message || typeof message !== 'object') {
        return;
      }
      if (message.type === 'protectionStateChanged' && message.protectionState && typeof message.protectionState === 'object') {
        protectionState = message.protectionState;
        testInProgress = false;
        mountProtectionBanner();
      }
    });
    async function getAuditLogSignature() {
      try {
        const response = await originalFetch(runtimeBaseUrl + '/api/audit-logs', {
          headers: mergeHeaders('/api/audit-logs', {})
        });
        if (!response.ok) {
          return '';
        }
        const payload = await response.json();
        if (!Array.isArray(payload)) {
          return '';
        }
        const first = payload[0] || {};
        return JSON.stringify({
          count: payload.length,
          timestamp: first.timestamp || '',
          matched: first.matched_text || '',
          policy: first.policy_name || ''
        });
      } catch {
        return auditLogSignature;
      }
    }
    async function startAuditAutoRefresh() {
      auditLogSignature = await getAuditLogSignature();
      auditRefreshTimer = window.setInterval(async () => {
        if (document.hidden) {
          return;
        }
        const nextSignature = await getAuditLogSignature();
        if (auditLogSignature && nextSignature && auditLogSignature !== nextSignature) {
          if (vscodeApi) {
            vscodeApi.postMessage({ type: 'refreshPanel' });
          }
          return;
        }
        auditLogSignature = nextSignature || auditLogSignature;
      }, 4000);
    }
    window.fetch = (input, init = {}) => {
      const requestUrl = typeof input === 'string' ? input : input.url;
      if (requestUrl.startsWith('/api/')) {
        return originalFetch(runtimeBaseUrl + requestUrl, { ...init, headers: mergeHeaders(input, init) });
      }
      return originalFetch(input, init);
    };
    window.addEventListener('auth-required', () => {
      localStorage.setItem('apiKey', 'local-dev-session');
    });
    window.addEventListener('beforeunload', () => {
      if (auditRefreshTimer) {
        window.clearInterval(auditRefreshTimer);
      }
    });
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        mountProtectionBanner();
        startAuditAutoRefresh();
      }, { once: true });
    } else {
      mountProtectionBanner();
      startAuditAutoRefresh();
    }
  </script>`;
}

async function buildOriginalUiHtml(webview, runtimeUrl, clientBuild, protectionState) {
  const nonce = `${Date.now()}`;
  let html = await fs.readFile(clientBuild.indexPath, 'utf8');
  const assetPattern = /(["'])(\.\/assets\/[^"']+)\1/g;
  html = html.replace(assetPattern, (match, quote, relativePath) => {
    const absolutePath = path.join(clientBuild.distRoot, relativePath.replace('./', '').replace(/\//g, path.sep));
    return `${quote}${webview.asWebviewUri(vscode.Uri.file(absolutePath))}${quote}`;
  });

  const csp = `default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; connect-src ${webview.cspSource} ${runtimeUrl} http://127.0.0.1:*; font-src ${webview.cspSource} https: data:;`;
  const bootstrap = createProxyBootstrapScript(runtimeUrl, nonce, protectionState);
  if (html.includes('<meta charset="UTF-8" />')) {
    html = html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`);
  } else {
    html = html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`);
  }
  html = html.replace('</head>', `\n    ${bootstrap}\n  </head>`);
  return html;
}

async function refreshOriginalUiPanel(context, runtimeUrlOverride) {
  if (!originalUiPanel) {
    return;
  }
  const clientBuild = await findLocalWorkspaceClientBuild();
  if (!clientBuild) {
    return;
  }
  const runtimeUrl = runtimeUrlOverride || getProtectionState(context).proxyUrl || buildRuntimeUrl(getConfig());
  const protectionState = getProtectionState(context, runtimeUrl);
  originalUiPanel.webview.html = await buildOriginalUiHtml(originalUiPanel.webview, runtimeUrl, clientBuild, protectionState);
}

async function openOriginalUiPanel(context, runtimeUrl, clientBuild) {
  const protectionState = getProtectionState(context, runtimeUrl);
  if (originalUiPanel) {
    originalUiPanel.reveal(vscode.ViewColumn.One);
    originalUiPanel.webview.html = await buildOriginalUiHtml(originalUiPanel.webview, runtimeUrl, clientBuild, protectionState);
    return;
  }

  originalUiPanel = vscode.window.createWebviewPanel(
    ORIGINAL_UI_PANEL_TYPE,
    'Cencurity Security Center',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(clientBuild.distRoot)]
    }
  );
  originalUiPanel.onDidDispose(() => {
    originalUiPanel = undefined;
  });
  originalUiPanel.webview.onDidReceiveMessage(async (message) => {
    if (!message || typeof message !== 'object') {
      return;
    }
    if (message.type === 'testProtection') {
      await testProtection(context, false);
      return;
    }
    if (message.type === 'disableProtection') {
      await disableProtection(context);
      return;
    }
    if (message.type === 'enableProtection') {
      await enableProtectionFromPanel(context);
      return;
    }
    if (message.type === 'refreshPanel') {
      await refreshOriginalUiPanel(context, runtimeUrl);
    }
  });
  originalUiPanel.webview.html = await buildOriginalUiHtml(originalUiPanel.webview, runtimeUrl, clientBuild, protectionState);
}

async function openDashboard(context, url, useSimpleBrowser) {
  const clientBuild = await findLocalWorkspaceClientBuild();
  if (clientBuild) {
    await openOriginalUiPanel(context, url, clientBuild);
    return;
  }

  if (useSimpleBrowser) {
    try {
      await vscode.commands.executeCommand('simpleBrowser.show', url);
      return;
    } catch {
    }
  }
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

async function showRuntimeInfo(context) {
  const config = getConfig();
  const installed = context.globalState.get(CONNECTOR_STATE_KEY);
  const target = getPlatformTarget();
  const protectionState = getProtectionState(context, buildRuntimeUrl(config));
  const lines = [
    `Manifest: ${config.manifestUrl || '(not set - using local workspace fallback if available)'}`,
    `Channel: ${config.releaseChannel}`,
    `Target: ${target}`,
    `Runtime URL: ${buildRuntimeUrl(config)}`,
    `Protection: ${protectionState.enabled ? 'ON' : 'OFF'}`,
    `Provider: ${protectionState.providerLabel}`,
    `Proxy URL: ${protectionState.proxyUrl || buildRuntimeUrl(config)}`,
    `Modified Settings: ${(protectionState.modifiedSettings || []).join(' | ') || 'none'}`,
    `Latest Test: ${protectionState.lastTest ? protectionState.lastTest.message : 'not-run'}`,
    `Installed: ${installed ? JSON.stringify(installed, null, 2) : 'none'}`
  ];
  outputChannel.show(true);
  outputChannel.appendLine(lines.join('\n'));
  vscode.window.showInformationMessage('Cencurity runtime info written to the Cencurity Connector output channel.');
}

module.exports = {
  activate,
  deactivate
};
