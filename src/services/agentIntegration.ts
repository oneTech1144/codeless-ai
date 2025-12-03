import * as vscode from 'vscode';
import { agentService, FileAction, TerminalAction } from './agentService';
import { errorDetector, ParsedError } from './errorDetector';
import { diagnosticsService, DiagnosticError } from './diagnosticsService';
import { ProviderManager, Message } from '../providers';

export interface AgentIntegrationConfig {
  maxAutoFixRetries: number;
  autoFixEnabled: boolean;
  autoFixOnSave: boolean;
  onStatusUpdate?: (status: string, success?: boolean, details?: any) => void;
  onPendingApprovals?: (approvals: (FileAction | TerminalAction)[]) => void;
  onErrorDetected?: (errors: ParsedError[]) => void;
  onFixAttempt?: (error: ParsedError, attempt: number) => void;
  onDiagnosticsChanged?: (errors: DiagnosticError[]) => void;
}

export interface AutoFixResult {
  success: boolean;
  errorsFixed: number;
  errorsFailed: number;
  attempts: number;
  fixedErrors: ParsedError[];
  remainingErrors: ParsedError[];
}

export class AgentIntegration {
  private providerManager: ProviderManager;
  private config: AgentIntegrationConfig;
  private fixHistory: Map<string, number> = new Map();
  private isFixing: boolean = false;
  private fixQueue: DiagnosticError[] = [];

  constructor(providerManager: ProviderManager, config?: Partial<AgentIntegrationConfig>) {
    this.providerManager = providerManager;
    this.config = {
      maxAutoFixRetries: 3,
      autoFixEnabled: true,
      autoFixOnSave: true,
      ...config
    };

    // Setup diagnostics integration
    this.setupDiagnosticsIntegration();
  }

  /**
   * Setup IDE diagnostics integration
   */
  private setupDiagnosticsIntegration(): void {
    diagnosticsService.setConfig({
      autoFixOnSave: this.config.autoFixOnSave,
      autoFixDelay: 1500, // 1.5s delay to let IDE finish analyzing
      onDiagnosticsChanged: (errors) => {
        console.log(`[Agent] IDE reported ${errors.length} diagnostic error(s)`);
        this.config.onDiagnosticsChanged?.(errors);
        
        // Queue errors for auto-fix if enabled
        if (this.config.autoFixEnabled && this.config.autoFixOnSave) {
          this.queueDiagnosticsForFix(errors);
        }
      },
      onAutoFixStart: (file, count) => {
        this.config.onStatusUpdate?.(
          `🔍 Found ${count} error(s) in ${file.split('/').pop()}`,
          undefined,
          { file, errorCount: count }
        );
      },
      onAutoFixComplete: (file, fixed, remaining) => {
        const fileName = file.split('/').pop();
        if (remaining === 0) {
          this.config.onStatusUpdate?.(
            `✅ All errors fixed in ${fileName}!`,
            true
          );
        } else {
          this.config.onStatusUpdate?.(
            `⚠️ ${fixed} fixed, ${remaining} remaining in ${fileName}`,
            false
          );
        }
      }
    });

    console.log('[Agent] Diagnostics integration setup complete');
  }

  /**
   * Queue diagnostics for auto-fix
   */
  private queueDiagnosticsForFix(errors: DiagnosticError[]): void {
    // Add to queue (avoid duplicates)
    for (const error of errors) {
      const exists = this.fixQueue.some(e => 
        e.file === error.file && 
        e.line === error.line && 
        e.message === error.message
      );
      if (!exists) {
        this.fixQueue.push(error);
      }
    }

    // Start processing if not already
    if (!this.isFixing && this.fixQueue.length > 0) {
      this.processDiagnosticsQueue();
    }
  }

  /**
   * Process queued diagnostics
   */
  private async processDiagnosticsQueue(): Promise<void> {
    if (this.isFixing || this.fixQueue.length === 0) return;

    this.isFixing = true;

    try {
      while (this.fixQueue.length > 0) {
        // Get errors for the first file in queue
        const firstError = this.fixQueue[0];
        const fileErrors = this.fixQueue.filter(e => e.file === firstError.file);
        
        // Remove these from queue
        this.fixQueue = this.fixQueue.filter(e => e.file !== firstError.file);

        // Fix the file
        await this.autoFixDiagnostics(fileErrors);
        
        // Small delay between files
        await new Promise(r => setTimeout(r, 500));
      }
    } finally {
      this.isFixing = false;
    }
  }

  /**
   * Auto-fix diagnostics from IDE
   */
  public async autoFixDiagnostics(errors: DiagnosticError[]): Promise<AutoFixResult> {
    const result: AutoFixResult = {
      success: false,
      errorsFixed: 0,
      errorsFailed: 0,
      attempts: 0,
      fixedErrors: [],
      remainingErrors: [...errors],
    };

    if (errors.length === 0) {
      result.success = true;
      return result;
    }

    const fileName = errors[0].file?.split('/').pop() || 'file';
    this.config.onStatusUpdate?.(
      `🔧 Auto-fixing ${errors.length} error(s) in ${fileName}...`
    );

    // Sort by priority
    const sortedErrors = [...errors].sort((a, b) => 
      errorDetector.getFixPriority(a) - errorDetector.getFixPriority(b)
    );

    // Try to fix errors
    for (let attempt = 0; attempt < this.config.maxAutoFixRetries && result.remainingErrors.length > 0; attempt++) {
      result.attempts++;
      
      const errorToFix = result.remainingErrors[0];
      const errorKey = `${errorToFix.message}-${errorToFix.file}-${errorToFix.line}`;
      
      // Skip if we've tried this error too many times
      const prevAttempts = this.fixHistory.get(errorKey) || 0;
      if (prevAttempts >= 2) {
        result.remainingErrors.shift();
        result.errorsFailed++;
        continue;
      }
      this.fixHistory.set(errorKey, prevAttempts + 1);

      this.config.onStatusUpdate?.(
        `🔧 Fixing: ${errorToFix.message.substring(0, 50)}...`
      );
      this.config.onFixAttempt?.(errorToFix, attempt + 1);

      try {
        // Build smart fix prompt with related errors
        // Build fix prompt
        let prompt = await errorDetector.buildFixPrompt(errorToFix);
        const relatedErrors = result.remainingErrors.slice(1, 4);
        if (relatedErrors.length > 0) {
          prompt += '\n\n## Other Errors in Same File (fix if related):\n';
          relatedErrors.forEach((e, i) => {
            prompt += `${i + 1}. Line ${e.line}: [${e.type}] ${e.message}\n`;
          });
        }
        
        // Get AI fix
        const messages: Message[] = [{ role: 'user', content: prompt }];
        let fixResponse = '';
        
        for await (const chunk of this.providerManager.streamChat(messages, {})) {
          fixResponse += chunk;
        }

        // Apply the fix
        await agentService.processAIResponse(fixResponse);
        
        // Wait for IDE to update diagnostics
        await new Promise(r => setTimeout(r, 1000));
        
        // Check what's fixed by re-checking IDE diagnostics
        const diagError = errorToFix as DiagnosticError;
        const currentDiagnostics = diagError.uri 
          ? diagnosticsService.getFileDiagnostics(diagError.uri) 
          : [];
        const currentKeys = new Set(currentDiagnostics.map(e => `${e.message}-${e.file}-${e.line}`));
        
        const beforeCount = result.remainingErrors.length;
        result.remainingErrors = result.remainingErrors.filter(e => 
          currentKeys.has(`${e.message}-${e.file}-${e.line}`)
        );
        
        const fixedCount = beforeCount - result.remainingErrors.length;
        result.errorsFixed += fixedCount;
        
        if (fixedCount > 0) {
          result.fixedErrors.push(errorToFix);
          this.config.onStatusUpdate?.(
            `✓ Fixed ${fixedCount} error(s)`,
            true
          );
        }

      } catch (error) {
        console.error('[Agent] Fix error:', error);
        result.errorsFailed++;
      }
    }

    result.success = result.remainingErrors.length === 0;
    
    if (result.success) {
      this.config.onStatusUpdate?.(
        `✅ All ${result.errorsFixed} error(s) fixed!`,
        true
      );
    } else {
      this.config.onStatusUpdate?.(
        `⚠️ Fixed ${result.errorsFixed}, ${result.remainingErrors.length} remaining`,
        false
      );
    }

    return result;
  }

  /**
   * Build fix prompt for IDE diagnostic
   */
  private async buildDiagnosticFixPrompt(error: DiagnosticError, relatedErrors: DiagnosticError[]): Promise<string> {
    // Use the base prompt builder
    let prompt = await errorDetector.buildFixPrompt(error);
    
    // Add IDE-specific context
    if (error.source) {
      prompt = prompt.replace('## Error Details', `## Error Details\n- **Source:** ${error.source} (IDE diagnostic)`);
    }
    
    // Add related information if available
    if (error.relatedInformation && error.relatedInformation.length > 0) {
      prompt += '\n\n## Related Information from IDE:\n';
      error.relatedInformation.forEach((info, i) => {
        prompt += `${i + 1}. ${info.message} (${info.location.uri.fsPath}:${info.location.range.start.line + 1})\n`;
      });
    }

    // Add related errors
    if (relatedErrors.length > 0) {
      prompt += '\n\n## Other Errors in Same File (fix if related):\n';
      relatedErrors.forEach((e, i) => {
        prompt += `${i + 1}. Line ${e.line}: [${e.type}] ${e.message}\n`;
      });
    }

    return prompt;
  }

  /**
   * Fix a single diagnostic (called from quick fix)
   */
  public async fixSingleDiagnostic(uri: vscode.Uri, diagnostic: vscode.Diagnostic): Promise<boolean> {
    const error = this.diagnosticToError(uri, diagnostic);
    const result = await this.autoFixDiagnostics([error]);
    return result.success;
  }

  /**
   * Fix all diagnostics in a file (called from quick fix)
   */
  public async fixAllInFile(uri: vscode.Uri): Promise<AutoFixResult> {
    const errors = diagnosticsService.getFileDiagnostics(uri);
    return this.autoFixDiagnostics(errors);
  }

  /**
   * Convert VS Code diagnostic to DiagnosticError
   */
  private diagnosticToError(uri: vscode.Uri, diagnostic: vscode.Diagnostic): DiagnosticError {
    return {
      type: 'unknown',
      severity: 'error',
      message: diagnostic.message,
      file: uri.fsPath,
      line: diagnostic.range.start.line + 1,
      column: diagnostic.range.start.character + 1,
      fullOutput: diagnostic.message,
      uri,
      range: diagnostic.range,
      source: diagnostic.source,
      code: diagnostic.code?.toString(),
    };
  }

  /**
   * Process AI response for file actions and terminal commands
   */
  public async processAIResponse(aiResponse: string): Promise<{
    filesCreated: number;
    filesEdited: number;
    commandsRun: number;
    errorsFixed: number;
    autoFixResult?: AutoFixResult;
  }> {
    const stats = { filesCreated: 0, filesEdited: 0, commandsRun: 0, errorsFixed: 0 };

    try {
      const { fileActions, terminalActions, pendingApprovals } = await agentService.processAIResponse(aiResponse);
      
      stats.filesCreated = fileActions.filter(a => a.type === 'create' && a.status === 'executed').length;
      stats.filesEdited = fileActions.filter(a => a.type === 'edit' && a.status === 'executed').length;
      stats.commandsRun = terminalActions.filter(a => a.status === 'executed').length;
      
      if (stats.filesCreated > 0 || stats.filesEdited > 0 || stats.commandsRun > 0) {
        this.config.onStatusUpdate?.(
          `✅ ${stats.filesCreated} created, ${stats.filesEdited} edited, ${stats.commandsRun} commands`
        );
      }
      
      // Check terminal output for errors
      if (this.config.autoFixEnabled) {
        for (const action of terminalActions) {
          if (action.output && errorDetector.hasErrors(action.output)) {
            const errors = errorDetector.parseErrors(action.output);
            this.config.onErrorDetected?.(errors);
            
            const result = await this.smartAutoFix(action, errors);
            stats.errorsFixed += result.errorsFixed;
          }
        }
      }
      
      // Notify about pending approvals
      if (pendingApprovals.length > 0) {
        this.config.onPendingApprovals?.(pendingApprovals);
      }

      return stats;
    } catch (error) {
      console.error('[Agent] Error:', error);
      return stats;
    }
  }

  /**
   * Smart auto-fix with prioritization
   */
  private async smartAutoFix(action: TerminalAction, errors: ParsedError[]): Promise<AutoFixResult> {
    const result: AutoFixResult = {
      success: false,
      errorsFixed: 0,
      errorsFailed: 0,
      attempts: 0,
      fixedErrors: [],
      remainingErrors: [...errors],
    };

    // Sort by priority
    const sortedErrors = errors.sort((a, b) => 
      errorDetector.getFixPriority(a) - errorDetector.getFixPriority(b)
    );

    // Group by file
    const errorsByFile = new Map<string, ParsedError[]>();
    for (const error of sortedErrors) {
      const key = error.file || '_global_';
      if (!errorsByFile.has(key)) {
        errorsByFile.set(key, []);
      }
      errorsByFile.get(key)!.push(error);
    }

    for (const [file, fileErrors] of errorsByFile) {
      let attempt = 0;
      let remaining = [...fileErrors];

      while (attempt < this.config.maxAutoFixRetries && remaining.length > 0) {
        attempt++;
        result.attempts++;

        const errorToFix = remaining[0];
        const errorKey = `${errorToFix.message}-${errorToFix.file}-${errorToFix.line}`;
        const prevAttempts = this.fixHistory.get(errorKey) || 0;
        
        if (prevAttempts >= 2) {
          remaining.shift();
          result.errorsFailed++;
          continue;
        }
        this.fixHistory.set(errorKey, prevAttempts + 1);

        this.config.onStatusUpdate?.(
          `🔧 Fixing ${errorToFix.type} error: ${errorToFix.message.substring(0, 50)}...`
        );

        try {
          const prompt = await errorDetector.buildFixPrompt(errorToFix);
          const messages: Message[] = [{ role: 'user', content: prompt }];
          let fixResponse = '';
          
          for await (const chunk of this.providerManager.streamChat(messages, {})) {
            fixResponse += chunk;
          }

          await agentService.processAIResponse(fixResponse);
          
          // Re-run command to verify
          const verifyResult = await agentService.executeCommandWithOutput(action.command, action.cwd);
          
          if (!errorDetector.hasErrors(verifyResult.output)) {
            result.success = true;
            result.errorsFixed += remaining.length;
            result.fixedErrors.push(...remaining);
            remaining = [];
            break;
          }

          // Check what's fixed
          const newErrors = errorDetector.parseErrors(verifyResult.output);
          const newKeys = new Set(newErrors.map(e => `${e.message}-${e.file}-${e.line}`));
          
          const beforeCount = remaining.length;
          remaining = remaining.filter(e => newKeys.has(`${e.message}-${e.file}-${e.line}`));
          result.errorsFixed += beforeCount - remaining.length;

        } catch (error) {
          console.error('[Agent] Fix error:', error);
          result.errorsFailed++;
        }
      }

      result.remainingErrors = remaining;
    }

    result.success = result.remainingErrors.length === 0;
    return result;
  }

  /**
   * Run command with auto-fix
   */
  public async runCommandWithAutoFix(command: string, cwd?: string): Promise<{
    success: boolean;
    output: string;
    autoFixResult?: AutoFixResult;
  }> {
    this.config.onStatusUpdate?.(`🚀 Running: ${command}`);
    
    let result = await agentService.executeCommandWithOutput(command, cwd);
    
    if (!errorDetector.hasErrors(result.output)) {
      this.config.onStatusUpdate?.(`✅ Success`, true);
      return { success: result.success, output: result.output };
    }

    this.config.onStatusUpdate?.(`⚠️ Errors detected, auto-fixing...`);
    
    const errors = errorDetector.parseErrors(result.output);
    const action: TerminalAction = {
      type: 'command',
      command,
      cwd,
      status: 'executed',
      output: result.output,
      exitCode: result.exitCode
    };
    
    const autoFixResult = await this.smartAutoFix(action, errors);
    
    if (autoFixResult.success) {
      result = await agentService.executeCommandWithOutput(command, cwd);
    }
    
    return { success: result.success && autoFixResult.success, output: result.output, autoFixResult };
  }

  /**
   * Get current diagnostics summary
   */
  public getDiagnosticsSummary(): { total: number; byType: Record<string, number>; byFile: Record<string, number> } {
    return diagnosticsService.getErrorSummary();
  }

  /**
   * Show diagnostics picker and fix selected
   */
  public async showAndFixDiagnostics(): Promise<void> {
    const error = await diagnosticsService.showDiagnosticsPicker();
    if (error) {
      await this.autoFixDiagnostics([error]);
    }
  }

  /**
   * Enable/disable auto-fix on save
   */
  public setAutoFixOnSave(enabled: boolean): void {
    this.config.autoFixOnSave = enabled;
    diagnosticsService.setAutoFixOnSave(enabled);
  }

  /**
   * Clear fix history
   */
  public clearFixHistory(): void {
    this.fixHistory.clear();
    errorDetector.clearHistory();
  }
}
