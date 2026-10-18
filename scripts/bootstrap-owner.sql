-- Create the first (owner) user without Telegram. Run once in the Supabase SQL editor after applying migrations,
-- and BEFORE deploying the Telegram bot (an empty database lets the first /start claim ownership).
-- Returns a raw API token (scope "*") ONCE: copy it now, only its SHA-256 is stored (api_tokens, same hashing as tokens.ts).
-- Send it as the X-Token header or paste it into the miniapp login, then use it to mint pairing codes / narrower tokens.
-- Rotate it later: issue a new "*" token from a signed-in device, then revoke this one (label "bootstrap").
-- Note: every user row also has a legacy random users.ingest_token, still accepted as a "*" credential; it is never
-- shown here. To retire it, run: update public.users set ingest_token = encode(extensions.gen_random_bytes(32), 'hex') where is_owner;
with u as (
  insert into public.users (first_name, tz, is_allowed, is_owner, consent_at)
  values ('Admin', 'UTC', true, true, now())
  returning id
), raw as (
  select encode(extensions.gen_random_bytes(32), 'hex') as token
), t as (
  insert into public.api_tokens (user_id, hash, label, scopes)
  select u.id, encode(extensions.digest(raw.token, 'sha256'), 'hex'), 'bootstrap', '{*}' from u, raw
  returning user_id
)
select t.user_id, raw.token as api_token_copy_it_now from t, raw;
