-- GotJesus Reel Engine — Supabase Schema
-- Run this SQL once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).

-- ─── Posting settings ─────────────────────────────────────────────────────────
-- One row stores all social posting configuration for this app.
-- The app creates the row automatically on first load if it does not exist.

create table if not exists gotjesus_posting_settings (
  id                  uuid        primary key default gen_random_uuid(),
  created_at          timestamptz not null    default now(),
  updated_at          timestamptz not null    default now(),
  auto_post_enabled   boolean     not null    default false,
  -- Controls whether clicking "Generate Video" immediately posts via Blotato.
  -- Independent of auto_post_enabled (which controls the daily scheduler only).
  manual_post_enabled boolean     not null    default false,
  instagram_enabled   boolean     not null    default true,
  tiktok_enabled      boolean     not null    default true,
  youtube_enabled     boolean     not null    default true,
  posts_per_day       integer     not null    default 3
                                  check (posts_per_day between 1 and 5),
  posting_times       jsonb       not null    default '["09:00","13:00","19:00"]'::jsonb,
  timezone            text        not null    default 'America/Los_Angeles'
);

-- ─── Migration: add manual_post_enabled if table already exists ────────────────
-- If you created the table before this column was added, run this once:
--
-- alter table gotjesus_posting_settings
--   add column if not exists manual_post_enabled boolean not null default false;

-- Enable Row Level Security.
-- The app uses the service role key which bypasses RLS, but enabling it is
-- good practice so anon/authenticated users cannot access this table.
alter table gotjesus_posting_settings enable row level security;

-- No RLS policies needed — access is via service role key only.

-- ─── Generated reels ───────────────────────────────────────────────────────────
-- One row per generated reel. Tracks the full lifecycle from Kie job submission
-- through Supabase Storage upload to Blotato publishing.

create table if not exists gotjesus_reels (
  id                              uuid        primary key default gen_random_uuid(),
  created_at                      timestamptz not null    default now(),

  -- Source and scheduling
  generation_source               text        not null    default 'manual',
  scheduled_for                   timestamptz             ,

  -- Kie.ai job info
  kie_task_id                     text                    ,
  kie_video_url                   text                    ,

  -- Supabase Storage
  saved_video_url                 text                    ,

  -- Prompt and caption
  prompt_used                     text                    ,
  caption_used                    text        not null    default 'Jesus Loves You!' || E'\n' || '#jesus #gotjesus gotjesus.co',

  -- Status
  -- Recommended values: generating | saving | ready | posting | scheduled | posted | failed
  status                          text        not null    default 'generated',

  -- Blotato
  blotato_status                  text                    ,
  instagram_enabled               boolean     not null    default false,
  tiktok_enabled                  boolean     not null    default false,
  youtube_enabled                 boolean     not null    default false,
  instagram_post_submission_id    text                    ,
  tiktok_post_submission_id       text                    ,
  youtube_post_submission_id      text                    ,

  -- Per-platform posting detail
  instagram_post_status           text                    ,
  tiktok_post_status              text                    ,
  youtube_post_status             text                    ,
  instagram_post_url              text                    ,
  tiktok_post_url                 text                    ,
  youtube_post_url                text                    ,
  instagram_error                 text                    ,
  tiktok_error                    text                    ,
  youtube_error                   text                    ,

  -- Error tracking
  error_message                   text
);

-- Enable Row Level Security.
-- Server-side operations use the service role key.
-- The service role key bypasses RLS for writes (INSERT/UPDATE/DELETE),
-- but in some Supabase configurations a SELECT policy is needed for reads.
-- These permissive policies keep all access server-side only.
alter table gotjesus_reels enable row level security;

-- Allow service role to read all rows (used by getReel polling + library)
create policy "service role can read reels"
  on gotjesus_reels for select
  using (true);

-- Allow service role to insert rows
create policy "service role can insert reels"
  on gotjesus_reels for insert
  with check (true);

-- Allow service role to update rows
create policy "service role can update reels"
  on gotjesus_reels for update
  using (true);

-- Allow service role to delete rows
create policy "service role can delete reels"
  on gotjesus_reels for delete
  using (true);

-- Index for efficient library queries (most recent first)
create index if not exists gotjesus_reels_created_at_idx
  on gotjesus_reels (created_at desc);

-- Index for duplicate-detection in the daily scheduler
create index if not exists gotjesus_reels_scheduled_for_idx
  on gotjesus_reels (generation_source, scheduled_for)
  where generation_source = 'scheduled';

-- ─── Brand / workspace settings ────────────────────────────────────────────────
-- Stores per-workspace brand configuration: banner image, future brand assets.
-- Currently a single-row table (workspace_key = 'gotjesus').
-- Designed to evolve into multi-company brand settings when workspace login is
-- added — workspace_key will map to a company/user account.

create table if not exists gotjesus_brand_settings (
  id                uuid        primary key default gen_random_uuid(),
  created_at        timestamptz not null    default now(),
  updated_at        timestamptz not null    default now(),
  workspace_key     text        not null    unique default 'gotjesus',
  banner_image_url  text,
  banner_image_path text
);

alter table gotjesus_brand_settings enable row level security;

-- Permissive service-role policies (access via service role key only,
-- matching the pattern used for gotjesus_reels).
create policy "service role select brand settings"
  on gotjesus_brand_settings for select using (true);

create policy "service role insert brand settings"
  on gotjesus_brand_settings for insert with check (true);

create policy "service role update brand settings"
  on gotjesus_brand_settings for update using (true);

create policy "service role delete brand settings"
  on gotjesus_brand_settings for delete using (true);

-- ─── Daily Content Engine — content slots ──────────────────────────────────────
-- One row per scheduled content slot. Each workspace has up to N slots (default 3).
-- Each slot owns its own prompt, reference images, scheduled time, and generation
-- settings. Designed as the future multi-workspace content scheduling layer.
--
-- Currently used for workspace_key = 'gotjesus' with 3 slots:
--   slot_1 = Morning Reel  (07:00 PT)
--   slot_2 = Midday Reel   (11:00 PT)
--   slot_3 = Evening Reel  (18:30 PT)

create table if not exists gotjesus_content_slots (
  id                  uuid        primary key default gen_random_uuid(),
  created_at          timestamptz not null    default now(),
  updated_at          timestamptz not null    default now(),
  workspace_key       text        not null    default 'gotjesus',
  slot_key            text        not null,
  slot_name           text        not null,
  prompt_text         text        not null    default '',
  reference_images    jsonb       not null    default '[]'::jsonb,
  enabled             boolean     not null    default true,
  scheduled_post_time text        not null    default '07:00',
  model               text        not null    default 'Seedance 2.0 Fast',
  duration_seconds    integer     not null    default 8,
  aspect_ratio        text        not null    default '9:16',
  resolution          text        not null    default '480p',
  sort_order          integer     not null    default 1,
  unique (workspace_key, slot_key)
);

alter table gotjesus_content_slots enable row level security;

create policy "service role select content slots"
  on gotjesus_content_slots for select using (true);

create policy "service role insert content slots"
  on gotjesus_content_slots for insert with check (true);

create policy "service role update content slots"
  on gotjesus_content_slots for update using (true);

create policy "service role delete content slots"
  on gotjesus_content_slots for delete using (true);

-- ─── Migration: add posting_source to gotjesus_reels ─────────────────────────
-- Tracks whether a posted video was published via Post Now (manual) or the
-- scheduled auto-post engine. Null means not yet posted.
-- Run once:
--
-- alter table gotjesus_reels
--   add column if not exists posting_source text;
--
-- Valid values: 'manual' | 'auto' | null

-- ─── Migration: add post_caption to content slots and reels ───────────────────
-- Run these once if the tables already exist:
--
-- alter table gotjesus_content_slots
--   add column if not exists post_caption text not null default '';
--
-- alter table gotjesus_reels
--   add column if not exists post_caption text;
--   (NOTE: gotjesus_reels already has caption_used which stores the snapshot.
--    The post_caption column on reels is optional — caption_used is the snapshot.)

-- ─── Migration: add editable end card columns to gotjesus_brand_settings ──────
-- Run these once if the table already exists:
--
-- alter table gotjesus_brand_settings
--   add column if not exists end_card_image_url  text,
--   add column if not exists end_card_image_path text;

-- ─── Migration: add Library + slot-linking columns to gotjesus_reels ──────────
-- Run these once if the table already exists:
--
-- alter table gotjesus_reels
--   add column if not exists is_favorite      boolean      not null default false,
--   add column if not exists content_slot_key  text,
--   add column if not exists content_slot_name text,
--   add column if not exists deleted_at        timestamptz;
--
-- create index if not exists gotjesus_reels_deleted_at_idx
--   on gotjesus_reels (deleted_at) where deleted_at is null;

-- ─── Native social connections — future OAuth per brand ─────────────────────
-- Stores one row per platform per workspace for native social connections.
-- Currently unused by the app; populated when a brand connects a platform
-- natively (OAuth). Until then all posting flows through Blotato.
--
-- provider values: 'blotato' (legacy/current) | 'native' (future OAuth)
-- status values:   'not_connected' | 'connecting' | 'connected' | 'revoked' | 'error'
-- platform values: 'instagram' | 'facebook' | 'tiktok' | 'youtube'

create table if not exists social_connections (
  id                        uuid        primary key default gen_random_uuid(),
  created_at                timestamptz not null    default now(),
  updated_at                timestamptz not null    default now(),
  user_key                  text        not null    default 'demo_jordan',
  workspace_key             text        not null    default 'gotjesus',
  platform                  text        not null,
  provider                  text        not null    default 'blotato',
  account_name              text,
  account_id                text,
  status                    text        not null    default 'not_connected',
  access_token_encrypted    text,
  refresh_token_encrypted   text,
  token_expires_at          timestamptz,
  scopes                    jsonb       not null    default '[]'::jsonb,
  metadata                  jsonb       not null    default '{}'::jsonb,
  unique (workspace_key, platform, provider)
);

alter table social_connections enable row level security;

create policy "service role select social connections"
  on social_connections for select using (true);

create policy "service role insert social connections"
  on social_connections for insert with check (true);

create policy "service role update social connections"
  on social_connections for update using (true);

create policy "service role delete social connections"
  on social_connections for delete using (true);

create index if not exists social_connections_workspace_key_idx
  on social_connections (workspace_key);

create index if not exists social_connections_platform_idx
  on social_connections (platform);

create index if not exists social_connections_provider_idx
  on social_connections (provider);

-- ─── Batch campaign plans ────────────────────────────────────────────────────
-- campaign_batches: one row per OpenAI-generated batch campaign plan.
-- campaign_items:   one row per video concept within a batch (8 per batch MVP).
-- status values for batches: 'planned' | 'generating' | 'done' | 'failed'
-- status values for items:   'planned' | 'generating' | 'ready' | 'failed'

create table if not exists campaign_batches (
  id                  uuid        primary key default gen_random_uuid(),
  created_at          timestamptz not null    default now(),
  updated_at          timestamptz not null    default now(),
  user_key            text        not null    default 'demo_jordan',
  workspace_key       text        not null    default 'gotjesus',
  brand_name          text,
  batch_title         text,
  batch_type          text,
  instruction         text,
  reference_image_url text,
  status              text        not null    default 'planned'
);

create table if not exists campaign_items (
  id                uuid        primary key default gen_random_uuid(),
  created_at        timestamptz not null    default now(),
  updated_at        timestamptz not null    default now(),
  user_key          text        not null    default 'demo_jordan',
  workspace_key     text        not null    default 'gotjesus',
  batch_id          uuid        references campaign_batches(id) on delete cascade,
  title             text,
  ad_type           text,
  hook              text,
  prompt_text       text,
  caption           text,
  reason            text,
  platform          text,
  duration_seconds  integer     not null    default 8,
  aspect_ratio      text        not null    default '9:16',
  resolution        text        not null    default '480p',
  model             text        not null    default 'Seedance 2.0 Fast',
  status            text        not null    default 'planned',
  kie_task_id       text,
  video_url         text,
  thumbnail_url     text,
  error_message     text
);

alter table campaign_batches enable row level security;
alter table campaign_items   enable row level security;

create policy "service role select campaign batches"
  on campaign_batches for select using (true);
create policy "service role insert campaign batches"
  on campaign_batches for insert with check (true);
create policy "service role update campaign batches"
  on campaign_batches for update using (true);
create policy "service role delete campaign batches"
  on campaign_batches for delete using (true);

create policy "service role select campaign items"
  on campaign_items for select using (true);
create policy "service role insert campaign items"
  on campaign_items for insert with check (true);
create policy "service role update campaign items"
  on campaign_items for update using (true);
create policy "service role delete campaign items"
  on campaign_items for delete using (true);

create index if not exists campaign_batches_workspace_key_idx
  on campaign_batches (workspace_key);
create index if not exists campaign_items_workspace_key_idx
  on campaign_items (workspace_key);
create index if not exists campaign_items_batch_id_idx
  on campaign_items (batch_id);
create index if not exists campaign_items_status_idx
  on campaign_items (status);
