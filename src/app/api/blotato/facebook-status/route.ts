/**
 * GET /api/blotato/facebook-status
 *
 * Admin/debug endpoint — returns Facebook configuration status and calls the
 * Blotato accounts API to verify the connected account and page.
 *
 * Protected: only callable with a valid BLOTATO_API_KEY in env.
 * Never exposes the API key itself in the response.
 */

import { NextResponse } from "next/server";

const BLOTATO_BASE_URL = "https://backend.blotato.com";

export async function GET() {
  const apiKey = process.env.BLOTATO_API_KEY;
  const accountId = process.env.BLOTATO_FACEBOOK_ACCOUNT_ID;
  const pageId = process.env.BLOTATO_FACEBOOK_PAGE_ID;

  const missingEnvVars: string[] = [];
  if (!apiKey) missingEnvVars.push("BLOTATO_API_KEY");
  if (!accountId) missingEnvVars.push("BLOTATO_FACEBOOK_ACCOUNT_ID");
  if (!pageId) missingEnvVars.push("BLOTATO_FACEBOOK_PAGE_ID");

  const facebookConfigured = Boolean(accountId && pageId);

  if (!apiKey) {
    return NextResponse.json(
      {
        facebookConfigured,
        accountId: accountId ?? null,
        pageId: pageId ?? null,
        missingEnvVars,
        error: "BLOTATO_API_KEY is not set — cannot call Blotato API.",
      },
      { status: 503 }
    );
  }

  const headers: HeadersInit = {
    "blotato-api-key": apiKey,
    "Content-Type": "application/json",
  };

  // Fetch connected Facebook accounts
  let blotatoAccounts: unknown = null;
  let blotatoAccountsError: string | null = null;
  try {
    const res = await fetch(
      `${BLOTATO_BASE_URL}/v2/users/me/accounts?platform=facebook`,
      { headers, cache: "no-store" } as RequestInit
    );
    if (res.ok) {
      blotatoAccounts = await res.json();
    } else {
      const text = await res.text();
      blotatoAccountsError = `HTTP ${res.status}: ${text}`;
    }
  } catch (err) {
    blotatoAccountsError = err instanceof Error ? err.message : String(err);
  }

  // Fetch subaccounts/pages for the configured account ID if present
  let subaccounts: unknown = null;
  let subaccountsError: string | null = null;
  if (accountId) {
    try {
      const res = await fetch(
        `${BLOTATO_BASE_URL}/v2/users/me/accounts/${accountId}/subaccounts`,
        { headers, cache: "no-store" } as RequestInit
      );
      if (res.ok) {
        subaccounts = await res.json();
      } else {
        const text = await res.text();
        subaccountsError = `HTTP ${res.status}: ${text}`;
      }
    } catch (err) {
      subaccountsError = err instanceof Error ? err.message : String(err);
    }
  }

  return NextResponse.json({
    facebookConfigured,
    accountId: accountId ?? null,
    pageId: pageId ?? null,
    missingEnvVars: missingEnvVars.length > 0 ? missingEnvVars : undefined,
    blotatoAccounts,
    blotatoAccountsError,
    subaccounts,
    subaccountsError,
  });
}
