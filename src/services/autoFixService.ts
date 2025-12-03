import * as vscode from 'vscode';
import * as cp from 'child_process';
import { errorDetector, ParsedError } from './errorDetector';
import { agentService } from './agentService';

export interface AutoFixResult {
  success: boolean;
  attempts: number;
  errors: ParsedError[];
  fixes: string[];
  finalOutput: string;
}

export interface AutoFixConfig {
  maxRetries: number;
  autoFixEnabled: boolean;
  onStatusUpdate?: (status: string) => void;
  onFixAttempt?: (attempt: number, error: ParsedError) => void;
  generateFix?: (prompt: string) => Promise<string>;
}

export class AutoFixService {
  private static instance: AutoFixService;
  private workspaceRoot: string | undefined;
  private config: AutoFixConfig = {
    maxRetries: 3,
    autoFixEnabled: true,
  };

  private constructor() {
    this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  public static getInstance(): AutoFixService {
    if (!AutoFixService.instance) {
      AutoFixService.instance = new AutoFixService();
    }
    return AutoFixService.instance;
  }

  public setConfig(config: Partial<AutoFixConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Run a command and capture output
   */
  public async runCommand(command: string, cwd?: string): Promise<{ output: string; exitCode: number }> {
    return new Promise((resolve) => {
      const workDir = cwd || this.workspaceRoot || process.cwd();
      
      cp.exec(command, { cwd: workDir, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        const output = stdout + '\n' + stderr;
        const exitCode = error?.code || 0;
        resolve({ output, exitCode });
      });
    });
  }

  /**
   * Run command with auto-fix loop
   */
  public async runWithAutoFix(
    command: string,
    generateFix: (prompt: string) => Promise<string>,
    onStatus?: (status: string) => void
  ): Promise<AutoFixResult> {
    const result: AutoFixResult = {
      success: false,
      attempts: 0,
      errors: [],
      fixes: [],
      finalOutput: '',
    };

    let currentAttempt = 0;
    
    while (currentAttempt < this.config.maxRetries) {
      currentAttempt++;
      result.attempts = currentAttempt;
      
      onStatus?.(`Running: ${command} (attempt ${currentAttempt}/${this.config.maxRetries})`);
      
      // Run the command
      const { output, exitCode } = await this.runCommand(command);
      result.finalOutput = output;
      
      // Check if successful
      if (exitCode === 0 && !errorDetector.hasErrors(output)) {
        result.success = true;
        onStatus?.(`✅ Success after ${currentAttempt} attempt(s)`);
        return result;
      }
      
      // Parse errors
      const errors = errorDetector.parseErrors(output);
      result.errors = errors;
      
      if (errors.length === 0) {
        // Has error indicators but couldn't parse - stop
        onStatus?.(`❌ Failed with unparseable errors`);
        return result;
      }
      
      onStatus?.(`Found ${errors.length} error(s), attempting fix...`);
      
      // Try to fix each error (focus on first one usually)
      const primaryError = errors[0];
      
      if (this.config.onFixAttempt) {
        this.config.onFixAttempt(currentAttempt, primaryError);
      }
      
      // Build prompt and get fix from AI
      const prompt = await errorDetector.buildFixPrompt(primaryError);
      
      try {
        onStatus?.(`🤖 Generating fix for: ${primaryError.message.substring(0, 50)}...`);
        
        const fixResponse = await generateFix(prompt);
        result.fixes.push(fixResponse);
        
        // Parse and apply the fix
        const applied = await this.applyFix(fixResponse);
        
        if (!applied) {
          onStatus?.(`⚠️ Could not apply fix, retrying...`);
        } else {
          onStatus?.(`✓ Fix applied, verifying...`);
        }
        
      } catch (error) {
        onStatus?.(`⚠️ Fix generation failed: ${error}`);
      }
    }
    
    onStatus?.(`❌ Failed after ${result.attempts} attempts`);
    return result;
  }

  /**
   * Apply a fix from AI response
   */
  private async applyFix(response: string): Promise<boolean> {
    // Parse file actions from the AI response (reuse agentService logic)
    const { fileActions } = await agentService.processAIResponse(response);
    return fileActions.length > 0 && fileActions.some(a => a.status === 'executed');
  }

  /**
   * Quick check and fix for a command
   */
  public async checkAndFix(
    command: string,
    generateFix: (prompt: string) => Promise<string>
  ): Promise<boolean> {
    // First run
    const { output, exitCode } = await this.runCommand(command);
    
    if (exitCode === 0 && !errorDetector.hasErrors(output)) {
      return true;
    }
    
    // Has errors, try auto-fix
    const result = await this.runWithAutoFix(command, generateFix);
    return result.success;
  }

  /**
   * Parse terminal output and return structured errors
   */
  public analyzeOutput(output: string): {
    hasErrors: boolean;
    errors: ParsedError[];
    summary: string;
  } {
    const hasErrors = errorDetector.hasErrors(output);
    const errors = hasErrors ? errorDetector.parseErrors(output) : [];
    
    let summary = '';
    if (errors.length > 0) {
      summary = `Found ${errors.length} error(s):\n`;
      errors.forEach((e, i) => {
        summary += `${i + 1}. ${e.type}: ${e.message}`;
        if (e.file) summary += ` in ${e.file}`;
        if (e.line) summary += `:${e.line}`;
        summary += '\n';
      });
    } else if (hasErrors) {
      summary = 'Build failed with errors (could not parse specific issues)';
    } else {
      summary = 'No errors detected';
    }
    
    return { hasErrors, errors, summary };
  }
}

export const autoFixService = AutoFixService.getInstance();
