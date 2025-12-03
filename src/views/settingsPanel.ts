import * as vscode from 'vscode';
import { supabaseService, UserProfile } from '../services/supabase';

interface Secret {
  name: string;
  value: string;
  createdAt: string;
}

export class SettingsPanelProvider {
  public static currentPanel: SettingsPanelProvider | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _context: vscode.ExtensionContext | undefined;
  private _userProfile: UserProfile | null = null;


  public static createOrShow(extensionUri: vscode.Uri, context?: vscode.ExtensionContext) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (SettingsPanelProvider.currentPanel) {
      SettingsPanelProvider.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'codelessaiSettings',
      'CodelessAI Settings',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    );

    SettingsPanelProvider.currentPanel = new SettingsPanelProvider(panel, extensionUri, context);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context?: vscode.ExtensionContext) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._context = context;

    this._loadUserProfile();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'connectGitHub':
            await this._connectGitHub();
            break;
          case 'disconnectGitHub':
            await this._disconnectGitHub();
            break;
          case 'connectSupabase':
            await this._connectSupabase();
            break;
          case 'disconnectSupabase':
            await this._disconnectSupabase();
            break;
          case 'saveRules':
            await this._saveRules(message.rules);
            break;
          case 'addSecret':
            await this._addSecret(message.name, message.value);
            break;
          case 'deleteSecret':
            await this._deleteSecret(message.name);
            break;
          case 'openExternal':
            vscode.env.openExternal(vscode.Uri.parse(message.url));
            break;
          case 'upgradePlan':
            vscode.env.openExternal(vscode.Uri.parse('https://codelessai.dev/pricing'));
            break;
          case 'manageBilling':
            vscode.env.openExternal(vscode.Uri.parse('https://codelessai.dev/billing'));
            break;
        }
      },
      null,
      this._disposables
    );
  }


  private async _loadUserProfile() {
    try {
      this._userProfile = await supabaseService.getProfile();
    } catch (e) {
      this._userProfile = null;
    }
    this._update();
  }
  // Connection handlers
  private async _connectGitHub() {
    vscode.window.showInformationMessage('GitHub OAuth integration coming soon!');
    // TODO: Implement GitHub OAuth flow
  }

  private async _disconnectGitHub() {
    const config = vscode.workspace.getConfiguration('codelessai');
    await config.update('githubConnected', false, vscode.ConfigurationTarget.Global);
    this._update();
    vscode.window.showInformationMessage('GitHub disconnected');
  }

  private async _connectSupabase() {
    vscode.window.showInformationMessage('Supabase connection coming soon!');
    // TODO: Implement Supabase connection
  }

  private async _disconnectSupabase() {
    const config = vscode.workspace.getConfiguration('codelessai');
    await config.update('supabaseConnected', false, vscode.ConfigurationTarget.Global);
    this._update();
    vscode.window.showInformationMessage('Supabase disconnected');
  }

  // Rules handlers
  private async _saveRules(rules: string) {
    const config = vscode.workspace.getConfiguration('codelessai');
    await config.update('aiRules', rules, vscode.ConfigurationTarget.Global);
    await config.update('aiRulesUpdatedAt', new Date().toISOString(), vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage('AI rules saved successfully!');
    this._update();
  }

  // Secrets handlers
  private _getSecrets(): Secret[] {
    if (!this._context) return [];
    return this._context.globalState.get<Secret[]>('codelessai.secrets', []);
  }

  private async _saveSecrets(secrets: Secret[]) {
    if (!this._context) return;
    await this._context.globalState.update('codelessai.secrets', secrets);
  }

  private async _addSecret(name: string, value: string) {
    if (!name || !value) {
      vscode.window.showErrorMessage('Secret name and value are required');
      return;
    }

    const secrets = this._getSecrets();
    const existing = secrets.find(s => s.name === name);
    
    if (existing) {
      existing.value = value;
      existing.createdAt = new Date().toISOString();
    } else {
      secrets.push({
        name,
        value,
        createdAt: new Date().toISOString()
      });
    }

    await this._saveSecrets(secrets);
    vscode.window.showInformationMessage(`Secret "${name}" saved!`);
    this._update();
  }

  private async _deleteSecret(name: string) {
    const secrets = this._getSecrets();
    const filtered = secrets.filter(s => s.name !== name);
    await this._saveSecrets(filtered);
    vscode.window.showInformationMessage(`Secret "${name}" deleted`);
    this._update();
  }

  public dispose() {
    SettingsPanelProvider.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) x.dispose();
    }
  }

  private _update() {
    this._panel.webview.html = this._getHtmlForWebview();
  }

  private _getHtmlForWebview() {
    const config = vscode.workspace.getConfiguration('codelessai');
    const githubConnected = config.get<boolean>('githubConnected', false);
    const supabaseConnected = config.get<boolean>('supabaseConnected', false);
    const aiRules = config.get<string>('aiRules', '');
    const aiRulesUpdatedAt = config.get<string>('aiRulesUpdatedAt', '');
    const secrets = this._getSecrets();

    // Get user profile for subscription info
    // User profile will be fetched asynchronously
    
    const plan = this._userProfile?.plan || 'free';
    const tokensUsed = this._userProfile?.tokens_used || 0;
    const tokensLimit = this._userProfile?.tokens_limit || 10000;
    const usagePercent = Math.min((tokensUsed / tokensLimit) * 100, 100);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CodelessAI Settings</title>
  <style>
    :root {
      --bg-base: #0d1117;
      --bg-surface: #161b22;
      --bg-elevated: #21262d;
      --bg-input: #0d1117;
      --border: #30363d;
      --border-focus: #58a6ff;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --text-subtle: #6e7681;
      --accent: #58a6ff;
      --accent-hover: #79c0ff;
      --success: #3fb950;
      --warning: #d29922;
      --error: #f85149;
      --pro-gradient: linear-gradient(135deg, #7c3aed, #2563eb);
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-base);
      color: var(--text);
      height: 100vh;
      display: flex;
    }

    /* Sidebar */
    .sidebar {
      width: 200px;
      background: var(--bg-surface);
      border-right: 1px solid var(--border);
      padding: 20px 0;
      flex-shrink: 0;
    }

    .sidebar-header {
      padding: 0 16px 20px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 12px;
    }

    .sidebar-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .sidebar-title svg {
      width: 18px;
      height: 18px;
      color: var(--accent);
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      border: none;
      background: none;
      width: 100%;
      text-align: left;
      transition: all 0.15s ease;
    }

    .nav-item:hover {
      background: var(--bg-elevated);
      color: var(--text);
    }

    .nav-item.active {
      background: var(--bg-elevated);
      color: var(--accent);
      border-left: 2px solid var(--accent);
    }

    .nav-item svg {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }

    /* Content */
    .content {
      flex: 1;
      padding: 32px;
      overflow-y: auto;
      max-width: 800px;
    }

    .tab-content {
      display: none;
    }

    .tab-content.active {
      display: block;
      animation: fadeIn 0.2s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .section-title {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .section-desc {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 24px;
    }

    /* Connection Cards */
    .connection-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      margin-bottom: 12px;
      transition: border-color 0.15s ease;
    }

    .connection-card:hover {
      border-color: var(--border-focus);
    }

    .connection-card.connected {
      border-color: var(--success);
      background: rgba(63, 185, 80, 0.05);
    }

    .connection-info {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .connection-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: var(--bg-elevated);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .connection-icon svg {
      width: 22px;
      height: 22px;
    }

    .connection-icon.github { color: #e6edf3; }
    .connection-icon.supabase { color: #3ecf8e; }
    .connection-icon.jira { color: #0052cc; }
    .connection-icon.slack { color: #e01e5a; }

    .connection-details h3 {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .connection-details p {
      font-size: 12px;
      color: var(--text-muted);
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      padding: 4px 10px;
      border-radius: 20px;
      font-weight: 500;
    }

    .status-badge.connected {
      background: rgba(63, 185, 80, 0.15);
      color: var(--success);
    }

    .status-badge.coming-soon {
      background: rgba(139, 148, 158, 0.15);
      color: var(--text-muted);
    }

    /* Buttons */
    .btn {
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: all 0.15s ease;
    }

    .btn-primary {
      background: var(--accent);
      color: #fff;
    }

    .btn-primary:hover {
      background: var(--accent-hover);
    }

    .btn-secondary {
      background: var(--bg-elevated);
      color: var(--text);
      border: 1px solid var(--border);
    }

    .btn-secondary:hover {
      background: var(--bg-surface);
      border-color: var(--text-muted);
    }

    .btn-danger {
      background: transparent;
      color: var(--error);
      border: 1px solid var(--error);
    }

    .btn-danger:hover {
      background: rgba(248, 81, 73, 0.1);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Rules textarea */
    .rules-container {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
    }

    .rules-textarea {
      width: 100%;
      min-height: 200px;
      padding: 16px;
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      font-size: 13px;
      line-height: 1.6;
      resize: vertical;
      transition: border-color 0.15s ease;
    }

    .rules-textarea:focus {
      outline: none;
      border-color: var(--accent);
    }

    .rules-textarea::placeholder {
      color: var(--text-subtle);
    }

    .rules-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 16px;
    }

    .rules-meta {
      font-size: 12px;
      color: var(--text-muted);
    }

    .char-count {
      font-size: 12px;
      color: var(--text-muted);
    }

    .char-count.warning { color: var(--warning); }
    .char-count.error { color: var(--error); }

    .tips-box {
      margin-top: 20px;
      padding: 16px;
      background: rgba(88, 166, 255, 0.08);
      border: 1px solid rgba(88, 166, 255, 0.2);
      border-radius: 8px;
    }

    .tips-box h4 {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 10px;
      color: var(--accent);
    }

    .tips-box ul {
      list-style: none;
      font-size: 12px;
      color: var(--text-muted);
    }

    .tips-box li {
      padding: 4px 0;
      padding-left: 16px;
      position: relative;
    }

    .tips-box li::before {
      content: "•";
      position: absolute;
      left: 0;
      color: var(--accent);
    }

    /* Subscription */
    .plan-header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
    }

    .plan-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 20px;
      border-radius: 24px;
      font-size: 16px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .plan-badge.free {
      background: var(--bg-elevated);
      color: var(--text);
      border: 1px solid var(--border);
    }

    .plan-badge.pro {
      background: var(--pro-gradient);
      color: #fff;
    }

    .plan-badge svg {
      width: 18px;
      height: 18px;
    }

    .usage-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 20px;
    }

    .usage-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .usage-title {
      font-size: 14px;
      font-weight: 600;
    }

    .usage-value {
      font-size: 14px;
      color: var(--accent);
      font-weight: 500;
    }

    .usage-bar {
      height: 8px;
      background: var(--bg-elevated);
      border-radius: 4px;
      overflow: hidden;
    }

    .usage-fill {
      height: 100%;
      background: var(--accent);
      border-radius: 4px;
      transition: width 0.3s ease;
    }

    .usage-fill.warning { background: var(--warning); }
    .usage-fill.danger { background: var(--error); }

    .usage-footer {
      margin-top: 12px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .upgrade-card {
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.1), rgba(37, 99, 235, 0.1));
      border: 1px solid rgba(124, 58, 237, 0.3);
      border-radius: 12px;
      padding: 24px;
      text-align: center;
    }

    .upgrade-card h3 {
      font-size: 18px;
      margin-bottom: 8px;
    }

    .upgrade-card p {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 20px;
    }

    .upgrade-features {
      display: flex;
      justify-content: center;
      gap: 24px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .upgrade-feature {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--text);
    }

    .upgrade-feature svg {
      width: 16px;
      height: 16px;
      color: var(--success);
    }

    /* Secrets */
    .secrets-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }

    .add-secret-form {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
      padding: 20px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 12px;
    }

    .form-group {
      flex: 1;
    }

    .form-label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      margin-bottom: 6px;
      color: var(--text-muted);
    }

    .form-input {
      width: 100%;
      padding: 10px 14px;
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 13px;
      transition: border-color 0.15s ease;
    }

    .form-input:focus {
      outline: none;
      border-color: var(--accent);
    }

    .form-input::placeholder {
      color: var(--text-subtle);
    }

    .secrets-list {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }

    .secret-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
    }

    .secret-item:last-child {
      border-bottom: none;
    }

    .secret-info {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .secret-icon {
      width: 36px;
      height: 36px;
      background: var(--bg-elevated);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--warning);
    }

    .secret-icon svg {
      width: 18px;
      height: 18px;
    }

    .secret-name {
      font-size: 14px;
      font-weight: 500;
      font-family: 'SF Mono', Monaco, monospace;
    }

    .secret-value {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .secret-actions {
      display: flex;
      gap: 8px;
    }

    .icon-btn {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      border: none;
      background: var(--bg-elevated);
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }

    .icon-btn:hover {
      background: var(--bg-base);
      color: var(--text);
    }

    .icon-btn.delete:hover {
      background: rgba(248, 81, 73, 0.1);
      color: var(--error);
    }

    .icon-btn svg {
      width: 16px;
      height: 16px;
    }

    .empty-state {
      text-align: center;
      padding: 48px 20px;
      color: var(--text-muted);
    }

    .empty-state svg {
      width: 48px;
      height: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }

    .empty-state p {
      font-size: 14px;
      margin-bottom: 8px;
    }

    .empty-state small {
      font-size: 12px;
      color: var(--text-subtle);
    }

    .usage-hint {
      margin-top: 16px;
      padding: 12px 16px;
      background: rgba(88, 166, 255, 0.08);
      border-radius: 8px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .usage-hint code {
      background: var(--bg-elevated);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'SF Mono', Monaco, monospace;
      color: var(--accent);
    }
  </style>
</head>
<body>
  <div class="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"></path>
        </svg>
        Settings
      </div>
    </div>

    <button class="nav-item active" data-tab="connections">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"></path>
        <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"></path>
      </svg>
      Connections
    </button>

    <button class="nav-item" data-tab="rules">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"></path>
        <polyline points="14,2 14,8 20,8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10,9 9,9 8,9"></polyline>
      </svg>
      Rules for AI
    </button>

    <button class="nav-item" data-tab="subscription">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
        <line x1="1" y1="10" x2="23" y2="10"></line>
      </svg>
      Subscription
    </button>

    <button class="nav-item" data-tab="secrets">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0110 0v4"></path>
      </svg>
      Secrets
    </button>
  </div>

  <div class="content">
    <!-- Connections Tab -->
    <div class="tab-content active" id="connections">
      <h1 class="section-title">Connections</h1>
      <p class="section-desc">Connect external services to enhance AI capabilities with your data.</p>

      <div class="connection-card ${githubConnected ? 'connected' : ''}">
        <div class="connection-info">
          <div class="connection-icon github">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
          </div>
          <div class="connection-details">
            <h3>GitHub</h3>
            <p>Access repositories, issues, and pull requests</p>
          </div>
        </div>
        ${githubConnected 
          ? '<span class="status-badge connected">✓ Connected</span><button class="btn btn-danger" onclick="disconnectGitHub()">Disconnect</button>'
          : '<button class="btn btn-primary" onclick="connectGitHub()">Connect</button>'
        }
      </div>

      <div class="connection-card ${supabaseConnected ? 'connected' : ''}">
        <div class="connection-info">
          <div class="connection-icon supabase">
            <svg viewBox="0 0 109 113" fill="currentColor"><path d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z"/><path d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z" fill-opacity="0.2"/><path d="M45.317 2.07103C48.1765 -1.53037 53.9745 0.442937 54.0434 5.041L54.4849 72.2922H9.83113C1.64038 72.2922 -2.92775 62.8321 2.1655 56.4175L45.317 2.07103Z"/></svg>
          </div>
          <div class="connection-details">
            <h3>Supabase</h3>
            <p>Database queries and authentication context</p>
          </div>
        </div>
        ${supabaseConnected 
          ? '<span class="status-badge connected">✓ Connected</span><button class="btn btn-danger" onclick="disconnectSupabase()">Disconnect</button>'
          : '<button class="btn btn-primary" onclick="connectSupabase()">Connect</button>'
        }
      </div>

      <div class="connection-card">
        <div class="connection-info">
          <div class="connection-icon jira">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 11.513H0a5.218 5.218 0 005.232 5.215h2.13v2.057A5.215 5.215 0 0012.575 24V12.518a1.005 1.005 0 00-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 005.215 5.214h2.129v2.058a5.218 5.218 0 005.215 5.214V6.758a1.001 1.001 0 00-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 005.215 5.215h2.129v2.057A5.215 5.215 0 0024 12.483V1.005A1.005 1.005 0 0023.013 0z"/></svg>
          </div>
          <div class="connection-details">
            <h3>Jira</h3>
            <p>Issue tracking and project management</p>
          </div>
        </div>
        <span class="status-badge coming-soon">Coming Soon</span>
      </div>

      <div class="connection-card">
        <div class="connection-info">
          <div class="connection-icon slack">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 01-2.52-2.523 2.526 2.526 0 012.52-2.52h6.313A2.527 2.527 0 0124 15.165a2.528 2.528 0 01-2.522 2.523h-6.313z"/></svg>
          </div>
          <div class="connection-details">
            <h3>Slack</h3>
            <p>Team notifications and updates</p>
          </div>
        </div>
        <span class="status-badge coming-soon">Coming Soon</span>
      </div>
    </div>

    <!-- Rules Tab -->
    <div class="tab-content" id="rules">
      <h1 class="section-title">Rules for AI</h1>
      <p class="section-desc">Custom instructions that apply to all conversations with CodelessAI.</p>

      <div class="rules-container">
        <textarea 
          class="rules-textarea" 
          id="rulesTextarea"
          placeholder="Enter your custom rules here...

Examples:
- Always use TypeScript with strict types
- Prefer functional components in React
- Add JSDoc comments to all functions
- Follow our coding standards
- Use descriptive variable names"
          maxlength="2000"
        >${aiRules}</textarea>

        <div class="rules-footer">
          <div class="rules-meta">
            ${aiRulesUpdatedAt ? `Last saved: ${new Date(aiRulesUpdatedAt).toLocaleDateString()}` : 'Not saved yet'}
          </div>
          <div style="display: flex; align-items: center; gap: 16px;">
            <span class="char-count" id="charCount">0 / 2000</span>
            <button class="btn btn-primary" onclick="saveRules()">Save Rules</button>
          </div>
        </div>
      </div>

      <div class="tips-box">
        <h4>💡 Tips for effective rules</h4>
        <ul>
          <li>Be specific about coding standards and conventions</li>
          <li>Mention preferred frameworks or libraries</li>
          <li>Include team-specific naming conventions</li>
          <li>Reference documentation files (e.g., ./CONVENTIONS.md)</li>
          <li>Specify error handling preferences</li>
        </ul>
      </div>
    </div>

    <!-- Subscription Tab -->
    <div class="tab-content" id="subscription">
      <h1 class="section-title">Subscription</h1>
      <p class="section-desc">Manage your plan and monitor usage.</p>

      <div class="plan-header">
        <span class="plan-badge ${plan}">
          ${plan === 'pro' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>' : ''}
          ${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan
        </span>
      </div>

      <div class="usage-card">
        <div class="usage-header">
          <span class="usage-title">Token Usage</span>
          <span class="usage-value">${tokensUsed.toLocaleString()} / ${tokensLimit.toLocaleString()}</span>
        </div>
        <div class="usage-bar">
          <div class="usage-fill ${usagePercent > 90 ? 'danger' : usagePercent > 70 ? 'warning' : ''}" style="width: ${usagePercent}%"></div>
        </div>
        <div class="usage-footer">
          ${usagePercent > 90 
            ? '⚠️ You are running low on tokens. Consider upgrading.' 
            : `${(tokensLimit - tokensUsed).toLocaleString()} tokens remaining`
          }
        </div>
      </div>

      ${plan === 'free' ? `
      <div class="upgrade-card">
        <h3>Upgrade to Pro</h3>
        <p>Unlock unlimited potential with our Pro plan</p>
        <div class="upgrade-features">
          <div class="upgrade-feature">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.854 3.646a.5.5 0 010 .708l-7 7a.5.5 0 01-.708 0l-3.5-3.5a.5.5 0 11.708-.708L6.5 10.293l6.646-6.647a.5.5 0 01.708 0z"/></svg>
            Unlimited tokens
          </div>
          <div class="upgrade-feature">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.854 3.646a.5.5 0 010 .708l-7 7a.5.5 0 01-.708 0l-3.5-3.5a.5.5 0 11.708-.708L6.5 10.293l6.646-6.647a.5.5 0 01.708 0z"/></svg>
            All AI models
          </div>
          <div class="upgrade-feature">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.854 3.646a.5.5 0 010 .708l-7 7a.5.5 0 01-.708 0l-3.5-3.5a.5.5 0 11.708-.708L6.5 10.293l6.646-6.647a.5.5 0 01.708 0z"/></svg>
            Priority support
          </div>
        </div>
        <button class="btn btn-primary" onclick="upgradePlan()">Upgrade to Pro — $20/mo</button>
      </div>
      ` : `
      <div style="text-align: center; padding: 20px;">
        <button class="btn btn-secondary" onclick="manageBilling()">Manage Billing</button>
      </div>
      `}
    </div>

    <!-- Secrets Tab -->
    <div class="tab-content" id="secrets">
      <h1 class="section-title">Secrets</h1>
      <p class="section-desc">Store sensitive values securely for use in your prompts.</p>

      <div class="add-secret-form">
        <div class="form-group">
          <label class="form-label">Name</label>
          <input type="text" class="form-input" id="secretName" placeholder="API_KEY">
        </div>
        <div class="form-group">
          <label class="form-label">Value</label>
          <input type="password" class="form-input" id="secretValue" placeholder="Enter secret value">
        </div>
        <div style="display: flex; align-items: flex-end;">
          <button class="btn btn-primary" onclick="addSecret()">Add Secret</button>
        </div>
      </div>

      <div class="secrets-list">
        ${secrets.length === 0 ? `
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0110 0v4"></path>
            </svg>
            <p>No secrets yet</p>
            <small>Add your first secret to get started</small>
          </div>
        ` : secrets.map(secret => `
          <div class="secret-item">
            <div class="secret-info">
              <div class="secret-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
                </svg>
              </div>
              <div>
                <div class="secret-name">\${${secret.name}}</div>
                <div class="secret-value">••••••••••••</div>
              </div>
            </div>
            <div class="secret-actions">
              <button class="icon-btn" onclick="copySecretRef('${secret.name}')" title="Copy reference">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                </svg>
              </button>
              <button class="icon-btn delete" onclick="deleteSecret('${secret.name}')" title="Delete">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3,6 5,6 21,6"></polyline>
                  <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                </svg>
              </button>
            </div>
          </div>
        `).join('')}
      </div>

      ${secrets.length > 0 ? `
        <div class="usage-hint">
          💡 <strong>Usage:</strong> Reference secrets in your prompts using <code>\${SECRET_NAME}</code> syntax.
        </div>
      ` : ''}
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // Tab navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        item.classList.add('active');
        document.getElementById(item.dataset.tab).classList.add('active');
      });
    });

    // Character counter for rules
    const rulesTextarea = document.getElementById('rulesTextarea');
    const charCount = document.getElementById('charCount');

    function updateCharCount() {
      const count = rulesTextarea.value.length;
      charCount.textContent = count + ' / 2000';
      charCount.className = 'char-count';
      if (count > 1800) charCount.classList.add('warning');
      if (count >= 2000) charCount.classList.add('error');
    }

    rulesTextarea.addEventListener('input', updateCharCount);
    updateCharCount();

    // Connection functions
    function connectGitHub() {
      vscode.postMessage({ type: 'connectGitHub' });
    }

    function disconnectGitHub() {
      vscode.postMessage({ type: 'disconnectGitHub' });
    }

    function connectSupabase() {
      vscode.postMessage({ type: 'connectSupabase' });
    }

    function disconnectSupabase() {
      vscode.postMessage({ type: 'disconnectSupabase' });
    }

    // Rules functions
    function saveRules() {
      vscode.postMessage({ type: 'saveRules', rules: rulesTextarea.value });
    }

    // Subscription functions
    function upgradePlan() {
      vscode.postMessage({ type: 'upgradePlan' });
    }

    function manageBilling() {
      vscode.postMessage({ type: 'manageBilling' });
    }

    // Secrets functions
    function addSecret() {
      const name = document.getElementById('secretName').value.trim();
      const value = document.getElementById('secretValue').value;
      if (!name || !value) {
        alert('Please enter both name and value');
        return;
      }
      vscode.postMessage({ type: 'addSecret', name, value });
      document.getElementById('secretName').value = '';
      document.getElementById('secretValue').value = '';
    }

    function deleteSecret(name) {
      if (confirm('Delete secret "' + name + '"?')) {
        vscode.postMessage({ type: 'deleteSecret', name });
      }
    }

    function copySecretRef(name) {
      navigator.clipboard.writeText('\${' + name + '}');
      // Show feedback
      const btn = event.target.closest('.icon-btn');
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2"><polyline points="20,6 9,17 4,12"></polyline></svg>';
      setTimeout(() => btn.innerHTML = originalHTML, 1500);
    }
  </script>
</body>
</html>`;
  }
}
