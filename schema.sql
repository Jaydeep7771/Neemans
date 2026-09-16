-- Supabase schema for the Landing Page Pre-Flight Auditor.
-- Run in the Supabase SQL editor.

create table if not exists public.audit_runs (
  id                      uuid primary key default gen_random_uuid(),
  created_at              timestamptz not null default now(),
  user_id                 uuid references auth.users (id) on delete set null,
  target_url              text not null,
  started_at              timestamptz,
  finished_at             timestamptz,
  duration_ms             integer,
  verdict                 text check (verdict in ('READY', 'READY_WITH_FIXES', 'NOT_READY')),
  readiness_score         integer check (readiness_score between 0 and 100),
  high_count              integer default 0,
  medium_count            integer default 0,
  low_count               integer default 0,
  total_tracking_requests integer default 0,
  vendors_detected        text[] default '{}',
  ai_available            boolean default false,
  headline                text,
  report                  jsonb not null
);

create index if not exists audit_runs_started_at_idx on public.audit_runs (started_at desc);
create index if not exists audit_runs_target_url_idx on public.audit_runs (target_url);

alter table public.audit_runs enable row level security;

-- The server writes with the service-role key (bypasses RLS).
-- These policies cover signed-in users reading their own runs from the browser.
create policy "users read own runs"
  on public.audit_runs for select
  to authenticated
  using (user_id = auth.uid());

create policy "users insert own runs"
  on public.audit_runs for insert
  to authenticated
  with check (user_id = auth.uid());
