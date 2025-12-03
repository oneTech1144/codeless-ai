/**
 * Provider types and interfaces for CodelessAI
 */

// Supported AI providers
export type ProviderType = 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'openrouter';

// Message format (standard across all providers)
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Provider configuration
export interface ProviderConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature?: number;
  baseUrl?: string; // For custom endpoints (Ollama, OpenRouter)
}

// Model information
export interface ModelInfo {
  id: string;
  name: string;
  provider: ProviderType;
  contextWindow: number;
  supportsStreaming: boolean;
  supportsVision?: boolean;
  costPer1kInput?: number;
  costPer1kOutput?: number;
}

// Chat completion options
export interface ChatOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

// Chat response
export interface ChatResponse {
  content: string;
  model: string;
  provider: ProviderType;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  finishReason?: 'stop' | 'length' | 'error';
}

// Streaming event
export interface StreamEvent {
  type: 'text' | 'done' | 'error';
  content?: string;
  error?: string;
}

// Provider status
export interface ProviderStatus {
  configured: boolean;
  healthy: boolean;
  error?: string;
}

// Available models by provider
export const AVAILABLE_MODELS: Record<ProviderType, ModelInfo[]> = {
  anthropic: [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', contextWindow: 200000, supportsStreaming: true, supportsVision: true },
    { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', provider: 'anthropic', contextWindow: 200000, supportsStreaming: true, supportsVision: true },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', contextWindow: 200000, supportsStreaming: true, supportsVision: true },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', contextWindow: 128000, supportsStreaming: true, supportsVision: true },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', contextWindow: 128000, supportsStreaming: true, supportsVision: true },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai', contextWindow: 128000, supportsStreaming: true, supportsVision: true },
  ],
  gemini: [
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'gemini', contextWindow: 1000000, supportsStreaming: true, supportsVision: true },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', provider: 'gemini', contextWindow: 1000000, supportsStreaming: true, supportsVision: true },
  ],
  ollama: [
    { id: 'llama3.2', name: 'Llama 3.2', provider: 'ollama', contextWindow: 128000, supportsStreaming: true },
    { id: 'codellama', name: 'Code Llama', provider: 'ollama', contextWindow: 16000, supportsStreaming: true },
    { id: 'deepseek-coder', name: 'DeepSeek Coder', provider: 'ollama', contextWindow: 16000, supportsStreaming: true },
  ],
  openrouter: [
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet (OR)', provider: 'openrouter', contextWindow: 200000, supportsStreaming: true },
    { id: 'openai/gpt-4o', name: 'GPT-4o (OR)', provider: 'openrouter', contextWindow: 128000, supportsStreaming: true },
  ],
};

// Default models per provider
export const DEFAULT_MODELS: Record<ProviderType, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  gemini: 'gemini-1.5-pro',
  ollama: 'llama3.2',
  openrouter: 'anthropic/claude-3.5-sonnet',
};
