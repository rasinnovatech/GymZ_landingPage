# GymZ AI Landing Page — Supabase Migration & Full Functionality Guide

This specification covers everything needed to connect the GymZ AI landing page to your existing **GymZ Supabase database** and make every landing page feature production-ready on Vercel (with **no keep-alive cron job**).

---

## 1. Current Gap Audit (`gymz-landing`)

| Area | Current State | Location | What Needs to Change |
| :--- | :--- | :--- | :--- |
| **Beta Waitlist** | Client-only: saves to browser `localStorage` (`gymz_waitlist`) after a `400ms` timeout and calculates a fake spot (`740 + list.length + 1`). Nothing reaches your backend or inbox. | [`index.html`](./index.html#L1243-L1280), [`JS`](./index.html#L2569-L2656) | Wire `#beta-form` to `POST /api/waitlist` → insert into `public.beta_waitlist` in Supabase + send notification email via Resend. |
| **Contact Form** | Calls `POST /api/contact` and dispatches email via Resend/SMTP/Web3Forms, plus stores a local copy in `localStorage`. Does **not** persist inquiries in Supabase. | [`index.html`](./index.html#L2689-L2759), [`api/contact.js`](./api/contact.js) | Optionally log submissions to `public.contact_submissions` in Supabase alongside dispatching the Resend email to `gymzai@rasinnovatech.com`. |
| **Android APK Download** | `./app-release.apk` is a `1051`-byte placeholder while UI text says `48.2 MB`. Fallback URL points to `https://gymz.ai/downloads/app-release.apk`. | [`index.html`](./index.html#L1210-L1218), [`JS`](./index.html#L2507-L2528), [`app-release.apk`](./app-release.apk) | Replace with the real APK (or host via GitHub Releases / Supabase Storage / CDN), update `fullApkUrl` and displayed MB size. |
| **Footer Legal Links** | `Privacy Policy`, `Terms of Service`, and `RasInnovatech` links all point to `#top`. | [`index.html`](./index.html#L1184) | Point to real legal pages/sections and your RasInnovatech domain. |
| **Secrets & Resend** | `.env.example` contains a real `RESEND_API_KEY` on line 15 and uses `onboarding@resend.dev`. Vercel ignores `.env.example`. | [`.env.example`](./.env.example#L7-L16) | Move all secrets to **Vercel → Project Settings → Environment Variables**, rotate the exposed key, replace `.env.example` value with a placeholder, and verify `rasinnovatech.com` in Resend. |
| **Vercel Config** | Only sets `{ "cleanUrls": true }`. | [`vercel.json`](./vercel.json) | Keep clean as-is (no cron job added). |

---

## 2. Database Migration SQL (Run in Original GymZ Backend Repo)

Generate a new migration in your original GymZ backend repository using the Supabase CLI:

```bash
supabase migration new create_landing_waitlist_and_contact
```

Paste the SQL below into the generated migration file. It follows Supabase Postgres best practices:
- Uses `bigint generated always as identity` primary keys.
- Uses `text` + explicit `CHECK` constraints matching exact `<select>` values in `index.html` (avoiding Postgres enum lock-in).
- Uses `timestamptz` for all timestamps.
- Normalizes & enforces case-insensitive email uniqueness (`lower(trim(email))`).
- Enables **Row Level Security (RLS)** and revokes public `anon`/`authenticated` table privileges so visitor emails cannot be scraped through Supabase's public REST API. Only server-side functions using `SUPABASE_SERVICE_ROLE_KEY` (or your backend) can read/write these tables.
- Includes an optional nullable `auth_user_id` on `beta_waitlist` so your backend can later link waitlist signups to `auth.users` when they create an account in the app.

```sql
-- ============================================================================
-- Migration: Landing Page Waitlist & Contact Submissions
-- Notes:
--   - Exact role/topic CHECK values match index.html dropdown options.
--   - RLS enabled with zero public anon/authenticated policies (server-only access).
-- ============================================================================

-- 1. Beta Waitlist Table
create table if not exists public.beta_waitlist (
  id bigint generated always as identity primary key,
  email text not null,
  role text not null check (
    role in (
      'Athlete',
      'Coach or trainer',
      'Gym owner',
      'Developer',
      'Investor or accelerator'
    )
  ),
  status text not null default 'pending' check (
    status in ('pending', 'invited', 'converted')
  ),
  source text not null default 'landing_modal',
  invite_code text,
  auth_user_id uuid references auth.users(id) on delete set null,
  invited_at timestamptz,
  created_at timestamptz not null default now(),
  constraint beta_waitlist_email_normalized check (email = lower(trim(email)))
);

-- Enforce unique emails case-insensitively
create unique index if not exists beta_waitlist_email_uidx
  on public.beta_waitlist (email);

-- Helpful index for admin cohort filtering & export
create index if not exists beta_waitlist_status_created_idx
  on public.beta_waitlist (status, created_at desc);

-- Lock down table: enable RLS and revoke direct client access
alter table public.beta_waitlist enable row level security;
revoke all on table public.beta_waitlist from anon, authenticated;


-- 2. Contact Submissions Table (Optional audit/backup log alongside Resend email)
create table if not exists public.contact_submissions (
  id bigint generated always as identity primary key,
  name text not null,
  email text not null,
  topic text not null default 'General' check (
    topic in (
      'Partnership or gym pilot',
      'Investment or accelerator',
      'Press',
      'App support',
      'General'
    )
  ),
  message text not null,
  email_dispatched boolean not null default false,
  created_at timestamptz not null default now(),
  constraint contact_submissions_email_normalized check (email = lower(trim(email)))
);

create index if not exists contact_submissions_created_idx
  on public.contact_submissions (created_at desc);

alter table public.contact_submissions enable row level security;
revoke all on table public.contact_submissions from anon, authenticated;
```

### Spot Number Consistency
- Your UI currently shows spot numbers starting around `#741` (`740 + list.length + 1` in `index.html`).
- With `beta_waitlist.id` (`1, 2, 3...`), your API can return `spot = 740 + row.id` (or raw `row.id` if you prefer `#1, #2, #3...`). Either way, every visitor gets a **real, permanent, globally unique spot number** backed by Postgres.
- Note on **existing emails**: When someone submits an email that already exists in `beta_waitlist`, perform a lookup/upsert-safe check (`ON CONFLICT (email) DO NOTHING` or `SELECT id, role, status WHERE email = lower(trim($1))`) and return `{ alreadyRegistered: true, spot, role }` so the user sees their existing spot without creating a duplicate row or erroring out.

### Optional Backend Sync (Waitlist → Mobile App Sign-Up)
You can mark a user as `'converted'` and populate `auth_user_id` inside your GymZ backend onboarding/profile endpoint using the `service_role` key, or (if you prefer a DB trigger on `auth.users`) place the `SECURITY DEFINER` trigger function in a non-exposed `private` schema rather than `public`:

```sql
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.link_waitlist_on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null then
    update public.beta_waitlist
    set auth_user_id = new.id,
        status = 'converted'
    where email = lower(trim(new.email))
      and auth_user_id is null;
  end if;
  return new;
end;
$$;
```

*(Run `supabase db advisors` after applying migrations, and test any `auth.users` trigger thoroughly in local Supabase before pushing to production.)*

---

## 3. Environment Variables Needed (Vercel Dashboard)

Add these in **Vercel Dashboard → Project → Settings → Environment Variables**:

| Variable | Value / Source | Used By |
| :--- | :--- | :--- |
| `SUPABASE_URL` | Your Supabase Project URL (`https://<ref>.supabase.co`) | `/api/waitlist` (and `/api/contact` if logging to DB) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Project Settings → API → `service_role` / Secret key (**server-only, never expose in `index.html`**) | `/api/waitlist` (and `/api/contact`) |
| `RESEND_API_KEY` | Fresh Resend API key (rotate the key currently saved in `.env.example`) | `/api/contact`, `/api/waitlist` |
| `CONTACT_RECEIVER_EMAIL` | `gymzai@rasinnovatech.com` | `/api/contact`, `/api/waitlist` |
| `EMAIL_FROM` | `GymZ AI <noreply@rasinnovatech.com>` (after domain verification; `onboarding@resend.dev` only sends to the Resend account owner) | `/api/contact`, `/api/waitlist` |

> **Important Security Cleanup:** Replace the live `RESEND_API_KEY` inside [`.env.example`](./.env.example#L15) with `RESEND_API_KEY=re_your_api_key_here` before committing to Git, and rotate that key in your Resend dashboard.

---

## 4. API & Frontend Wiring Changes Needed in `gymz-landing`

When you're ready to wire the landing page side, these are the exact changes needed:

### A. Create `api/waitlist.js` (Vercel Serverless Function)
- Accept `POST { email, role }`.
- Normalize `email = email.trim().toLowerCase()`, validate format, and validate `role` against the allowed list (`Athlete`, `Coach or trainer`, `Gym owner`, `Developer`, `Investor or accelerator`).
- Call Supabase PostgREST (`POST ${SUPABASE_URL}/rest/v1/beta_waitlist`) using `apikey` + `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}` with `Prefer: return=representation,resolution=ignore-duplicates` (or query existing row on `23505` conflict) so **no extra npm dependency is even required**.
- Return `{ success: true, spot, alreadyRegistered, email, role }`.
- Also dispatch a notification email to `gymzai@rasinnovatech.com` via Resend (`RESEND_API_KEY`).
- **Graceful fallback:** If Supabase is paused or temporarily unreachable, still send the signup email via Resend so no lead is dropped, and return a clean response to the UI.

### B. Update `api/contact.js` (Optional DB Log)
- Keep existing Resend / SMTP / Web3Forms email dispatch in [`api/contact.js`](./api/contact.js).
- Optionally insert `{ name, email: email.trim().toLowerCase(), topic, message, email_dispatched }` into `public.contact_submissions` via Supabase REST using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.

### C. Update `#beta-form` Submit Handler in `index.html`
- Replace the `setTimeout(..., 400)` mock in [`betaForm.addEventListener('submit', ...)`](./index.html#L2601-L2656) with an `async` `fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, role }) })`.
- Render the server-returned `spot` number in `#beta-success-spot` and `#beta-success-desc` (and adjust wording slightly if `alreadyRegistered` is `true`, e.g., `"You're already on the list — Spot #..."`).
- Show inline error state in `#beta-email-err` if the server returns `400`/`500`.

---

## 5. Other Landing Page Consistency Checklist (Before Launch)

1. **Real Android APK (`app-release.apk`)**
   - Currently [`app-release.apk`](./app-release.apk) is a `1051`-byte placeholder while [`index.html`](./index.html#L1211) displays `48.2 MB`.
   - **Recommended hosting:** For a ~48 MB binary, avoid storing the APK directly inside Git if you deploy via GitHub → Vercel. Host the signed APK in **GitHub Releases** or a public **Supabase Storage** bucket (`releases/app-release.apk`), then point `#btn-download-apk` ([line 1216](./index.html#L1216)) and `fullApkUrl` ([line 2507](./index.html#L2507)) to that URL and update the MB size label to match your real release build.
2. **Verify `rasinnovatech.com` Domain in Resend**
   - Until your sending domain is verified in Resend (`EMAIL_FROM`), Resend restricts `onboarding@resend.dev` deliveries to your Resend account email only and cannot send welcome/confirmation emails directly to waitlist subscribers.
3. **Privacy Policy & Terms Links**
   - Update the footer links at [`index.html` line 1184](./index.html#L1184) (`Privacy Policy`, `Terms of Service`, `RasInnovatech`) from `#top` to real URLs or sections, since the waitlist and contact form collect user email addresses.
4. **Confirm Waitlist Cohort Strategy**
   - Make sure your backend/team plan matches the modal promise at [`index.html` line 1271](./index.html#L1271): *"We'll send your priority beta invite code to ..."* (e.g., whether waitlist users receive closed Play Store beta invites, iOS TestFlight access, or gym pilot onboarding).

