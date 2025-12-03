import * as vscode from 'vscode';
import { ParsedError, ErrorType, errorDetector } from './errorDetector';

export interface DiagnosticError extends ParsedError {
  uri: vscode.Uri;
  range: vscode.Range;
  source?: string;
  relatedInformation?: vscode.DiagnosticRelatedInformation[];
}

export interface DiagnosticsConfig {
  autoFixOnSave: boolean;
  autoFixDelay: number;  // ms delay before auto-fix starts
  ignoredRules: string[];
  ignoredFiles: string[];
  severityFilter: vscode.DiagnosticSeverity[];
  onDiagnosticsChanged?: (errors: DiagnosticError[]) => void;
  onAutoFixStart?: (file: string, errorCount: number) => void;
  onAutoFixComplete?: (file: string, fixed: number, remaining: number) => void;
}

export class DiagnosticsService {
  private static instance: DiagnosticsService;
  private disposables: vscode.Disposable[] = [];
  private config: DiagnosticsConfig;
  private diagnosticCollection: vscode.DiagnosticCollection;
  private saveDebounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private isAutoFixing: boolean = false;
  private lastDiagnostics: Map<string, DiagnosticError[]> = new Map();

  private constructor() {
    this.config = {
      autoFixOnSave: true,
      autoFixDelay: 1000,
      ignoredRules: [],
      ignoredFiles: ['node_modules', '.git', 'dist', 'build', '.next'],
      severityFilter: [vscode.DiagnosticSeverity.Error],
    };
    
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('codeless-ai');
    this.setupListeners();
  }

  public static getInstance(): DiagnosticsService {
    if (!DiagnosticsService.instance) {
      DiagnosticsService.instance = new DiagnosticsService();
    }
    return DiagnosticsService.instance;
  }

  /**
   * Setup VS Code diagnostic listeners
   */
  private setupListeners(): void {
    // Listen to all diagnostics changes
    this.disposables.push(
      vscode.languages.onDidChangeDiagnostics(this.handleDiagnosticsChange.bind(this))
    );

    // Listen to document saves for auto-fix
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument(this.handleDocumentSave.bind(this))
    );

    // Listen to active editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(this.handleEditorChange.bind(this))
    );

    console.log('[Diagnostics] Service initialized with listeners');
  }

  /**
   * Handle diagnostics changes from VS Code
   */
  private handleDiagnosticsChange(event: vscode.DiagnosticChangeEvent): void {
    const errors: DiagnosticError[] = [];

    for (const uri of event.uris) {
      // Skip ignored files
      if (this.shouldIgnoreFile(uri.fsPath)) {
        continue;
      }

      const diagnostics = vscode.languages.getDiagnostics(uri);
      const fileErrors = this.convertDiagnostics(uri, diagnostics);
      
      if (fileErrors.length > 0) {
        this.lastDiagnostics.set(uri.fsPath, fileErrors);
        errors.push(...fileErrors);
      } else {
        this.lastDiagnostics.delete(uri.fsPath);
      }
    }

    if (errors.length > 0) {
      console.log(`[Diagnostics] ${errors.length} error(s) detected`);
      this.config.onDiagnosticsChanged?.(errors);
    }
  }

  /**
   * Handle document save - trigger auto-fix if enabled
   */
  private handleDocumentSave(document: vscode.TextDocument): void {
    if (!this.config.autoFixOnSave) return;
    if (this.isAutoFixing) return;
    if (this.shouldIgnoreFile(document.uri.fsPath)) return;

    // Debounce auto-fix to let diagnostics update
    const existingTimer = this.saveDebounceTimers.get(document.uri.fsPath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      await this.autoFixFile(document.uri);
      this.saveDebounceTimers.delete(document.uri.fsPath);
    }, this.config.autoFixDelay);

    this.saveDebounceTimers.set(document.uri.fsPath, timer);
  }

  /**
   * Handle active editor change
   */
  private handleEditorChange(editor: vscode.TextEditor | undefined): void {
    if (!editor) return;
    
    // Refresh diagnostics for the active file
    const uri = editor.document.uri;
    const diagnostics = vscode.languages.getDiagnostics(uri);
    const errors = this.convertDiagnostics(uri, diagnostics);
    
    if (errors.length > 0) {
      this.lastDiagnostics.set(uri.fsPath, errors);
      this.config.onDiagnosticsChanged?.(errors);
    }
  }

  /**
   * Convert VS Code diagnostics to our ParsedError format
   */
  private convertDiagnostics(uri: vscode.Uri, diagnostics: vscode.Diagnostic[]): DiagnosticError[] {
    return diagnostics
      .filter(d => this.config.severityFilter.includes(d.severity))
      .filter(d => !this.config.ignoredRules.includes(d.code?.toString() || ''))
      .map(d => this.diagnosticToError(uri, d));
  }

  /**
   * Convert a single diagnostic to DiagnosticError
   */
  private diagnosticToError(uri: vscode.Uri, diagnostic: vscode.Diagnostic): DiagnosticError {
    const type = this.inferErrorType(diagnostic);
    
    return {
      type,
      severity: this.convertSeverity(diagnostic.severity),
      message: diagnostic.message,
      file: uri.fsPath,
      line: diagnostic.range.start.line + 1,
      column: diagnostic.range.start.character + 1,
      endLine: diagnostic.range.end.line + 1,
      endColumn: diagnostic.range.end.character + 1,
      code: diagnostic.code?.toString(),
      rule: typeof diagnostic.code === 'object' ? diagnostic.code.value?.toString() : undefined,
      source: diagnostic.source,
      fullOutput: diagnostic.message,
      uri,
      range: diagnostic.range,
      relatedInformation: diagnostic.relatedInformation,
    };
  }

  /**
   * Infer error type from diagnostic source and message
   */
  private inferErrorType(diagnostic: vscode.Diagnostic): ErrorType {
    const source = diagnostic.source?.toLowerCase() || '';
    const message = diagnostic.message.toLowerCase();
    const code = diagnostic.code?.toString() || '';

    // TypeScript
    if (source === 'ts' || code.startsWith('ts') || source.includes('typescript')) {
      return 'typescript';
    }

    // ESLint
    if (source === 'eslint' || source.includes('eslint')) {
      return 'eslint';
    }

    // Prettier
    if (source === 'prettier' || source.includes('prettier')) {
      return 'prettier';
    }

    // React/JSX
    if (message.includes('react') || message.includes('jsx') || message.includes('hook')) {
      return 'react';
    }

    // Vue
    if (source === 'vetur' || source === 'volar' || source.includes('vue')) {
      return 'vue';
    }

    // CSS
    if (source === 'css' || source === 'scss' || source === 'less') {
      return 'css';
    }

    // Tailwind
    if (source.includes('tailwind')) {
      return 'tailwind';
    }

    // Flutter/Dart
    if (source === 'dart' || source.includes('flutter')) {
      return 'flutter';
    }

    // Swift
    if (source === 'swift' || source.includes('sourcekit')) {
      return 'swift';
    }

    // Kotlin
    if (source === 'kotlin' || source.includes('kotlin')) {
      return 'kotlin';
    }

    // Jest
    if (source === 'jest' || message.includes('test')) {
      return 'jest';
    }

    // Module errors
    if (message.includes('cannot find module') || message.includes('module not found')) {
      return 'module';
    }

    // Syntax errors
    if (message.includes('syntax') || message.includes('unexpected token')) {
      return 'syntax';
    }

    return 'unknown';
  }

  /**
   * Convert VS Code severity to our severity
   */
  private convertSeverity(severity: vscode.DiagnosticSeverity): 'error' | 'warning' | 'info' {
    switch (severity) {
      case vscode.DiagnosticSeverity.Error:
        return 'error';
      case vscode.DiagnosticSeverity.Warning:
        return 'warning';
      default:
        return 'info';
    }
  }

  /**
   * Check if file should be ignored
   */
  private shouldIgnoreFile(filePath: string): boolean {
    return this.config.ignoredFiles.some(ignored => filePath.includes(ignored));
  }

  /**
   * Auto-fix errors in a file
   */
  public async autoFixFile(uri: vscode.Uri): Promise<{ fixed: number; remaining: number }> {
    const errors = this.lastDiagnostics.get(uri.fsPath) || [];
    
    if (errors.length === 0) {
      return { fixed: 0, remaining: 0 };
    }

    this.isAutoFixing = true;
    this.config.onAutoFixStart?.(uri.fsPath, errors.length);

    let fixed = 0;
    let remaining = errors.length;

    try {
      // Sort by priority
      const sortedErrors = errors.sort((a, b) => 
        errorDetector.getFixPriority(a) - errorDetector.getFixPriority(b)
      );

      // This will be called by the AgentIntegration
      // For now, just return the counts
      // The actual fixing is done by agentIntegration.autoFixDiagnostics()
      
    } catch (error) {
      console.error('[Diagnostics] Auto-fix error:', error);
    } finally {
      this.isAutoFixing = false;
      this.config.onAutoFixComplete?.(uri.fsPath, fixed, remaining);
    }

    return { fixed, remaining };
  }

  /**
   * Get all current diagnostics
   */
  public getAllDiagnostics(): DiagnosticError[] {
    const all: DiagnosticError[] = [];
    
    vscode.languages.getDiagnostics().forEach(([uri, diagnostics]) => {
      if (!this.shouldIgnoreFile(uri.fsPath)) {
        all.push(...this.convertDiagnostics(uri, diagnostics));
      }
    });

    return all;
  }

  /**
   * Get diagnostics for a specific file
   */
  public getFileDiagnostics(uri: vscode.Uri): DiagnosticError[] {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    return this.convertDiagnostics(uri, diagnostics);
  }

  /**
   * Get diagnostics for the active editor
   */
  public getActiveEditorDiagnostics(): DiagnosticError[] {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return [];
    return this.getFileDiagnostics(editor.document.uri);
  }

  /**
   * Get error summary for display
   */
  public getErrorSummary(): { total: number; byType: Record<string, number>; byFile: Record<string, number> } {
    const all = this.getAllDiagnostics();
    const byType: Record<string, number> = {};
    const byFile: Record<string, number> = {};

    for (const error of all) {
      byType[error.type] = (byType[error.type] || 0) + 1;
      
      const fileName = error.file?.split('/').pop() || 'unknown';
      byFile[fileName] = (byFile[fileName] || 0) + 1;
    }

    return { total: all.length, byType, byFile };
  }

  /**
   * Update configuration
   */
  public setConfig(config: Partial<DiagnosticsConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[Diagnostics] Config updated:', this.config);
  }

  /**
   * Enable/disable auto-fix on save
   */
  public setAutoFixOnSave(enabled: boolean): void {
    this.config.autoFixOnSave = enabled;
    console.log(`[Diagnostics] Auto-fix on save: ${enabled}`);
  }

  /**
   * Add quick fix code action provider
   */
  public registerCodeActionProvider(selector: vscode.DocumentSelector): vscode.Disposable {
    return vscode.languages.registerCodeActionsProvider(selector, {
      provideCodeActions: (document, range, context) => {
        const actions: vscode.CodeAction[] = [];

        for (const diagnostic of context.diagnostics) {
          // Add "Fix with AI" action
          const fixAction = new vscode.CodeAction(
            `🤖 Fix with AI: ${diagnostic.message.substring(0, 40)}...`,
            vscode.CodeActionKind.QuickFix
          );
          fixAction.diagnostics = [diagnostic];
          fixAction.command = {
            command: 'codeless-ai.fixDiagnostic',
            title: 'Fix with AI',
            arguments: [document.uri, diagnostic]
          };
          actions.push(fixAction);
        }

        // Add "Fix all in file" action if multiple errors
        if (context.diagnostics.length > 1) {
          const fixAllAction = new vscode.CodeAction(
            `🤖 Fix all ${context.diagnostics.length} issues with AI`,
            vscode.CodeActionKind.QuickFix
          );
          fixAllAction.command = {
            command: 'codeless-ai.fixAllInFile',
            title: 'Fix all with AI',
            arguments: [document.uri]
          };
          actions.push(fixAllAction);
        }

        return actions;
      }
    }, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
    });
  }

  /**
   * Show diagnostics in a quick pick
   */
  public async showDiagnosticsPicker(): Promise<DiagnosticError | undefined> {
    const errors = this.getAllDiagnostics();
    
    if (errors.length === 0) {
      vscode.window.showInformationMessage('No errors found! 🎉');
      return undefined;
    }

    const items = errors.map(error => ({
      label: `$(error) ${error.type}: ${error.message.substring(0, 60)}`,
      description: error.file?.split('/').pop(),
      detail: `Line ${error.line}${error.column ? `:${error.column}` : ''}`,
      error
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Select an error to fix (${errors.length} total)`,
      matchOnDescription: true,
      matchOnDetail: true
    });

    return selected?.error;
  }

  /**
   * Dispose all listeners
   */
  public dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.diagnosticCollection.dispose();
    this.saveDebounceTimers.forEach(timer => clearTimeout(timer));
    this.saveDebounceTimers.clear();
  }
}

export const diagnosticsService = DiagnosticsService.getInstance();
