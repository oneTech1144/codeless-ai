/**
 * Anthropic/Claude Provider Implementation
 */

import Anthropic from '@anthropic-ai/sdk';
import { BaseProvider } from './base';
import { Message, ChatOptions, ChatResponse, ProviderConfig, ProviderStatus } from './types';

export class AnthropicProvider extends BaseProvider {
  private client: Anthropic | null = null;

  constructor(config: ProviderConfig) {
    super('anthropic', config);
    this.initClient();
  }

  private initClient(): void {
    if (this.config.apiKey) {
      this.client = new Anthropic({ apiKey: this.config.apiKey });
    } else {
      this.client = null;
    }
  }

  updateConfig(config: Partial<ProviderConfig>): void {
    super.updateConfig(config);
    this.initClient();
  }

  isConfigured(): boolean {
    return this.client !== null && !!this.config.apiKey;
  }

  async getStatus(): Promise<ProviderStatus> {
    if (!this.isConfigured()) {
      return { configured: false, healthy: false, error: 'API key not configured' };
    }

    try {
      // Make a minimal test request
      await this.client!.messages.create({
        model: this.config.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      return { configured: true, healthy: true };
    } catch (error: any) {
      return { configured: true, healthy: false, error: error.message };
    }
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    if (!this.client) {
      throw new Error('Anthropic API key not configured');
    }

    const systemPrompt = options?.systemPrompt || 'You are CodelessAI, a helpful coding assistant.';
    
    // Filter out system messages and convert format
    const apiMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    try {
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: options?.maxTokens || this.config.maxTokens,
        system: systemPrompt,
        messages: apiMessages,
      });

      const textContent = response.content.find(c => c.type === 'text');
      
      return {
        content: textContent ? textContent.text : '',
        model: this.config.model,
        provider: 'anthropic',
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        finishReason: response.stop_reason === 'end_turn' ? 'stop' : 'length',
      };
    } catch (error: any) {
      throw new Error(`Anthropic API Error: ${error.message}`);
    }
  }

  async *streamChat(messages: Message[], options?: ChatOptions): AsyncGenerator<string> {
    if (!this.client) {
      throw new Error('Anthropic API key not configured');
    }

    const systemPrompt = options?.systemPrompt || 'You are CodelessAI, a helpful coding assistant.';
    
    const apiMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const stream = this.client.messages.stream({
      model: this.config.model,
      max_tokens: options?.maxTokens || this.config.maxTokens,
      system: systemPrompt,
      messages: apiMessages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }
}
