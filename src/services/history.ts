/**
 * Conversation History Service - Persist and manage chat history
 */

import * as vscode from 'vscode';
import { Message } from '../providers';

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  provider: string;
  model: string;
}

const STORAGE_KEY = 'codelessai.conversations';
const MAX_CONVERSATIONS = 50;

export class HistoryService {
  private conversations: Conversation[] = [];
  private activeId: string | null = null;

  constructor(private context: vscode.ExtensionContext) {
    this.loadFromStorage();
  }

  /**
   * Load conversations from persistent storage
   */
  private loadFromStorage(): void {
    const stored = this.context.globalState.get<Conversation[]>(STORAGE_KEY);
    this.conversations = stored || [];
  }

  /**
   * Save conversations to persistent storage
   */
  private async saveToStorage(): Promise<void> {
    await this.context.globalState.update(STORAGE_KEY, this.conversations);
  }

  /**
   * Create a new conversation
   */
  createConversation(provider: string, model: string): Conversation {
    const conversation: Conversation = {
      id: this.generateId(),
      title: 'New Chat',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      provider,
      model,
    };

    this.conversations.unshift(conversation);
    this.activeId = conversation.id;

    // Limit stored conversations
    if (this.conversations.length > MAX_CONVERSATIONS) {
      this.conversations = this.conversations.slice(0, MAX_CONVERSATIONS);
    }

    this.saveToStorage();
    return conversation;
  }

  /**
   * Get the active conversation
   */
  getActiveConversation(): Conversation | null {
    if (!this.activeId) return null;
    return this.conversations.find(c => c.id === this.activeId) || null;
  }

  /**
   * Set active conversation by ID
   */
  setActiveConversation(id: string): Conversation | null {
    const conversation = this.conversations.find(c => c.id === id);
    if (conversation) {
      this.activeId = id;
    }
    return conversation || null;
  }

  /**
   * Add message to active conversation
   */
  addMessage(role: 'user' | 'assistant', content: string): void {
    const conversation = this.getActiveConversation();
    if (!conversation) return;

    conversation.messages.push({ role, content });
    conversation.updatedAt = Date.now();

    // Update title from first user message
    if (conversation.messages.length === 1 && role === 'user') {
      conversation.title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
    }

    this.saveToStorage();
  }

  /**
   * Get all conversations (sorted by last updated)
   */
  getAllConversations(): Conversation[] {
    return [...this.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Delete a conversation
   */
  deleteConversation(id: string): void {
    this.conversations = this.conversations.filter(c => c.id !== id);
    if (this.activeId === id) {
      this.activeId = this.conversations[0]?.id || null;
    }
    this.saveToStorage();
  }

  /**
   * Clear all conversations
   */
  clearAll(): void {
    this.conversations = [];
    this.activeId = null;
    this.saveToStorage();
  }

  /**
   * Get messages for active conversation
   */
  getMessages(): Message[] {
    return this.getActiveConversation()?.messages || [];
  }

  /**
   * Clear messages in active conversation
   */
  clearActiveMessages(): void {
    const conversation = this.getActiveConversation();
    if (conversation) {
      conversation.messages = [];
      conversation.updatedAt = Date.now();
      this.saveToStorage();
    }
  }

  private generateId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}
