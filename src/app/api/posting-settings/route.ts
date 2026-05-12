import { NextRequest, NextResponse } from "next/server";
import {
  getPostingSettings,
  updatePostingSettings,
  type PostingSettings,
} from "@/lib/posting-settings";

// GET /api/posting-settings
// Returns the current posting settings (or defaults if none saved yet).
export async function GET() {
  try {
    const settings = await getPostingSettings();
    return NextResponse.json(settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[posting-settings] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/posting-settings
// Accepts a partial PostingSettings body and persists it to Supabase.
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<PostingSettings>;
    const updated = await updatePostingSettings(body);
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[posting-settings] PATCH error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
