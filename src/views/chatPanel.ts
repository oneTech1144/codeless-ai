import * as vscode from 'vscode';
import { ProviderManager, Message } from '../providers';
import { ContextService } from '../services/context';
import { AuthService } from '../services/auth';
import { AgentIntegration } from '../services/agentIntegration';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codelessai.chatView';
  private _view?: vscode.WebviewView;
  private messages: ChatMessage[] = [];
  private conversations: Conversation[] = [];
  private activeConversationId: string | null = null;
  private attachedFiles: Array<{name: string; content: string; language: string}> = [];
  private isLoading = false;
  private abortController?: AbortController;
  private context?: vscode.ExtensionContext;
  private authService = AuthService.getInstance();
  private agentIntegration?: AgentIntegration;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private providerManager: ProviderManager
  ) {}

  public setContext(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadConversations();
    this.authService.setContext(context);
    this.authService.onAuthStateChanged(() => this._updateView());
    
    // Initialize agent integration with auto-fix callbacks
    this.agentIntegration = new AgentIntegration(this.providerManager, {
      maxAutoFixRetries: 3,
      onStatusUpdate: (status, success) => {
        this._view?.webview.postMessage({ type: 'autoFixStatus', status, success });
      },
      onPendingApprovals: (approvals) => {
        this._view?.webview.postMessage({
          type: 'pendingApprovals',
          approvals: approvals.map(a => ({ ...a, id: Math.random().toString(36).substring(7) }))
        });
      }
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'sendMessage':
          await this.handleUserMessage(data.message);
          break;
        case 'newChat':
          this.startNewConversation();
          break;
        case 'loadConversation':
          this.loadConversation(data.id);
          break;
        case 'deleteConversation':
          this.deleteConversation(data.id);
          break;
        case 'clearAllConversations':
          this.clearAllConversations();
          break;
        case 'exportConversations':
          this.exportConversations();
          break;
        case 'importConversations':
          this.importConversations();
          break;
        case 'attachFile':
          await this.attachFile();
          break;
        case 'attachCurrentFile':
          await this.attachCurrentFile();
          break;
        case 'removeAttachment':
          this.removeAttachment(data.index);
          break;
        case 'insertCode':
          await ContextService.insertAtCursor(data.code);
          break;
        case 'copyCode':
          await vscode.env.clipboard.writeText(data.code);
          vscode.window.showInformationMessage('Copied to clipboard');
          break;
        case 'abort':
          this.abortController?.abort();
          break;
        case 'switchProvider':
          vscode.commands.executeCommand('codelessai.switchProvider');
          break;
        case 'openSettings':
        case 'openSettingsPanel':
          vscode.commands.executeCommand('codelessai.openSettingsPanel');
          break;
        case 'openHelp':
          vscode.env.openExternal(vscode.Uri.parse('https://codelessai.dev/docs'));
          break;
        case 'openAccountBilling':
          vscode.commands.executeCommand('codelessai.openSettingsPanel');
          break;
        case 'signOut':
          vscode.window.showInformationMessage('Sign out functionality coming soon!');
          break;
        case 'openSettings':
        case 'openSettingsPanel':
          vscode.commands.executeCommand('codelessai.openSettingsPanel');
          break;
        case 'openHelp':
          vscode.env.openExternal(vscode.Uri.parse('https://codelessai.dev/docs'));
          break;
        case 'openAccountBilling':
          vscode.commands.executeCommand('codelessai.openSettingsPanel');
          break;
        case 'signOut':
          vscode.window.showInformationMessage('Sign out functionality coming soon!');
          break;
        case 'openSettings':
        case 'openSettingsPanel':
          vscode.commands.executeCommand('codelessai.openSettingsPanel');
          break;
        case 'openHelp':
          vscode.env.openExternal(vscode.Uri.parse('https://codelessai.dev/docs'));
          break;
        case 'openAccountBilling':
          vscode.commands.executeCommand('codelessai.openSettingsPanel');
          break;
        case 'signOut':
          vscode.window.showInformationMessage('Sign out functionality coming soon!');
          break;
        case 'quickAction':
          this.executeQuickAction(data.action);
          break;
        case 'feedback':
          this.handleFeedback(data.rating, data.messageIndex);
          break;
        case 'startSignIn':
          await this.authService.startAuth();
          break;
        case 'startSignUp':
          await this.authService.startAuth();
          break;
        case 'cancelAuth':
          this.authService.cancelAuth();
          break;
        case 'mockLogin':
          await this.authService.mockLogin();
          break;
        case 'signOut':
          await this.authService.signOut();
          break;
        case 'approveAction':
          await this.handleApproval(data.action, true);
          break;
        case 'rejectAction':
          // Just remove the card, no action needed
          break;
      }
    });

    this.updateWebview();
    this.updateConversationList();
  }

  private async executeQuickAction(action: string) {
    const ctx = ContextService.getActiveContext();
    if (!ctx) {
      vscode.window.showWarningMessage('Open a file first');
      return;
    }
    
    const code = ctx.selection || ctx.content || '';
    const prompts: Record<string, string> = {
      explain: `Explain this ${ctx.language} code:\n\n\`\`\`${ctx.language}\n${code}\n\`\`\``,
      fix: `Fix any bugs in this code:\n\n\`\`\`${ctx.language}\n${code}\n\`\`\``,
      refactor: `Refactor this code for better readability:\n\n\`\`\`${ctx.language}\n${code}\n\`\`\``,
      test: `Generate unit tests for:\n\n\`\`\`${ctx.language}\n${code}\n\`\`\``,
      docs: `Add documentation comments:\n\n\`\`\`${ctx.language}\n${code}\n\`\`\``,
    };
    
    const prompt = prompts[action];
    if (prompt) {
      await this.handleUserMessage(prompt);
    }
  }

  private async handleApproval(action: any, approved: boolean): Promise<void> {
    if (!approved) return;
    
    try {
      if (action.type === 'delete' && action.path) {
        // Execute file delete
        const { agentService } = await import('../services/agentService');
        await agentService.executeDelete(action.path);
        vscode.window.showInformationMessage('File deleted: ' + action.path);
      } else if (action.type === 'command' && action.command) {
        // Execute terminal command
        const { agentService } = await import('../services/agentService');
        const result = await agentService.executeCommandWithOutput(action.command, action.cwd);
        if (!result.success) {
          vscode.window.showWarningMessage('Command failed: ' + (result.error || 'Unknown error'));
        }
      }
    } catch (error: any) {
      vscode.window.showErrorMessage('Action failed: ' + error.message);
    }
  }

  private handleFeedback(rating: 'up' | 'down', messageIndex: number) {
    vscode.window.showInformationMessage(`Feedback recorded: ${rating === 'up' ? '👍' : '👎'}`);
  }

  private async handleUserMessage(content: string) {
    if (!content.trim() || this.isLoading) return;

    if (!this.activeConversationId) {
      this.startNewConversation();
    }

    let fullContent = content;
    if (this.attachedFiles.length > 0) {
      fullContent += '\n\n**Attached Files:**\n';
      for (const file of this.attachedFiles) {
        fullContent += `\n### ${file.name}\n\`\`\`${file.language}\n${file.content}\n\`\`\`\n`;
      }
      this.attachedFiles = [];
      this.updateAttachments();
    }

    const userMsg: ChatMessage = { role: 'user', content: fullContent, timestamp: Date.now() };
    this.messages.push(userMsg);
    this.updateWebview();

    if (!this.providerManager.isConfigured()) {
      const errorMsg: ChatMessage = {
        role: 'assistant',
        content: '⚠️ **API key not configured**\n\nGo to Settings → CodelessAI to configure your API key.',
        timestamp: Date.now()
      };
      this.messages.push(errorMsg);
      this.updateWebview();
      return;
    }

    this.isLoading = true;
    this.abortController = new AbortController();
    this.updateLoadingState(true);

    try {
      const ctx = ContextService.getActiveContext();
      
      const systemPrompt = `You are CodelessAI, a professional AI coding assistant.
${ctx ? `Current context: ${ctx.fileName} (${ctx.language})` : ''}
Provide clear, concise responses. Format code in markdown with language tags.`;

      const apiMessages: Message[] = this.messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      let assistantContent = '';
      const assistantMsg: ChatMessage = { role: 'assistant', content: '', timestamp: Date.now() };
      this.messages.push(assistantMsg);

      for await (const chunk of this.providerManager.streamChat(apiMessages, { systemPrompt })) {
        if (this.abortController.signal.aborted) break;
        assistantContent += chunk;
        assistantMsg.content = assistantContent;
        this.streamUpdate(assistantContent);
      }

      this.saveCurrentConversation();
      
      // Process AI response for file actions and terminal commands with auto-fix
      if (this.agentIntegration) {
        await this.agentIntegration.processAIResponse(assistantContent);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        const errorMsg: ChatMessage = {
          role: 'assistant',
          content: `❌ **Error:** ${error.message}`,
          timestamp: Date.now()
        };
        this.messages.push(errorMsg);
      }
    } finally {
      this.isLoading = false;
      this.updateLoadingState(false);
      this.updateWebview();
    }
  }

  private async attachFile() {
    const files = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: 'Attach',
      filters: { 'All Files': ['*'] }
    });
    if (!files) return;

    for (const file of files) {
      try {
        const doc = await vscode.workspace.openTextDocument(file);
        const content = doc.getText();
        if (content.length > 50000) {
          vscode.window.showWarningMessage(`${file.fsPath} is too large`);
          continue;
        }
        this.attachedFiles.push({
          name: file.fsPath.split('/').pop() || 'file',
          content: content.slice(0, 50000),
          language: doc.languageId
        });
      } catch (e) {
        vscode.window.showErrorMessage(`Could not read file`);
      }
    }
    this.updateAttachments();
  }

  private async attachCurrentFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active file');
      return;
    }
    
    const doc = editor.document;
    const content = doc.getText();
    if (content.length > 50000) {
      vscode.window.showWarningMessage('File is too large');
      return;
    }
    
    this.attachedFiles.push({
      name: doc.fileName.split('/').pop() || 'file',
      content: content.slice(0, 50000),
      language: doc.languageId
    });
    this.updateAttachments();
  }

  private removeAttachment(index: number) {
    this.attachedFiles.splice(index, 1);
    this.updateAttachments();
  }

  private updateAttachments() {
    this._view?.webview.postMessage({
      type: 'attachments',
      files: this.attachedFiles.map(f => f.name)
    });
  }

  private startNewConversation() {
    const conv: Conversation = {
      id: `conv_${Date.now()}`,
      title: 'New Chat',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.conversations.unshift(conv);
    this.activeConversationId = conv.id;
    this.messages = [];
    this.saveConversations();
    this.updateWebview();
    this.updateConversationList();
  }

  private loadConversation(id: string) {
    const conv = this.conversations.find(c => c.id === id);
    if (conv) {
      this.activeConversationId = id;
      this.messages = [...conv.messages];
      this.updateWebview();
    }
  }

  private deleteConversation(id: string) {
    this.conversations = this.conversations.filter(c => c.id !== id);
    if (this.activeConversationId === id) {
      this.activeConversationId = this.conversations[0]?.id || null;
      this.messages = this.activeConversationId 
        ? [...(this.conversations[0]?.messages || [])]
        : [];
    }
    this.saveConversations();
    this.updateWebview();
    this.updateConversationList();
  }


  private clearAllConversations() {
    this.conversations = [];
    this.activeConversationId = null;
    this.messages = [];
    this.saveConversations();
    this.updateConversationList();
    this.updateWebview();
    vscode.window.showInformationMessage('All conversations cleared!');
  }

  private saveCurrentConversation() {
    if (!this.activeConversationId) return;
    const conv = this.conversations.find(c => c.id === this.activeConversationId);
    if (conv) {
      conv.messages = [...this.messages];
      conv.updatedAt = Date.now();
      if (this.messages.length > 0 && conv.title === 'New Chat') {
        conv.title = this.messages[0].content.slice(0, 35) + '...';
      }
      this.saveConversations();
      this.updateConversationList();
    }
  }

  private loadConversations() {
    if (this.context) {
      const saved = this.context.globalState.get<Conversation[]>('codelessai.conversations', []);
      this.conversations = saved;
    }
  }

  private saveConversations() {
    if (this.context) {
      this.context.globalState.update('codelessai.conversations', this.conversations.slice(0, 50));
    }
  }

  private async exportConversations() {
    const data = JSON.stringify(this.conversations, null, 2);
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('codelessai-history.json'),
      filters: { 'JSON': ['json'] }
    });
    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(data));
      vscode.window.showInformationMessage('Conversations exported');
    }
  }

  private async importConversations() {
    const files = await vscode.window.showOpenDialog({ filters: { 'JSON': ['json'] } });
    if (!files?.[0]) return;
    
    try {
      const data = await vscode.workspace.fs.readFile(files[0]);
      const imported = JSON.parse(data.toString());
      if (Array.isArray(imported)) {
        this.conversations = [...imported, ...this.conversations];
        this.saveConversations();
        this.updateConversationList();
        vscode.window.showInformationMessage(`Imported ${imported.length} conversations`);
      }
    } catch (e) {
      vscode.window.showErrorMessage('Invalid JSON file');
    }
  }

  public addMessage(role: 'user' | 'assistant', content: string) {
    if (!this.activeConversationId) this.startNewConversation();
    this.messages.push({ role, content, timestamp: Date.now() });
    this.saveCurrentConversation();
    this.updateWebview();
  }

  
  /**
   * Fix a single diagnostic error with AI
   */
  public async fixDiagnostic(uri: vscode.Uri, diagnostic: vscode.Diagnostic): Promise<void> {
    if (!this.agentIntegration) {
      vscode.window.showErrorMessage('Agent integration not initialized');
      return;
    }

    this._view?.webview.postMessage({ type: 'autoFixStatus', status: '🔧 Fixing error with AI...', success: undefined });
    
    try {
      const result = await this.agentIntegration.fixSingleDiagnostic(uri, diagnostic);
      
      if (result) {
        this._view?.webview.postMessage({ type: 'autoFixStatus', status: '✅ Error fixed!', success: true });
        vscode.window.showInformationMessage('Error fixed successfully!');
      } else {
        this._view?.webview.postMessage({ type: 'autoFixStatus', status: '❌ Could not fix error', success: false });
        vscode.window.showWarningMessage('Could not automatically fix this error');
      }
    } catch (error) {
      console.error('[ChatPanel] Fix diagnostic error:', error);
      this._view?.webview.postMessage({ type: 'autoFixStatus', status: '❌ Fix failed', success: false });
    }
  }

  /**
   * Fix all diagnostics in a file
   */
  public async fixAllDiagnostics(uri: vscode.Uri): Promise<void> {
    if (!this.agentIntegration) {
      vscode.window.showErrorMessage('Agent integration not initialized');
      return;
    }

    this._view?.webview.postMessage({ type: 'autoFixStatus', status: '🔧 Fixing all errors...', success: undefined });
    
    try {
      const result = await this.agentIntegration.fixAllInFile(uri);
      
      if (result.success) {
        this._view?.webview.postMessage({ 
          type: 'autoFixStatus', 
          status: `✅ Fixed all ${result.errorsFixed} error(s)!`, 
          success: true 
        });
        vscode.window.showInformationMessage(`Fixed ${result.errorsFixed} error(s) successfully!`);
      } else {
        this._view?.webview.postMessage({ 
          type: 'autoFixStatus', 
          status: `⚠️ Fixed ${result.errorsFixed}, ${result.remainingErrors.length} remaining`, 
          success: false 
        });
        vscode.window.showWarningMessage(`Fixed ${result.errorsFixed} error(s), ${result.remainingErrors.length} remaining`);
      }
    } catch (error) {
      console.error('[ChatPanel] Fix all diagnostics error:', error);
      this._view?.webview.postMessage({ type: 'autoFixStatus', status: '❌ Fix failed', success: false });
    }
  }

  public updateProvider() {
    this.updateWebview();
  }


  private _updateView() {
    if (this._view) {
      this._view.webview.html = this._getHtmlForWebview(this._view.webview);
    }
  }
  private updateWebview() {
    const provider = this.providerManager.getActiveProviderType();
    const model = this.providerManager.getCurrentModel();
    this._view?.webview.postMessage({
      type: 'updateMessages',
      messages: this.messages,
      provider,
      model,
      configured: this.providerManager.isConfigured()
    });
  }

  private updateLoadingState(loading: boolean) {
    this._view?.webview.postMessage({ type: 'loading', loading });
  }

  private streamUpdate(content: string) {
    this._view?.webview.postMessage({ type: 'stream', content });
  }

  private updateConversationList() {
    this._view?.webview.postMessage({
      type: 'conversations',
      conversations: this.conversations.map(c => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        active: c.id === this.activeConversationId
      }))
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const authState = this.authService.authState;
    const isLoggedIn = authState === 'logged_in';
    const isAuthenticating = authState === 'authenticating';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CodelessAI</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg-base: #0d1117;
      --bg-surface: #161b22;
      --bg-elevated: #1f2937;
      --bg-input: #1f2937;
      --border: #30363d;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --text-subtle: #6e7681;
      --accent: #2563eb;
      --accent-hover: #3b82f6;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      color: var(--text);
      background: var(--bg-base);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border);
      min-height: 40px;
    }
    .header-left { display: flex; align-items: center; gap: 8px; }
    .header-right { display: flex; align-items: center; gap: 4px; }
    .menu-btn, .icon-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .menu-btn:hover, .icon-btn:hover {
      color: var(--text);
      background: var(--bg-elevated);
    }
    .menu-btn svg, .icon-btn svg { width: 16px; height: 16px; }
    .logo { font-size: 12px; font-weight: 600; letter-spacing: 0.3px; }


    /* Settings Dropdown */
    .settings-dropdown-container {
      position: relative;
    }
    .settings-dropdown {
      display: none;
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 4px;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 200;
      overflow: hidden;
    }
    .settings-dropdown.show { display: block; }
    .settings-dropdown-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      color: var(--text);
      font-size: 12px;
      cursor: pointer;
      border: none;
      background: none;
      width: 100%;
      text-align: left;
    }
    .settings-dropdown-item:hover {
      background: var(--bg-surface);
    }
    .settings-dropdown-item svg {
      width: 14px;
      height: 14px;
      color: var(--text-muted);
    }
    .settings-dropdown-divider {
      height: 1px;
      background: var(--border);
      margin: 4px 0;
    }
    /* Sidebar */
    .sidebar {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 100;
    }
    .sidebar.open { display: flex; }
    .sidebar-panel {
      width: 240px;
      background: var(--bg-surface);
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--border);
    }
    .sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px;
      border-bottom: 1px solid var(--border);
    }
    .sidebar-header h3 { font-size: 12px; font-weight: 600; }
    .sidebar-content { flex: 1; overflow-y: auto; padding: 8px; }
    .conv-item {
      display: flex;
      align-items: center;
      padding: 8px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      margin-bottom: 2px;
    }
    .conv-item:hover { background: var(--bg-elevated); }
    .conv-item.active { background: var(--accent); color: white; }
    .conv-item-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .conv-item-delete {
      opacity: 0;
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 2px;
      font-size: 11px;
    }
    .conv-item:hover .conv-item-delete { opacity: 1; }
    .sidebar-footer {
      padding: 10px;
      border-top: 1px solid var(--border);
      display: flex;
      gap: 6px;
    }
    .sidebar-btn {
      flex: 1;
      padding: 6px;
      font-size: 11px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--bg-elevated);
      color: var(--text);
      cursor: pointer;
    }
    .sidebar-btn:hover { background: var(--bg-input); }

    /* Messages */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }

    /* Empty State */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-top: 32px;
    }
    .empty-title { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
    .empty-subtitle { font-size: 12px; color: var(--text-muted); margin-bottom: 24px; }
    .suggestions { width: 100%; max-width: 280px; }
    .suggestion {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      margin-bottom: 8px;
      border-radius: 8px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      cursor: pointer;
      transition: all 0.15s;
    }
    .suggestion:hover {
      border-color: var(--accent);
      background: var(--bg-elevated);
    }
    .suggestion-icon { color: var(--accent); font-size: 11px; }
    .suggestion-text { font-size: 12px; color: var(--accent); }

    /* Message */
    .message { margin-bottom: 16px; }
    .message-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .avatar {
      width: 22px;
      height: 22px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      background: var(--bg-elevated);
    }
    .message.assistant .avatar { background: linear-gradient(135deg, #0078d4, #50a0e0); }
    .message-name { font-size: 12px; font-weight: 500; }
    .message-content { padding-left: 30px; line-height: 1.5; font-size: 13px; }
    .message-content code:not(pre code) {
      background: var(--bg-elevated);
      padding: 2px 5px;
      border-radius: 3px;
      font-size: 12px;
    }
    .message-content pre {
      margin: 10px 0;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    .message-content pre code {
      display: block;
      padding: 12px;
      font-size: 12px;
      line-height: 1.4;
    }
    .code-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 10px;
      background: var(--bg-elevated);
      font-size: 10px;
      color: var(--text-muted);
    }
    .code-actions { display: flex; gap: 4px; }
    .code-btn {
      padding: 2px 6px;
      font-size: 10px;
      border: none;
      border-radius: 3px;
      background: var(--bg-input);
      color: var(--text);
      cursor: pointer;
    }
    .code-btn:hover { background: var(--accent); }
    .message-footer { display: flex; gap: 6px; margin-top: 8px; padding-left: 30px; }
    .feedback-btn {
      background: none;
      border: none;
      color: var(--text-subtle);
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 12px;
    }
    .feedback-btn:hover { background: var(--bg-elevated); color: var(--text); }

    /* Loading */
    .loading {
      display: none;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      color: var(--text-muted);
      font-size: 11px;
    }
    .loading.show { display: flex; }
    .spinner {
      width: 12px;
      height: 12px;
      border: 2px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }


    /* Input Area - Card Style */
    .input-area {
      background: var(--bg-elevated);
      margin: 10px;
      padding: 12px;
      border-radius: 10px;
      border: 1px solid var(--border);
    }

    /* Top Toolbar */
    .input-top {
      display: flex;
      align-items: center;
      gap: 2px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .tool-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 5px 7px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .tool-btn:hover { color: var(--text); background: var(--bg-input); }
    .tool-btn svg { width: 14px; height: 14px; }
    .file-tags { display: flex; gap: 6px; margin-left: 6px; flex-wrap: wrap; }
    .file-tag {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      background: var(--bg-input);
      border-radius: 4px;
      font-size: 11px;
      color: var(--text);
    }
    .file-tag svg { width: 12px; height: 12px; color: var(--text-muted); }
    .file-tag .close {
      cursor: pointer;
      color: var(--text-muted);
      font-size: 10px;
      margin-left: 2px;
    }
    .file-tag .close:hover { color: var(--text); }

    /* Input Box */
    .input-box {
      background: var(--bg-input);
      border-radius: 8px;
      margin-bottom: 10px;
    }
    textarea {
      width: 100%;
      min-height: 36px;
      max-height: 100px;
      padding: 10px 12px;
      border: none;
      background: transparent;
      color: var(--text);
      font-family: inherit;
      font-size: 13px;
      resize: none;
      outline: none;
      line-height: 1.4;
    }
    textarea::placeholder { color: var(--text-subtle); }

    /* Bottom Toolbar */
    .input-bottom {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .auto-toggle {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px 4px 5px;
      background: var(--bg-input);
      border: none;
      border-radius: 12px;
      font-size: 11px;
      color: var(--text-muted);
      cursor: pointer;
    }
    .auto-toggle:hover { background: var(--border); }
    .auto-toggle .indicator {
      width: 14px;
      height: 14px;
      background: var(--text-subtle);
      border-radius: 50%;
    }
    .auto-toggle.active .indicator { background: var(--accent); }
    .chat-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 4px;
      display: flex;
    }
    .chat-btn:hover { color: var(--text); }
    .chat-btn svg { width: 14px; height: 14px; }
    .divider {
      width: 1px;
      height: 14px;
      background: var(--border);
      margin: 0 4px;
    }
    .model-selector {
      position: relative;
    }
    .model-btn {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 4px 8px;
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 11px;
      cursor: pointer;
      border-radius: 4px;
    }
    .model-btn:hover { color: var(--text); background: var(--bg-input); }
    .model-btn svg { width: 12px; height: 12px; }
    
    /* Model Dropdown */
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .model-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: none;
      z-index: 100;
      overflow: hidden;
    }
    .model-dropdown.show { display: block; }
    .model-option {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
    }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover { background: var(--bg-elevated); }
    .model-option.active { background: var(--bg-elevated); }
    .model-option-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-option-name {
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
    }
    .model-option-badge {
      font-size: 8px;
      padding: 1px 4px;
      background: var(--accent);
      color: white;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .model-option-desc {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }
    .spacer { flex: 1; }
    .action-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 5px;
      border-radius: 4px;
      display: flex;
    }
    .action-btn:hover { color: var(--text); background: var(--bg-input); }
    .action-btn svg { width: 14px; height: 14px; }
    .send-btn {
      width: 26px;
      height: 26px;
      border: none;
      border-radius: 4px;
      background: var(--accent);
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .send-btn:hover { background: var(--accent-hover); }
    .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .send-btn.loading { background: #d9534f; }
    .send-btn svg { width: 12px; height: 12px; }

    /* Responsive */
    @media (max-width: 300px) {
      .model-btn span { display: none; }
      .auto-toggle span:last-child { display: none; }
    }

    /* Auth Screens */
    .auth-screen {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      padding: 20px;
      text-align: center;
    }
    .auth-logo {
      width: 64px;
      height: 64px;
      background: var(--bg-elevated);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
      border: 1px solid var(--border);
    }
    .auth-logo svg { width: 32px; height: 32px; color: var(--accent); }
    .auth-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--text);
    }
    .auth-tagline {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 24px;
      line-height: 1.5;
    }
    .auth-btn {
      width: 100%;
      max-width: 220px;
      padding: 10px 20px;
      margin-bottom: 10px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: none;
    }
    .auth-btn-primary {
      background: var(--accent);
      color: #fff;
    }
    .auth-btn-primary:hover { background: var(--accent-hover); }
    .auth-btn-secondary {
      background: var(--bg-elevated);
      color: var(--text);
      border: 1px solid var(--border);
    }
    .auth-btn-secondary:hover { background: var(--border); }
    .auth-features {
      display: flex;
      gap: 8px;
      margin-top: 24px;
      flex-wrap: wrap;
      justify-content: center;
    }
    .auth-feature {
      padding: 6px 12px;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 20px;
      font-size: 11px;
      color: var(--text-muted);
    }
    .auth-waiting {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }
    .auth-waiting .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    .auth-waiting-text {
      font-size: 14px;
      color: var(--text);
    }
    .auth-waiting-subtext {
      font-size: 12px;
      color: var(--text-muted);
    }
    .auth-cancel {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 12px;
      cursor: pointer;
      margin-top: 12px;
    }
    .auth-cancel:hover { color: var(--text); text-decoration: underline; }
    .chat-container { display: none; }
    .chat-container.active { display: flex; flex-direction: column; height: 100vh; }

    /* Auto-fix status styles */
    .autofix-status {
      padding: 12px 16px;
      margin: 8px 0;
      border-radius: 8px;
      font-size: 13px;
      animation: fadeIn 0.3s ease;
    }
    .autofix-status.pending {
      background: rgba(255, 193, 7, 0.15);
      border: 1px solid rgba(255, 193, 7, 0.3);
      color: #ffc107;
    }
    .autofix-status.success {
      background: rgba(40, 167, 69, 0.15);
      border: 1px solid rgba(40, 167, 69, 0.3);
      color: #28a745;
    }
    .autofix-status.error {
      background: rgba(220, 53, 69, 0.15);
      border: 1px solid rgba(220, 53, 69, 0.3);
      color: #dc3545;
    }
    
    /* Approval card styles */
    .approval-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      margin: 12px 0;
      overflow: hidden;
      animation: fadeIn 0.3s ease;
    }
    .approval-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: rgba(255, 193, 7, 0.1);
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .approval-icon {
      font-size: 18px;
    }
    .approval-title {
      font-weight: 600;
      color: #ffc107;
    }
    .approval-content {
      padding: 12px 16px;
    }
    .approval-content code {
      display: block;
      padding: 8px 12px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      word-break: break-all;
    }
    .approval-actions {
      display: flex;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--vscode-panel-border);
    }
    .approve-btn, .reject-btn {
      flex: 1;
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .approve-btn {
      background: #238636;
      color: white;
    }
    .approve-btn:hover {
      background: #2ea043;
    }
    .reject-btn {
      background: #d73a49;
      color: white;
    }
    .reject-btn:hover {
      background: #cb2431;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Auto-fix status styles */
    .autofix-status {
      padding: 12px 16px;
      margin: 8px 0;
      border-radius: 8px;
      font-size: 13px;
      animation: fadeIn 0.3s ease;
    }
    .autofix-status.pending {
      background: rgba(255, 193, 7, 0.15);
      border: 1px solid rgba(255, 193, 7, 0.3);
      color: #ffc107;
    }
    .autofix-status.success {
      background: rgba(40, 167, 69, 0.15);
      border: 1px solid rgba(40, 167, 69, 0.3);
      color: #28a745;
    }
    .autofix-status.error {
      background: rgba(220, 53, 69, 0.15);
      border: 1px solid rgba(220, 53, 69, 0.3);
      color: #dc3545;
    }
    
    /* Approval card styles */
    .approval-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      margin: 12px 0;
      overflow: hidden;
      animation: fadeIn 0.3s ease;
    }
    .approval-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: rgba(255, 193, 7, 0.1);
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .approval-icon {
      font-size: 18px;
    }
    .approval-title {
      font-weight: 600;
      color: #ffc107;
    }
    .approval-content {
      padding: 12px 16px;
    }
    .approval-content code {
      display: block;
      padding: 8px 12px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      word-break: break-all;
    }
    .approval-actions {
      display: flex;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--vscode-panel-border);
    }
    .approve-btn, .reject-btn {
      flex: 1;
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .approve-btn {
      background: #238636;
      color: white;
    }
    .approve-btn:hover {
      background: #2ea043;
    }
    .reject-btn {
      background: #d73a49;
      color: white;
    }
    .reject-btn:hover {
      background: #cb2431;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <!-- Sign In Screen -->
  <div class="auth-screen" id="authSignIn" style="display: ${!isLoggedIn && !isAuthenticating ? 'flex' : 'none'};">
    <div class="auth-logo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6v6H9z"/><path d="M9 3v6M15 3v6M9 15v6M15 15v6M3 9h6M3 15h6M15 9h6M15 15h6"/></svg>
    </div>
    <h1 class="auth-title">codeless ai</h1>
    <p class="auth-tagline">Better Context.<br/>Better Agent.<br/>Better Code.</p>
    <button class="auth-btn auth-btn-primary" onclick="startSignIn()">Sign In</button>
    <button class="auth-btn auth-btn-secondary" onclick="startSignUp()">Create Account</button>
    <div class="auth-features">
      <span class="auth-feature">Agent</span>
      <span class="auth-feature">Chat</span>
      <span class="auth-feature">Completions</span>
      <span class="auth-feature">Tools</span>
    </div>
  </div>

  <!-- Waiting for Auth Screen -->
  <div class="auth-screen" id="authWaiting" style="display: ${isAuthenticating ? 'flex' : 'none'};">
    <div class="auth-waiting">
      <div class="auth-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6v6H9z"/></svg>
      </div>
      <div class="spinner"></div>
      <p class="auth-waiting-text">Almost there!</p>
      <p class="auth-waiting-subtext">Complete sign in in your browser.<br/>Then come back here to finish up.</p>
      <button class="auth-cancel" onclick="cancelAuth()">Cancel</button>
    </div>
  </div>

  <!-- Chat Container (existing content will go here) -->
  <div class="chat-container${isLoggedIn ? ' active' : ''}" id="chatContainer">
  <div class="header">
    <div class="header-left">
      <button class="menu-btn" onclick="toggleSidebar()" title="History">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 3.5h12v1H2v-1zm0 4h12v1H2v-1zm0 4h12v1H2v-1z"/></svg>
      </button>
      <span class="logo">CodelessAI</span>
    </div>
    <div class="header-right">
      <div class="settings-dropdown-container">
        <button class="icon-btn" onclick="toggleSettingsDropdown(event)" title="Settings">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z"/><path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319z"/></svg>
        </button>
        <div class="settings-dropdown" id="settingsDropdown">
          <button class="settings-dropdown-item" onclick="openSettingsPanel()">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492z"/></svg>
            Settings
          </button>
          <button class="settings-dropdown-item" onclick="openHelp()">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 15A7 7 0 118 1a7 7 0 010 14zm0 1A8 8 0 108 0a8 8 0 000 16z"/><path d="M5.255 5.786a.237.237 0 00.241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 00.25.246h.811a.25.25 0 00.25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94z"/></svg>
            Help
          </button>
          <div class="settings-dropdown-divider"></div>
          <button class="settings-dropdown-item" onclick="openAccountBilling()">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M0 4a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H2a2 2 0 01-2-2V4zm2-1a1 1 0 00-1 1v1h14V4a1 1 0 00-1-1H2zm13 4H1v5a1 1 0 001 1h12a1 1 0 001-1V7z"/><path d="M2 10a1 1 0 011-1h1a1 1 0 011 1v1a1 1 0 01-1 1H3a1 1 0 01-1-1v-1z"/></svg>
            Account & Billing
          </button>
          <div class="settings-dropdown-divider"></div>
          <button class="settings-dropdown-item" onclick="signOut()">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M10 12.5a.5.5 0 01-.5.5h-8a.5.5 0 01-.5-.5v-9a.5.5 0 01.5-.5h8a.5.5 0 01.5.5v2a.5.5 0 001 0v-2A1.5 1.5 0 009.5 2h-8A1.5 1.5 0 000 3.5v9A1.5 1.5 0 001.5 14h8a1.5 1.5 0 001.5-1.5v-2a.5.5 0 00-1 0v2z"/><path d="M15.854 8.354a.5.5 0 000-.708l-3-3a.5.5 0 00-.708.708L14.293 7.5H5.5a.5.5 0 000 1h8.793l-2.147 2.146a.5.5 0 00.708.708l3-3z"/></svg>
            Sign Out
          </button>
        </div>
      </div>
      <button class="icon-btn" onclick="newChat()" title="New Chat">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 2v6H2v1h6v6h1V9h6V8H9V2H8z"/></svg>
      </button>
    </div>
  </div>


  <div class="sidebar" id="sidebar" onclick="closeSidebar(event)">
    <div class="sidebar-panel" onclick="event.stopPropagation()">
      <div class="sidebar-header">
        <h3>History</h3>
        <button class="icon-btn" onclick="toggleSidebar()">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z"/></svg>
        </button>
      </div>
      <div class="sidebar-content" id="convList"></div>
      <div class="sidebar-footer">
        <button class="sidebar-btn" onclick="exportConversations()">Export</button>
        <button class="sidebar-btn" onclick="importConversations()">Import</button>
        <button class="sidebar-btn" onclick="clearAllConversations()" style="color: #f87171; margin-top: 8px; width: 100%;">🗑️ Clear All History</button>
      </div>
    </div>
  </div>

  <div class="messages" id="messages"></div>
  <div class="loading" id="loading"><div class="spinner"></div><span>Generating...</span></div>

  <div class="input-area">
    <div class="input-top">
      <button class="tool-btn" onclick="attachCurrentFile()" title="Mention file (@)">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.715 6.542L3.343 7.914a3 3 0 104.243 4.243l1.828-1.829A3 3 0 008.586 5.5L8 6.086a1.002 1.002 0 00-.154.199 2 2 0 01.861 3.337L6.88 11.45a2 2 0 11-2.83-2.83l.793-.792a4.018 4.018 0 01-.128-1.287z"/><path d="M6.586 4.672A3 3 0 007.414 9.5l.775-.776a2 2 0 01-.896-3.346L9.12 3.55a2 2 0 112.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 10-4.243-4.243L6.586 4.672z"/></svg>
      </button>
      <button class="tool-btn" onclick="attachFile()" title="Attach file">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 3a2.5 2.5 0 015 0v9a1.5 1.5 0 01-3 0V5a.5.5 0 011 0v7a.5.5 0 001 0V3a1.5 1.5 0 00-3 0v9a2.5 2.5 0 005 0V5a.5.5 0 011 0v7a3.5 3.5 0 01-7 0V3z"/></svg>
      </button>
      <button class="tool-btn" onclick="attachFile()" title="Add files">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M14 4.5V14a2 2 0 01-2 2H4a2 2 0 01-2-2V2a2 2 0 012-2h5.5L14 4.5zM12 4.5V4H9.5a.5.5 0 01-.5-.5V1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V4.5h-1z"/><path d="M8.5 6a.5.5 0 00-1 0v1.5H6a.5.5 0 000 1h1.5V10a.5.5 0 001 0V8.5H10a.5.5 0 000-1H8.5V6z"/></svg>
      </button>
      <button class="tool-btn" title="Terminal">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 9a.5.5 0 01.5-.5h3a.5.5 0 010 1h-3A.5.5 0 016 9zM3.854 4.146a.5.5 0 10-.708.708L4.793 6.5 3.146 8.146a.5.5 0 10.708.708l2-2a.5.5 0 000-.708l-2-2z"/><path d="M2 1a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V3a2 2 0 00-2-2H2zm12 1a1 1 0 011 1v10a1 1 0 01-1 1H2a1 1 0 01-1-1V3a1 1 0 011-1h12z"/></svg>
      </button>
      <div class="file-tags" id="fileTags"></div>
    </div>
    
    <div class="input-box">
      <textarea id="input" placeholder="Ask CodelessAI anything..." rows="1"></textarea>
    </div>
    
    <div class="input-bottom">
      <button class="auto-toggle" id="autoToggle" onclick="toggleAuto()">
        <span class="indicator"></span>
        <span>Auto</span>
      </button>
      <button class="chat-btn" title="Chat mode">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M14 1a1 1 0 011 1v8a1 1 0 01-1 1H4.414A2 2 0 003 11.586l-2 2V2a1 1 0 011-1h12zM2 0a2 2 0 00-2 2v12.793a.5.5 0 00.854.353l2.853-2.853A1 1 0 014.414 12H14a2 2 0 002-2V2a2 2 0 00-2-2H2z"/></svg>
      </button>
      <div class="divider"></div>
      <div class="model-selector">
        <button class="model-btn" onclick="toggleModelDropdown(event)">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z"/></svg>
          <span id="modelLabel">Claude Opus 4.5</span>
        </button>
        <div class="model-dropdown" id="modelDropdown">
          <div class="model-option" onclick="selectModel('claude-opus-4.5', 'Claude Opus 4.5')">
            <div class="model-option-header">
              <span class="model-option-name">Claude Opus 4.5</span>
              <span class="model-option-badge">New</span>
            </div>
            <span class="model-option-desc">Best for complex tasks</span>
          </div>
          <div class="model-option" onclick="selectModel('claude-sonnet-4.5', 'Sonnet 4.5')">
            <div class="model-option-header">
              <span class="model-option-name">Sonnet 4.5</span>
            </div>
            <span class="model-option-desc">Great for everyday tasks</span>
          </div>
          <div class="model-option" onclick="selectModel('gpt-5.1', 'GPT-5.1')">
            <div class="model-option-header">
              <span class="model-option-name">GPT-5.1</span>
            </div>
            <span class="model-option-desc">Strong reasoning and planning</span>
          </div>
          <div class="model-option" onclick="selectModel('claude-haiku-4.5', 'Haiku 4.5')">
            <div class="model-option-header">
              <span class="model-option-name">Haiku 4.5</span>
            </div>
            <span class="model-option-desc">Fast and efficient responses</span>
          </div>
          <div class="model-option" onclick="selectModel('claude-sonnet-4', 'Sonnet 4')">
            <div class="model-option-header">
              <span class="model-option-name">Sonnet 4</span>
            </div>
            <span class="model-option-desc">Legacy model</span>
          </div>
          <div class="model-option" onclick="selectModel('gpt-5', 'GPT-5')">
            <div class="model-option-header">
              <span class="model-option-name">GPT-5</span>
            </div>
            <span class="model-option-desc">OpenAI GPT-5 legacy</span>
          </div>
        </div>
      </div>
      <div class="spacer"></div>
      <button class="action-btn" onclick="attachFile()" title="Attach">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 3a2.5 2.5 0 015 0v9a1.5 1.5 0 01-3 0V5a.5.5 0 011 0v7a.5.5 0 001 0V3a1.5 1.5 0 00-3 0v9a2.5 2.5 0 005 0V5a.5.5 0 011 0v7a3.5 3.5 0 01-7 0V3z"/></svg>
      </button>
      <button class="action-btn" title="Magic">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M7.657 6.247c.11-.33.576-.33.686 0l.645 1.937a2.89 2.89 0 001.828 1.828l1.937.645c.33.11.33.576 0 .686l-1.937.645a2.89 2.89 0 00-1.828 1.828l-.645 1.937a.361.361 0 01-.686 0l-.645-1.937a2.89 2.89 0 00-1.828-1.828l-1.937-.645a.361.361 0 010-.686l1.937-.645a2.89 2.89 0 001.828-1.828l.645-1.937zM3.794 1.148a.217.217 0 01.412 0l.387 1.162c.173.518.579.924 1.097 1.097l1.162.387a.217.217 0 010 .412l-1.162.387A1.734 1.734 0 004.593 5.69l-.387 1.162a.217.217 0 01-.412 0L3.407 5.69a1.734 1.734 0 00-1.097-1.097l-1.162-.387a.217.217 0 010-.412l1.162-.387A1.734 1.734 0 003.407 2.31l.387-1.162zM10.863.099a.145.145 0 01.274 0l.258.774c.115.346.386.617.732.732l.774.258a.145.145 0 010 .274l-.774.258a1.156 1.156 0 00-.732.732l-.258.774a.145.145 0 01-.274 0l-.258-.774a1.156 1.156 0 00-.732-.732L9.1 2.137a.145.145 0 010-.274l.774-.258c.346-.115.617-.386.732-.732L10.863.1z"/></svg>
      </button>
      <button class="send-btn" id="sendBtn" onclick="sendOrAbort()">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M15.854 8.354a.5.5 0 000-.708l-7-7a.5.5 0 00-.708.708L14.293 7.5H1a.5.5 0 000 1h13.293l-6.147 6.146a.5.5 0 00.708.708l7-7z"/></svg>
      </button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let isLoading = false;
    let autoMode = false;
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('sendBtn');
    const messagesEl = document.getElementById('messages');
    const loadingEl = document.getElementById('loading');
    const fileTags = document.getElementById('fileTags');
    const sidebar = document.getElementById('sidebar');
    const convList = document.getElementById('convList');
    const modelLabel = document.getElementById('modelLabel');
    const autoToggle = document.getElementById('autoToggle');


    // Auth screen elements
    const authSignIn = document.getElementById('authSignIn');
    const authWaiting = document.getElementById('authWaiting');
    const chatContainer = document.getElementById('chatContainer');

    // Auth functions
    function showAuthState(state) {
      authSignIn.style.display = 'none';
      authWaiting.style.display = 'none';
      chatContainer.classList.remove('active');
      
      if (state === 'logged_out') {
        authSignIn.style.display = 'flex';
      } else if (state === 'authenticating') {
        authWaiting.style.display = 'flex';
      } else if (state === 'logged_in') {
        chatContainer.classList.add('active');
      }
    }

    // Auto-fix status display
    function showAutoFixStatus(status, success) {
      // Create or update status element
      let statusEl = document.getElementById('autoFixStatus');
      if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = 'autoFixStatus';
        statusEl.className = 'autofix-status';
        messagesEl.appendChild(statusEl);
      }
      
      statusEl.textContent = status;
      statusEl.className = 'autofix-status ' + (success === true ? 'success' : success === false ? 'error' : 'pending');
      messagesEl.scrollTop = messagesEl.scrollHeight;
      
      // Auto-hide after 5 seconds if success or error
      if (success !== undefined) {
        setTimeout(function() {
          if (statusEl.parentNode) {
            statusEl.parentNode.removeChild(statusEl);
          }
        }, 5000);
      }
    }

    // Pending approvals display
    function showPendingApprovals(approvals) {
      // Remove existing approval cards
      document.querySelectorAll('.approval-card').forEach(function(el) { el.remove(); });
      
      approvals.forEach(function(approval) {
        var card = document.createElement('div');
        card.className = 'approval-card';
        card.innerHTML = '<div class="approval-header">' +
          '<span class="approval-icon">' + (approval.type === 'delete' ? '🗑️' : '⚠️') + '</span>' +
          '<span class="approval-title">' + (approval.type === 'delete' ? 'Delete File' : 'Run Command') + '</span>' +
        '</div>' +
        '<div class="approval-content">' +
          '<code>' + (approval.path || approval.command) + '</code>' +
        '</div>' +
        '<div class="approval-actions">' +
          '<button class="approve-btn" data-id="' + approval.id + '">✓ Approve</button>' +
          '<button class="reject-btn" data-id="' + approval.id + '">✗ Reject</button>' +
        '</div>';
        
        card.querySelector('.approve-btn').addEventListener('click', function() {
          vscode.postMessage({ type: 'approveAction', id: approval.id, action: approval });
          card.remove();
        });
        
        card.querySelector('.reject-btn').addEventListener('click', function() {
          vscode.postMessage({ type: 'rejectAction', id: approval.id });
          card.remove();
        });
        
        messagesEl.appendChild(card);
      });
      
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // Auto-fix status display
    function showAutoFixStatus(status, success) {
      // Create or update status element
      let statusEl = document.getElementById('autoFixStatus');
      if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = 'autoFixStatus';
        statusEl.className = 'autofix-status';
        messagesEl.appendChild(statusEl);
      }
      
      statusEl.textContent = status;
      statusEl.className = 'autofix-status ' + (success === true ? 'success' : success === false ? 'error' : 'pending');
      messagesEl.scrollTop = messagesEl.scrollHeight;
      
      // Auto-hide after 5 seconds if success or error
      if (success !== undefined) {
        setTimeout(function() {
          if (statusEl.parentNode) {
            statusEl.parentNode.removeChild(statusEl);
          }
        }, 5000);
      }
    }

    // Pending approvals display
    function showPendingApprovals(approvals) {
      // Remove existing approval cards
      document.querySelectorAll('.approval-card').forEach(function(el) { el.remove(); });
      
      approvals.forEach(function(approval) {
        var card = document.createElement('div');
        card.className = 'approval-card';
        card.innerHTML = '<div class="approval-header">' +
          '<span class="approval-icon">' + (approval.type === 'delete' ? '🗑️' : '⚠️') + '</span>' +
          '<span class="approval-title">' + (approval.type === 'delete' ? 'Delete File' : 'Run Command') + '</span>' +
        '</div>' +
        '<div class="approval-content">' +
          '<code>' + (approval.path || approval.command) + '</code>' +
        '</div>' +
        '<div class="approval-actions">' +
          '<button class="approve-btn" data-id="' + approval.id + '">✓ Approve</button>' +
          '<button class="reject-btn" data-id="' + approval.id + '">✗ Reject</button>' +
        '</div>';
        
        card.querySelector('.approve-btn').addEventListener('click', function() {
          vscode.postMessage({ type: 'approveAction', id: approval.id, action: approval });
          card.remove();
        });
        
        card.querySelector('.reject-btn').addEventListener('click', function() {
          vscode.postMessage({ type: 'rejectAction', id: approval.id });
          card.remove();
        });
        
        messagesEl.appendChild(card);
      });
      
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function startSignIn() {
      vscode.postMessage({ type: 'startSignIn' });
    }

    function startSignUp() {
      vscode.postMessage({ type: 'startSignUp' });
    }

    function cancelAuth() {
      vscode.postMessage({ type: 'cancelAuth' });
    }

    // For testing - double click logo to mock login
    document.querySelectorAll('.auth-logo').forEach(el => {
      el.addEventListener('dblclick', () => {
        vscode.postMessage({ type: 'mockLogin' });
      });
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendOrAbort(); }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    });

    function sendOrAbort() {
      if (isLoading) { vscode.postMessage({ type: 'abort' }); }
      else {
        const text = input.value.trim();
        if (!text) return;
        vscode.postMessage({ type: 'sendMessage', message: text });
        input.value = '';
        input.style.height = 'auto';
      }
    }

    function newChat() { vscode.postMessage({ type: 'newChat' }); }
    function toggleSidebar() { sidebar.classList.toggle('open'); }

    let currentModel = 'claude-opus-4.5';
    
    function toggleModelDropdown(event) {
      event.stopPropagation();
      const dropdown = document.getElementById('modelDropdown');
      dropdown.classList.toggle('show');
    }
    
    function selectModel(modelId, modelName) {
      currentModel = modelId;
      document.getElementById('modelLabel').textContent = modelName;
      document.getElementById('modelDropdown').classList.remove('show');
      // Update all options to show active state
      document.querySelectorAll('.model-option').forEach(opt => opt.classList.remove('active'));
      event.currentTarget.classList.add('active');
      vscode.postMessage({ type: 'selectModel', modelId, modelName });
    }
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const modelDropdown = document.getElementById('modelDropdown');
      if (modelDropdown && !e.target.closest('.model-selector')) {
        modelDropdown.classList.remove('show');
      }
      const settingsDropdown = document.getElementById('settingsDropdown');
      if (settingsDropdown && !e.target.closest('.settings-dropdown-container')) {
        settingsDropdown.classList.remove('show');
      }
    });
    document.addEventListener('click', (e) => {
      const modelDropdown = document.getElementById('modelDropdown');
      if (modelDropdown && !e.target.closest('.model-selector')) {
        modelDropdown.classList.remove('show');
      }
      const settingsDropdown = document.getElementById('settingsDropdown');
      if (settingsDropdown && !e.target.closest('.settings-dropdown-container')) {
        settingsDropdown.classList.remove('show');
      }
    });
    document.addEventListener('click', (e) => {
      const modelDropdown = document.getElementById('modelDropdown');
      if (modelDropdown && !e.target.closest('.model-selector')) {
        modelDropdown.classList.remove('show');
      }
      const settingsDropdown = document.getElementById('settingsDropdown');
      if (settingsDropdown && !e.target.closest('.settings-dropdown-container')) {
        settingsDropdown.classList.remove('show');
      }
    });
    document.addEventListener('click', (e) => {
      const modelDropdown = document.getElementById('modelDropdown');
      if (modelDropdown && !e.target.closest('.model-selector')) {
        modelDropdown.classList.remove('show');
      }
      const settingsDropdown = document.getElementById('settingsDropdown');
      if (settingsDropdown && !e.target.closest('.settings-dropdown-container')) {
        settingsDropdown.classList.remove('show');
      }
    });
    document.addEventListener('click', (e) => {
      const modelDropdown = document.getElementById('modelDropdown');
      if (modelDropdown && !e.target.closest('.model-selector')) {
        modelDropdown.classList.remove('show');
      }
      const settingsDropdown = document.getElementById('settingsDropdown');
      if (settingsDropdown && !e.target.closest('.settings-dropdown-container')) {
        settingsDropdown.classList.remove('show');
      }
    });
    document.addEventListener('click', (e) => {
      const modelDropdown = document.getElementById('modelDropdown');
      if (modelDropdown && !e.target.closest('.model-selector')) {
        modelDropdown.classList.remove('show');
      }
      const settingsDropdown = document.getElementById('settingsDropdown');
      if (settingsDropdown && !e.target.closest('.settings-dropdown-container')) {
        settingsDropdown.classList.remove('show');
      }
    });

    function switchProvider() { vscode.postMessage({ type: 'switchProvider' }); }
    function openSettings() { vscode.postMessage({ type: 'openSettings' }); }
    function toggleSettingsDropdown(e) {
      e.stopPropagation();
      const dropdown = document.getElementById('settingsDropdown');
      dropdown.classList.toggle('show');
    }
    function closeSettingsDropdown() {
      const dropdown = document.getElementById('settingsDropdown');
      if (dropdown) dropdown.classList.remove('show');
    }
    function openSettingsPanel() { closeSettingsDropdown(); vscode.postMessage({ type: 'openSettingsPanel' }); }
    function openHelp() { closeSettingsDropdown(); vscode.postMessage({ type: 'openHelp' }); }
    function openAccountBilling() { closeSettingsDropdown(); vscode.postMessage({ type: 'openAccountBilling' }); }
    function signOut() { closeSettingsDropdown(); vscode.postMessage({ type: 'signOut' }); }
    function attachFile() { vscode.postMessage({ type: 'attachFile' }); }
    function attachCurrentFile() { vscode.postMessage({ type: 'attachCurrentFile' }); }
    function removeAttachment(i) { vscode.postMessage({ type: 'removeAttachment', index: i }); }
    function exportConversations() { vscode.postMessage({ type: 'exportConversations' }); }
    function importConversations() { vscode.postMessage({ type: 'importConversations' }); }
    function clearAllConversations() { 
      if (confirm('Are you sure you want to clear all conversation history?')) {
        vscode.postMessage({ type: 'clearAllConversations' }); 
        toggleSidebar();
      }
    }
    function loadConversation(id) { vscode.postMessage({ type: 'loadConversation', id }); toggleSidebar(); }
    function deleteConversation(id, e) { e.stopPropagation(); vscode.postMessage({ type: 'deleteConversation', id }); }
    function copyCode(code) { vscode.postMessage({ type: 'copyCode', code }); }
    function insertCode(code) { vscode.postMessage({ type: 'insertCode', code }); }
    function quickAction(action) { vscode.postMessage({ type: 'quickAction', action }); }
    function feedback(rating, idx) { vscode.postMessage({ type: 'feedback', rating, messageIndex: idx }); }
    function toggleAuto() {
      autoMode = !autoMode;
      autoToggle.classList.toggle('active', autoMode);
    }

    function renderMessages(messages) {
      if (messages.length === 0) {
        messagesEl.innerHTML = \`
          <div class="empty-state">
            <div class="empty-title">Welcome to CodelessAI</div>
            <div class="empty-subtitle">Your intelligent coding assistant</div>
            <div class="suggestions">
              <div class="suggestion" onclick="quickAction('explain')">
                <span class="suggestion-icon">▸</span>
                <span class="suggestion-text">Explain the current code</span>
              </div>
              <div class="suggestion" onclick="quickAction('refactor')">
                <span class="suggestion-icon">▸</span>
                <span class="suggestion-text">Refactor for readability</span>
              </div>
              <div class="suggestion" onclick="quickAction('test')">
                <span class="suggestion-icon">▸</span>
                <span class="suggestion-text">Generate unit tests</span>
              </div>
              <div class="suggestion" onclick="quickAction('docs')">
                <span class="suggestion-icon">▸</span>
                <span class="suggestion-text">Add documentation</span>
              </div>
            </div>
          </div>\`;
        return;
      }

      messagesEl.innerHTML = messages.map((m, i) => \`
        <div class="message \${m.role}">
          <div class="message-header">
            <div class="avatar">\${m.role === 'user' ? '👤' : '✨'}</div>
            <span class="message-name">\${m.role === 'user' ? 'You' : 'CodelessAI'}</span>
          </div>
          <div class="message-content">\${renderContent(m.content)}</div>
          \${m.role === 'assistant' ? \`<div class="message-footer">
            <button class="feedback-btn" onclick="feedback('up', \${i})">👍</button>
            <button class="feedback-btn" onclick="feedback('down', \${i})">👎</button>
          </div>\` : ''}
        </div>\`).join('');

      messagesEl.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function renderContent(content) {
      let html = content.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, (m, lang, code) => {
        const escaped = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safecode = code.replace(/\`/g, '\\\\\`').replace(/\\$/g, '\\\\$');
        return \`<pre><div class="code-header"><span>\${lang || 'code'}</span><div class="code-actions"><button class="code-btn" onclick="copyCode('\${safecode}')">Copy</button><button class="code-btn" onclick="insertCode('\${safecode}')">Insert</button></div></div><code class="language-\${lang || 'plaintext'}">\${escaped}</code></pre>\`;
      });
      html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
      html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
      html = html.replace(/\\n/g, '<br>');
      return html;
    }

    function renderConversations(convs) {
      convList.innerHTML = convs.length === 0
        ? '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:11px;">No conversations</div>'
        : convs.map(c => \`<div class="conv-item \${c.active ? 'active' : ''}" onclick="loadConversation('\${c.id}')"><span class="conv-item-title">\${c.title}</span><button class="conv-item-delete" onclick="deleteConversation('\${c.id}', event)">×</button></div>\`).join('');
    }

    function updateFileTags(files) {
      fileTags.innerHTML = files.map((f, i) => \`
        <div class="file-tag">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M14 4.5V14a2 2 0 01-2 2H4a2 2 0 01-2-2V2a2 2 0 012-2h5.5L14 4.5zM12 4.5V4H9.5a.5.5 0 01-.5-.5V1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V4.5h-1z"/></svg>
          \${f}
          <span class="close" onclick="removeAttachment(\${i})">×</span>
        </div>\`).join('');
    }

    window.addEventListener('message', (event) => {
      const data = event.data;
      switch (data.type) {
        case 'updateMessages':
          renderMessages(data.messages);
          modelLabel.textContent = data.model?.split('/').pop()?.split('-').slice(0,3).join('-') || data.provider;
          break;
        case 'loading':
          isLoading = data.loading;
          loadingEl.classList.toggle('show', data.loading);
          sendBtn.classList.toggle('loading', data.loading);
          sendBtn.innerHTML = data.loading
            ? '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.5h6v9H5z"/></svg>'
            : '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M15.854 8.354a.5.5 0 000-.708l-7-7a.5.5 0 00-.708.708L14.293 7.5H1a.5.5 0 000 1h13.293l-6.147 6.146a.5.5 0 00.708.708l7-7z"/></svg>';
          input.disabled = data.loading;
          break;
        case 'stream':
          const lastMsg = messagesEl.querySelector('.message.assistant:last-child .message-content');
          if (lastMsg) {
            lastMsg.innerHTML = renderContent(data.content);
            lastMsg.parentElement.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
          break;
        case 'conversations':
          renderConversations(data.conversations);
          break;
        case 'attachments':
          updateFileTags(data.files);
        case 'authState':
          showAuthState(data.state);
          break;
        case 'autoFixStatus':
          showAutoFixStatus(data.status, data.success);
          break;
        case 'pendingApprovals':
          showPendingApprovals(data.approvals);
          break;
      }
    });
  </script>
  </div> <!-- End chat-container -->
</body>
</html>`;
  }
}
