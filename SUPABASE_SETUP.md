# Inkwell cloud sync setup

The browser app already uses Supabase magic-link authentication. The database
objects and Row Level Security policies are installed separately.

1. Open the Inkwell Supabase project.
2. Open **SQL Editor**, create a new query, and run
   `supabase/inkwell_profiles.sql`.
3. In **Authentication → URL Configuration**, add the production GitHub Pages
   URL to **Redirect URLs**.
4. Keep only the public project URL and publishable/anon key in
   `site/sync-config.json`. Never commit a service-role key.
5. Sign in on two browsers with the same email and press **Sync now**.

The SQL enables RLS so an authenticated user can access only their own rows.
Writes use a revision check. If two devices edit the same profile concurrently,
the second write is stopped and Inkwell preserves a local conflict snapshot
instead of silently overwriting the other device.

To verify the table from Supabase SQL Editor:

```sql
select profile, revision, updated_at
from public.inkwell_profiles
where user_id = auth.uid();
```

