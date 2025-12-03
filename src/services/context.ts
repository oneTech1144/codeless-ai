/**
 * Enhanced Context Service - Workspace awareness, file context, git status
 */

import * as vscode from 'vscode';
import * as path from 'path';

export interface FileContext {
  fileName: string;
  filePath: string;
  language: string;
  content?: string;
  selection?: string;
  lineCount: number;
}

export interface WorkspaceContext {
  name: string;
  rootPath: string;
  openFiles: FileContext[];
  activeFile?: FileContext;
  gitBranch?: string;
  gitStatus?: string;
}

export class ContextService {
  /**
   * Get the currently selected code in the active editor
   */
  static getSelectedCode(): string | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;
    
    const selection = editor.selection;
    if (selection.isEmpty) return null;
    
    return editor.document.getText(selection);
  }

  /**
   * Get context about the active file
   */
  static getActiveContext(): FileContext | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;

    const doc = editor.document;
    const selection = editor.selection;

    return {
      fileName: path.basename(doc.fileName),
      filePath: doc.fileName,
      language: doc.languageId,
      content: doc.getText(),
      selection: selection.isEmpty ? undefined : doc.getText(selection),
      lineCount: doc.lineCount,
    };
  }

  /**
   * Get full workspace context including open files
   */
  static async getWorkspaceContext(): Promise<WorkspaceContext | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return null;

    const rootFolder = workspaceFolders[0];
    const openFiles: FileContext[] = [];

    // Get all open text documents
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme === 'file' && !doc.isUntitled) {
        openFiles.push({
          fileName: path.basename(doc.fileName),
          filePath: doc.fileName,
          language: doc.languageId,
          lineCount: doc.lineCount,
        });
      }
    }

    // Get git branch if available
    let gitBranch: string | undefined;
    try {
      const gitExtension = vscode.extensions.getExtension('vscode.git');
      if (gitExtension) {
        const git = gitExtension.exports.getAPI(1);
        const repo = git.repositories[0];
        if (repo) {
          gitBranch = repo.state.HEAD?.name;
        }
      }
    } catch {
      // Git extension not available
    }

    return {
      name: rootFolder.name,
      rootPath: rootFolder.uri.fsPath,
      openFiles,
      activeFile: this.getActiveContext() || undefined,
      gitBranch,
    };
  }

  /**
   * Get a summary of the workspace for AI context
   */
  static async getContextSummary(): Promise<string> {
    const workspace = await this.getWorkspaceContext();
    if (!workspace) return 'No workspace open.';

    let summary = `Workspace: ${workspace.name}`;
    
    if (workspace.gitBranch) {
      summary += ` (branch: ${workspace.gitBranch})`;
    }

    if (workspace.activeFile) {
      summary += `\nActive file: ${workspace.activeFile.fileName} (${workspace.activeFile.language}, ${workspace.activeFile.lineCount} lines)`;
    }

    if (workspace.openFiles.length > 1) {
      summary += `\nOpen files: ${workspace.openFiles.map(f => f.fileName).join(', ')}`;
    }

    return summary;
  }

  /**
   * Get file content by path (relative to workspace)
   */
  static async getFileContent(relativePath: string): Promise<string | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return null;

    const fullPath = path.join(workspaceFolders[0].uri.fsPath, relativePath);
    
    try {
      const uri = vscode.Uri.file(fullPath);
      const doc = await vscode.workspace.openTextDocument(uri);
      return doc.getText();
    } catch {
      return null;
    }
  }

  /**
   * Replace the current selection with new text
   */
  static async replaceSelection(newText: string): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) return false;

    return editor.edit(editBuilder => {
      editBuilder.replace(editor.selection, newText);
    });
  }

  /**
   * Insert text at cursor position
   */
  static async insertAtCursor(text: string): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;

    return editor.edit(editBuilder => {
      editBuilder.insert(editor.selection.active, text);
    });
  }

  /**
   * Get diagnostics (errors/warnings) for active file
   */
  static getActiveDiagnostics(): vscode.Diagnostic[] {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return [];

    return vscode.languages.getDiagnostics(editor.document.uri);
  }

  /**
   * Format diagnostics as string for AI context
   */
  static formatDiagnosticsForAI(): string {
    const diagnostics = this.getActiveDiagnostics();
    if (diagnostics.length === 0) return '';

    return diagnostics.map(d => {
      const severity = d.severity === vscode.DiagnosticSeverity.Error ? 'Error' : 'Warning';
      return `${severity} at line ${d.range.start.line + 1}: ${d.message}`;
    }).join('\n');
  }
}
