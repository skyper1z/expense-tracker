# SpendNote

*by O.B (Osei-Bonsu)*

A personal expense tracker where every expense can carry a note about what it was for. It adds up spending by calendar week (Monday start) and month, and flags expenses that still need an explanation.

Built with React 19, TypeScript, Tailwind CSS 4, Vite, IndexedDB (`idb`), `lucide-react` icons and `vite-plugin-pwa`, with a Supabase (Postgres) backend. Sign-in is by **emailed one-time code only**, sent and checked by [Authentica](https://github.com/AuthenticaSA/Authentica). There are no passwords.

The app is offline-first: records live in the browser (IndexedDB) and sync to the user's Postgres rows whenever there's a connection. Without Supabase settings it runs in **local-only mode**, with no sign-in and records kept on the device only.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (development; the service worker is off in dev)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build at http://localhost:4173 (offline/PWA works here)
npm test           # unit tests: calculations, MoMo parsing, backups, storage, sync, sign-in functions
```

To install it on a phone, deploy `dist/` to any static HTTPS host. Service workers and installation need HTTPS, or `localhost`.

## Set up accounts and sync

You need a Supabase project and an Authentica account. Docker isn't required.

1. **Database.** Link the project and apply the migration:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
2. **Auth settings.** Push `supabase/config.toml` (`supabase config push`), or set these by hand in the dashboard:
   - *Authentication → Sign In / Providers*: turn **off** "Allow new users to sign up". Accounts are created only by the sign-in function, after Authentica has verified the code.
   - *Authentication → Hooks*: add a **Send Email** hook of type Postgres function, pointing at `public.hook_block_builtin_auth_email`. This stops Supabase from sending its own magic links or codes, so Authentica email OTP is the only way in.
3. **Authentica.** In the [Authentica portal](https://portal.authentica.sa), get an API key and set up an email OTP template. Then add the secrets:
   ```bash
   supabase secrets set AUTHENTICA_API_KEY=... AUTHENTICA_EMAIL_TEMPLATE_ID=... ALLOWED_ORIGINS=https://your-site.example
   ```
   `AUTHENTICA_EMAIL_TEMPLATE_ID` and `ALLOWED_ORIGINS` are optional (see `supabase/functions/.env.example`).
4. **Functions.** Deploy both sign-in functions. JWT checks are off for them in `config.toml` because the user isn't signed in yet:
   ```bash
   supabase functions deploy auth-send-otp auth-verify-otp --use-api
   ```
5. **App.** Copy `.env.example` to `.env`, fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then `npm run build`.

### How sign-in works

1. The app calls `auth-send-otp` with the email. The function rate-limits the request (one code per minute, 5 per email and 20 per IP address per hour), then asks Authentica to email a code.
2. The app calls `auth-verify-otp` with the code. Authentica checks it. Wrong codes are capped at 5 per email per 15 minutes.
3. If the code is right, the function creates the user if they're new (no password), mints a one-time token with the admin API, exchanges it for a normal Supabase session, and returns it. From then on it's a standard Supabase session.

Every table has row level security, so a user can only read or change their own rows. Codes are never stored in our database.

### How sync works

Every change is saved on the device first and queued. When online, queued changes upload, and changes made on other devices download. If two devices edit the same entry, the edit made most recently wins. The database also enforces this, so a late upload of an older edit can't overwrite a newer one. Deletions sync too, and Undo brings an entry back everywhere. Signing out removes the device's copy; signing in again downloads it.

## Where things live

| Path | What it does |
| --- | --- |
| `src/lib/calc.ts` | All spending, category, filter and duplicate maths |
| `src/lib/momo.ts` | MoMo / Telecel Cash / AT Money message reader |
| `src/lib/dates.ts`, `src/lib/money.ts` | Local calendar dates; integer minor-unit money parsing and formatting |
| `src/lib/db.ts` | IndexedDB storage: one database per signed-in user, one for the demo, plus an upload queue |
| `src/lib/sync.ts`, `src/lib/remote.ts` | Offline-first sync with Postgres (push queued changes, pull changes since last sync) |
| `src/state/auth.tsx`, `src/screens/SignIn.tsx` | Email-code sign-in in the app |
| `supabase/migrations/` | Tables, row level security, sync triggers, sign-in rate limits, email hook |
| `supabase/functions/` | `auth-send-otp` and `auth-verify-otp` Edge Functions (Authentica) |
| `src/lib/backup.ts` | Versioned JSON backup, validated restore, CSV export |
| `src/screens/` | Overview, Expenses, Review, Settings, first-run |
| `src/sheets/` | Add/edit sheet (incl. MoMo paste), entry details, account and category forms |

## Data rules

- Money is stored as whole minor units (pesewas), never as floating-point values.
- Spending = expense amounts + explicit fees. Money in and transfers never count; only their fees do. Fees appear under **Fees & charges**, so category totals always add up to the period total.
- A transfer is a single record holding both sides, so it can't be half-saved or half-edited.
- Accounts are optional labels (e.g. "MoMo wallet") for where money is paid from or received into. They don't track balances.
- "Missing a note" and "reviewed" are separate. Needs attention counts expenses that have no note **and** haven't been marked reviewed.
- Demo data lives in its own IndexedDB database. Demo backups can't be restored into real data. The demo works without signing in.
- Backups are version 2. Older version-1 backups still restore; their balance-check data is ignored.

## Features that depend on the browser

- **Install**: Chrome and Edge show an install button in Settings. On iPhone or iPad use Safari's Share → Add to Home Screen. Firefox desktop doesn't support installing.
- **Offline**: works after the first visit to a production build (`npm run preview` or a deployed site).
- **Reminders**: the weekly reminder always appears inside the app the next time it's opened after the scheduled time. If notifications are allowed, it also shows a notification at that time **while SpendNote is open** (including in a background tab). Reminders can't reach a closed app, because that would need a push server.
- **Paste from clipboard**: the button only appears where the browser allows reading the clipboard. Long-press paste always works.
- **Storage**: when signed in, records are saved to the account, and clearing site data only removes the device copy. In local-only mode, clearing site data deletes the records, so Settings offers backups.

## What has and hasn't been tested

- **Tested here:** unit tests for the sync engine (two devices, conflicts, offline retries, deletes, restore) and for the sign-in functions (with Authentica's documented request and response formats). The migration was run in an in-process Postgres (PGlite) to check row level security, conflict handling, constraints, rate limits and the email hook. The Edge Functions were type-checked with Deno. The full app was tested in Chrome against an emulated Supabase backend: sign-in, two devices, offline then reconnect, sign-out, and importing older records.
- **Not tested yet:** the live Authentica API and a real Supabase project (no API key or project was available). Authentica doesn't document what a failed check looks like; the function accepts both `{"status": false}` and HTTP 422. Check that on your first live sign-in.
