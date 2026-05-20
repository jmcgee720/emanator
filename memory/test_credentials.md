# Test Credentials

## Status
- The previous shared test account (`[REDACTED_TEST_USER]`) was COMPROMISED on or around 2026-05-16 and has been deleted from Supabase auth.
- The Supabase JWT signing key has been rotated and the previous key marked as Previous.
- **DO NOT** hardcode passwords in this file or commit them to the repo. Use environment variables only.

## Setting Up a New Test Account
1. Sign up a fresh test account via the live `/signup` page.
2. Promote it to the desired role via Supabase SQL editor:
   ```sql
   UPDATE public.users SET role = 'owner', is_allowlisted = true WHERE email = '<your-test-email>';
   ```
3. Store the credentials locally in `.env.local` as:
   - `TEST_USER_EMAIL=<your-test-email>`
   - `TEST_USER_PASSWORD=<your-test-password>`
4. Reference them in test scripts via `process.env.TEST_USER_EMAIL` / `os.environ.get("TEST_USER_EMAIL")`.

## Auth Type
- Supabase email/password auth
- Login page selector: `data-testid="signin-btn"`
