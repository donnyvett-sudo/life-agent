-- Create the first (admin) user without Telegram. Run once in the Supabase SQL editor after applying migrations.
-- The returned ingest_token is this user's first credential (scope "*"): send it as the X-Token header,
-- or paste it into the miniapp login. Mint pairing codes / invites from there. Keep it secret.
insert into public.users (first_name, tz, is_allowed, is_owner, consent_at)
values ('Admin', 'UTC', true, true, now())
returning id, ingest_token;
