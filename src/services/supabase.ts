import { createClient, SupabaseClient, User as SupabaseUser, Session } from '@supabase/supabase-js';
import * as vscode from 'vscode';

// Supabase configuration for CodelessAI project
const SUPABASE_URL = 'https://sizwtijdyjnamnppcwyy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpend0aWpkeWpuYW1ucHBjd3l5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3MTAwNTIsImV4cCI6MjA4MDI4NjA1Mn0.q64OGNZ6pwpRurZST9Vu0RlKhqGSKhLmoc1Hdto5XGI';

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  plan: 'free' | 'pro' | 'enterprise';
  tokens_used: number;
  tokens_limit: number;
  stripe_customer_id: string | null;
  created_at: string;
}

export class SupabaseService {
  private static instance: SupabaseService;
  private client: SupabaseClient;
  private context?: vscode.ExtensionContext;
  private _onAuthStateChanged = new vscode.EventEmitter<{ user: SupabaseUser | null; session: Session | null }>();
  public readonly onAuthStateChanged = this._onAuthStateChanged.event;

  private constructor() {
    this.client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: false, // We'll handle persistence ourselves in VS Code
        detectSessionInUrl: false,
      },
    });
  }

  public static getInstance(): SupabaseService {
    if (!SupabaseService.instance) {
      SupabaseService.instance = new SupabaseService();
    }
    return SupabaseService.instance;
  }

  public setContext(context: vscode.ExtensionContext) {
    this.context = context;
    this.restoreSession();
  }

  private async restoreSession() {
    if (!this.context) return;
    
    const storedSession = this.context.globalState.get<Session>('codelessai.session');
    if (storedSession) {
      const { data, error } = await this.client.auth.setSession({
        access_token: storedSession.access_token,
        refresh_token: storedSession.refresh_token,
      });
      
      if (data.session) {
        this._onAuthStateChanged.fire({ user: data.user, session: data.session });
      } else if (error) {
        // Session expired, clear it
        await this.context.globalState.update('codelessai.session', undefined);
      }
    }
  }

  private async saveSession(session: Session | null) {
    if (!this.context) return;
    if (session) {
      await this.context.globalState.update('codelessai.session', session);
    } else {
      await this.context.globalState.update('codelessai.session', undefined);
    }
  }

  public getClient(): SupabaseClient {
    return this.client;
  }

  // Sign up with email and password
  public async signUp(email: string, password: string, name?: string): Promise<{ user: SupabaseUser | null; error: Error | null }> {
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: {
        data: { name: name || email.split('@')[0] },
      },
    });

    if (data.session) {
      await this.saveSession(data.session);
      this._onAuthStateChanged.fire({ user: data.user, session: data.session });
    }

    return { user: data.user, error: error as Error | null };
  }

  // Sign in with email and password
  public async signIn(email: string, password: string): Promise<{ user: SupabaseUser | null; error: Error | null }> {
    const { data, error } = await this.client.auth.signInWithPassword({
      email,
      password,
    });

    if (data.session) {
      await this.saveSession(data.session);
      this._onAuthStateChanged.fire({ user: data.user, session: data.session });
    }

    return { user: data.user, error: error as Error | null };
  }

  // Sign in with OAuth provider (opens browser)
  public async signInWithOAuth(provider: 'github' | 'google'): Promise<string> {
    const { data, error } = await this.client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: 'vscode://codelessai.codeless-ai/auth',
        skipBrowserRedirect: true,
      },
    });

    if (error) throw error;
    return data.url || '';
  }

  // Handle OAuth callback with access token
  public async handleOAuthCallback(accessToken: string, refreshToken?: string): Promise<{ user: SupabaseUser | null; error: Error | null }> {
    if (refreshToken) {
      const { data, error } = await this.client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      
      if (data.session) {
        await this.saveSession(data.session);
        this._onAuthStateChanged.fire({ user: data.user, session: data.session });
      }
      
      return { user: data.user, error: error as Error | null };
    }
    
    // For simple token auth (from our web pages)
    const { data, error } = await this.client.auth.getUser(accessToken);
    return { user: data.user, error: error as Error | null };
  }

  // Sign out
  public async signOut(): Promise<void> {
    await this.client.auth.signOut();
    await this.saveSession(null);
    this._onAuthStateChanged.fire({ user: null, session: null });
  }

  // Get current user
  public async getCurrentUser(): Promise<SupabaseUser | null> {
    const { data } = await this.client.auth.getUser();
    return data.user;
  }

  // Get current session
  public async getSession(): Promise<Session | null> {
    const { data } = await this.client.auth.getSession();
    return data.session;
  }

  // Get user profile from database
  public async getProfile(): Promise<UserProfile | null> {
    const user = await this.getCurrentUser();
    if (!user) return null;

    const { data, error } = await this.client
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('Error fetching profile:', error);
      return null;
    }

    return data as UserProfile;
  }

  // Update user profile
  public async updateProfile(updates: Partial<UserProfile>): Promise<{ error: Error | null }> {
    const user = await this.getCurrentUser();
    if (!user) return { error: new Error('Not authenticated') };

    const { error } = await this.client
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    return { error: error as Error | null };
  }

  // Log token usage
  public async logUsage(tokensInput: number, tokensOutput: number, model: string, provider: string): Promise<boolean> {
    const user = await this.getCurrentUser();
    if (!user) return false;

    const { data, error } = await this.client.rpc('log_usage', {
      p_user_id: user.id,
      p_tokens_input: tokensInput,
      p_tokens_output: tokensOutput,
      p_model: model,
      p_provider: provider,
    });

    if (error) {
      console.error('Error logging usage:', error);
      return false;
    }

    return data as boolean;
  }

  // Check if user has enough tokens
  public async hasTokens(estimatedTokens: number): Promise<boolean> {
    const profile = await this.getProfile();
    if (!profile) return false;
    return profile.tokens_used + estimatedTokens <= profile.tokens_limit;
  }

  // Save conversation
  public async saveConversation(title: string, messages: any[], model: string, provider: string): Promise<string | null> {
    const user = await this.getCurrentUser();
    if (!user) return null;

    const { data, error } = await this.client
      .from('conversations')
      .insert({
        user_id: user.id,
        title,
        messages,
        model,
        provider,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error saving conversation:', error);
      return null;
    }

    return data.id;
  }

  // Get conversations
  public async getConversations(): Promise<any[]> {
    const user = await this.getCurrentUser();
    if (!user) return [];

    const { data, error } = await this.client
      .from('conversations')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error fetching conversations:', error);
      return [];
    }

    return data || [];
  }

  // Delete conversation
  public async deleteConversation(id: string): Promise<boolean> {
    const user = await this.getCurrentUser();
    if (!user) return false;

    const { error } = await this.client
      .from('conversations')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    return !error;
  }
}

export const supabaseService = SupabaseService.getInstance();
