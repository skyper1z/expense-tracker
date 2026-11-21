# SpendNote

*by O.B (Osei-Bonsu)*

A personal expense tracker where every expense can carry a note about what it was for. It adds up spending by calendar week (Monday start) and month, and flags expenses that still need an explanation.

Built with React 19, TypeScript, Tailwind CSS 4, Vite, IndexedDB (`idb`), `lucide-react` icons and `vite-plugin-pwa`, with a Supabase (Postgres) backend. Sign-in is by **emailed one-time code only**, generated and checked by SpendNote's own server functions and delivered by a free email API (Brevo or Resend). There are no passwords.

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

Sign-in codes are generated and checked by SpendNote's own server functions, then delivered by a free email API. Choose one:

| Email API | Free allowance | What you need |
| --- | --- | --- |
| [Brevo](https://www.brevo.com) | 300 emails a day | A sender address you confirm by email. No domain needed. |
| [Resend](https://resend.com) | 3,000 emails a month | Your own domain, to email anyone other than yourself. |

**Already done for the `spendnote` project** (ref `alskqyuvjvfhaawdyzlc`, London):
- both migrations applied (tables, row level security, sync triggers, rate limits, sign-in codes, email hook);
- auth settings pushed: public sign-ups off, the email provider off, Supabase's own emails blocked;
- `auth-send-otp` and `auth-verify-otp` deployed;
- the project URL and browser key saved in `.env`, commented out.

**What's left:**

1. Create a free account at Brevo or Resend and get an API key.
   - Brevo: Senders, Domains & Dedicated IPs → Senders → add and confirm your sender address. Then SMTP & API → API keys.
   - Resend: add and verify your domain, then API Keys.
2. In your own terminal, from this folder, set the key and the sender. Use the address or domain you verified:
   ```bash
   supabase secrets set BREVO_API_KEY=<your Brevo API key> EMAIL_FROM="SpendNote <you@example.com>"
   # or: supabase secrets set RESEND_API_KEY=<your Resend API key> EMAIL_FROM="SpendNote <hello@yourdomain.com>"
   ```
3. In `.env`, remove the `# ` in front of `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then restart `npm run dev` or rebuild.

**Deploying (Vercel):** the live site is https://expense-tracker-bab2.vercel.app. `.env` isn't in git, so add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under the Vercel project's Settings → Environment Variables, then redeploy. Vite builds these values into the app, so changing them always needs a new build. The sign-in functions only accept browser requests from the addresses in the `ALLOWED_ORIGINS` secret: currently the Vercel site and `localhost:5173`/`4173`. Add any new domain there.

To redo the setup on another project, run `supabase link --project-ref <ref>`, `supabase db push`, `supabase config push`, `supabase functions deploy auth-send-otp auth-verify-otp --use-api`, then steps 1–3. Docker isn't needed. The database password for this project is in `supabase/.db-password` (git-ignored).

### How sign-in works

1. The app sends the email to `auth-send-otp`. The function rate-limits it: one code per minute, 5 per email and 20 per IP address per hour. It then makes a random 6-digit code, stores only a keyed hash of it, and emails the code through Brevo or Resend.
2. The app sends the code to `auth-verify-otp`. Codes expire after 10 minutes, work once, and allow 5 wrong tries. Only the latest code for an email is valid.
3. If the code is right, the function creates the user if they're new (no password), mints a one-time token with the admin API, exchanges it for a normal Supabase session, and returns it.

The project's email provider is switched off, so password sign-in and Supabase's own magic links and email codes are refused outright. The emailed code is the only way in. Every table has row level security, so a user can only read or change their own rows.

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
| `supabase/functions/` | `auth-send-otp` and `auth-verify-otp` Edge Functions (codes, email via Brevo or Resend, sessions) |
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

## Installing is required

In production, SpendNote only runs as an installed app. In a normal browser tab it shows **Install SpendNote to continue**, with steps for that device:

- **Chrome, Edge and Android:** an Install button, or the browser menu's "Install app".
- **iPhone and iPad:** Share → Add to Home Screen.
- **Mac Safari:** File → Add to Dock.

Browsers that can't install apps (desktop Firefox, and the browsers inside WhatsApp, Instagram and similar) are told to open the link in Chrome, Edge or Safari. Once installed, the app opens straight to SpendNote. When Chrome moves the tab into the new app window, the app opens by itself.

`npm run dev` is never blocked. To let a production build run in a browser tab, for example for testing, build it with `VITE_REQUIRE_INSTALL=false`.

## Features that depend on the browser

- **Install**: required in production (see above). Desktop Firefox can't install web apps, so its users are pointed to Chrome, Edge or Safari.
- **Offline**: works after the first visit to a production build (`npm run preview` or a deployed site).
- **Reminders**: the weekly reminder always appears inside the app the next time it's opened after the scheduled time. If notifications are allowed, it also shows a notification at that time **while SpendNote is open** (including in a background tab). Reminders can't reach a closed app, because that would need a push server.
- **Paste from clipboard**: the button only appears where the browser allows reading the clipboard. Long-press paste always works.
- **Storage**: when signed in, records are saved to the account, and clearing site data only removes the device copy. In local-only mode, clearing site data deletes the records, so Settings offers backups.

## What has and hasn't been tested

- **Unit tests:** the sync engine (two devices, conflicts, offline retries, deletes, restore); the sign-in functions; code generation and hashing; and the exact Brevo and Resend requests.
- **Database:** both migrations were run in an in-process Postgres (PGlite) to check row level security, conflict handling, constraints, rate limits, the code rules and the email hook.
- **Edge Functions:** type-checked with Deno.
- **Browser:** the full app was tested in Chrome against an emulated backend, covering sign-in, two devices, offline then reconnect, sign-out, and importing older records.
- **Live project:** a session was issued for a verified email while the email provider was off. Row level security and token refresh worked. Password sign-in, Supabase's own email codes, and public sign-ups were all refused. The deployed functions answer and report "not set up" until an email key is added.
- **Not yet tested:** a real email sent through Brevo or Resend, which needs your API key. Do one test sign-in after step 2.
