-- ============================================================================
-- Ascora Studio — Invoice Management System
-- Applied to Supabase project phuzogcgrozzsiqdlroe via three migrations:
--   invoices_schema · invoices_functions_rls · invoices_seed_storage
-- This file is the consolidated record. All invoice tables are ADMIN-ONLY,
-- mirroring the existing is_admin() RLS pattern used by leads.
-- ============================================================================

-- ---------- enum ----------
create type invoice_status as enum (
  'draft','sent','deposit_paid','partially_paid','paid','overdue','cancelled','refunded'
);

-- ---------- business settings (enforced singleton) ----------
create table public.business_settings (
  id            boolean primary key default true,
  logo_url      text,
  brand_name    text not null default 'Ascora Studio',
  legal_name    text not null default 'Yasser Derhem',
  website       text,
  email         text,
  phone         text,
  address       text,
  vat_id        text,
  iban          text,
  bank_name     text,
  bic           text,
  bank_address  text,
  paypal        text,
  invoice_prefix      text not null default 'ASC',
  currency            text not null default 'EUR',
  tax_rate            numeric(6,3) not null default 0,
  payment_terms_days  int  not null default 14,
  intro_text   text,
  terms_text   text,
  footer_text  text,
  updated_at   timestamptz not null default now(),
  constraint business_settings_singleton check (id = true)
);

-- ---------- atomic numbering counter ----------
create table public.invoice_counters (
  prefix   text not null,
  year     int  not null,
  last_seq int  not null default 0,
  primary key (prefix, year)
);

-- ---------- invoices (client + business/bank snapshot at generation) ----------
create table public.invoices (
  id            uuid primary key default gen_random_uuid(),
  number        text not null unique,
  lead_id       uuid references public.leads(id) on delete set null,
  status        invoice_status not null default 'draft',
  currency      text not null default 'EUR',
  issue_date    date not null default current_date,
  due_date      date,
  client_name text, client_company text, client_email text, client_phone text, client_address text,
  biz_logo_url text, biz_brand_name text, biz_legal_name text, biz_website text, biz_email text,
  biz_phone text, biz_address text, biz_vat_id text, biz_iban text, biz_bank_name text,
  biz_bic text, biz_bank_address text, biz_paypal text,
  project_name text, intro_text text, notes text, terms_text text, footer_text text,
  subtotal numeric(12,2) not null default 0,
  discount_type text not null default 'amount' check (discount_type in ('amount','percent')),
  discount_value numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  tax_rate numeric(6,3) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  deposit_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  balance_due numeric(12,2) not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoices_status_idx  on public.invoices(status);
create index invoices_lead_idx    on public.invoices(lead_id);
create index invoices_created_idx on public.invoices(created_at desc);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  position int not null default 0,
  description text not null default '',
  qty numeric(12,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index invoice_items_invoice_idx on public.invoice_items(invoice_id);

create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount numeric(12,2) not null,
  paid_on date not null default current_date,
  method text not null default 'bank_transfer',
  is_deposit boolean not null default false,
  reference text, note text, created_by text,
  created_at timestamptz not null default now()
);
create index invoice_payments_invoice_idx on public.invoice_payments(invoice_id);

-- ---------- atomic invoice number (admin-gated, concurrency-safe) ----------
create or replace function public.next_invoice_number(p_prefix text, p_year int)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_seq int;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  insert into public.invoice_counters (prefix, year, last_seq) values (p_prefix, p_year, 1)
  on conflict (prefix, year) do update set last_seq = public.invoice_counters.last_seq + 1
  returning last_seq into v_seq;
  return p_prefix || '-' || p_year::text || '-' || lpad(v_seq::text, 4, '0');
end; $$;

-- ---------- updated_at + payment recompute triggers ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger trg_invoices_touch before update on public.invoices
  for each row execute function public.touch_updated_at();
create trigger trg_settings_touch before update on public.business_settings
  for each row execute function public.touch_updated_at();

create or replace function public.recompute_invoice_paid()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_invoice uuid; v_paid numeric(12,2); v_deposit_paid boolean;
begin
  v_invoice := coalesce(new.invoice_id, old.invoice_id);
  select coalesce(sum(amount),0), coalesce(bool_or(is_deposit),false)
    into v_paid, v_deposit_paid
    from public.invoice_payments where invoice_id = v_invoice;
  update public.invoices i set
    amount_paid = v_paid,
    balance_due = round(i.total - v_paid, 2),
    status = case
      when i.status in ('cancelled','refunded') then i.status
      when i.total > 0 and v_paid >= i.total then 'paid'::invoice_status
      when v_paid > 0 and v_paid < i.total then
        case when v_deposit_paid and v_paid <= i.deposit_amount
             then 'deposit_paid'::invoice_status else 'partially_paid'::invoice_status end
      when v_paid = 0 and i.status in ('deposit_paid','partially_paid','paid')
             then 'sent'::invoice_status
      else i.status end,
    updated_at = now()
  where i.id = v_invoice;
  return null;
end; $$;
create trigger trg_payments_recompute
  after insert or update or delete on public.invoice_payments
  for each row execute function public.recompute_invoice_paid();

-- ---------- RLS (admin only) ----------
alter table public.business_settings enable row level security;
alter table public.invoices         enable row level security;
alter table public.invoice_items    enable row level security;
alter table public.invoice_payments enable row level security;
alter table public.invoice_counters enable row level security;
create policy settings_admin_all on public.business_settings for all to authenticated using (is_admin()) with check (is_admin());
create policy invoices_admin_all on public.invoices         for all to authenticated using (is_admin()) with check (is_admin());
create policy items_admin_all    on public.invoice_items    for all to authenticated using (is_admin()) with check (is_admin());
create policy payments_admin_all on public.invoice_payments for all to authenticated using (is_admin()) with check (is_admin());
create policy counters_admin_all on public.invoice_counters for all to authenticated using (is_admin()) with check (is_admin());

-- ---------- seed business settings ----------
insert into public.business_settings (
  id, brand_name, legal_name, email, website, currency, invoice_prefix, tax_rate, payment_terms_days,
  iban, bank_name, bic, bank_address, intro_text, terms_text, footer_text
) values (
  true, 'Ascora Studio', 'Yasser Derhem', 'hello@ascorastudio.com', 'https://www.ascorastudio.com',
  'EUR', 'ASC', 0, 14,
  'DE25100101783959024560', 'Revolut Bank UAB, Zweigniederlassung Deutschland', 'REVODEB2',
  E'FORA Linden Palais\nUnter den Linden 40\n10117 Berlin\nGermany',
  E'Thank you for partnering with Ascora Studio. Below you will find the details of your project and the corresponding investment. We are excited to bring this work to life.',
  E'Payment is due within 14 days of the invoice date. Please include the invoice number as the payment reference for your bank transfer. Thank you for your business.',
  'Ascora Studio · Premium Websites & Digital Experiences'
) on conflict (id) do nothing;

-- ---------- branding storage bucket (public read, admin write) ----------
insert into storage.buckets (id, name, public) values ('branding','branding',true) on conflict (id) do nothing;
create policy "branding_public_read"   on storage.objects for select using (bucket_id = 'branding');
create policy "branding_admin_insert"  on storage.objects for insert to authenticated with check (bucket_id = 'branding' and is_admin());
create policy "branding_admin_update"  on storage.objects for update to authenticated using (bucket_id = 'branding' and is_admin());
create policy "branding_admin_delete"  on storage.objects for delete to authenticated using (bucket_id = 'branding' and is_admin());
