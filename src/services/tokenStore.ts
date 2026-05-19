import { supabase } from "../lib/supabase";
import { EbayEnvironment } from "../config/ebay";

export type StoredEbayToken = {
  id: string;
  environment: EbayEnvironment;
  account_label: string | null;
  ebay_user_id: string | null;
  ebay_username: string | null;
  access_token: string;
  refresh_token: string | null;
  token_type: string | null;
  scope: string | null;
  access_expires_at: string;
  refresh_expires_at: string | null;
  is_active: boolean;
  last_refresh_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export async function saveToken(params: {
  environment: EbayEnvironment;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  accessExpiresIn: number;
  refreshExpiresIn?: number;
  accountLabel?: string;
}) {
  const access_expires_at = new Date(Date.now() + params.accessExpiresIn * 1000).toISOString();
  const refresh_expires_at = params.refreshExpiresIn
    ? new Date(Date.now() + params.refreshExpiresIn * 1000).toISOString()
    : null;

  const { error } = await supabase.from("ebay_oauth_tokens").insert({
    environment: params.environment,
    account_label: params.accountLabel ?? null,
    access_token: params.accessToken,
    refresh_token: params.refreshToken ?? null,
    token_type: params.tokenType ?? "User Access Token",
    scope: params.scope ?? null,
    access_expires_at,
    refresh_expires_at,
    is_active: true,
  });

  if (error) throw error;
}

export async function getLatestActiveToken(environment: EbayEnvironment): Promise<StoredEbayToken | null> {
  const { data, error } = await supabase
    .from("ebay_oauth_tokens")
    .select("*")
    .eq("environment", environment)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as StoredEbayToken | null;
}

export async function updateTokenById(
  id: string,
  params: {
    accessToken: string;
    refreshToken?: string;
    scope?: string;
    accessExpiresIn: number;
    refreshExpiresIn?: number;
  }
) {
  const access_expires_at = new Date(Date.now() + params.accessExpiresIn * 1000).toISOString();
  const refresh_expires_at = params.refreshExpiresIn
    ? new Date(Date.now() + params.refreshExpiresIn * 1000).toISOString()
    : null;

  const payload: Record<string, unknown> = {
    access_token: params.accessToken,
    access_expires_at,
    last_refresh_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  };

  if (params.refreshToken) payload.refresh_token = params.refreshToken;
  if (params.scope) payload.scope = params.scope;
  if (refresh_expires_at) payload.refresh_expires_at = refresh_expires_at;

  const { error } = await supabase
    .from("ebay_oauth_tokens")
    .update(payload)
    .eq("id", id);

  if (error) throw error;
}

export async function setTokenError(id: string, message: string) {
  const { error } = await supabase
    .from("ebay_oauth_tokens")
    .update({
      last_error: message,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw error;
}
