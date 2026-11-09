-- Gildenkarte: einmal im Supabase SQL Editor ausführen.
-- Danach zusätzlich supabase/set-token.local.sql ausführen (enthält dein geheimes Token).

create table if not exists public.guild_members (
  name            text primary key,
  class           text,
  level           int,
  xp              int,
  xp_max          int,
  rested          int,
  zone            text,
  online          boolean not null default false,
  has_addon       boolean not null default false,
  pos             jsonb,           -- {"c":"K"|"E","x":0..1,"y":0..1} oder null
  pos_updated_at  timestamptz,
  last_seen       timestamptz not null default now()
);

-- Lesen darf jeder mit dem öffentlichen Schlüssel, schreiben niemand direkt.
alter table public.guild_members enable row level security;
drop policy if exists "guild_members lesen" on public.guild_members;
create policy "guild_members lesen" on public.guild_members for select to anon, authenticated using (true);

-- Live-Updates an die Browser
do $$ begin
  alter publication supabase_realtime add table public.guild_members;
exception when duplicate_object then null; end $$;

-- Geheimes Token liegt in einem Schema, das die API nicht ausliefert.
create schema if not exists private;
create table if not exists private.settings (key text primary key, value text not null);
revoke all on schema private from anon, authenticated;

-- Schreiben nur über diese Funktion mit gültigem Token (vom Companion aufgerufen).
create or replace function public.ingest_members(token text, members jsonb)
returns int
language plpgsql
security definer
set search_path = public, private
as $$
declare
  m jsonb;
  p jsonb;
  n int := 0;
begin
  if token is null or token is distinct from (select value from private.settings where key = 'ingest_token') then
    raise exception 'invalid token' using errcode = '28000';
  end if;
  if jsonb_typeof(members) <> 'array' or jsonb_array_length(members) > 500 then
    raise exception 'members must be an array (max 500)';
  end if;

  for m in select * from jsonb_array_elements(members) loop
    continue when coalesce(trim(m->>'name'), '') = '';

    p := case
      when m->'pos'->>'c' in ('K', 'E') then jsonb_build_object(
        'c', m->'pos'->>'c',
        'x', least(1, greatest(0, (m->'pos'->>'x')::float)),
        'y', least(1, greatest(0, (m->'pos'->>'y')::float)))
      else null end;

    insert into public.guild_members as g
      (name, class, level, xp, xp_max, rested, zone, online, has_addon, pos, pos_updated_at, last_seen)
    values (
      left(trim(m->>'name'), 48),
      upper(left(m->>'class', 16)),
      -- fehlende Felder bleiben NULL (greatest() würde NULL ignorieren und z. B. 1 liefern)
      case when m->>'level'  is not null then least(60, greatest(1, (m->>'level')::int)) end,
      case when m->>'xp'     is not null then greatest(0, (m->>'xp')::int) end,
      case when m->>'xpMax'  is not null then greatest(0, (m->>'xpMax')::int) end,
      case when m->>'rested' is not null then greatest(0, (m->>'rested')::int) end,
      left(m->>'zone', 64),
      coalesce((m->>'online')::boolean, false),
      coalesce((m->>'hasAddon')::boolean, false),
      p,
      case when p is not null then now() - make_interval(secs => least(3600, greatest(0, coalesce((m->>'posAge')::int, 0)))) end,
      now())
    on conflict (name) do update set
      class          = coalesce(excluded.class, g.class),
      level          = coalesce(excluded.level, g.level),
      xp             = coalesce(excluded.xp, g.xp),
      xp_max         = coalesce(excluded.xp_max, g.xp_max),
      rested         = coalesce(excluded.rested, g.rested),
      zone           = coalesce(excluded.zone, g.zone),
      online         = case when m ? 'online'   then excluded.online    else g.online    end,
      has_addon      = case when m ? 'hasAddon' then excluded.has_addon else g.has_addon end,
      pos            = case when m ? 'pos'      then excluded.pos       else g.pos       end,
      pos_updated_at = coalesce(excluded.pos_updated_at, g.pos_updated_at),
      last_seen      = now();
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.ingest_members(text, jsonb) from public;
grant execute on function public.ingest_members(text, jsonb) to anon, authenticated;
