/**
 * Ollama Provider Implementation (Local LLMs)
 */

import { BaseProvider } from './base';
import { Message, ChatOptions, ChatResponse, ProviderConfig, ProviderStatus } from './types';

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaResponse {
  message: { content: string };
  done: boolean;
  eval_count?: number;
  prompt_eval_count?: number;
}

export class OllamaProvider extends BaseProvider {
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    super('ollama', config);
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
  }

  updateConfig(config: Partial<ProviderConfig>): void {
    super.updateConfig(config);
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  isConfigured(): boolean {
    // Ollama doesn't need an API key, just needs to be running
    return true;
  }

  async getStatus(): Promise<ProviderStatus> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { configured: true, healthy: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { 
        configured: true, 
        healthy: false, 
        error: `Ollama not running at ${this.baseUrl}. ${message}` 
      };
    }
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const apiMessages: OllamaMessage[] = [];
    
    if (options?.systemPrompt) {
      apiMessages.push({ role: 'system', content: options.systemPrompt });
    }
    
    for (const m of messages) {
      apiMessages.push({ role: m.role, content: m.content });
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          messages: apiMessages,
          stream: false,
          options: {
            num_predict: options?.maxTokens || this.config.maxTokens,
            temperature: options?.temperature ?? this.config.temperature ?? 0.7,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const data = await response.json() as OllamaResponse;

      return {
        content: data.message?.content || '',
        model: this.config.model,
        provider: 'ollama',
        usage: {
          inputTokens: data.prompt_eval_count || 0,
          outputTokens: data.eval_count || 0,
        },
        finishReason: data.done ? 'stop' : 'length',
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
        throw new Error(`Ollama not running. Start it with: ollama serve`);
      }
      throw new Error(`Ollama Error: ${message}`);
    }
  }

  async *streamChat(messages: Message[], options?: ChatOptions): AsyncGenerator<string> {
    const apiMessages: OllamaMessage[] = [];
    
    if (options?.systemPrompt) {
      apiMessages.push({ role: 'system', content: options.systemPrompt });
    }
    
    for (const m of messages) {
      apiMessages.push({ role: m.role, content: m.content });
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: apiMessages,
        stream: true,
        options: {
          num_predict: options?.maxTokens || this.config.maxTokens,
          temperature: options?.temperature ?? this.config.temperature ?? 0.7,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          try {
            const json = JSON.parse(line);
            if (json.message?.content) {
              yield json.message.content;
            }
            if (json.done) return;
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  }
}
