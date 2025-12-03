import * as vscode from 'vscode';
import { ChatViewProvider } from './views/chatPanel';
import { SettingsPanelProvider } from './views/settingsPanel';
import { getProviderManager } from './providers';
import { registerCommands } from './commands';
import { registerInlineCompletionProvider } from './services/inline';
import { registerCodeActionsProvider } from './services/codeActions';
import { AuthService } from './services/auth';
import { diagnosticsService } from './services/diagnosticsService';

export function activate(context: vscode.ExtensionContext) {
  console.log('CodelessAI is now active!');

  // Initialize Provider Manager
  const providerManager = getProviderManager();

  // Register the chat webview provider
  const chatProvider = new ChatViewProvider(context.extensionUri, providerManager);
  chatProvider.setContext(context);
  
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('codelessai.chatView', chatProvider)
  );

  // Register settings panel command
  context.subscriptions.push(
    vscode.commands.registerCommand('codelessai.openSettingsPanel', () => {
      SettingsPanelProvider.createOrShow(context.extensionUri);
    })
  );

  // Register all commands
  registerCommands(context, providerManager, chatProvider);

  // Register inline completion provider
  registerInlineCompletionProvider(context, providerManager);

  // Register code actions provider (lightbulb menu)
  registerCodeActionsProvider(context);

  // Register diagnostics-related commands
  context.subscriptions.push(
    vscode.commands.registerCommand('codeless-ai.fixDiagnostic', async (uri: vscode.Uri, diagnostic: vscode.Diagnostic) => {
      // This will be handled by agentIntegration
      vscode.window.showInformationMessage('Fixing error with AI...');
      chatProvider.fixDiagnostic(uri, diagnostic);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('codeless-ai.fixAllInFile', async (uri: vscode.Uri) => {
      vscode.window.showInformationMessage('Fixing all errors in file...');
      chatProvider.fixAllDiagnostics(uri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('codeless-ai.showDiagnostics', async () => {
      const summary = diagnosticsService.getErrorSummary();
      if (summary.total === 0) {
        vscode.window.showInformationMessage('No errors found! 🎉');
      } else {
        vscode.window.showInformationMessage(
          `Found ${summary.total} error(s). Types: ${Object.entries(summary.byType).map(([k,v]) => `${k}(${v})`).join(', ')}`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('codeless-ai.toggleAutoFix', async () => {
      const current = vscode.workspace.getConfiguration('codelessai').get('autoFixOnSave', true);
      await vscode.workspace.getConfiguration('codelessai').update('autoFixOnSave', !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Auto-fix on save: ${!current ? 'Enabled' : 'Disabled'}`);
    })
  );

  // Register code action provider for quick fixes
  context.subscriptions.push(
    diagnosticsService.registerCodeActionProvider([
      { language: 'typescript' },
      { language: 'typescriptreact' },
      { language: 'javascript' },
      { language: 'javascriptreact' },
      { language: 'vue' },
      { language: 'dart' },
      { language: 'swift' },
      { language: 'kotlin' },
      { language: 'css' },
      { language: 'scss' },
      { language: 'less' },
    ])
  );


  // Watch for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('codelessai')) {
        providerManager.updateConfig();
        chatProvider.updateProvider();
      }
    })
  );

  // Create status bar item
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'codelessai.switchProvider';
  updateStatusBar(statusBarItem, providerManager);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);


  // Register URI handler for auth callback
  const authService = AuthService.getInstance();
  authService.setContext(context);
  
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri) {
        if (uri.path === '/auth') {
          const params = new URLSearchParams(uri.query);
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');
          if (accessToken) {
            authService.handleAuthCallback(accessToken, refreshToken || undefined);
          }
        }
      }
    })
  );
  // Update status bar when provider changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('codelessai.provider')) {
        updateStatusBar(statusBarItem, providerManager);
      }
    })
  );

  // Show welcome message on first activation
  const hasShownWelcome = context.globalState.get('codelessai.welcomeShown');
  if (!hasShownWelcome) {
    vscode.window.showInformationMessage(
      'CodelessAI activated! Open the sidebar to start chatting.',
      'Open Chat',
      'Settings'
    ).then(selection => {
      if (selection === 'Open Chat') {
        vscode.commands.executeCommand('codelessai.chatView.focus');
      } else if (selection === 'Settings') {
        vscode.commands.executeCommand('codelessai.openSettingsPanel');
      }
    });
    context.globalState.update('codelessai.welcomeShown', true);
  }
}

function updateStatusBar(statusBar: vscode.StatusBarItem, providerManager: any) {
  const provider = providerManager.getActiveProviderType();
  const configured = providerManager.isConfigured();
  
  const icons: Record<string, string> = {
    anthropic: '$(hubot)',
    openai: '$(sparkle)',
    gemini: '$(star)',
    ollama: '$(server)',
    openrouter: '$(globe)',
  };
  
  statusBar.text = `${icons[provider] || '$(robot)'} CodelessAI`;
  statusBar.tooltip = configured 
    ? `Provider: ${provider}\nClick to switch` 
    : `⚠️ ${provider} API key not configured\nClick to configure`;
  statusBar.backgroundColor = configured 
    ? undefined 
    : new vscode.ThemeColor('statusBarItem.warningBackground');
}

export function deactivate() {
  console.log('CodelessAI deactivated');
}
