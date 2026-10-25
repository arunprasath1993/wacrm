# Nixie WA-CRM — Hostinger deploy guide (Tanglish)

Indha guide follow panna, GitHub → Supabase → Hostinger → Meta WhatsApp
ellam connect aagi CRM live aagum. Mothama ~45 nimisham.

> **Thevaiyaanavai:** GitHub account, Supabase account (free plan podhum),
> Hostinger **Business Web Hosting** illa **Cloud** plan (Node.js web
> apps indha plans-la mattum dhaan), Meta Business account + WhatsApp
> Cloud API app, oru domain/subdomain (e.g. `crm.shinysoftwares.in`).

---

## 1. GitHub-la repo upload

```bash
cd wacrm
git remote rename origin upstream          # original ArnasDon/wacrm — future updates-ku
git remote add origin https://github.com/<your-username>/nixie-wa-crm.git
git push -u origin main
```

- Repo-va **Private**-aa vachukonga (Settings → General → Danger zone → Change visibility).
- Upstream update venumna: `git fetch upstream && git merge upstream/main`.

## 2. Supabase project

1. <https://supabase.com> → **New project** → Region: **Mumbai (ap-south-1)** (India users-ku fast).
   Database password-a safe-aa save pannunga.
2. **Project Settings → API**-la irundhu copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**secret — yaarukkum share pannadheenga**)
3. **Database migrations run pannunga** (ella tables + security rules create aagum).
   Unga computer-la (Node 22 install aagirukkanum):

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>   # URL-la https://<project-ref>.supabase.co
   npx supabase db push                             # 001 → 061 ella migrations-um order-la apply aagum
   ```

   CLI illama: Supabase → **SQL Editor**-la `supabase/migrations/` folder files-a
   **number order-la** (001, 002 … 060, 061) oru oru-aa paste panni **Run** pannunga.

4. **Authentication → Sign In / Providers → Email**: **"Allow new users to sign up" OFF** pannunga.
   (Public signup close — unga team mattum dhaan login panna mudiyum.)
5. **Authentication → URL Configuration**:
   - Site URL: `https://crm.shinysoftwares.in`
   - Redirect URLs: `https://crm.shinysoftwares.in/auth/callback`
6. **First owner login create**: **Authentication → Users → Add user → Create new user** →
   unga email + strong password → **Auto Confirm User** tick → Create.
   Indha first user automatic-aa **Owner** aagiduvaanga.

## 3. Secrets generate

Unga computer-la:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # → ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # → AUTOMATION_CRON_SECRET
```

> `ENCRYPTION_KEY`-a deploy aana appuram **maatha koodaadhu** — maathina
> WhatsApp token decrypt aagaadhu, thirumba save pannanum.

## 4. Hostinger-la deploy

1. hPanel → **Websites → Add Website → Node.js web app**.
2. **Connect with GitHub** → Hostinger GitHub App install → unga repo select → **Deploy**.
3. Settings check pannunga:
   | Field | Value |
   | --- | --- |
   | Framework | **Next.js** (auto-detect aagum) |
   | Branch | `main` |
   | Node version | **22** (24-um ok; 18/20 work aagaadhu — Next 16 ku 22.12+ venum) |
   | Build command | `npm run build` |
   | Start | `npm start` |
4. **Environment variables** (build-ku **munnadi** add pannunga — `NEXT_PUBLIC_*` build time-la dhaan eduthukkum):

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
   | `ENCRYPTION_KEY` | step 3 hex |
   | `META_APP_SECRET` | Meta App → Settings → Basic → App secret |
   | `META_APP_ID` | Meta App ID (image-header templates-ku) |
   | `NEXT_PUBLIC_SITE_URL` | `https://crm.shinysoftwares.in` (trailing `/` illama) |
   | `NEXT_PUBLIC_SIGNUP_MODE` | `closed` |
   | `NEXT_PUBLIC_APP_NAME` | `Nixie WA-CRM` (venumna maathalaam) |
   | `AUTOMATION_CRON_SECRET` | step 3 secret |
   | `ALLOWED_INVITE_HOSTS` | `crm.shinysoftwares.in` |

5. **Domain** connect panni **SSL** on pannunga (AutoSSL 1–2 nimisham edukkum). WhatsApp webhook-ku HTTPS kandippa venum.
6. Deploy mudinjadhum `https://crm.shinysoftwares.in/login` open panni step 2.6 login-la sign in.
   **Settings → Your profile**-la unga name update pannunga.

> Build fail aana (memory): hPanel-la app restart panni redeploy; Hostinger
> build-ku ~2 GB RAM recommend pannuranga.

## 5. Meta WhatsApp Cloud API connect

1. <https://developers.facebook.com> → unga App → **WhatsApp → API Setup**: **Phone Number ID**, **WABA ID** copy.
2. **Business Settings → Users → System users** → system user create (Admin) → **Generate token** →
   permissions: `whatsapp_business_messaging`, `whatsapp_business_management` → **Never expire**.
3. CRM-la **Settings → WhatsApp**: Phone Number ID, WABA ID, token paste; oru **verify token** (unga sondha random word) type; production number-na **2-step PIN**; **Save Configuration**.
4. Meta → **WhatsApp → Configuration → Webhook**:
   - Callback URL: `https://crm.shinysoftwares.in/api/whatsapp/webhook`
   - Verify token: step 3-la type panna adhe word
   - **Verify and save** → **Webhook fields → `messages` Subscribe**.
5. CRM-la **Verify with Meta** click — ella checks green aaganum. Unga phone-la irundhu test message anuppi Inbox-la varudhaa paarunga.

## 6. Apps setup (Nixie, payment app …)

**Settings → Apps → New app** — oru oru product-kum (e.g. *Nixie CRM* `nixie-crm`,
*MoneyCtrl* `moneyctrl`). Tag + sales pipeline automatic-aa create aagum.
Mela top bar switcher-la app select panna Contacts / Inbox / Broadcasts / Pipelines
ellam andha app-ku mattum filter aagum.

**Unga app-oda signup-la irundhu leads auto-va varanumna:**
Settings → API keys → `contacts:write` scope-oda key create → unga app **server**-la irundhu:

```bash
curl -X POST https://crm.shinysoftwares.in/api/v1/contacts \
  -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" \
  -d '{"phone":"+919876543210","name":"Customer","app":"nixie-crm"}'
```

`app` additive — vera app-la irukkura contact-oda membership pogaadhu.
Automations-la **"Tag added" → Nixie CRM tag** trigger vechaa welcome template udane pogum.

## 7. Cron (automation "Wait" steps + flow timeouts)

hPanel → **Advanced → Cron Jobs** (illa free <https://cron-job.org> — custom header support irukku), every minute:

```
* * * * * curl -s -H "x-cron-secret: <AUTOMATION_CRON_SECRET>" https://crm.shinysoftwares.in/api/automations/cron > /dev/null
* * * * * curl -s -H "x-cron-secret: <AUTOMATION_CRON_SECRET>" https://crm.shinysoftwares.in/api/flows/cron > /dev/null
```

(hPanel cron app env vars-a read pannaadhu — secret-a literal-aa paste pannanum.)

## 8. Security checklist ✅

Indha fork-la already on:
- **Public signup closed** (`NEXT_PUBLIC_SIGNUP_MODE=closed` + Supabase signup OFF).
- **Google indexing block**: `robots.txt` Disallow all, ella responses-ilum `X-Robots-Tag: noindex, nofollow, noarchive`, pages-la `noindex` meta.
- **CSP enforced**, HSTS, `X-Frame-Options: DENY`, COOP, `X-Powered-By` hidden.
- Row Level Security ella tables-ilum; WhatsApp token AES-256-GCM encrypted; webhook HMAC verify.

Deploy appuram check:

```bash
curl -sI https://crm.shinysoftwares.in/login | grep -iE "x-robots|content-security|strict-transport"
curl -s https://crm.shinysoftwares.in/robots.txt
```

Unga pakkam pannavendiyadhu:
- Supabase **Authentication → Rate limits** default-ae vechukonga; owner account-ku strong password.
- Team member vela vittaa **Settings → Team members**-la remove + Supabase Users-la delete.
- Pazhaya API keys revoke pannunga.
- Domain munnaadi Google-la index aagirundha: Google Search Console → **Removals** → URL prefix remove request.
- Supabase **Database → Backups** (Pro plan) illa weekly `npx supabase db dump` eduthu vechukonga.

## 9. Update / redeploy

```bash
git pull                 # illa: git fetch upstream && git merge upstream/main
git push origin main     # Hostinger auto rebuild pannum
```

Pudhu migration files vandha → `npx supabase db push` (illa SQL Editor-la pudhu files mattum run).

## Problem vandha

| Prachanai | Theervu |
| --- | --- |
| Login aana udane thirumba login page | Supabase URL Configuration-la domain + `/auth/callback` correct-aa? |
| Webhook verify fail | Verify token match aagudhaa; `META_APP_SECRET` set aagirukkaa |
| Messages Inbox-la varala | Meta webhook `messages` subscribed? **Verify with Meta** run pannunga |
| "Stored token can't be decrypted" | `ENCRYPTION_KEY` maaridichu — Reset Configuration panni token thirumba save |
| Page blank / blocked resource | `CSP_REPORT_ONLY=true` vechu redeploy, browser console-la blocked URL paarunga |
| Apps menu-la error | Migration 060/061 apply aagala — `npx supabase db push` |
