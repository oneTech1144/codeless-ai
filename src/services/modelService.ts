import * as vscode from 'vscode';
import { supabaseService } from './supabase';

const SUPABASE_URL = 'https://sizwtijdyjnamnppcwyy.supabase.co';

export interface AIModel {
  id: string;
  provider: string;
  name: string;
  display_name: string;
  description: string;
  context_window: number;
  min_plan: string;
  supports_vision: boolean;
  supports_function_calling: boolean;
  available: boolean;
  locked: boolean;
  required_plan: string;
}

export interface Plan {
  id: string;
  name: string;
  description: string;
  price_monthly: number;
  tokens_per_month: number;
  features: string[];
}

export interface UsageInfo {
  plan: string;
  tokens_used: number;
  tokens_limit: number;
  tokens_remaining: number;
  usage_percentage?: number;
  requests_today?: number;
  requests_this_month?: number;
}

export interface ModelsResponse {
  models: AIModel[];
  plans: Plan[];
  user_plan: string;
  usage: UsageInfo | null;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
  _usage?: UsageInfo;
  error?: string;
}

export class ModelService {
  private static instance: ModelService;
  private models: AIModel[] = [];
  private plans: Plan[] = [];
  private currentModel: string = 'gpt-4o-mini';
  private _onModelsChanged = new vscode.EventEmitter<AIModel[]>();
  private _onUsageChanged = new vscode.EventEmitter<UsageInfo>();
  public readonly onModelsChanged = this._onModelsChanged.event;
  public readonly onUsageChanged = this._onUsageChanged.event;

  private constructor() {}

  public static getInstance(): ModelService {
    if (!ModelService.instance) {
      ModelService.instance = new ModelService();
    }
    return ModelService.instance;
  }

  public async fetchModels(): Promise<ModelsResponse | null> {
    try {
      const session = await supabaseService.getSession();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const response = await fetch(`${SUPABASE_URL}/functions/v1/get-models`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to fetch models:', errorText);
        return null;
      }

      const data = await response.json() as ModelsResponse;
      this.models = data.models;
      this.plans = data.plans;
      this._onModelsChanged.fire(this.models);
      
      if (data.usage) {
        this._onUsageChanged.fire(data.usage);
      }

      return data;
    } catch (error) {
      console.error('Error fetching models:', error);
      return null;
    }
  }

  public async chat(messages: ChatMessage[], options?: {
    model?: string;
    max_tokens?: number;
    temperature?: number;
    stream?: boolean;
  }): Promise<ChatResponse> {
    try {
      const session = await supabaseService.getSession();
      if (!session?.access_token) {
        return { choices: [], error: 'Not authenticated. Please sign in.' };
      }

      const model = options?.model || this.currentModel;

      const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: options?.max_tokens || 4096,
          temperature: options?.temperature || 0.7,
          stream: options?.stream || false,
        }),
      });

      const data = await response.json() as ChatResponse & { error?: string };

      if (!response.ok) {
        if (response.status === 429) {
          return {
            choices: [],
            error: data.error || 'Rate limit exceeded or token limit reached.',
            _usage: data._usage,
          };
        }
        return { choices: [], error: data.error || 'API request failed' };
      }

      if (data._usage) {
        this._onUsageChanged.fire(data._usage);
      }

      return data;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get response';
      console.error('Chat error:', error);
      return { choices: [], error: errorMessage };
    }
  }

  public getModels(): AIModel[] { return this.models; }
  public getAvailableModels(): AIModel[] { return this.models.filter(m => m.available); }
  public getPlans(): Plan[] { return this.plans; }
  public setCurrentModel(modelId: string): void { this.currentModel = modelId; }
  public getCurrentModel(): string { return this.currentModel; }
  public getModelById(modelId: string): AIModel | undefined { return this.models.find(m => m.id === modelId); }

  // Fallback to direct API calls if proxy is not available
  public async chatDirect(messages: ChatMessage[], provider: string, apiKey: string, model: string): Promise<ChatResponse> {
    try {
      if (provider === 'openai') return await this.callOpenAI(apiKey, model, messages);
      if (provider === 'anthropic') return await this.callAnthropic(apiKey, model, messages);
      if (provider === 'google') return await this.callGoogle(apiKey, model, messages);
      throw new Error('Unsupported provider');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { choices: [], error: errorMessage };
    }
  }

  private async callOpenAI(apiKey: string, model: string, messages: ChatMessage[]): Promise<ChatResponse> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, max_tokens: 4096 }),
    });
    return await response.json() as ChatResponse;
  }

  private async callAnthropic(apiKey: string, model: string, messages: ChatMessage[]): Promise<ChatResponse> {
    const systemMessage = messages.find(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 4096, system: systemMessage?.content || '',
        messages: otherMessages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      }),
    });

    const data = await response.json() as { content?: Array<{text: string}>; usage?: {input_tokens: number; output_tokens: number} };
    return {
      choices: [{ message: { role: 'assistant', content: data.content?.[0]?.text || '' } }],
      usage: { prompt_tokens: data.usage?.input_tokens || 0, completion_tokens: data.usage?.output_tokens || 0 },
    };
  }

  private async callGoogle(apiKey: string, model: string, messages: ChatMessage[]): Promise<ChatResponse> {
    const contents = messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents }),
    });

    const data = await response.json() as { candidates?: Array<{content?: {parts?: Array<{text: string}>}}>};
    return { choices: [{ message: { role: 'assistant', content: data.candidates?.[0]?.content?.parts?.[0]?.text || '' } }] };
  }
}

export const modelService = ModelService.getInstance();
