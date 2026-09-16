-- Dayframe cross-device data model for Supabase/PostgreSQL.
-- Run this in a new Supabase project's SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'Europe/Prague',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  day_start time not null default '09:00',
  day_end time not null default '00:30',
  authority_level smallint not null default 2 check (authority_level between 0 and 3),
  notifications_enabled boolean not null default true,
  guard_enabled boolean not null default true,
  blocked_terms jsonb not null default '["youtube","instagram","tiktok","netflix","steam","reddit"]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  target_date date,
  status text not null default 'active' check (status in ('active','completed','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid references public.goals(id) on delete set null,
  title text not null,
  category text not null default 'Vlastní',
  scheduled_date date not null,
  start_time time,
  duration_minutes integer not null default 30 check (duration_minutes between 1 and 1440),
  deadline timestamptz,
  priority smallint not null default 2 check (priority between 1 and 4),
  energy_level text not null default 'medium' check (energy_level in ('low','medium','high')),
  required_apps jsonb not null default '[]'::jsonb,
  blocked_apps jsonb not null default '[]'::jsonb,
  status text not null default 'planned' check (status in ('inbox','planned','active','completed','skipped')),
  sort_order integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid references public.goals(id) on delete cascade,
  title text not null,
  target_date date not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  device_id uuid,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  planned_minutes integer not null default 50,
  focused_seconds integer not null default 0,
  interruption_count integer not null default 0,
  completed boolean not null default false
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  platform text not null check (platform in ('windows','ios','android','web')),
  push_token text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.focus_sessions
  add constraint focus_sessions_device_id_fkey
  foreign key (device_id) references public.devices(id) on delete set null;

create index if not exists idx_tasks_user_date_order on public.tasks(user_id, scheduled_date, sort_order);
create index if not exists idx_tasks_user_status on public.tasks(user_id, status);
create index if not exists idx_milestones_user_date on public.milestones(user_id, target_date);
create index if not exists idx_focus_sessions_user_started on public.focus_sessions(user_id, started_at desc);
create index if not exists idx_devices_user on public.devices(user_id);

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.goals enable row level security;
alter table public.tasks enable row level security;
alter table public.milestones enable row level security;
alter table public.focus_sessions enable row level security;
alter table public.devices enable row level security;

create policy "profiles are owned by user" on public.profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "settings are owned by user" on public.user_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "goals are owned by user" on public.goals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tasks are owned by user" on public.tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "milestones are owned by user" on public.milestones for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "focus sessions are owned by user" on public.focus_sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "devices are owned by user" on public.devices for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

