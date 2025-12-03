"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const server_ts_1 = require("https://deno.land/std@0.168.0/http/server.ts");
const supabase_js_2_1 = require("https://esm.sh/@supabase/supabase-js@2");
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
(0, server_ts_1.serve)(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    try {
        const authHeader = req.headers.get("Authorization");
        const supabaseAdmin = (0, supabase_js_2_1.createClient)(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
        const supabaseClient = (0, supabase_js_2_1.createClient)(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
            global: { headers: { Authorization: authHeader || "" } },
            auth: { persistSession: false },
        });
        // Get user's plan (if logged in)
        let userPlan = "free";
        let usage = null;
        if (authHeader) {
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (user) {
                const { data: profile } = await supabaseAdmin
                    .from("profiles")
                    .select("plan, tokens_used, tokens_limit")
                    .eq("id", user.id)
                    .single();
                if (profile) {
                    userPlan = profile.plan || "free";
                    usage = {
                        tokens_used: profile.tokens_used || 0,
                        tokens_limit: profile.tokens_limit || 50000,
                        tokens_remaining: (profile.tokens_limit || 50000) - (profile.tokens_used || 0),
                    };
                }
                // Get detailed usage
                const { data: usageData } = await supabaseAdmin.rpc("get_user_usage", { p_user_id: user.id });
                if (usageData?.[0]) {
                    usage = { ...usage, ...usageData[0] };
                }
            }
        }
        // Get all active models
        const { data: models, error: modelsError } = await supabaseAdmin
            .from("models")
            .select("id, provider, name, display_name, description, context_window, min_plan, supports_vision, supports_function_calling")
            .eq("is_active", true)
            .order("sort_order");
        if (modelsError) {
            throw modelsError;
        }
        // Get all plans
        const { data: plans, error: plansError } = await supabaseAdmin
            .from("plans")
            .select("id, name, description, price_monthly, tokens_per_month, features")
            .eq("is_active", true)
            .order("sort_order");
        if (plansError) {
            throw plansError;
        }
        // Mark models as available/locked based on user's plan
        const planOrder = { free: 0, pro: 1, enterprise: 2 };
        const userPlanLevel = planOrder[userPlan] || 0;
        const modelsWithAccess = models.map(model => ({
            ...model,
            available: planOrder[model.min_plan] <= userPlanLevel,
            locked: planOrder[model.min_plan] > userPlanLevel,
            required_plan: model.min_plan,
        }));
        return new Response(JSON.stringify({
            models: modelsWithAccess,
            plans,
            user_plan: userPlan,
            usage,
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
    catch (error) {
        console.error("Error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
//# sourceMappingURL=index.js.map