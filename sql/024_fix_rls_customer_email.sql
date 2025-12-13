-- Fix RLS policies that referenced legacy public.quotes.email.
--
-- Some environments removed public.quotes.email in favor of public.quotes.customer_email.
-- These policy rewrites prevent runtime errors when Postgres evaluates RLS predicates.

-- quote_messages: customer read/write policies
do $$
begin
  if to_regclass('public.quote_messages') is null then
    return;
  end if;

  execute 'drop policy if exists "quote_messages_customers_select" on public.quote_messages';
  execute 'drop policy if exists "quote_messages_customers_insert" on public.quote_messages';

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_messages'
      and column_name = 'sender_role'
  ) then
    execute $policy$
      create policy "quote_messages_customers_select"
        on public.quote_messages
        for select
        using (
          exists (
            select 1
            from public.quotes q
            left join public.customers c on c.id = q.customer_id
            where q.id = quote_messages.quote_id
              and (
                (c.user_id is not null and c.user_id = auth.uid())
                or (
                  q.customer_email is not null
                  and trim(q.customer_email) <> ''
                  and lower(q.customer_email) = lower(coalesce(auth.jwt()->> 'email', ''))
                )
              )
          )
        );
    $policy$;

    execute $policy$
      create policy "quote_messages_customers_insert"
        on public.quote_messages
        for insert
        with check (
          lower(sender_role) = 'customer'
          and sender_id = auth.uid()
          and exists (
            select 1
            from public.quotes q
            left join public.customers c on c.id = q.customer_id
            where q.id = quote_messages.quote_id
              and (
                (c.user_id is not null and c.user_id = auth.uid())
                or (
                  q.customer_email is not null
                  and trim(q.customer_email) <> ''
                  and lower(q.customer_email) = lower(coalesce(auth.jwt()->> 'email', ''))
                )
              )
          )
        );
    $policy$;
  else
    -- Legacy schema (author_type/author_email)
    execute $policy$
      create policy "quote_messages_customers_select"
        on public.quote_messages
        for select
        using (
          exists (
            select 1
            from public.quotes q
            where q.id = quote_messages.quote_id
              and q.customer_email is not null
              and trim(q.customer_email) <> ''
              and lower(q.customer_email) = lower(coalesce(auth.jwt()->> 'email', ''))
          )
        );
    $policy$;

    execute $policy$
      create policy "quote_messages_customers_insert"
        on public.quote_messages
        for insert
        with check (
          lower(author_type) = 'customer'
          and exists (
            select 1
            from public.quotes q
            where q.id = quote_messages.quote_id
              and q.customer_email is not null
              and trim(q.customer_email) <> ''
              and lower(q.customer_email) = lower(coalesce(auth.jwt()->> 'email', ''))
          )
        );
    $policy$;
  end if;
end $$;

-- quote_projects: customer read/write policies
do $$
begin
  if to_regclass('public.quote_projects') is null then
    return;
  end if;

  execute 'drop policy if exists "quote_projects_customers_select" on public.quote_projects';
  execute 'drop policy if exists "quote_projects_customers_insert" on public.quote_projects';
  execute 'drop policy if exists "quote_projects_customers_update" on public.quote_projects';

  execute $policy$
    create policy "quote_projects_customers_select"
      on public.quote_projects
      for select
      using (
        exists (
          select 1
          from public.quotes q
          left join public.customers c on c.id = q.customer_id
          where q.id = quote_projects.quote_id
            and (
              (c.user_id is not null and c.user_id = auth.uid())
              or (
                q.customer_email is not null
                and trim(q.customer_email) <> ''
                and lower(q.customer_email) = lower(coalesce(auth.jwt()->> 'email', ''))
              )
            )
        )
      );
  $policy$;

  execute $policy$
    create policy "quote_projects_customers_insert"
      on public.quote_projects
      for insert
      with check (
        exists (
          select 1
          from public.quotes q
          left join public.customers c on c.id = q.customer_id
          where q.id = quote_projects.quote_id
            and (
              (c.user_id is not null and c.user_id = auth.uid())
              or (
                q.customer_email is not null
                and trim(q.customer_email) <> ''
                and lower(q.customer_email) = lower(coalesce(auth.jwt()->> 'email', ''))
              )
            )
        )
      );
  $policy$;

  execute $policy$
    create policy "quote_projects_customers_update"
      on public.quote_projects
      for update
      using (
        exists (
          select 1
          from public.quotes q
          left join public.customers c on c.id = q.customer_id
          where q.id = quote_projects.quote_id
            and (
              (c.user_id is not null and c.user_id = auth.uid())
              or (
                q.customer_email is not null
                and trim(q.customer_email) <> ''
                and lower(q.customer_email) = lower(coalesce(auth.jwt()->> 'email', ''))
              )
            )
        )
      )
      with check (
        exists (
          select 1
          from public.quotes q
          left join public.customers c on c.id = q.customer_id
          where q.id = quote_projects.quote_id
            and (
              (c.user_id is not null and c.user_id = auth.uid())
              or (
                q.customer_email is not null
                and trim(q.customer_email) <> ''
                and lower(q.customer_email) = lower(coalesce(auth.jwt()->> 'email', ''))
              )
            )
        )
      );
  $policy$;
end $$;

-- quote_events: customer read policy
do $$
begin
  if to_regclass('public.quote_events') is null then
    return;
  end if;

  execute 'drop policy if exists "quote_events_customers_select" on public.quote_events';

  execute $policy$
    create policy "quote_events_customers_select"
      on public.quote_events
      for select
      using (
        exists (
          select 1
          from public.quotes q
          left join public.customers c on c.id = q.customer_id
          where q.id = quote_events.quote_id
            and (
              (c.user_id is not null and c.user_id = auth.uid())
              or (
                q.customer_email is not null
                and trim(q.customer_email) <> ''
                and lower(q.customer_email) = lower(coalesce(auth.jwt()->> 'email', ''))
              )
            )
        )
      );
  $policy$;
end $$;
