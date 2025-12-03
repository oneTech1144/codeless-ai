import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';

export interface FileAction {
  type: 'read' | 'create' | 'edit' | 'delete';
  path: string;
  content?: string;
  originalContent?: string;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
  error?: string;
}

export interface TerminalAction {
  type: 'command';
  command: string;
  cwd?: string;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
  output?: string;
  exitCode?: number;
  error?: string;
  isDangerous?: boolean;
}

export interface AgentPlan {
  description: string;
  steps: (FileAction | TerminalAction)[];
  status: 'planning' | 'executing' | 'completed' | 'failed';
}

// Safe commands that can run without approval
const SAFE_COMMAND_PATTERNS = [
  // Read-only commands
  /^ls\b/, /^pwd\b/, /^cat\b/, /^head\b/, /^tail\b/, /^grep\b/, /^find\b/, /^which\b/, /^echo\b/,
  /^wc\b/, /^diff\b/, /^file\b/, /^stat\b/, /^tree\b/,
  
  // Package info (not install)
  /^npm\s+(list|ls|outdated|view|info|search|help|version|config\s+get)\b/,
  /^yarn\s+(list|info|why|outdated|help)\b/,
  /^pnpm\s+(list|ls|outdated|why)\b/,
  
  // Build/test/dev commands
  /^npm\s+run\s+(dev|start|build|test|lint|format|check|compile|watch)\b/,
  /^yarn\s+(dev|start|build|test|lint|format|check|compile|watch)\b/,
  /^pnpm\s+(dev|start|build|test|lint|format|check|compile|watch)\b/,
  /^npx\s+(tsc|eslint|prettier|jest|vitest|playwright)\b/,
  
  // Git read operations
  /^git\s+(status|log|diff|branch|show|remote|tag|stash\s+list|blame|shortlog)\b/,
  
  // TypeScript/build tools
  /^tsc\b/, /^node\b/, /^deno\b/, /^bun\b/,
  /^cargo\s+(build|test|check|clippy|fmt|doc)\b/,
  /^go\s+(build|test|vet|fmt|doc)\b/,
  /^dotnet\s+(build|test|run|watch)\b/,
  /^python\s+-m\s+(pytest|unittest|mypy|black|flake8)\b/,
  /^pytest\b/, /^mypy\b/,
];

// Dangerous commands that always need approval
const DANGEROUS_COMMAND_PATTERNS = [
  // File deletion
  /^rm\b/, /^rmdir\b/, /^del\b/, /^unlink\b/,
  
  // Elevated privileges
  /^sudo\b/, /^su\b/, /^doas\b/,
  
  // Package installation
  /^npm\s+(install|i|add|uninstall|remove|update|upgrade|ci)\b/,
  /^yarn\s+(add|remove|upgrade|install)\b/,
  /^pnpm\s+(add|remove|update|install)\b/,
  /^pip\s+(install|uninstall)\b/,
  /^pip3\s+(install|uninstall)\b/,
  /^cargo\s+(install|uninstall)\b/,
  /^go\s+(install|get)\b/,
  /^gem\s+(install|uninstall)\b/,
  /^brew\s+(install|uninstall|upgrade)\b/,
  /^apt\b/, /^apt-get\b/, /^yum\b/, /^dnf\b/, /^pacman\b/,
  
  // Git write operations
  /^git\s+(push|commit|merge|rebase|reset|checkout|pull|fetch|clone|init)\b/,
  /^git\s+(cherry-pick|revert|stash\s+(pop|drop|apply|clear))\b/,
  
  // File operations
  /^mv\b/, /^cp\s+-r?f/, /^rsync\b/,
  
  // Container/cloud operations
  /^docker\b/, /^kubectl\b/, /^terraform\b/, /^aws\b/, /^gcloud\b/, /^az\b/,
  
  // Process management
  /^kill\b/, /^pkill\b/, /^killall\b/,
  
  // Network
  /^curl\b.*(-X|--request)\s*(POST|PUT|DELETE|PATCH)/, /^wget\b/,
  
  // Database
  /^mysql\b/, /^psql\b/, /^mongo\b/, /^redis-cli\b/,
];

export class AgentService {
  private static instance: AgentService;
  private workspaceRoot: string | undefined;
  private terminal: vscode.Terminal | undefined;
  private autoMode: boolean = true;

  private constructor() {
    this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  public static getInstance(): AgentService {
    if (!AgentService.instance) {
      AgentService.instance = new AgentService();
    }
    return AgentService.instance;
  }

  public setAutoMode(enabled: boolean): void {
    this.autoMode = enabled;
  }

  public isAutoModeEnabled(): boolean {
    return this.autoMode;
  }

  // ==================== FILE OPERATIONS ====================
  // Create and Edit are ALWAYS ALLOWED (core purpose of AI coding assistant)
  // Delete ALWAYS REQUIRES APPROVAL (hard to undo)

  /**
   * Read a file - ALWAYS ALLOWED
   */
  public async readFile(filePath: string): Promise<{ success: boolean; content?: string; error?: string }> {
    try {
      const fullPath = this.resolvePath(filePath);
      const content = fs.readFileSync(fullPath, 'utf-8');
      return { success: true, content };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Create a file - ALWAYS ALLOWED (core AI assistant function)
   */
  public async createFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }> {
    try {
      const fullPath = this.resolvePath(filePath);
      const dir = path.dirname(fullPath);
      
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(fullPath, content, 'utf-8');
      
      // Open the file in editor
      const doc = await vscode.workspace.openTextDocument(fullPath);
      await vscode.window.showTextDocument(doc);
      
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Edit a file - ALWAYS ALLOWED (core AI assistant function)
   */
  public async editFile(filePath: string, newContent: string): Promise<{ success: boolean; error?: string }> {
    try {
      const fullPath = this.resolvePath(filePath);
      
      if (!fs.existsSync(fullPath)) {
        return this.createFile(filePath, newContent);
      }
      
      fs.writeFileSync(fullPath, newContent, 'utf-8');
      
      // Refresh the file in editor if open
      const doc = await vscode.workspace.openTextDocument(fullPath);
      await vscode.window.showTextDocument(doc);
      
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete a file - ALWAYS REQUIRES APPROVAL
   */
  public async deleteFile(filePath: string): Promise<{ success: boolean; needsApproval: boolean; error?: string }> {
    // Always require approval for delete
    return { success: false, needsApproval: true };
  }

  /**
   * Execute delete after approval
   */
  public async executeDelete(filePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const fullPath = this.resolvePath(filePath);
      fs.unlinkSync(fullPath);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ==================== TERMINAL COMMANDS ====================
  // Safe commands: Auto-run
  // Dangerous commands: Need approval

  /**
   * Check if a command is safe to run without approval
   */
  public isCommandSafe(command: string): boolean {
    const trimmed = command.trim();
    
    // Check if it matches any dangerous pattern first
    if (DANGEROUS_COMMAND_PATTERNS.some(pattern => pattern.test(trimmed))) {
      return false;
    }
    
    // Check if it matches any safe pattern
    if (SAFE_COMMAND_PATTERNS.some(pattern => pattern.test(trimmed))) {
      return true;
    }
    
    // Unknown commands are considered dangerous
    return false;
  }

  /**
   * Run a terminal command
   */
  public async runCommand(command: string, cwd?: string): Promise<{
    success: boolean;
    needsApproval: boolean;
    error?: string;
  }> {
    const isSafe = this.isCommandSafe(command);
    
    if (!isSafe) {
      return { success: false, needsApproval: true };
    }
    
    // Safe command - execute
    const result = await this.executeCommand(command, cwd);
    return { ...result, needsApproval: false };
  }

  /**
   * Execute a command in terminal (visual feedback)
   */
  public async executeCommand(command: string, cwd?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const workDir = cwd ? this.resolvePath(cwd) : this.workspaceRoot;
      
      // Create or reuse terminal
      if (!this.terminal || this.terminal.exitStatus !== undefined) {
        this.terminal = vscode.window.createTerminal({
          name: 'CodelessAI',
          cwd: workDir
        });
      }

      this.terminal.show();
      this.terminal.sendText(command);
      
      const isSafe = this.isCommandSafe(command);
      if (!isSafe) {
        vscode.window.showInformationMessage(`⚡ Running: ${command}`);
      }
      
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute command and capture output for error detection
   */
  public async executeCommandWithOutput(command: string, cwd?: string): Promise<{
    success: boolean;
    output: string;
    exitCode: number;
    error?: string;
  }> {
    return new Promise((resolve) => {
      const workDir = cwd ? this.resolvePath(cwd) : this.workspaceRoot || process.cwd();
      
      cp.exec(command, {
        cwd: workDir,
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
        timeout: 300000, // 5 min timeout
      }, (error, stdout, stderr) => {
        const output = stdout + (stderr ? '\n' + stderr : '');
        const exitCode = error?.code || 0;
        
        resolve({
          success: exitCode === 0,
          output,
          exitCode,
          error: error?.message
        });
      });
    });
  }

  // ==================== HELPER METHODS ====================

  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.join(this.workspaceRoot || '', filePath);
  }

  /**
   * Parse AI response to extract file actions
   * Looks for code blocks with file paths
   */
  public parseActionsFromResponse(response: string): FileAction[] {
    const actions: FileAction[] = [];
    
    // Pattern: ```language:path/to/file or ```path/to/file
    const codeBlockPattern = /```(\w+)?(?::([^\n]+))?\n([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockPattern.exec(response)) !== null) {
      const language = match[1] || '';
      const filePath = match[2]?.trim();
      const content = match[3]?.trim();

      if (filePath && content) {
        const fullPath = this.resolvePath(filePath);
        const exists = fs.existsSync(fullPath);

        actions.push({
          type: exists ? 'edit' : 'create',
          path: filePath,
          content: content,
          originalContent: exists ? fs.readFileSync(fullPath, 'utf-8') : undefined,
          status: 'pending'
        });
      }
    }

    return actions;
  }

  /**
   * Parse AI response to extract terminal commands
   * Looks for shell/bash code blocks or explicit command patterns
   */
  public parseCommandsFromResponse(response: string): TerminalAction[] {
    const actions: TerminalAction[] = [];
    
    // Pattern: ```bash or ```shell or ```sh
    const shellBlockPattern = /```(?:bash|shell|sh|zsh|terminal)\n([\s\S]*?)```/g;
    let match;

    while ((match = shellBlockPattern.exec(response)) !== null) {
      const commands = match[1].trim().split('\n').filter(cmd => {
        const trimmed = cmd.trim();
        return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('$');
      });

      for (const command of commands) {
        const cleanCmd = command.replace(/^\$\s*/, '').trim();
        if (cleanCmd) {
          actions.push({
            type: 'command',
            command: cleanCmd,
            status: 'pending',
            isDangerous: !this.isCommandSafe(cleanCmd)
          });
        }
      }
    }

    return actions;
  }

  /**
   * Process AI response and execute actions
   */
  public async processAIResponse(response: string): Promise<{
    fileActions: FileAction[];
    terminalActions: TerminalAction[];
    pendingApprovals: (FileAction | TerminalAction)[];
  }> {
    const fileActions = this.parseActionsFromResponse(response);
    const terminalActions = this.parseCommandsFromResponse(response);
    const pendingApprovals: (FileAction | TerminalAction)[] = [];

    // Execute file actions (always allowed for create/edit)
    for (const action of fileActions) {
      if (action.type === 'create') {
        const result = await this.createFile(action.path, action.content || '');
        action.status = result.success ? 'executed' : 'failed';
        action.error = result.error;
      } else if (action.type === 'edit') {
        const result = await this.editFile(action.path, action.content || '');
        action.status = result.success ? 'executed' : 'failed';
        action.error = result.error;
      } else if (action.type === 'delete') {
        // Delete needs approval
        pendingApprovals.push(action);
      }
    }

    // Process terminal commands
    for (const action of terminalActions) {
      if (!action.isDangerous) {
        // Safe command - execute with output capture for error detection
        const result = await this.executeCommandWithOutput(action.command, action.cwd);
        action.status = result.success ? 'executed' : 'failed';
        action.error = result.error;
        action.output = result.output;
        action.exitCode = result.exitCode;
      } else {
        // Dangerous command - needs approval
        pendingApprovals.push(action);
      }
    }

    return { fileActions, terminalActions, pendingApprovals };
  }
}

export const agentService = AgentService.getInstance();
