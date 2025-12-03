/**
 * OpenAI Provider Implementation
 */

import { BaseProvider } from './base';
import { Message, ChatOptions, ChatResponse, ProviderConfig, ProviderStatus } from './types';

// OpenAI-compatible API client (works with OpenAI, Azure, etc.)
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIResponse {
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

interface OpenAIError {
  error?: {
    message?: string;
  };
}

export class OpenAIProvider extends BaseProvider {
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    super('openai', config);
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  }

  updateConfig(config: Partial<ProviderConfig>): void {
    super.updateConfig(config);
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  isConfigured(): boolean {
    return !!this.config.apiKey;
  }

  async getStatus(): Promise<ProviderStatus> {
    if (!this.isConfigured()) {
      return { configured: false, healthy: false, error: 'API key not configured' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return { configured: true, healthy: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { configured: true, healthy: false, error: message };
    }
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    if (!this.config.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const apiMessages: OpenAIMessage[] = [];
    
    // Add system message if provided
    if (options?.systemPrompt) {
      apiMessages.push({ role: 'system', content: options.systemPrompt });
    }
    
    // Add conversation messages
    for (const m of messages) {
      apiMessages.push({ role: m.role, content: m.content });
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: apiMessages,
          max_tokens: options?.maxTokens || this.config.maxTokens,
          temperature: options?.temperature ?? this.config.temperature ?? 0.7,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as OpenAIError;
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json() as OpenAIResponse;
      
      return {
        content: data.choices[0]?.message?.content || '',
        model: this.config.model,
        provider: 'openai',
        usage: data.usage ? {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
        } : undefined,
        finishReason: data.choices[0]?.finish_reason === 'stop' ? 'stop' : 'length',
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`OpenAI API Error: ${message}`);
    }
  }

  async *streamChat(messages: Message[], options?: ChatOptions): AsyncGenerator<string> {
    if (!this.config.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const apiMessages: OpenAIMessage[] = [];
    
    if (options?.systemPrompt) {
      apiMessages.push({ role: 'system', content: options.systemPrompt });
    }
    
    for (const m of messages) {
      apiMessages.push({ role: m.role, content: m.content });
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: apiMessages,
        max_tokens: options?.maxTokens || this.config.maxTokens,
        temperature: options?.temperature ?? this.config.temperature ?? 0.7,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as OpenAIError;
      throw new Error(errorData.error?.message || `HTTP ${response.status}`);
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
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;
          
          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  }
}
