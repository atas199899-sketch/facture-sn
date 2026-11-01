-- Facture SN : schéma de la base (étape 1 : profil, clients, tarifs ; étape 2 : devis et factures)
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

-- ===========================================================================
-- Étape 2 : devis et factures
-- Montants en entiers : francs CFA, ou centimes pour les documents en euros.
-- ===========================================================================
create table if not exists public.documents (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id       uuid not null references public.clients (id) on delete restrict,
  type            text not null check (type in ('DEV', 'FAC')),
  number          text,                                   -- attribué à la validation
  status          text not null default 'draft' check (status in ('draft', 'sent', 'cancelled')),
  currency        text not null default 'XOF' check (currency in ('XOF', 'EUR')),
  issue_date      date not null default current_date,
  due_date        date,                                   -- échéance, ou fin de validité d'un devis
  discount_pct    numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  deposit_pct     smallint not null default 0 check (deposit_pct between 0 and 100),
  tva             boolean not null default false,
  notes           text not null default '',
  -- Totaux recalculés par la base à partir des lignes
  subtotal        bigint not null default 0,
  discount_amount bigint not null default 0,
  total_ht        bigint not null default 0,
  tva_amount      bigint not null default 0,
  total_ttc       bigint not null default 0,
  deposit_amount  bigint not null default 0,
  snapshot        jsonb,                                  -- coordonnées figées à la validation
  sent_at         timestamptz,
  converted_to    uuid references public.documents (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, number)
);
create index if not exists documents_user_id_idx on public.documents (user_id);
create index if not exists documents_client_id_idx on public.documents (client_id);

create table if not exists public.document_lines (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents (id) on delete cascade,
  position     smallint not null default 0,
  description  text not null check (length(trim(description)) > 0),
  qty          numeric(12,2) not null default 1 check (qty > 0),
  unit_price   bigint not null default 0 check (unit_price >= 0),
  amount       bigint generated always as (round(qty * unit_price)::bigint) stored
);
create index if not exists document_lines_document_id_idx on public.document_lines (document_id);

-- Compteurs de numérotation : uniquement manipulés par finalize_document()
create table if not exists public.number_counters (
  user_id     uuid not null references auth.users (id) on delete cascade,
  type        text not null,
  year        int  not null,
  last_value  int  not null default 0,
  primary key (user_id, type, year)
);

-- Un document validé (numéroté) ne change plus : seul son état peut évoluer
create or replace function public.document_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status <> 'draft' and
     (new.client_id, new.type, new.currency, new.issue_date, new.due_date, new.discount_pct,
      new.deposit_pct, new.tva, new.notes, new.number, new.snapshot)
     is distinct from
     (old.client_id, old.type, old.currency, old.issue_date, old.due_date, old.discount_pct,
      old.deposit_pct, old.tva, old.notes, old.number, old.snapshot) then
    raise exception 'Ce document est validé : il ne peut plus être modifié. Dupliquez-le pour en faire un nouveau.';
  end if;
  new.updated_at = now();
  return new;
end $$;

create or replace function public.document_totals()
returns trigger language plpgsql set search_path = '' as $$
begin
  select coalesce(sum(amount), 0) into new.subtotal from public.document_lines where document_id = new.id;
  new.discount_amount = round(new.subtotal * new.discount_pct / 100);
  new.total_ht        = new.subtotal - new.discount_amount;
  new.tva_amount      = case when new.tva then round(new.total_ht * 0.18) else 0 end;
  new.total_ttc       = new.total_ht + new.tva_amount;
  new.deposit_amount  = round(new.total_ttc * new.deposit_pct / 100.0);
  return new;
end $$;

-- Toute modification des lignes relance le calcul des totaux du document
create or replace function public.document_lines_changed()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.documents set updated_at = now() where id = coalesce(new.document_id, old.document_id);
  return null;
end $$;

drop trigger if exists documents_10_guard on public.documents;
create trigger documents_10_guard before update on public.documents for each row execute function public.document_guard();
drop trigger if exists documents_20_totals on public.documents;
create trigger documents_20_totals before insert or update on public.documents for each row execute function public.document_totals();
drop trigger if exists document_lines_changed on public.document_lines;
create trigger document_lines_changed after insert or update or delete on public.document_lines
  for each row execute function public.document_lines_changed();

alter table public.documents       enable row level security;
alter table public.document_lines  enable row level security;
alter table public.number_counters enable row level security;

drop policy if exists "Documents : lecture des siens" on public.documents;
create policy "Documents : lecture des siens" on public.documents
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "Documents : création" on public.documents;
create policy "Documents : création" on public.documents
  for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.clients c where c.id = client_id and c.user_id = auth.uid()));
drop policy if exists "Documents : modification" on public.documents;
create policy "Documents : modification" on public.documents
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.clients c where c.id = client_id and c.user_id = auth.uid()));
drop policy if exists "Documents : suppression des brouillons" on public.documents;
create policy "Documents : suppression des brouillons" on public.documents
  for delete to authenticated using (user_id = auth.uid() and status = 'draft');

drop policy if exists "Lignes : lecture" on public.document_lines;
create policy "Lignes : lecture" on public.document_lines
  for select to authenticated using (exists (select 1 from public.documents d where d.id = document_id and d.user_id = auth.uid()));
drop policy if exists "Lignes : brouillons seulement" on public.document_lines;
create policy "Lignes : brouillons seulement" on public.document_lines
  for all to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id and d.user_id = auth.uid() and d.status = 'draft'))
  with check (exists (select 1 from public.documents d where d.id = document_id and d.user_id = auth.uid() and d.status = 'draft'));

-- Numéro, état, totaux et coordonnées figées : jamais écrits directement par l'utilisateur
revoke all on public.documents, public.document_lines, public.number_counters from anon;
revoke all on public.number_counters from authenticated;
revoke insert, update on public.documents from authenticated;
grant select, delete on public.documents to authenticated;
grant insert (client_id, type, currency, issue_date, due_date, discount_pct, deposit_pct, tva, notes)
  on public.documents to authenticated;
grant update (client_id, type, currency, issue_date, due_date, discount_pct, deposit_pct, tva, notes, updated_at)
  on public.documents to authenticated;
grant select, insert, update, delete on public.document_lines to authenticated;

-- Enregistre un brouillon et ses lignes en une seule fois
create or replace function public.save_document(p_doc jsonb, p_lines jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare
  v_id uuid := nullif(p_doc->>'id', '')::uuid;
begin
  if v_id is null then
    insert into public.documents (client_id, type, currency, issue_date, due_date, discount_pct, deposit_pct, tva, notes)
    values ((p_doc->>'client_id')::uuid, p_doc->>'type', p_doc->>'currency', (p_doc->>'issue_date')::date,
            nullif(p_doc->>'due_date', '')::date, coalesce((p_doc->>'discount_pct')::numeric, 0),
            coalesce((p_doc->>'deposit_pct')::smallint, 0), coalesce((p_doc->>'tva')::boolean, false), coalesce(p_doc->>'notes', ''))
    returning id into v_id;
  else
    if exists (select 1 from public.documents where id = v_id and status <> 'draft') then
      raise exception 'Ce document est validé : il ne peut plus être modifié. Dupliquez-le pour en faire un nouveau.';
    end if;
    update public.documents set
      client_id = (p_doc->>'client_id')::uuid, type = p_doc->>'type', currency = p_doc->>'currency',
      issue_date = (p_doc->>'issue_date')::date, due_date = nullif(p_doc->>'due_date', '')::date,
      discount_pct = coalesce((p_doc->>'discount_pct')::numeric, 0), deposit_pct = coalesce((p_doc->>'deposit_pct')::smallint, 0),
      tva = coalesce((p_doc->>'tva')::boolean, false), notes = coalesce(p_doc->>'notes', '')
    where id = v_id;
    if not found then raise exception 'Document introuvable.'; end if;
    delete from public.document_lines where document_id = v_id;
  end if;
  insert into public.document_lines (document_id, position, description, qty, unit_price)
  select v_id, (t.ord - 1)::smallint, t.l->>'description', (t.l->>'qty')::numeric, (t.l->>'unit_price')::bigint
  from jsonb_array_elements(p_lines) with ordinality as t(l, ord);
  return v_id;
end $$;

-- Valide un brouillon : numéro définitif sans doublon ni trou, coordonnées figées
create or replace function public.finalize_document(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
  v_year int;
  v_n int;
begin
  select * into d from public.documents where id = p_id and user_id = auth.uid() for update;
  if not found then raise exception 'Document introuvable.'; end if;
  if d.status <> 'draft' then raise exception 'Ce document est déjà validé.'; end if;
  if d.total_ttc <= 0 then raise exception 'Ajoutez au moins une ligne avec un prix.'; end if;
  v_year = extract(year from d.issue_date);
  insert into public.number_counters (user_id, type, year, last_value) values (d.user_id, d.type, v_year, 1)
  on conflict (user_id, type, year) do update set last_value = public.number_counters.last_value + 1
  returning last_value into v_n;
  update public.documents set
    number   = d.type || '-' || v_year || '-' || lpad(v_n::text, 4, '0'),
    status   = 'sent',
    sent_at  = now(),
    snapshot = jsonb_build_object(
      'company', (select to_jsonb(p) from (select name, job, phone_pay, email, address, ninea, mentions from public.profiles where id = d.user_id) p),
      'client',  (select to_jsonb(c) from (select name, contact, phone, email, address, ninea from public.clients where id = d.client_id) c))
  where id = p_id;
  return p_id;
end $$;

-- Annule un document validé (il reste dans l'historique avec son numéro)
create or replace function public.cancel_document(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  update public.documents set status = 'cancelled' where id = p_id and user_id = auth.uid() and status = 'sent';
  if not found then raise exception 'Seul un document validé peut être annulé.'; end if;
  return p_id;
end $$;

-- Devis accepté : crée la facture en brouillon avec les mêmes lignes
create or replace function public.convert_quote(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  q public.documents;
  v_id uuid;
begin
  select * into q from public.documents where id = p_id and user_id = auth.uid() and type = 'DEV' for update;
  if not found then raise exception 'Devis introuvable.'; end if;
  if q.status <> 'sent' then raise exception 'Validez d’abord le devis.'; end if;
  if q.converted_to is not null then return q.converted_to; end if;
  insert into public.documents (user_id, client_id, type, currency, issue_date, due_date, discount_pct, deposit_pct, tva, notes)
  values (q.user_id, q.client_id, 'FAC', q.currency, current_date, current_date + 15, q.discount_pct, q.deposit_pct, q.tva, q.notes)
  returning id into v_id;
  insert into public.document_lines (document_id, position, description, qty, unit_price)
  select v_id, position, description, qty, unit_price from public.document_lines where document_id = p_id;
  update public.documents set converted_to = v_id where id = p_id;
  return v_id;
end $$;

revoke execute on function public.save_document(jsonb, jsonb), public.finalize_document(uuid),
  public.cancel_document(uuid), public.convert_quote(uuid) from public, anon;
grant execute on function public.save_document(jsonb, jsonb), public.finalize_document(uuid),
  public.cancel_document(uuid), public.convert_quote(uuid) to authenticated;
