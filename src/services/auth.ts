import * as vscode from 'vscode';
import { SupabaseService, UserProfile } from './supabase';

export type AuthState = 'logged_out' | 'authenticating' | 'logged_in';

export interface User {
  id: string;
  email: string;
  name: string;
  plan: 'free' | 'pro' | 'enterprise';
  tokensUsed: number;
  tokensLimit: number;
  avatarUrl?: string;
  createdAt: number;
}

export class AuthService {
  private static instance: AuthService;
  private supabase: SupabaseService;
  private context?: vscode.ExtensionContext;
  private _authState: AuthState = 'logged_out';
  private _user: User | null = null;
  
  private readonly _onAuthStateChanged = new vscode.EventEmitter<AuthState>();
  public readonly onAuthStateChanged = this._onAuthStateChanged.event;

  private constructor() {
    this.supabase = SupabaseService.getInstance();
    
    // Listen to Supabase auth changes
    this.supabase.onAuthStateChanged(async ({ user, session }) => {
      if (user && session) {
        await this.loadUserProfile();
        this._authState = 'logged_in';
      } else {
        this._user = null;
        this._authState = 'logged_out';
      }
      this._onAuthStateChanged.fire(this._authState);
    });
  }

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  public setContext(context: vscode.ExtensionContext) {
    this.context = context;
    this.supabase.setContext(context);
    this.checkAuthStatus();
  }

  private async checkAuthStatus() {
    const session = await this.supabase.getSession();
    if (session) {
      await this.loadUserProfile();
      this._authState = 'logged_in';
      this._onAuthStateChanged.fire(this._authState);
    }
  }

  private async loadUserProfile() {
    const profile = await this.supabase.getProfile();
    if (profile) {
      this._user = this.mapProfileToUser(profile);
    }
  }

  private mapProfileToUser(profile: UserProfile): User {
    return {
      id: profile.id,
      email: profile.email,
      name: profile.name || profile.email.split('@')[0],
      plan: profile.plan,
      tokensUsed: profile.tokens_used,
      tokensLimit: profile.tokens_limit,
      avatarUrl: profile.avatar_url || undefined,
      createdAt: new Date(profile.created_at).getTime(),
    };
  }

  public get authState(): AuthState {
    return this._authState;
  }

  public get user(): User | null {
    return this._user;
  }

  public get isLoggedIn(): boolean {
    return this._authState === 'logged_in';
  }

  // Start OAuth flow - opens browser
  public async startAuth(provider?: 'github' | 'google') {
    this._authState = 'authenticating';
    this._onAuthStateChanged.fire(this._authState);

    try {
      if (provider) {
        // OAuth provider
        const url = await this.supabase.signInWithOAuth(provider);
        if (url) {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        }
      } else {
        // Open web login page
        // For now, we'll use a hosted auth page or local dev server
        const authUrl = 'https://codelessai-auth.vercel.app/login'; // Replace with your hosted URL
        await vscode.env.openExternal(vscode.Uri.parse(authUrl));
      }
    } catch (error) {
      console.error('Auth error:', error);
      this._authState = 'logged_out';
      this._onAuthStateChanged.fire(this._authState);
      vscode.window.showErrorMessage('Failed to start authentication');
    }
  }

  // Sign up with email/password
  public async signUp(email: string, password: string, name?: string): Promise<{ success: boolean; error?: string }> {
    this._authState = 'authenticating';
    this._onAuthStateChanged.fire(this._authState);

    const { user, error } = await this.supabase.signUp(email, password, name);
    
    if (error) {
      this._authState = 'logged_out';
      this._onAuthStateChanged.fire(this._authState);
      return { success: false, error: error.message };
    }

    if (user) {
      await this.loadUserProfile();
      this._authState = 'logged_in';
      this._onAuthStateChanged.fire(this._authState);
      return { success: true };
    }

    return { success: false, error: 'Unknown error' };
  }

  // Sign in with email/password
  public async signIn(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    this._authState = 'authenticating';
    this._onAuthStateChanged.fire(this._authState);

    const { user, error } = await this.supabase.signIn(email, password);
    
    if (error) {
      this._authState = 'logged_out';
      this._onAuthStateChanged.fire(this._authState);
      return { success: false, error: error.message };
    }

    if (user) {
      await this.loadUserProfile();
      this._authState = 'logged_in';
      this._onAuthStateChanged.fire(this._authState);
      return { success: true };
    }

    return { success: false, error: 'Unknown error' };
  }

  // Handle callback from OAuth or web auth
  public async handleAuthCallback(accessToken: string, refreshToken?: string) {
    try {
      const { user, error } = await this.supabase.handleOAuthCallback(accessToken, refreshToken);
      
      if (error) {
        throw error;
      }

      if (user) {
        await this.loadUserProfile();
        this._authState = 'logged_in';
        this._onAuthStateChanged.fire(this._authState);
        vscode.window.showInformationMessage('Successfully signed in to CodelessAI!');
      }
    } catch (error) {
      console.error('Auth callback error:', error);
      this._authState = 'logged_out';
      this._onAuthStateChanged.fire(this._authState);
      vscode.window.showErrorMessage('Authentication failed. Please try again.');
    }
  }

  public cancelAuth() {
    this._authState = 'logged_out';
    this._onAuthStateChanged.fire(this._authState);
  }

  public async signOut() {
    await this.supabase.signOut();
    this._user = null;
    this._authState = 'logged_out';
    this._onAuthStateChanged.fire(this._authState);
    vscode.window.showInformationMessage('Signed out of CodelessAI');
  }

  // Check if user has enough tokens for a request
  public async hasTokens(estimatedTokens: number): Promise<boolean> {
    return this.supabase.hasTokens(estimatedTokens);
  }

  // Log usage after a request
  public async logUsage(tokensInput: number, tokensOutput: number, model: string, provider: string): Promise<boolean> {
    const success = await this.supabase.logUsage(tokensInput, tokensOutput, model, provider);
    if (success) {
      // Refresh user profile to get updated token count
      await this.loadUserProfile();
    }
    return success;
  }

  // Refresh user profile
  public async refreshProfile(): Promise<User | null> {
    await this.loadUserProfile();
    return this._user;
  }

  // Mock login for testing (keep for development)
  public mockLogin() {
    this._user = {
      id: 'mock-user-id',
      email: 'test@codelessai.dev',
      name: 'Test User',
      plan: 'free',
      tokensUsed: 1234,
      tokensLimit: 10000,
      createdAt: Date.now(),
    };
    this._authState = 'logged_in';
    this._onAuthStateChanged.fire(this._authState);
  }
}
