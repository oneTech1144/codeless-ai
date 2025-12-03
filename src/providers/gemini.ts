/**
 * Google Gemini Provider Implementation
 */

import { BaseProvider } from './base';
import { Message, ChatOptions, ChatResponse, ProviderConfig, ProviderStatus } from './types';

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

interface GeminiResponse {
  candidates: Array<{
    content: { parts: Array<{ text: string }> };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
  };
}

interface GeminiError {
  error?: { message?: string };
}

export class GeminiProvider extends BaseProvider {
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  constructor(config: ProviderConfig) {
    super('gemini', config);
  }

  isConfigured(): boolean {
    return !!this.config.apiKey;
  }

  async getStatus(): Promise<ProviderStatus> {
    if (!this.isConfigured()) {
      return { configured: false, healthy: false, error: 'API key not configured' };
    }
    try {
      const response = await fetch(
        `${this.baseUrl}/models?key=${this.config.apiKey}`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { configured: true, healthy: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { configured: true, healthy: false, error: message };
    }
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    if (!this.config.apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const contents: GeminiContent[] = [];
    
    // Gemini uses 'model' instead of 'assistant'
    for (const m of messages) {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      });
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: options?.maxTokens || this.config.maxTokens,
        temperature: options?.temperature ?? this.config.temperature ?? 0.7,
      },
    };

    // Add system instruction if provided
    if (options?.systemPrompt) {
      body.systemInstruction = { parts: [{ text: options.systemPrompt }] };
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/models/${this.config.model}:generateContent?key=${this.config.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as GeminiError;
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json() as GeminiResponse;
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      return {
        content: text,
        model: this.config.model,
        provider: 'gemini',
        usage: data.usageMetadata ? {
          inputTokens: data.usageMetadata.promptTokenCount,
          outputTokens: data.usageMetadata.candidatesTokenCount,
        } : undefined,
        finishReason: data.candidates?.[0]?.finishReason === 'STOP' ? 'stop' : 'length',
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Gemini API Error: ${message}`);
    }
  }

  async *streamChat(messages: Message[], options?: ChatOptions): AsyncGenerator<string> {
    if (!this.config.apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const contents: GeminiContent[] = [];
    for (const m of messages) {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      });
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: options?.maxTokens || this.config.maxTokens,
        temperature: options?.temperature ?? this.config.temperature ?? 0.7,
      },
    };

    if (options?.systemPrompt) {
      body.systemInstruction = { parts: [{ text: options.systemPrompt }] };
    }

    const response = await fetch(
      `${this.baseUrl}/models/${this.config.model}:streamGenerateContent?key=${this.config.apiKey}&alt=sse`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as GeminiError;
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
          try {
            const json = JSON.parse(line.slice(6));
            const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) yield text;
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  }
}
