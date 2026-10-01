-- Creates the admin login and allow-lists it. Run AFTER 20260930000012_admin_auth.sql.
-- The generated 16-character password is returned as the query result. COPY IT
-- NOW (it is not stored anywhere readable), sign in at /admin with it, and change
-- it later from Supabase -> Authentication -> Users if you like.
-- Also turn OFF "Allow new users to sign up" (Authentication -> Providers -> Email).
-- Run once; if the user already exists nothing is created (use the dashboard to
-- reset the password instead).

with settings as (
  select 'jeffrey.t.brothers@gmail.com'::text as email,
         left(translate(encode(gen_random_bytes(24), 'base64'), '+/=', 'xyz'), 16) as pw,
         gen_random_uuid() as uid
),
new_user as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', email,
         crypt(pw, gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
         '', '', '', ''
  from settings
  where not exists (select 1 from auth.users u where lower(u.email) = lower((select email from settings)))
  returning id
),
new_identity as (
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), n.id, n.id::text,
         jsonb_build_object('sub', n.id::text, 'email', s.email, 'email_verified', true),
         'email', now(), now(), now()
  from new_user n, settings s
  returning user_id
),
allow as (
  insert into admin_emails (email) select email from settings on conflict do nothing returning email
)
select s.email as login_email,
       case when exists (select 1 from new_user) then s.pw else '(user already existed - password unchanged)' end as password
from settings s;
