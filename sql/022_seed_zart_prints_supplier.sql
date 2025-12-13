-- Seeds the Zart Prints supplier profile (idempotent).
--
-- This ensures the supplier exists with the expected auth link and
-- notification preferences.

do $$
begin
  -- Prefer an exact id match.
  update public.suppliers
  set company_name = 'Zart Prints',
      primary_email = 'jackson.zartman@gmail.com',
      phone = '3176901680',
      website = null,
      country = 'United States',
      verified = true,
      user_id = '5c7018e4-7860-40ec-abe6-8b83d3177733',
      notify_quote_messages = true,
      notify_quote_winner = true
  where id = '5c7018e4-7860-40ec-abe6-8b83d3177733';

  if found then
    return;
  end if;

  -- If the record already exists under a different id, update it by email.
  update public.suppliers
  set company_name = 'Zart Prints',
      phone = '3176901680',
      website = null,
      country = 'United States',
      verified = true,
      user_id = '5c7018e4-7860-40ec-abe6-8b83d3177733',
      notify_quote_messages = true,
      notify_quote_winner = true
  where primary_email is not null
    and lower(primary_email) = lower('jackson.zartman@gmail.com');

  if found then
    return;
  end if;

  -- Otherwise insert fresh.
  insert into public.suppliers (
    id,
    company_name,
    primary_email,
    phone,
    website,
    country,
    verified,
    created_at,
    user_id,
    notify_quote_messages,
    notify_quote_winner
  ) values (
    '5c7018e4-7860-40ec-abe6-8b83d3177733',
    'Zart Prints',
    'jackson.zartman@gmail.com',
    '3176901680',
    null,
    'United States',
    true,
    timestamptz '2025-11-23 20:10:04.067723+00',
    '5c7018e4-7860-40ec-abe6-8b83d3177733',
    true,
    true
  );
end $$;
