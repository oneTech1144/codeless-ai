/**
 * Base AI Provider - Abstract class that all providers must implement
 */

import { Message, ChatOptions, ChatResponse, ProviderConfig, ProviderStatus, ProviderType } from './types';

export abstract class BaseProvider {
  protected config: ProviderConfig;
  protected providerType: ProviderType;

  constructor(providerType: ProviderType, config: ProviderConfig) {
    this.providerType = providerType;
    this.config = config;
  }

  /**
   * Get the provider type
   */
  getType(): ProviderType {
    return this.providerType;
  }

  /**
   * Update provider configuration
   */
  updateConfig(config: Partial<ProviderConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if the provider is properly configured
   */
  abstract isConfigured(): boolean;

  /**
   * Get provider status (configured, healthy, errors)
   */
  abstract getStatus(): Promise<ProviderStatus>;

  /**
   * Send a chat message and get a response (non-streaming)
   */
  abstract chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;

  /**
   * Send a chat message and stream the response
   */
  abstract streamChat(messages: Message[], options?: ChatOptions): AsyncGenerator<string>;

  /**
   * Validate API key by making a test request
   */
  async validateApiKey(): Promise<boolean> {
    try {
      const status = await this.getStatus();
      return status.configured && status.healthy;
    } catch {
      return false;
    }
  }

  /**
   * Get the current model ID
   */
  getModel(): string {
    return this.config.model;
  }

  /**
   * Set the model ID
   */
  setModel(model: string): void {
    this.config.model = model;
  }
}
