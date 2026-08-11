-- ─────────────────────────────────────────────
-- 공고비서 데이터베이스 스키마
-- Supabase 대시보드 → SQL Editor 에 전체 붙여넣고 Run 하세요. (설치가이드 2단계)
-- ─────────────────────────────────────────────

-- 1) 사업 프로필 (회원 1명당 1개)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company text default '',
  industry text default '',
  founded text default '',
  region text default '',
  staff text default '',
  revenue text default '',
  descr text default '',
  keywords jsonb default '[]'::jsonb,
  doc_summary text default '',
  updated_at timestamptz default now()
);

-- 2) 스크랩 + 지원 진행 상태
create table if not exists public.scraps (
  user_id uuid references auth.users(id) on delete cascade,
  ann_key text,
  title text default '',
  deadline text default '',
  url text default '',
  status text default '검토 중',
  created_at timestamptz default now(),
  primary key (user_id, ann_key)
);

-- 3) 보안 규칙(RLS): 본인 데이터만 읽고 쓸 수 있게
alter table public.profiles enable row level security;
alter table public.scraps enable row level security;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

create policy "scraps_select_own" on public.scraps for select using (auth.uid() = user_id);
create policy "scraps_insert_own" on public.scraps for insert with check (auth.uid() = user_id);
create policy "scraps_update_own" on public.scraps for update using (auth.uid() = user_id);
create policy "scraps_delete_own" on public.scraps for delete using (auth.uid() = user_id);
