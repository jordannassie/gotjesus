-- GotJesus Reel Engine — Supabase Schema
-- Run this SQL once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).

-- ─── Posting settings ─────────────────────────────────────────────────────────
-- One row stores all social posting configuration for this app.
-- The app creates the row automatically on first load if it does not exist.

create table if not exists gotjesus_posting_settings (
  id                uuid        primary key default gen_random_uuid(),
  created_at        timestamptz not null    default now(),
  updated_at        timestamptz not null    default now(),
  auto_post_enabled boolean     not null    default false,
  instagram_enabled boolean     not null    default true,
  tiktok_enabled    boolean     not null    default true,
  youtube_enabled   boolean     not null    default true,
  posts_per_day     integer     not null    default 3
                                check (posts_per_day between 1 and 5),
  posting_times     jsonb       not null    default '["09:00","13:00","19:00"]'::jsonb,
  timezone          text        not null    default 'America/Los_Angeles'
);

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

  -- Error tracking
  error_message                   text
);

-- Enable Row Level Security.
-- Server-side operations use the service role key which bypasses RLS.
alter table gotjesus_reels enable row level security;

-- Index for efficient library queries (most recent first)
create index if not exists gotjesus_reels_created_at_idx
  on gotjesus_reels (created_at desc);

-- Index for duplicate-detection in the daily scheduler
create index if not exists gotjesus_reels_scheduled_for_idx
  on gotjesus_reels (generation_source, scheduled_for)
  where generation_source = 'scheduled';
