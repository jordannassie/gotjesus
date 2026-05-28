/**
 * DELETE /api/campaign-batches/[id]
 *
 * Deletes a campaign batch by id.
 * campaign_items rows are removed automatically via ON DELETE CASCADE.
 * Does NOT touch gotjesus_reels / Library.
 * Does NOT call Kie or Blotato.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase not configured.");
  return createClient(url, key);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Batch id is required." }, { status: 400 });
  }

  const supabase = getClient();
  const { error } = await supabase
    .from("campaign_batches")
    .delete()
    .eq("id", id);

  if (error) {
    const msg = error.message || error.code || JSON.stringify(error);
    console.error(`[campaign-batches/delete] id=${id}:`, error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  console.log(`[campaign-batches/delete] Deleted batch ${id}`);
  return NextResponse.json({ success: true });
}
