-- Every minute, call the scheduler Edge Function. Both the URL and the secret come from Vault:
-- 'cron_secret' is created by the init migration. Create 'project_url' once, BEFORE the first tick:
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select cron.schedule(
  'scheduler-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
