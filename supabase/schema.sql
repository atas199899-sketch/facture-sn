-- Facture SN : schéma de l'étape 1 (profil, clients, tarifs)
-- À coller dans Supabase > SQL Editor > New query, puis « Run ».
-- Le script peut être relancé sans risque : il ne recrée que ce qui manque.

create extension if not exists pgcrypto;

-- Met à jour automatiquement la colonne updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Profil du freelance (une ligne par compte)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text   not null default '',
  job         text   not null default '',
  phone_pay   text   not null default '',
  email       text   not null default '',
  address     text   not null default '',
  ninea       text   not null default '',
  tva_on      boolean not null default false,
  goal_xof    bigint not null default 0 check (goal_xof >= 0),
  mentions    text   not null default '',
  plan        text   not null default 'free' check (plan in ('free', 'pro')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Clients du freelance
-- ---------------------------------------------------------------------------
create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  contact     text not null default '',
  phone       text not null default '',
  email       text not null default '',
  address     text not null default '',
  ninea       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists clients_user_id_idx on public.clients (user_id);

-- ---------------------------------------------------------------------------
-- Tarifs (prestations habituelles)
-- ---------------------------------------------------------------------------
create table if not exists public.catalog_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  unit        text not null default '',
  price_xof   bigint not null default 0 check (price_xof >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists catalog_items_user_id_idx on public.catalog_items (user_id);

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists clients_touch on public.clients;
create trigger clients_touch before update on public.clients for each row execute function public.touch_updated_at();
drop trigger if exists catalog_items_touch on public.catalog_items;
create trigger catalog_items_touch before update on public.catalog_items for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Sécurité : chaque freelance ne voit et ne modifie que ses propres données
-- ---------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.clients       enable row level security;
alter table public.catalog_items enable row level security;

drop policy if exists "Profil : lecture du sien" on public.profiles;
create policy "Profil : lecture du sien" on public.profiles
  for select to authenticated using (id = auth.uid());
drop policy if exists "Profil : création du sien" on public.profiles;
create policy "Profil : création du sien" on public.profiles
  for insert to authenticated with check (id = auth.uid());
drop policy if exists "Profil : modification du sien" on public.profiles;
create policy "Profil : modification du sien" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "Clients : les siens" on public.clients;
create policy "Clients : les siens" on public.clients
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Tarifs : les siens" on public.catalog_items;
create policy "Tarifs : les siens" on public.catalog_items
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- L'offre (free / pro) ne peut pas être changée par l'utilisateur lui-même
revoke insert, update on public.profiles from anon, authenticated;
grant insert (id, email) on public.profiles to authenticated;
grant update (name, job, phone_pay, email, address, ninea, tva_on, goal_xof, mentions)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Création automatique du profil à l'inscription
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
