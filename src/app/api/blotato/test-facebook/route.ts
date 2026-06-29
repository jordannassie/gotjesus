/**
 * POST /api/blotato/test-facebook
 *
 * Admin/debug endpoint — sends a real Blotato post to the Facebook page.
 *
 * Body: { videoUrl: string, caption?: string }
 *
 * Returns: { success, postSubmissionId } or { success: false, error, blotatoBody }
 *
 * Protected: requires BLOTATO_API_KEY, BLOTATO_FACEBOOK_ACCOUNT_ID,
 *             and BLOTATO_FACEBOOK_PAGE_ID to be set in env.
 */

import { NextRequest, NextResponse } from "next/server";

const BLOTATO_BASE_URL = "https://backend.blotato.com";

export async function POST(req: NextRequest) {
  const apiKey = process.env.BLOTATO_API_KEY;
  const accountId = process.env.BLOTATO_FACEBOOK_ACCOUNT_ID;
  const pageId = process.env.BLOTATO_FACEBOOK_PAGE_ID;

  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: "Missing BLOTATO_API_KEY." },
      { status: 503 }
    );
  }
  if (!accountId) {
    return NextResponse.json(
      { success: false, error: "Missing BLOTATO_FACEBOOK_ACCOUNT_ID." },
      { status: 503 }
    );
  }
  if (!pageId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Missing BLOTATO_FACEBOOK_PAGE_ID. Facebook posting requires a Page ID from Blotato subaccounts.",
      },
      { status: 503 }
    );
  }

  let body: { videoUrl?: string; caption?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { videoUrl, caption = "Testing Got Jesus Facebook posting" } = body;
  if (!videoUrl) {
    return NextResponse.json(
      { success: false, error: "videoUrl is required." },
      { status: 400 }
    );
  }

  const payload = {
    post: {
      accountId,
      content: {
        text: caption,
        mediaUrls: [videoUrl],
        platform: "facebook",
      },
      target: {
        targetType: "facebook",
        pageId,
        mediaType: "reel",
      },
    },
  };

  console.log(
    `[test-facebook] Sending test post to Facebook accountId=${accountId} pageId=${pageId}`
  );

  const res = await fetch(`${BLOTATO_BASE_URL}/v2/posts`, {
    method: "POST",
    headers: {
      "blotato-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responseText = await res.text();
  let responseJson: unknown = null;
  try {
    responseJson = JSON.parse(responseText);
  } catch {
    // not JSON
  }

  if (!res.ok) {
    console.error(`[test-facebook] Blotato error HTTP ${res.status}:`, responseText);
    return NextResponse.json(
      {
        success: false,
        error: `Blotato HTTP ${res.status}`,
        blotatoBody: responseJson ?? responseText,
      },
      { status: 502 }
    );
  }

  const postSubmissionId =
    (responseJson as { postSubmissionId?: string } | null)?.postSubmissionId ??
    "unknown";
  console.log(`[test-facebook] Success — postSubmissionId=${postSubmissionId}`);

  return NextResponse.json({
    success: true,
    postSubmissionId,
    blotatoBody: responseJson,
  });
}
