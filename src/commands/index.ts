import * as vscode from 'vscode';
import { ProviderManager, Message, ProviderType } from '../providers';
import { ContextService } from '../services/context';
import { ChatViewProvider } from '../views/chatPanel';

const PROMPTS = {
  explain: 'Explain the following code concisely. What does it do and how does it work?',
  fix: 'Fix any bugs or issues in the following code. Return only the fixed code with comments explaining changes.',
  refactor: 'Refactor the following code to be cleaner, more efficient, and follow best practices. Return the refactored code.',
  comments: 'Add clear, concise comments to the following code. Return the code with comments added.',
  generate: 'Generate code based on the following description:',
  tests: 'Write unit tests for the following code. Use the appropriate testing framework.',
  docs: 'Generate documentation (JSDoc/docstrings) for the following code.',
  optimize: 'Optimize the following code for performance. Explain what you changed.',
  security: 'Review the following code for security vulnerabilities and suggest fixes.',
};

export function registerCommands(
  context: vscode.ExtensionContext,
  providerManager: ProviderManager,
  chatProvider: ChatViewProvider
) {
  // Open Chat command
  context.subscriptions.push(
    vscode.commands.registerCommand('codelessai.openChat', () => {
      vscode.commands.executeCommand('codelessai.chatView.focus');
    })
  );

  // Quick Actions command (shows palette of actions)
  context.subscriptions.push(
    vscode.commands.registerCommand('codelessai.quickActions', async () => {
      const code = ContextService.getSelectedCode();
      
      const actions = [
        { label: '$(comment-discussion) Explain Code', action: 'explain', needsCode: true },
        { label: '$(debug) Fix Code', action: 'fix', needsCode: true },
        { label: '$(wand) Refactor Code', action: 'refactor', needsCode: true },
        { label: '$(note) Add Comments', action: 'comments', needsCode: true },
        { label: '$(beaker) Generate Tests', action: 'tests', needsCode: true },
        { label: '$(book) Generate Docs', action: 'docs', needsCode: true },
        { label: '$(rocket) Optimize', action: 'optimize', needsCode: true },
        { label: '$(shield) Security Review', action: 'security', needsCode: true },
        { label: '$(add) Generate Code', action: 'generate', needsCode: false },
        { label: '$(gear) Switch Provider', action: 'switchProvider', needsCode: false },
      ];

      const items = actions.map(a => ({
        ...a,
        description: a.needsCode && !code ? '(select code first)' : '',
        enabled: !a.needsCode || !!code,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select an action',
        title: 'CodelessAI Quick Actions',
      });

      if (!selected) return;

      if (selected.action === 'switchProvider') {
        vscode.commands.executeCommand('codelessai.switchProvider');
        return;
      }

      if (selected.action === 'generate') {
        vscode.commands.executeCommand('codelessai.generateCode');
        return;
      }

      if (!code) {
        vscode.window.showWarningMessage('Please select some code first.');
        return;
      }

      await processCodeAction(providerManager, chatProvider, selected.action as keyof typeof PROMPTS, code, true);
    })
  );

  // Switch Provider command
  context.subscriptions.push(
    vscode.commands.registerCommand('codelessai.switchProvider', async () => {
      const providers: Array<{ label: string; description: string; value: ProviderType }> = [
        { label: '$(hubot) Anthropic Claude', description: 'claude-sonnet-4, opus-4, haiku', value: 'anthropic' },
        { label: '$(sparkle) OpenAI GPT', description: 'gpt-4o, gpt-4-turbo, o1', value: 'openai' },
        { label: '$(star) Google Gemini', description: 'gemini-1.5-pro, flash', value: 'gemini' },
        { label: '$(server) Ollama Local', description: 'llama3.2, codellama (no API key)', value: 'ollama' },
        { label: '$(globe) OpenRouter', description: 'Multiple providers', value: 'openrouter' },
      ];

      const current = providerManager.getActiveProviderType();
      const selected = await vscode.window.showQuickPick(
        providers.map(p => ({
          ...p,
          picked: p.value === current,
          detail: p.value === current ? '✓ Currently active' : undefined,
        })),
        {
          placeHolder: 'Select AI Provider',
          title: 'CodelessAI: Switch Provider',
        }
      );

      if (selected) {
        providerManager.setActiveProvider(selected.value);
        chatProvider.updateProvider();
        vscode.window.showInformationMessage(`Switched to ${selected.label.replace(/\$\([^)]+\) /, '')}`);
      }
    })
  );

  // Code action commands
  const codeCommands = [
    { command: 'codelessai.explainCode', action: 'explain', replace: false },
    { command: 'codelessai.fixCode', action: 'fix', replace: true },
    { command: 'codelessai.refactorCode', action: 'refactor', replace: true },
    { command: 'codelessai.addComments', action: 'comments', replace: true },
    { command: 'codelessai.generateTests', action: 'tests', replace: false },
    { command: 'codelessai.generateDocs', action: 'docs', replace: true },
    { command: 'codelessai.optimizeCode', action: 'optimize', replace: true },
    { command: 'codelessai.securityReview', action: 'security', replace: false },
  ];

  for (const cmd of codeCommands) {
    context.subscriptions.push(
      vscode.commands.registerCommand(cmd.command, async () => {
        const code = ContextService.getSelectedCode();
        if (!code) {
          vscode.window.showWarningMessage('Please select some code first.');
          return;
        }
        await processCodeAction(providerManager, chatProvider, cmd.action as keyof typeof PROMPTS, code, cmd.replace);
      })
    );
  }

  // Generate Code command
  context.subscriptions.push(
    vscode.commands.registerCommand('codelessai.generateCode', async () => {
      const description = await vscode.window.showInputBox({
        prompt: 'Describe what code you want to generate',
        placeHolder: 'e.g., A React component that displays a user profile card',
      });
      if (!description) return;
      await processCodeAction(providerManager, chatProvider, 'generate', description, true);
    })
  );

  // Ask about file command
  context.subscriptions.push(
    vscode.commands.registerCommand('codelessai.askAboutFile', async () => {
      const ctx = ContextService.getActiveContext();
      if (!ctx) {
        vscode.window.showWarningMessage('Please open a file first.');
        return;
      }

      const question = await vscode.window.showInputBox({
        prompt: `Ask about ${ctx.fileName}`,
        placeHolder: 'e.g., What does this file do? How can I improve it?',
      });
      if (!question) return;

      const fullQuestion = `About the file ${ctx.fileName} (${ctx.language}, ${ctx.lineCount} lines):\n\n${question}\n\nFile content:\n\`\`\`${ctx.language}\n${ctx.content?.slice(0, 10000)}\n\`\`\``;
      
      chatProvider.addMessage('user', fullQuestion);
      vscode.commands.executeCommand('codelessai.chatView.focus');
    })
  );
}

async function processCodeAction(
  providerManager: ProviderManager,
  chatProvider: ChatViewProvider,
  action: keyof typeof PROMPTS,
  content: string,
  offerReplace: boolean = false
) {
  if (!providerManager.isConfigured()) {
    const provider = providerManager.getActiveProviderType();
    const result = await vscode.window.showErrorMessage(
      `CodelessAI: ${provider} API key not configured`,
      'Open Settings'
    );
    if (result === 'Open Settings') {
      vscode.commands.executeCommand('workbench.action.openSettings', 'codelessai');
    }
    return;
  }

  const ctx = ContextService.getActiveContext();
  const language = ctx?.language || 'plaintext';
  const provider = providerManager.getActiveProviderType();
  
  const systemPrompt = `You are CodelessAI, an expert coding assistant powered by ${provider}. 
Language: ${language}
Be concise. Always wrap code in \`\`\`${language} blocks.`;

  const userMessage = `${PROMPTS[action]}\n\n\`\`\`${language}\n${content}\n\`\`\``;

  try {
    chatProvider.addMessage('user', userMessage);
    vscode.commands.executeCommand('codelessai.chatView.focus');

    const response = await providerManager.chat(
      [{ role: 'user', content: userMessage }],
      { systemPrompt }
    );
    
    chatProvider.addMessage('assistant', response.content);

    if (offerReplace && action !== 'explain' && action !== 'security' && action !== 'tests') {
      const shouldReplace = await vscode.window.showInformationMessage(
        'Apply this change to your code?',
        'Apply',
        'Cancel'
      );
      if (shouldReplace === 'Apply') {
        const codeMatch = response.content.match(/```[\w]*\n([\s\S]*?)\n```/);
        const codeToInsert = codeMatch ? codeMatch[1] : response.content;
        await ContextService.replaceSelection(codeToInsert);
      }
    }
  } catch (error: any) {
    vscode.window.showErrorMessage(`CodelessAI Error: ${error.message}`);
  }
}
