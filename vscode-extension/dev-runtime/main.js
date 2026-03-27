const vscode = require('vscode');
const runtime = require('./runtime');

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('cencurity.bootstrapSession', async () => {
      await runtime.activateCore(context, {
        rootDir: __dirname,
        panelType: 'cencurity.securityCenter',
        panelTitle: 'Cencurity Security Center',
        configurationNamespace: 'cencurity',
        devConfigKey: 'cencurity.devConfig'
      });
    }),
    vscode.commands.registerCommand('cencurity.openSecurityCenter', async () => {
      await runtime.activateCore(context, {
        rootDir: __dirname,
        panelType: 'cencurity.securityCenter',
        panelTitle: 'Cencurity Security Center',
        configurationNamespace: 'cencurity',
        devConfigKey: 'cencurity.devConfig'
      });
    }),
    vscode.commands.registerCommand('cencurity.startLocalStack', async () => {
      const terminal = vscode.window.createTerminal({
        name: 'Cencurity Local Stack',
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      });
      terminal.show(true);
      terminal.sendText('docker compose up -d');
    }),
    vscode.commands.registerCommand('cencurity.openBrowserDashboard', async () => {
      const config = vscode.workspace.getConfiguration('cencurity');
      const baseUrl = String(config.get('dashboardBaseUrl', 'http://localhost:18080')).replace(/\/+$/, '');
      await vscode.env.openExternal(vscode.Uri.parse(baseUrl));
    }),
    vscode.commands.registerCommand('cencurity.copyProxyBaseUrl', async () => {
      const config = vscode.workspace.getConfiguration('cencurity');
      const proxyUrl = String(config.get('proxyBaseUrl', 'http://localhost:18082')).replace(/\/+$/, '');
      await vscode.env.clipboard.writeText(proxyUrl);
      vscode.window.showInformationMessage(`Cencurity proxy URL copied: ${proxyUrl}`);
    })
  );
}

function deactivate() {
  runtime.deactivateCore();
}

module.exports = {
  activate,
  deactivate
};
