-- Seed example provider destinations (idempotent).

do $$
begin
  if not exists (
    select 1 from public.providers where lower(name) = lower('Zartman Network (Internal)')
  ) then
    insert into public.providers (name, provider_type, quoting_mode, website, notes)
    values (
      'Zartman Network (Internal)',
      'direct_supplier',
      'manual',
      null,
      'Internal network of vetted direct suppliers.'
    );
  end if;

  if not exists (select 1 from public.providers where lower(name) = lower('Xometry')) then
    insert into public.providers (name, provider_type, quoting_mode, website, notes)
    values ('Xometry', 'marketplace', 'manual', 'https://www.xometry.com', null);
  end if;

  if not exists (select 1 from public.providers where lower(name) = lower('Fictiv')) then
    insert into public.providers (name, provider_type, quoting_mode, website, notes)
    values ('Fictiv', 'marketplace', 'manual', 'https://www.fictiv.com', null);
  end if;

  if not exists (select 1 from public.providers where lower(name) = lower('Hubs')) then
    insert into public.providers (name, provider_type, quoting_mode, website, notes)
    values ('Hubs', 'marketplace', 'manual', 'https://www.hubs.com', null);
  end if;

  if not exists (select 1 from public.providers where lower(name) = lower('Protolabs')) then
    insert into public.providers (name, provider_type, quoting_mode, website, notes)
    values ('Protolabs', 'marketplace', 'manual', 'https://www.protolabs.com', null);
  end if;

  if not exists (select 1 from public.providers where lower(name) = lower('Quickparts')) then
    insert into public.providers (name, provider_type, quoting_mode, website, notes)
    values ('Quickparts', 'marketplace', 'manual', 'https://www.quickparts.com', null);
  end if;

  if not exists (select 1 from public.providers where lower(name) = lower('Acme Precision (Example)')) then
    insert into public.providers (name, provider_type, quoting_mode, website, notes)
    values ('Acme Precision (Example)', 'factory', 'email', null, 'Example factory partner.');
  end if;

  if not exists (select 1 from public.providers where lower(name) = lower('Global Sourcing Brokers (Example)')) then
    insert into public.providers (name, provider_type, quoting_mode, website, notes)
    values ('Global Sourcing Brokers (Example)', 'broker', 'email', null, 'Example broker entry.');
  end if;
end $$;
