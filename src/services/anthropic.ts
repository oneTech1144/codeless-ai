import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export class AnthropicService {
  private client: Anthropic | null = null;
  private model: string = 'claude-sonnet-4-20250514';
  private maxTokens: number = 4096;

  constructor() {
    this.updateConfig();
  }

  updateConfig() {
    const config = vscode.workspace.getConfiguration('codelessai');
    const apiKey = config.get<string>('anthropicApiKey');
    this.model = config.get<string>('model') || 'claude-sonnet-4-20250514';
    this.maxTokens = config.get<number>('maxTokens') || 4096;

    if (apiKey) {
      this.client = new Anthropic({ apiKey });
    } else {
      this.client = null;
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async chat(messages: Message[], systemPrompt?: string): Promise<string> {
    if (!this.client) {
      throw new Error('API key not configured. Please set your Anthropic API key in settings.');
    }

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: systemPrompt || 'You are CodelessAI, a helpful coding assistant. Be concise and helpful.',
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      });

      const textContent = response.content.find(c => c.type === 'text');
      return textContent ? textContent.text : 'No response generated.';
    } catch (error: any) {
      throw new Error(`API Error: ${error.message}`);
    }
  }

  async *streamChat(messages: Message[], systemPrompt?: string): AsyncGenerator<string> {
    if (!this.client) {
      throw new Error('API key not configured. Please set your Anthropic API key in settings.');
    }

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt || 'You are CodelessAI, a helpful coding assistant. Be concise and helpful.',
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }
}
