-- ראש בראש — סכמת Supabase
-- מריצים פעם אחת ב-SQL Editor של הפרויקט (או דרך מיגרציה).
-- שלוש טבלאות: התוכניות, הגדרות (העונות), ורשימת המנהלים לפי דוא"ל.
-- קריאה: כולם רואים תוכניות מוצגות (visible). כתיבה: רק מי שהדוא"ל שלו ב-rosh_admins.

create table if not exists public.rosh_episodes (
  id text primary key,
  data jsonb not null,               -- התוכנית כולה, באותו מבנה כמו data/episodes.json
  visible boolean not null default true,
  date date,
  number integer,
  updated_at timestamptz not null default now()
);
create index if not exists rosh_episodes_date_idx on public.rosh_episodes (date desc nulls last, number desc nulls last);

create table if not exists public.rosh_settings (
  key text primary key,              -- כרגע: 'seasons'
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.rosh_admins (
  email text primary key,
  created_at timestamptz not null default now()
);

create or replace function public.rosh_is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rosh_admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.rosh_is_admin() from public;
grant execute on function public.rosh_is_admin() to anon, authenticated;

alter table public.rosh_episodes enable row level security;
alter table public.rosh_settings enable row level security;
alter table public.rosh_admins enable row level security;

drop policy if exists "rosh_episodes: public read visible" on public.rosh_episodes;
create policy "rosh_episodes: public read visible" on public.rosh_episodes
  for select to anon, authenticated using (visible or public.rosh_is_admin());
drop policy if exists "rosh_episodes: admin write" on public.rosh_episodes;
create policy "rosh_episodes: admin write" on public.rosh_episodes
  for all to authenticated using (public.rosh_is_admin()) with check (public.rosh_is_admin());

drop policy if exists "rosh_settings: public read" on public.rosh_settings;
create policy "rosh_settings: public read" on public.rosh_settings
  for select to anon, authenticated using (true);
drop policy if exists "rosh_settings: admin write" on public.rosh_settings;
create policy "rosh_settings: admin write" on public.rosh_settings
  for all to authenticated using (public.rosh_is_admin()) with check (public.rosh_is_admin());

drop policy if exists "rosh_admins: self read" on public.rosh_admins;
create policy "rosh_admins: self read" on public.rosh_admins
  for select to authenticated using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- הוסיפו כאן את הדוא"ל של כל מי שמנהל את האתר:
-- insert into public.rosh_admins (email) values ('you@example.com') on conflict do nothing;
