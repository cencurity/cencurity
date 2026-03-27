#!/usr/bin/env node
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { URL } = require('node:url');

const DEFAULT_CONFIG = {
  alertLevel: 'OFF',
  webhooks: {
    slack: '',
    telegram: '',
    discord: '',
    jandi: '',
    custom: ''
  },
  protection: {
    enabled: false,
    provider: '',
    providerLabel: 'Not selected',
    proxyBaseUrl: '',
    upstreamBaseUrl: '',
    updatedAt: ''
  }
};

const DEFAULT_POLICIES = [
  { id: 999, name: 'Cencurity Code Analysis', severity: 'CRITICAL', action: 'block' },
  { id: 27, name: 'Universal API Key Detection', severity: 'CRITICAL', action: 'mask' },
  { id: 25, name: 'Email Masking', severity: 'INFO', action: 'mask' },
  { id: 26, name: 'Phone Number Masking', severity: 'INFO', action: 'mask' },
  { id: 73, name: 'Sensitive Data Detection', severity: 'WARNING', action: 'mask' }
];

const DEFAULT_LOGS = [
  {
    timestamp: new Date().toISOString(),
    policy_name: 'Cencurity Code Analysis',
    severity: 'CRITICAL',
    action: 'block',
    matched_text: 'subprocess.Popen(shell=True)',
    client_ip: '127.0.0.1'
  },
  {
    timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    policy_name: 'Sensitive Data Detection',
    severity: 'WARNING',
    action: 'mask',
    matched_text: 'demo@example.com',
    client_ip: '127.0.0.1'
  }
];

const DEFAULT_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-KEY, X-API-Key, Authorization'
};

function parseArgs(argv) {
  const result = {
    command: argv[2] || 'serve',
    host: '127.0.0.1',
    port: 38180
  };

  for (let index = 3; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--host') {
      result.host = argv[index + 1] || result.host;
      index += 1;
      continue;
    }
    if (token === '--port') {
      result.port = Number(argv[index + 1] || result.port);
      index += 1;
    }
  }

  return result;
}

function getStorageDir() {
  return path.join(os.homedir(), '.cencurity-core');
}

function getConfigPath() {
  return path.join(getStorageDir(), 'config.json');
}

function getPoliciesPath() {
  return path.join(getStorageDir(), 'policies.json');
}

function getAuditLogsPath() {
  return path.join(getStorageDir(), 'audit_logs.json');
}

const STATIC_ASSET_PATHS = {
  'index.html': path.join(__dirname, 'standalone', 'index.html'),
  'styles.css': path.join(__dirname, 'standalone', 'styles.css'),
  'app.js': path.join(__dirname, 'standalone', 'app.js')
};

async function ensureStorageDir() {
  await fs.mkdir(getStorageDir(), { recursive: true });
}

async function readJsonFile(filePath, fallbackValue) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

async function writeJsonFile(filePath, value) {
  await ensureStorageDir();
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeConfig(stored) {
  return {
    alertLevel: stored && stored.alertLevel ? stored.alertLevel : DEFAULT_CONFIG.alertLevel,
    webhooks: {
      ...DEFAULT_CONFIG.webhooks,
      ...((stored && stored.webhooks) || {})
    },
    protection: {
      ...DEFAULT_CONFIG.protection,
      ...((stored && stored.protection) || {})
    }
  };
}

async function loadPersistedConfig() {
  const stored = await readJsonFile(getConfigPath(), DEFAULT_CONFIG);
  return normalizeConfig(stored);
}

async function loadPersistedPolicies() {
  const stored = await readJsonFile(getPoliciesPath(), DEFAULT_POLICIES);
  if (!Array.isArray(stored) || stored.length === 0) {
    return DEFAULT_POLICIES;
  }
  return stored;
}

async function savePersistedPolicies(policies) {
  await writeJsonFile(getPoliciesPath(), policies);
  return policies;
}

async function loadPersistedAuditLogs() {
  const stored = await readJsonFile(getAuditLogsPath(), []);
  return Array.isArray(stored) ? stored : [];
}

async function savePersistedAuditLogs(logs) {
  await writeJsonFile(getAuditLogsPath(), logs);
  return logs;
}

async function appendAuditLog(entry) {
  const current = await loadPersistedAuditLogs();
  current.unshift(entry);
  await savePersistedAuditLogs(current.slice(0, 200));
  return current[0];
}

async function addPersistedPolicy(payload) {
  const current = await loadPersistedPolicies();
  const nextId = current.reduce((maxValue, policy) => Math.max(maxValue, Number(policy.id) || 0), 0) + 1;
  const nextPolicy = {
    id: nextId,
    name: payload.name || payload.policy_name || `Custom Policy ${nextId}`,
    severity: payload.severity || 'WARNING',
    action: payload.action || 'mask',
    ...payload,
    id: nextId
  };
  current.push(nextPolicy);
  await savePersistedPolicies(current);
  return nextPolicy;
}

async function deletePersistedPolicy(policyId) {
  const current = await loadPersistedPolicies();
  const nextPolicies = current.filter((policy) => Number(policy.id) !== Number(policyId));
  await savePersistedPolicies(nextPolicies);
  return nextPolicies;
}

async function savePersistedConfig(payload) {
  const current = await loadPersistedConfig();
  const nextValue = normalizeConfig({
    ...current,
    ...(payload || {}),
    webhooks: {
      ...current.webhooks,
      ...((payload && payload.webhooks) || {})
    },
    protection: {
      ...current.protection,
      ...((payload && payload.protection) || {})
    }
  });
  await writeJsonFile(getConfigPath(), nextValue);
  return nextValue;
}

async function loadLogs() {
  const logs = await loadPersistedAuditLogs();
  return logs.filter((entry) => {
    if (entry && entry.internal_test === true) {
      return false;
    }
    try {
      const details = entry && entry.finding_details ? JSON.parse(entry.finding_details) : undefined;
      return !(details && details.test_request === true);
    } catch {
      return true;
    }
  });
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
        source: 'standalone-core',
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
        source: 'standalone-core',
        reason: 'Applied local masking rules.'
      }
    };
  }

  return {
    action: 'allow',
    severity: 'INFO',
    policy_name: 'Standalone Core',
    matched_text: 'No issues found',
    input,
    masked_output: input,
    finding: {
      source: 'standalone-core',
      reason: 'No blocking or masking rule matched.'
    }
  };
}

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    request.on('error', reject);
  });
}

async function readBody(request) {
  const rawBuffer = await readRawBody(request);
  const raw = rawBuffer.toString('utf8');
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function joinUrl(baseUrl, pathAndQuery) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}/${String(pathAndQuery || '').replace(/^\/+/, '')}`;
}

function buildProxyRequestHeaders(headers, bodyBuffer) {
  const nextHeaders = new Headers();
  for (const [key, value] of Object.entries(headers || {})) {
    const normalizedKey = key.toLowerCase();
    if (['host', 'connection', 'content-length', 'accept-encoding'].includes(normalizedKey)) {
      continue;
    }
    if (Array.isArray(value)) {
      nextHeaders.set(key, value.join(', '));
    } else if (typeof value === 'string') {
      nextHeaders.set(key, value);
    }
  }
  if (bodyBuffer && bodyBuffer.length > 0) {
    nextHeaders.set('Content-Length', String(bodyBuffer.length));
  }
  return nextHeaders;
}

async function proxyProviderRequest(request, response, requestUrl) {
  const config = await loadPersistedConfig();
  const protection = config.protection || DEFAULT_CONFIG.protection;
  if (!protection.enabled || !protection.upstreamBaseUrl) {
    sendJson(response, 503, { error: 'Protection is disabled. Enable protection from the Cencurity Connector first.' });
    return;
  }

  const bodyBuffer = request.method === 'GET' || request.method === 'HEAD' ? undefined : await readRawBody(request);
  const isProtectionTest = request.headers['x-cencurity-test'] === '1';
  const upstreamUrl = joinUrl(protection.upstreamBaseUrl, `${requestUrl.pathname}${requestUrl.search}`);
  const upstreamResponse = await fetch(upstreamUrl, {
    method: request.method,
    headers: buildProxyRequestHeaders(request.headers, bodyBuffer),
    body: bodyBuffer && bodyBuffer.length > 0 ? bodyBuffer : undefined,
    redirect: 'manual'
  });

  const responseBuffer = Buffer.from(await upstreamResponse.arrayBuffer());
  await appendAuditLog({
    timestamp: new Date().toISOString(),
    direction: 'REQUEST',
    policy_name: isProtectionTest ? 'Protection Test' : 'Protected LLM Request',
    severity: 'INFO',
    action: 'mask',
    matched_text: `${request.method} ${requestUrl.pathname}`,
    client_ip: String(request.socket?.remoteAddress || request.headers['x-forwarded-for'] || '127.0.0.1'),
    internal_test: isProtectionTest,
    finding_details: JSON.stringify({
      source: 'local-proxy',
      provider: protection.providerLabel || protection.provider || 'Unknown',
      upstream_status: upstreamResponse.status,
      test_request: isProtectionTest
    })
  });
  const responseHeaders = {
    ...DEFAULT_CORS_HEADERS,
    'Cache-Control': 'no-store',
    'X-Cencurity-Proxy': 'active',
    'X-Cencurity-Upstream-Status': String(upstreamResponse.status)
  };
  upstreamResponse.headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();
    if (['content-length', 'transfer-encoding', 'content-encoding', 'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers'].includes(normalizedKey)) {
      return;
    }
    responseHeaders[key] = value;
  });
  responseHeaders['Content-Length'] = String(responseBuffer.length);

  response.writeHead(upstreamResponse.status, responseHeaders);
  response.end(responseBuffer);
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    ...DEFAULT_CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function sendText(response, statusCode, text, contentType) {
  response.writeHead(statusCode, {
    ...DEFAULT_CORS_HEADERS,
    'Content-Type': `${contentType}; charset=utf-8`,
    'Cache-Control': 'no-store'
  });
  response.end(text);
}

async function readAsset(fileName) {
  const assetPath = STATIC_ASSET_PATHS[fileName];
  if (!assetPath) {
    throw new Error(`Unknown asset requested: ${fileName}`);
  }
  return fs.readFile(assetPath, 'utf8');
}

async function createHandler(runtime) {
  return async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host || `${runtime.host}:${runtime.port}`}`);

    if (request.method === 'OPTIONS') {
      response.writeHead(204, DEFAULT_CORS_HEADERS);
      response.end();
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/healthz') {
      sendJson(response, 200, { ok: true, mode: 'standalone-core' });
      return;
    }

    if (requestUrl.pathname.startsWith('/v1/') || requestUrl.pathname.startsWith('/v1beta/')) {
      await proxyProviderRequest(request, response, requestUrl);
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/config') {
      sendJson(response, 200, await loadPersistedConfig());
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/config') {
      const payload = await readBody(request);
      sendJson(response, 200, await savePersistedConfig(payload));
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/audit-logs') {
      sendJson(response, 200, await loadLogs());
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/policies') {
      sendJson(response, 200, await loadPersistedPolicies());
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/policies') {
      const payload = await readBody(request);
      sendJson(response, 200, await addPersistedPolicy(payload));
      return;
    }

    if (request.method === 'DELETE' && /^\/api\/policies\/\d+$/.test(requestUrl.pathname)) {
      const policyId = Number(requestUrl.pathname.split('/').pop());
      await deletePersistedPolicy(policyId);
      sendJson(response, 200, { ok: true, deletedId: policyId });
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/dry-run') {
      const payload = await readBody(request);
      sendJson(response, 200, simulateDryRun(payload));
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/app.js') {
      sendText(response, 200, await readAsset('app.js'), 'application/javascript');
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/styles.css') {
      sendText(response, 200, await readAsset('styles.css'), 'text/css');
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/') {
      const runtimeUrlString = `http://${runtime.host}:${runtime.port}`;
      const html = (await readAsset('index.html')).replace('__RUNTIME_URL__', runtimeUrlString);
      sendText(response, 200, html, 'text/html');
      return;
    }

    sendJson(response, 404, { error: 'Not found' });
  };
}

async function startServer(options) {
  const runtime = {
    host: options.host || '127.0.0.1',
    port: Number(options.port || 38180)
  };

  const handler = await createHandler(runtime);
  const server = http.createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });

  server.listen(runtime.port, runtime.host, () => {
    process.stdout.write(`Cencurity standalone core listening on http://${runtime.host}:${runtime.port}\n`);
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command !== 'serve') {
    throw new Error(`Unsupported command: ${args.command}`);
  }
  await startServer(args);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
