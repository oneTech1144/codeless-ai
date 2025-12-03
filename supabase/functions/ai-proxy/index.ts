import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ChatRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Get auth token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Initialize Supabase client with service role for admin access
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Initialize Supabase client with user's token
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      }
    );

    // Get user from token
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request body
    const body: ChatRequest = await req.json();
    const { model, messages, stream = false, max_tokens = 4096, temperature = 0.7 } = body;

    if (!model || !messages) {
      return new Response(JSON.stringify({ error: "Missing model or messages" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check user limits using database function
    const { data: limitCheck, error: limitError } = await supabaseAdmin.rpc("check_user_limits", {
      p_user_id: user.id,
      p_model_id: model,
    });

    if (limitError) {
      console.error("Limit check error:", limitError);
      return new Response(JSON.stringify({ error: "Failed to check limits" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const limit = limitCheck?.[0];
    if (!limit?.allowed) {
      return new Response(JSON.stringify({ 
        error: limit?.reason || "Request not allowed",
        tokens_remaining: limit?.tokens_remaining || 0,
        plan: limit?.user_plan || "free"
      }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get model info
    const { data: modelInfo, error: modelError } = await supabaseAdmin
      .from("models")
      .select("*")
      .eq("id", model)
      .single();

    if (modelError || !modelInfo) {
      return new Response(JSON.stringify({ error: "Model not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get API key for the provider
    const { data: apiKeyData, error: apiKeyError } = await supabaseAdmin
      .from("api_keys")
      .select("api_key, api_endpoint")
      .eq("provider", modelInfo.provider)
      .eq("is_active", true)
      .single();

    if (apiKeyError || !apiKeyData) {
      return new Response(JSON.stringify({ error: "API key not configured for this provider" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Call the appropriate AI provider
    let aiResponse;
    let tokensInput = 0;
    let tokensOutput = 0;

    if (modelInfo.provider === "openai") {
      aiResponse = await callOpenAI(apiKeyData.api_key, model, messages, max_tokens, temperature, stream);
    } else if (modelInfo.provider === "anthropic") {
      aiResponse = await callAnthropic(apiKeyData.api_key, model, messages, max_tokens, temperature, stream);
    } else if (modelInfo.provider === "google") {
      aiResponse = await callGoogle(apiKeyData.api_key, model, messages, max_tokens, temperature, stream);
    } else {
      return new Response(JSON.stringify({ error: "Unsupported provider" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract token usage from response
    if (aiResponse.usage) {
      tokensInput = aiResponse.usage.prompt_tokens || aiResponse.usage.input_tokens || 0;
      tokensOutput = aiResponse.usage.completion_tokens || aiResponse.usage.output_tokens || 0;
    }

    // Log usage
    await supabaseAdmin.rpc("log_usage", {
      p_user_id: user.id,
      p_model: model,
      p_provider: modelInfo.provider,
      p_tokens_input: tokensInput,
      p_tokens_output: tokensOutput,
      p_request_type: "chat",
    });

    // Return response with usage info
    return new Response(JSON.stringify({
      ...aiResponse,
      _usage: {
        tokens_used: tokensInput + tokensOutput,
        tokens_remaining: (limit?.tokens_remaining || 0) - (tokensInput + tokensOutput),
        plan: limit?.user_plan || "free",
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// OpenAI API call
async function callOpenAI(apiKey: string, model: string, messages: any[], maxTokens: number, temperature: number, stream: boolean) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  return response.json();
}

// Anthropic API call
async function callAnthropic(apiKey: string, model: string, messages: any[], maxTokens: number, temperature: number, stream: boolean) {
  // Convert messages format for Anthropic
  const systemMessage = messages.find(m => m.role === "system");
  const otherMessages = messages.filter(m => m.role !== "system");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemMessage?.content || "",
      messages: otherMessages.map(m => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error: ${error}`);
  }

  const data = await response.json();
  
  // Convert to OpenAI-like format
  return {
    choices: [{
      message: {
        role: "assistant",
        content: data.content?.[0]?.text || "",
      },
    }],
    usage: {
      prompt_tokens: data.usage?.input_tokens || 0,
      completion_tokens: data.usage?.output_tokens || 0,
    },
  };
}

// Google Gemini API call
async function callGoogle(apiKey: string, model: string, messages: any[], maxTokens: number, temperature: number, stream: boolean) {
  // Convert messages format for Gemini
  const contents = messages.filter(m => m.role !== "system").map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const systemInstruction = messages.find(m => m.role === "system");

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents,
      systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction.content }] } : undefined,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google API error: ${error}`);
  }

  const data = await response.json();
  
  // Convert to OpenAI-like format
  return {
    choices: [{
      message: {
        role: "assistant",
        content: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
      },
    }],
    usage: {
      prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
      completion_tokens: data.usageMetadata?.candidatesTokenCount || 0,
    },
  };
}
