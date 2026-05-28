/**
 * DELETE /api/campaign-items/[id]
 *
 * Deletes a single campaign_items row by id.
 * Does NOT touch the parent campaign_batches row.
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
    return NextResponse.json({ error: "Item id is required." }, { status: 400 });
  }

  const supabase = getClient();
  const { error } = await supabase
    .from("campaign_items")
    .delete()
    .eq("id", id);

  if (error) {
    const msg = error.message || error.code || JSON.stringify(error);
    console.error(`[campaign-items/delete] id=${id}:`, error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  console.log(`[campaign-items/delete] Deleted item ${id}`);
  return NextResponse.json({ success: true });
}
