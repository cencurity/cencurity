const state = {
  loading: true,
  config: { alertLevel: 'OFF', webhooks: {} },
  logs: [],
  policies: [],
  dryRunResult: null,
  error: '',
  toast: ''
};

const runtimeUrl = window.CENCURITY_RUNTIME_URL || window.location.origin;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function summarize(logs) {
  return logs.reduce((summary, log) => {
    summary.total += 1;
    if (log.severity === 'CRITICAL') summary.critical += 1;
    if (log.action === 'block') summary.blocked += 1;
    const name = String(log.policy_name || '');
    if (['Cencurity Code Analysis', 'Dangerous Keyword Block', 'Zero-click Attempt Blocked', 'Semgrep Code Analysis'].includes(name)) {
      summary.zeroClick += 1;
    }
    return summary;
  }, { total: 0, critical: 0, blocked: 0, zeroClick: 0 });
}

async function api(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...((init && init.headers) || {})
    }
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function toast(message) {
  state.toast = message;
  render();
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    state.toast = '';
    render();
  }, 2200);
}

function render() {
  const summary = summarize(state.logs);
  const webhooks = {
    slack: '',
    telegram: '',
    discord: '',
    jandi: '',
    custom: '',
    ...(state.config.webhooks || {})
  };
  const logsRows = state.logs.slice(0, 50).map((log) => `
    <tr>
      <td>${escapeHtml(log.timestamp || '')}</td>
      <td>${escapeHtml(log.policy_name || '-')}</td>
      <td><span class="badge ${escapeHtml(log.severity || 'INFO')}">${escapeHtml(log.severity || 'INFO')}</span></td>
      <td><span class="badge ${escapeHtml(log.action || 'allow')}">${escapeHtml(log.action || 'allow')}</span></td>
      <td>${escapeHtml(log.matched_text || log.masked_data || '-')}</td>
      <td>${escapeHtml(log.client_ip || '-')}</td>
    </tr>`).join('');
  const policyOptions = state.policies.map((policy) => `<option value="${escapeHtml(policy.id)}">${escapeHtml(policy.name || ('Policy ' + policy.id))}</option>`).join('');
  const alertOptions = ['OFF', 'CRITICAL', 'WARNING', 'INFO'].map((level) => `<option value="${level}" ${state.config.alertLevel === level ? 'selected' : ''}>${level}</option>`).join('');

  document.getElementById('app').innerHTML = `
    <section class="hero">
      <div class="hero-top">
        <div>
          <h1>Cencurity Security Center</h1>
          <p>Standalone local core runtime입니다. connector가 이 런타임을 실행하고 브라우저로 연결합니다.</p>
        </div>
        <div class="actions">
          <button class="primary" data-action="refresh">Refresh</button>
          <button class="secondary" data-action="copyUrl">Copy URL</button>
        </div>
      </div>
      <div class="hero-meta">
        <div class="meta-card"><div class="label">Runtime URL</div><div class="value">${escapeHtml(runtimeUrl)}</div></div>
        <div class="meta-card"><div class="label">Status</div><div class="value">${state.loading ? 'Loading…' : 'Ready'}</div></div>
        <div class="meta-card"><div class="label">Mode</div><div class="value">Standalone Core</div></div>
      </div>
    </section>
    <section class="metrics">
      <div class="metric"><div class="label">Total Logs</div><div class="value">${summary.total}</div></div>
      <div class="metric danger"><div class="label">Critical</div><div class="value">${summary.critical}</div></div>
      <div class="metric warn"><div class="label">Blocked</div><div class="value">${summary.blocked}</div></div>
      <div class="metric good"><div class="label">Zero-click Events</div><div class="value">${summary.zeroClick}</div></div>
    </section>
    ${state.error ? `<div class="notice">${escapeHtml(state.error)}</div>` : ''}
    <section class="columns">
      <div class="panel">
        <div class="panel-header"><div><h2>Audit Logs</h2><p class="panel-subtitle">최근 50개 로그를 확인합니다.</p></div></div>
        ${state.logs.length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Policy</th><th>Severity</th><th>Action</th><th>Detected</th><th>Client</th></tr></thead><tbody>${logsRows}</tbody></table></div>` : `<div class="empty">No audit logs yet.</div>`}
      </div>
      <div class="panel">
        <div class="panel-header"><div><h2>Dry Run</h2><p class="panel-subtitle">정책 시뮬레이션을 바로 실행합니다.</p></div></div>
        <div class="field"><label for="policyId">Policy</label><select id="policyId">${policyOptions}</select></div>
        <div class="field"><label for="direction">Direction</label><select id="direction"><option value="inbound">Inbound</option><option value="outbound">Outbound</option></select></div>
        <div class="field"><label for="dryRunInput">Input</label><textarea id="dryRunInput" placeholder="검사할 프롬프트, 코드, 응답을 입력하세요."></textarea></div>
        <div class="actions"><button class="primary" data-action="runDryRun">Run Dry Run</button></div>
        <div class="field"><label>Result</label><div class="output"><pre>${escapeHtml(state.dryRunResult ? JSON.stringify(state.dryRunResult, null, 2) : 'Dry run result will appear here.')}</pre></div></div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-header"><div><h2>Alert Settings</h2><p class="panel-subtitle">local config를 저장합니다.</p></div></div>
      <div class="grid-2">
        <div>
          <div class="field"><label for="alertLevel">Alert Level</label><select id="alertLevel">${alertOptions}</select></div>
          <div class="field"><label for="slackWebhook">Slack</label><input id="slackWebhook" value="${escapeHtml(webhooks.slack)}" /></div>
          <div class="field"><label for="discordWebhook">Discord</label><input id="discordWebhook" value="${escapeHtml(webhooks.discord)}" /></div>
          <div class="field"><label for="telegramWebhook">Telegram</label><input id="telegramWebhook" value="${escapeHtml(webhooks.telegram)}" /></div>
        </div>
        <div>
          <div class="field"><label for="jandiWebhook">Jandi</label><input id="jandiWebhook" value="${escapeHtml(webhooks.jandi)}" /></div>
          <div class="field"><label for="customWebhook">Custom</label><input id="customWebhook" value="${escapeHtml(webhooks.custom)}" /></div>
          <div class="field"><label>Saved payload preview</label><div class="output"><pre>${escapeHtml(JSON.stringify({ alertLevel: state.config.alertLevel || 'OFF', webhooks }, null, 2))}</pre></div></div>
          <div class="actions"><button class="primary" data-action="saveConfig">Save Settings</button></div>
        </div>
      </div>
    </section>
    <div class="toast ${state.toast ? '' : 'hidden'}">${escapeHtml(state.toast)}</div>`;

  wire();
}

function wire() {
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.getAttribute('data-action');
      try {
        if (action === 'refresh') {
          await load();
          return;
        }
        if (action === 'copyUrl') {
          await navigator.clipboard.writeText(runtimeUrl);
          toast('Runtime URL copied');
          return;
        }
        if (action === 'runDryRun') {
          state.dryRunResult = await api('/api/dry-run', {
            method: 'POST',
            body: JSON.stringify({
              policy_id: Number(document.getElementById('policyId').value),
              direction: document.getElementById('direction').value,
              input: document.getElementById('dryRunInput').value
            })
          });
          render();
          return;
        }
        if (action === 'saveConfig') {
          state.config = await api('/api/config', {
            method: 'POST',
            body: JSON.stringify({
              alertLevel: document.getElementById('alertLevel').value,
              webhooks: {
                slack: document.getElementById('slackWebhook').value,
                discord: document.getElementById('discordWebhook').value,
                telegram: document.getElementById('telegramWebhook').value,
                jandi: document.getElementById('jandiWebhook').value,
                custom: document.getElementById('customWebhook').value
              }
            })
          });
          toast('Settings saved');
          render();
        }
      } catch (error) {
        state.error = error.message || String(error);
        render();
      }
    });
  });
}

async function load() {
  state.loading = true;
  state.error = '';
  render();
  try {
    const [config, logs, policies] = await Promise.all([
      api('/api/config'),
      api('/api/audit-logs'),
      api('/api/policies')
    ]);
    state.config = config;
    state.logs = Array.isArray(logs) ? logs : [];
    state.policies = Array.isArray(policies) ? policies : [];
  } catch (error) {
    state.error = error.message || String(error);
  } finally {
    state.loading = false;
    render();
  }
}

load();
