-- Run once in your own Supabase project's SQL Editor. No API keys go in this file.
create table if not exists public.zhijian_backend_state (
 key text primary key check (length(key) <= 190 and key ~ '^(ai|batch|forum):[A-Za-z0-9:_-]+$'),
 value jsonb not null,
 revision bigint not null default 1,
 updated_at timestamptz not null default now()
);
create index if not exists zhijian_state_updated on public.zhijian_backend_state(updated_at);
alter table public.zhijian_backend_state enable row level security;
revoke all on public.zhijian_backend_state from anon, authenticated;
grant select, insert, update, delete on public.zhijian_backend_state to service_role;

create or replace function public.zhijian_put_state(p_key text, p_value jsonb, p_expected bigint default null)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare next_revision bigint;
begin
 if p_expected = 0 then
  insert into public.zhijian_backend_state(key,value) values(p_key,p_value)
  on conflict(key) do nothing returning revision into next_revision;
 elsif p_expected is not null then
  update public.zhijian_backend_state set value=p_value,revision=revision+1,updated_at=now()
  where key=p_key and revision=p_expected returning revision into next_revision;
 else
  insert into public.zhijian_backend_state(key,value) values(p_key,p_value)
  on conflict(key) do update set value=excluded.value,revision=zhijian_backend_state.revision+1,updated_at=now()
  returning revision into next_revision;
 end if;
 if next_revision is null then raise exception 'State conflict' using errcode='40001'; end if;
 delete from public.zhijian_backend_state where updated_at < now()-interval '35 days';
 return jsonb_build_object('revision',next_revision);
end $$;
revoke all on function public.zhijian_put_state(text,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.zhijian_put_state(text,jsonb,bigint) to service_role;

-- Atomic reservations survive restarts and prevent concurrent requests from overspending.
create table if not exists public.zhijian_ai_reservations (
 id uuid primary key, day date not null, amount numeric not null check(amount>0),
 status text not null default 'reserved' check(status in ('reserved','settled','refunded')),
 actual numeric, created_at timestamptz not null default now()
);
create index if not exists zhijian_reservation_day on public.zhijian_ai_reservations(day);
alter table public.zhijian_ai_reservations enable row level security;
revoke all on public.zhijian_ai_reservations from anon,authenticated;
grant select,insert,update,delete on public.zhijian_ai_reservations to service_role;

create or replace function public.zhijian_reserve_ai(p_day date,p_amount numeric,p_budget numeric,p_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare k text := 'ai:'||p_day::text; v jsonb;
begin
 if p_amount<=0 or p_budget<=0 then raise exception 'Invalid amount'; end if;
 insert into public.zhijian_backend_state(key,value) values(k,jsonb_build_object('date',p_day,'calls',0,'costCNY',0,'reservedCNY',0)) on conflict(key) do nothing;
 select value into v from public.zhijian_backend_state where key=k for update;
 if exists(select 1 from public.zhijian_ai_reservations where id=p_id) then return jsonb_build_object('id',p_id,'ledger',v); end if;
 if (v->>'costCNY')::numeric+(v->>'reservedCNY')::numeric+p_amount>p_budget then return jsonb_build_object('error','budget-exhausted'); end if;
 v=jsonb_set(jsonb_set(v,'{calls}',to_jsonb((v->>'calls')::integer+1)),'{reservedCNY}',to_jsonb((v->>'reservedCNY')::numeric+p_amount));
 update public.zhijian_backend_state set value=v,revision=revision+1,updated_at=now() where key=k;
 insert into public.zhijian_ai_reservations(id,day,amount) values(p_id,p_day,p_amount);
 delete from public.zhijian_ai_reservations where day<current_date-35;
 delete from public.zhijian_backend_state where updated_at<now()-interval '35 days';
 return jsonb_build_object('id',p_id,'ledger',v);
end $$;

create or replace function public.zhijian_settle_ai(p_id uuid,p_actual numeric default null,p_refund boolean default false)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.zhijian_ai_reservations%rowtype; k text; v jsonb;
begin
 select * into r from public.zhijian_ai_reservations where id=p_id;
 if not found then raise exception 'Unknown reservation'; end if;
 k='ai:'||r.day::text;
 select value into v from public.zhijian_backend_state where key=k for update;
 select * into r from public.zhijian_ai_reservations where id=p_id for update;
 if r.status<>'reserved' then return jsonb_build_object('ledger',v); end if;
 if not p_refund and (p_actual is null or p_actual<0) then raise exception 'Invalid usage'; end if;
 v=jsonb_set(v,'{reservedCNY}',to_jsonb(greatest(0,(v->>'reservedCNY')::numeric-r.amount)));
 if not p_refund then v=jsonb_set(v,'{costCNY}',to_jsonb((v->>'costCNY')::numeric+p_actual)); end if;
 update public.zhijian_backend_state set value=v,revision=revision+1,updated_at=now() where key=k;
 update public.zhijian_ai_reservations set status=case when p_refund then 'refunded' else 'settled' end,actual=p_actual where id=p_id;
 return jsonb_build_object('ledger',v);
end $$;
revoke all on function public.zhijian_reserve_ai(date,numeric,numeric,uuid) from public,anon,authenticated;
revoke all on function public.zhijian_settle_ai(uuid,numeric,boolean) from public,anon,authenticated;
grant execute on function public.zhijian_reserve_ai(date,numeric,numeric,uuid) to service_role;
grant execute on function public.zhijian_settle_ai(uuid,numeric,boolean) to service_role;
