/**
 * Code Actions Provider - Lightbulb menu suggestions
 */

import * as vscode from 'vscode';

export class CodeActionsProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
    vscode.CodeActionKind.Refactor,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    // Only show if text is selected
    if (range.isEmpty) {
      return [];
    }

    const actions: vscode.CodeAction[] = [];

    // Quick fix actions
    const explainAction = new vscode.CodeAction(
      '💡 Explain with CodelessAI',
      vscode.CodeActionKind.QuickFix
    );
    explainAction.command = {
      command: 'codelessai.explainCode',
      title: 'Explain Code',
    };
    actions.push(explainAction);

    const fixAction = new vscode.CodeAction(
      '🔧 Fix with CodelessAI',
      vscode.CodeActionKind.QuickFix
    );
    fixAction.command = {
      command: 'codelessai.fixCode',
      title: 'Fix Code',
    };
    actions.push(fixAction);

    // Refactor actions
    const refactorAction = new vscode.CodeAction(
      '✨ Refactor with CodelessAI',
      vscode.CodeActionKind.Refactor
    );
    refactorAction.command = {
      command: 'codelessai.refactorCode',
      title: 'Refactor Code',
    };
    actions.push(refactorAction);

    const commentAction = new vscode.CodeAction(
      '📝 Add Comments with CodelessAI',
      vscode.CodeActionKind.Refactor
    );
    commentAction.command = {
      command: 'codelessai.addComments',
      title: 'Add Comments',
    };
    actions.push(commentAction);

    const docsAction = new vscode.CodeAction(
      '📖 Generate Docs with CodelessAI',
      vscode.CodeActionKind.Refactor
    );
    docsAction.command = {
      command: 'codelessai.generateDocs',
      title: 'Generate Docs',
    };
    actions.push(docsAction);

    const testsAction = new vscode.CodeAction(
      '🧪 Generate Tests with CodelessAI',
      vscode.CodeActionKind.Refactor
    );
    testsAction.command = {
      command: 'codelessai.generateTests',
      title: 'Generate Tests',
    };
    actions.push(testsAction);

    return actions;
  }
}

/**
 * Register code actions provider for all languages
 */
export function registerCodeActionsProvider(context: vscode.ExtensionContext): void {
  const provider = new CodeActionsProvider();
  
  const disposable = vscode.languages.registerCodeActionsProvider(
    { pattern: '**' },
    provider,
    { providedCodeActionKinds: CodeActionsProvider.providedCodeActionKinds }
  );
  
  context.subscriptions.push(disposable);
}
