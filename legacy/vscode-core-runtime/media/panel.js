const vscode = acquireVsCodeApi();

const state = {
  loading: true,
  dashboardBaseUrl: '',
  proxyBaseUrl: '',
  config: { alertLevel: 'OFF', webhooks: {} },
  logs: [],
  policies: [],
  dryRunResult: null,
  errors: [],
  toast: '',
  runtimeMode: 'local-dev',
  runtimeMessage: '',
  dataSourceSummary: null
};

function send(type, payload) {
  vscode.postMessage({ type, payload });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function summarize(logs) {
  const summary = {
    total: logs.length,
    critical: 0,
    warnings: 0,
    blocked: 0,
    zeroClick: 0
  };

  for (const log of logs) {
    if (log.severity === 'CRITICAL') summary.critical += 1;
    if (log.severity === 'WARNING') summary.warnings += 1;
    if (log.action === 'block') summary.blocked += 1;
    const policyName = String(log.policy_name || '');
    if (
      policyName === 'Cencurity Code Analysis' ||
      policyName === 'Dangerous Keyword Block' ||
      policyName === 'Zero-click Attempt Blocked' ||
      policyName === 'Semgrep Code Analysis'
    ) {
      summary.zeroClick += 1;
    }
  }

  return summary;
}

function prettyJson(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

function render() {
  const app = document.getElementById('app');
  const summary = summarize(state.logs);
  const recentLogs = state.logs.slice(0, 50);
  const config = state.config || { alertLevel: 'OFF', webhooks: {} };
  const webhooks = {
    slack: '',
    telegram: '',
    discord: '',
    jandi: '',
    custom: '',
    ...(config.webhooks || {})
  };

  app.innerHTML = `
    <div class="shell">
      <section class="hero">
        <div class="hero-top">
          <div>
            <h1>Cencurity Security Center</h1>
            <p>인증 없이 바로 열리는 VS Code 전용 local-dev 대시보드입니다. 로컬 API가 가능하면 붙고, 아니면 fixture와 in-memory session으로 즉시 동작합니다.</p>
          </div>
          <div class="actions">
            <button class="primary" data-action="refresh">Refresh</button>
            <button class="secondary" data-action="openBrowserDashboard">Open Browser</button>
            <button class="ghost" data-action="copyProxyBaseUrl">Copy Proxy URL</button>
            <button class="ghost" data-action="startLocalStack">Start Stack</button>
          </div>
        </div>
        <div class="hero-meta">
          <div class="meta-card">
            <div class="label">Dashboard URL</div>
            <div class="value">${escapeHtml(state.dashboardBaseUrl)}</div>
          </div>
          <div class="meta-card">
            <div class="label">Proxy URL</div>
            <div class="value">${escapeHtml(state.proxyBaseUrl)}</div>
          </div>
          <div class="meta-card">
            <div class="label">Status</div>
            <div class="value">${state.loading ? 'Loading…' : state.runtimeMode === 'live-api' ? 'Live API' : 'Local Dev Session'}</div>
          </div>
          <div class="meta-card">
            <div class="label">Runtime</div>
            <div class="value">${escapeHtml(state.runtimeMessage || 'Ready')}</div>
          </div>
        </div>
      </section>

      ${state.dataSourceSummary ? `
        <section class="panel compact-panel">
          <div class="panel-header">
            <div>
              <h2>Runtime Source</h2>
              <p class="panel-subtitle">각 데이터가 실제 로컬 API인지, local-dev fallback인지 표시합니다.</p>
            </div>
          </div>
          <div class="hero-meta">
            <div class="meta-card"><div class="label">Config</div><div class="value">${escapeHtml(state.dataSourceSummary.config || '-')}</div></div>
            <div class="meta-card"><div class="label">Logs</div><div class="value">${escapeHtml(state.dataSourceSummary.logs || '-')}</div></div>
            <div class="meta-card"><div class="label">Policies</div><div class="value">${escapeHtml(state.dataSourceSummary.policies || '-')}</div></div>
          </div>
        </section>
      ` : ''}

      <section class="metrics">
        <div class="metric">
          <div class="label">Total Logs</div>
          <div class="value">${summary.total}</div>
        </div>
        <div class="metric danger">
          <div class="label">Critical</div>
          <div class="value">${summary.critical}</div>
        </div>
        <div class="metric warn">
          <div class="label">Blocked</div>
          <div class="value">${summary.blocked}</div>
        </div>
        <div class="metric good">
          <div class="label">Zero-click Events</div>
          <div class="value">${summary.zeroClick}</div>
        </div>
      </section>

      ${state.errors.length ? `<div class="notice">${escapeHtml(state.errors.join(' | '))}</div>` : ''}

      <section class="columns">
        <div class="panel">
          <div class="panel-header">
            <div>
              <h2>Audit Logs</h2>
              <p class="panel-subtitle">최근 50개 로그를 바로 확인합니다.</p>
            </div>
            <div class="status"><span class="dot ${state.loading ? 'loading' : ''}"></span>${state.loading ? 'Syncing' : 'Synced'}</div>
          </div>
          ${recentLogs.length ? `
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Policy</th>
                    <th>Severity</th>
                    <th>Action</th>
                    <th>Detected</th>
                    <th>Client</th>
                  </tr>
                </thead>
                <tbody>
                  ${recentLogs.map((log) => `
                    <tr>
                      <td>${escapeHtml(log.timestamp || '')}</td>
                      <td>${escapeHtml(log.policy_name || '-')}</td>
                      <td><span class="badge ${escapeHtml(log.severity || 'INFO')}">${escapeHtml(log.severity || 'INFO')}</span></td>
                      <td><span class="badge ${escapeHtml(log.action || 'allow')}">${escapeHtml(log.action || 'allow')}</span></td>
                      <td>${escapeHtml(log.matched_text || log.masked_data || '-')}</td>
                      <td>${escapeHtml(log.client_ip || '-')}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>` : `<div class="empty">No audit logs yet.</div>`}
        </div>

        <div class="panel">
          <div class="panel-header">
            <div>
              <h2>Dry Run</h2>
              <p class="panel-subtitle">정책 시뮬레이션을 VS Code 안에서 바로 실행합니다.</p>
            </div>
          </div>
          <div class="field">
            <label for="policyId">Policy</label>
            <select id="policyId">
              ${state.policies.map((policy) => `<option value="${escapeHtml(policy.id)}">${escapeHtml(policy.name || policy.policy_name || `Policy ${policy.id}`)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="direction">Direction</label>
            <select id="direction">
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
            </select>
          </div>
          <div class="field">
            <label for="dryRunInput">Input</label>
            <textarea id="dryRunInput" placeholder="검사할 프롬프트, 코드, 응답을 입력하세요."></textarea>
          </div>
          <div class="actions">
            <button class="primary" data-action="runDryRun">Run Dry Run</button>
          </div>
          <div class="field">
            <label>Result</label>
            <div class="output"><pre>${escapeHtml(state.dryRunResult ? prettyJson(state.dryRunResult) : 'Dry run result will appear here.')}</pre></div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Alert Settings</h2>
            <p class="panel-subtitle">기존 /api/config 를 직접 호출해서 설정을 저장합니다.</p>
          </div>
        </div>
        <div class="grid-2">
          <div>
            <div class="field">
              <label for="alertLevel">Alert Level</label>
              <select id="alertLevel">
                ${['OFF', 'CRITICAL', 'WARNING', 'INFO'].map((level) => `<option value="${level}" ${config.alertLevel === level ? 'selected' : ''}>${level}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="slackWebhook">Slack</label>
              <input id="slackWebhook" value="${escapeHtml(webhooks.slack)}" placeholder="https://hooks.slack.com/..." />
            </div>
            <div class="field">
              <label for="discordWebhook">Discord</label>
              <input id="discordWebhook" value="${escapeHtml(webhooks.discord)}" placeholder="https://discord.com/api/webhooks/..." />
            </div>
            <div class="field">
              <label for="telegramWebhook">Telegram</label>
              <input id="telegramWebhook" value="${escapeHtml(webhooks.telegram)}" placeholder="Telegram webhook or bot endpoint" />
            </div>
          </div>
          <div>
            <div class="field">
              <label for="jandiWebhook">Jandi</label>
              <input id="jandiWebhook" value="${escapeHtml(webhooks.jandi)}" placeholder="https://wh.jandi.com/..." />
            </div>
            <div class="field">
              <label for="customWebhook">Custom</label>
              <input id="customWebhook" value="${escapeHtml(webhooks.custom)}" placeholder="https://your-webhook.example" />
            </div>
            <div class="field">
              <label>Saved payload preview</label>
              <div class="output"><pre>${escapeHtml(prettyJson({ alertLevel: config.alertLevel || 'OFF', webhooks }))}</pre></div>
            </div>
            <div class="actions">
              <button class="primary" data-action="saveConfig">Save Settings</button>
            </div>
          </div>
        </div>
      </section>

      <div class="toast ${state.toast ? '' : 'hidden'}" id="toast">${escapeHtml(state.toast)}</div>
    </div>
  `;

  wireActions();
}

function wireActions() {
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.getAttribute('data-action');
      if (action === 'runDryRun') {
        const policyIdElement = document.getElementById('policyId');
        const directionElement = document.getElementById('direction');
        const inputElement = document.getElementById('dryRunInput');
        send('dryRun', {
          policy_id: Number(policyIdElement && policyIdElement.value),
          direction: directionElement ? directionElement.value : 'inbound',
          input: inputElement ? inputElement.value : ''
        });
        return;
      }

      if (action === 'saveConfig') {
        const alertLevelElement = document.getElementById('alertLevel');
        const payload = {
          alertLevel: alertLevelElement ? alertLevelElement.value : 'OFF',
          webhooks: {
            slack: document.getElementById('slackWebhook')?.value || '',
            discord: document.getElementById('discordWebhook')?.value || '',
            telegram: document.getElementById('telegramWebhook')?.value || '',
            jandi: document.getElementById('jandiWebhook')?.value || '',
            custom: document.getElementById('customWebhook')?.value || ''
          }
        };
        send('saveConfig', payload);
        return;
      }

      send(action);
    });
  });
}

function showToast(message) {
  state.toast = message;
  render();
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    state.toast = '';
    render();
  }, 2200);
}

window.addEventListener('message', (event) => {
  const message = event.data;
  switch (message.type) {
    case 'loading':
      state.loading = Boolean(message.value);
      render();
      break;
    case 'state':
      Object.assign(state, message.payload || {});
      state.loading = false;
      render();
      break;
    case 'dryRunResult':
      state.dryRunResult = message.payload;
      showToast(message.source === 'live-api' ? 'Dry run completed from live API.' : 'Dry run completed in local dev mode.');
      break;
    case 'configSaved':
      state.config = message.payload || state.config;
      showToast(message.source === 'live-api' ? 'Config saved to live API.' : 'Config saved to local dev session.');
      break;
    case 'error':
      state.errors = [message.payload || 'Unknown error'];
      state.loading = false;
      render();
      break;
    default:
      break;
  }
});

render();
send('init');
