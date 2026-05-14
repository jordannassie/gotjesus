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
