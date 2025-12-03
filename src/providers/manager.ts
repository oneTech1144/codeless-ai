/**
 * Provider Manager - Handles switching between AI providers
 */

import * as vscode from 'vscode';
import { BaseProvider } from './base';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';
import { GeminiProvider } from './gemini';
import { OllamaProvider } from './ollama';
import { ProviderType, Message, ChatOptions, ChatResponse, ProviderConfig, DEFAULT_MODELS } from './types';

export class ProviderManager {
  private providers: Map<ProviderType, BaseProvider> = new Map();
  private activeProvider: ProviderType = 'anthropic';

  constructor() {
    this.initializeFromConfig();
  }

  /**
   * Initialize all providers from VS Code configuration
   */
  initializeFromConfig(): void {
    const config = vscode.workspace.getConfiguration('codelessai');
    
    // Get active provider
    this.activeProvider = config.get<ProviderType>('provider') || 'anthropic';
    
    // Initialize Anthropic
    this.providers.set('anthropic', new AnthropicProvider({
      apiKey: config.get<string>('anthropicApiKey') || '',
      model: config.get<string>('model') || DEFAULT_MODELS.anthropic,
      maxTokens: config.get<number>('maxTokens') || 4096,
      temperature: config.get<number>('temperature') || 0.7,
    }));

    // Initialize OpenAI
    this.providers.set('openai', new OpenAIProvider({
      apiKey: config.get<string>('openaiApiKey') || '',
      model: config.get<string>('openaiModel') || DEFAULT_MODELS.openai,
      maxTokens: config.get<number>('maxTokens') || 4096,
      temperature: config.get<number>('temperature') || 0.7,
    }));

    // Initialize Gemini
    this.providers.set('gemini', new GeminiProvider({
      apiKey: config.get<string>('geminiApiKey') || '',
      model: config.get<string>('geminiModel') || DEFAULT_MODELS.gemini,
      maxTokens: config.get<number>('maxTokens') || 4096,
      temperature: config.get<number>('temperature') || 0.7,
    }));

    // Initialize Ollama
    this.providers.set('ollama', new OllamaProvider({
      apiKey: '', // Ollama doesn't need API key
      model: config.get<string>('ollamaModel') || DEFAULT_MODELS.ollama,
      maxTokens: config.get<number>('maxTokens') || 4096,
      temperature: config.get<number>('temperature') || 0.7,
      baseUrl: config.get<string>('ollamaBaseUrl') || 'http://localhost:11434',
    }));

    // OpenRouter uses OpenAI-compatible API
    this.providers.set('openrouter', new OpenAIProvider({
      apiKey: config.get<string>('openrouterApiKey') || '',
      model: DEFAULT_MODELS.openrouter,
      maxTokens: config.get<number>('maxTokens') || 4096,
      temperature: config.get<number>('temperature') || 0.7,
      baseUrl: 'https://openrouter.ai/api/v1',
    }));
  }

  /**
   * Update configuration (called when settings change)
   */
  updateConfig(): void {
    this.initializeFromConfig();
  }

  /**
   * Get the active provider instance
   */
  getActiveProvider(): BaseProvider {
    const provider = this.providers.get(this.activeProvider);
    if (!provider) {
      throw new Error(`Provider ${this.activeProvider} not found`);
    }
    return provider;
  }

  /**
   * Get the active provider type
   */
  getActiveProviderType(): ProviderType {
    return this.activeProvider;
  }

  /**
   * Get current model name
   */
  getCurrentModel(): string {
    return this.getActiveProvider().getModel();
  }

  /**
   * Set the active provider
   */
  setActiveProvider(provider: ProviderType): void {
    if (!this.providers.has(provider)) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    this.activeProvider = provider;
    
    // Save to configuration
    vscode.workspace.getConfiguration('codelessai').update('provider', provider, true);
  }

  /**
   * Check if current provider is configured
   */
  isConfigured(): boolean {
    return this.getActiveProvider().isConfigured();
  }

  /**
   * Send a chat message using the active provider
   */
  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    return this.getActiveProvider().chat(messages, options);
  }

  /**
   * Stream a chat response using the active provider
   */
  async *streamChat(messages: Message[], options?: ChatOptions): AsyncGenerator<string> {
    yield* this.getActiveProvider().streamChat(messages, options);
  }

  /**
   * Get all available providers
   */
  getAvailableProviders(): ProviderType[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get provider status
   */
  async getProviderStatus(provider: ProviderType): Promise<{ configured: boolean; healthy: boolean; error?: string }> {
    const p = this.providers.get(provider);
    if (!p) return { configured: false, healthy: false, error: 'Provider not found' };
    return p.getStatus();
  }
}

// Singleton instance
let providerManagerInstance: ProviderManager | null = null;

export function getProviderManager(): ProviderManager {
  if (!providerManagerInstance) {
    providerManagerInstance = new ProviderManager();
  }
  return providerManagerInstance;
}
