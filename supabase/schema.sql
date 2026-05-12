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
