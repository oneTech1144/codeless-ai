/**
 * Inline Code Completion Provider - Copilot-like suggestions
 */

import * as vscode from 'vscode';
import { ProviderManager } from '../providers';

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private debounceTimer?: NodeJS.Timeout;
  private lastCompletion = '';
  
  constructor(private providerManager: ProviderManager) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    // Check if provider is configured
    if (!this.providerManager.isConfigured()) {
      return undefined;
    }

    // Get configuration
    const config = vscode.workspace.getConfiguration('codelessai');
    const enabled = config.get<boolean>('inlineCompletions', true);
    if (!enabled) return undefined;

    // Get context around cursor
    const linePrefix = document.lineAt(position).text.substring(0, position.character);
    const lineSuffix = document.lineAt(position).text.substring(position.character);
    
    // Skip if line is empty or just whitespace
    if (linePrefix.trim().length < 3) {
      return undefined;
    }

    // Get surrounding context (previous lines)
    const startLine = Math.max(0, position.line - 20);
    const contextBefore = document.getText(new vscode.Range(startLine, 0, position.line, position.character));
    
    // Get context after cursor (for better predictions)
    const endLine = Math.min(document.lineCount - 1, position.line + 5);
    const contextAfter = document.getText(new vscode.Range(position.line, position.character, endLine, document.lineAt(endLine).text.length));

    try {
      // Create completion prompt
      const systemPrompt = `You are a code completion AI. Complete the code at the cursor position.
Rules:
- Return ONLY the completion text, nothing else
- Do not repeat existing code
- Complete the current line and add 1-3 more lines if appropriate
- Match the existing code style and indentation
- Be concise - suggest meaningful completions`;

      const userPrompt = `Language: ${document.languageId}

Code before cursor:
\`\`\`
${contextBefore}
\`\`\`

Code after cursor:
\`\`\`
${contextAfter}
\`\`\`

Complete the code at the cursor position:`;

      // Use non-streaming for speed
      const response = await this.providerManager.chat(
        [{ role: 'user', content: userPrompt }],
        { systemPrompt, maxTokens: 150, temperature: 0.2 }
      );

      if (token.isCancellationRequested) {
        return undefined;
      }

      let completion = response.content.trim();
      
      // Clean up the completion
      completion = this.cleanCompletion(completion, document.languageId);
      
      if (!completion || completion === this.lastCompletion) {
        return undefined;
      }

      this.lastCompletion = completion;

      return [{
        insertText: completion,
        range: new vscode.Range(position, position),
      }];
    } catch (error) {
      console.error('Inline completion error:', error);
      return undefined;
    }
  }

  private cleanCompletion(text: string, language: string): string {
    // Remove markdown code blocks if present
    text = text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
    
    // Remove leading/trailing quotes
    text = text.replace(/^["'`]|["'`]$/g, '');
    
    // Limit length
    const lines = text.split('\n');
    if (lines.length > 5) {
      text = lines.slice(0, 5).join('\n');
    }
    
    return text;
  }
}

/**
 * Register the inline completion provider
 */
export function registerInlineCompletionProvider(
  context: vscode.ExtensionContext,
  providerManager: ProviderManager
): void {
  const provider = new InlineCompletionProvider(providerManager);
  
  // Register for all file types
  const disposable = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    provider
  );
  
  context.subscriptions.push(disposable);
}
