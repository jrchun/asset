-- =====================================================================
-- Supabase 스키마 (Supabase 모드). 여러 번 실행해도 안전하다.
-- 적용: AI가 Supabase MCP(apply_migration)로 넣거나, 대시보드 › SQL Editor에 붙여 넣고 Run.
--
-- 규칙은 화면이 아니라 여기(RLS·함수)에 둔다. 화면은 공개 키(publishable)로 직접 연결하므로
-- RLS가 없는 표는 누구나 읽고 쓸 수 있다. 표를 만들면 반드시 RLS를 켜고 정책을 단다.
-- =====================================================================

-- 예제: 사람마다 자기 메모만 보고 고칠 수 있다.
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists notes_owner_created on public.notes (owner, created_at desc);

alter table public.notes enable row level security;

drop policy if exists "내 메모 읽기" on public.notes;
create policy "내 메모 읽기" on public.notes for select to authenticated using (owner = (select auth.uid()));
drop policy if exists "내 메모 쓰기" on public.notes;
create policy "내 메모 쓰기" on public.notes for insert to authenticated with check (owner = (select auth.uid()));
drop policy if exists "내 메모 고치기" on public.notes;
create policy "내 메모 고치기" on public.notes for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
drop policy if exists "내 메모 지우기" on public.notes;
create policy "내 메모 지우기" on public.notes for delete to authenticated using (owner = (select auth.uid()));

-- 잠들기 방지: 무료 플랜은 7일간 요청이 없으면 멈춘다. 매일 작업(.github/workflows/supabase-keepalive.yml)이
-- 공개 키로 이 함수를 부른다. 아무 데이터도 읽거나 쓰지 않는다.
create or replace function public.keepalive() returns integer
language sql stable security invoker set search_path = '' as $$ select 1 $$;
revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
