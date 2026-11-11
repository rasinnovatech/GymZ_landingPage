# GymZ AI landing page

Open `index.html` in a browser. It is one self-contained file: styles, scripts and the food photos are all inside it. It loads Three.js and GSAP + ScrollTrigger from public CDNs, so it needs an internet connection.

`assets/` holds copies of the cropped food photos that are embedded in the page, in case you want to reuse or replace them.

### Features
- **Working Contact Form with Email Dispatch**: Configured to send emails directly to `gymzai@rasinnovatech.com` via a Vercel Serverless Function (`/api/contact.js`).
- **Native Smooth Scrolling**: Clean, high-performance native mouse wheel and trackpad scrolling across all OSes (Linux, Windows, macOS), fully integrated with GSAP ScrollTrigger's scrubbed animations.
- **Android APK Download**: Direct download linked to `app-release.apk` with copyable direct link and Android install instructions.
- **Beta Waitlist**: Fully interactive signup form with input validation, localStorage persistence, and confirmation state.
- **Accessible Modal**: Opens via navigation and hero CTAs, closes cleanly via close button, clicking outside the dialog card, or pressing `Escape`.

---

### Deploying on Vercel & Receiving Emails

When you deploy this project to Vercel, the `api/contact.js` file automatically becomes a live serverless function (`/api/contact`).

#### Step 1: Push or Deploy to Vercel
Deploy the folder via Vercel CLI (`vercel`) or by connecting your GitHub repository to Vercel.

#### Step 2: Add Environment Variables in Vercel
Go to **Vercel Dashboard → Your Project → Settings → Environment Variables** and add:

##### Recommended: Resend (Free 3,000 emails/mo, 1-minute setup)
1. Sign up for free at [Resend.com](https://resend.com).
2. Generate an API Key (starts with `re_...`).
3. In Vercel, add:
   * `RESEND_API_KEY`: `re_your_api_key_here`
   * `CONTACT_RECEIVER_EMAIL`: `gymzai@rasinnovatech.com`
   * `EMAIL_FROM`: `GymZ AI <gymzai@rasinnovatech.com>` (verified domain in Resend)

##### Alternative: Standard SMTP (Gmail, Zoho, Google Workspace, etc.)
* `SMTP_HOST`: `smtp.gmail.com`
* `SMTP_PORT`: `587`
* `SMTP_USER`: `your_account@gmail.com`
* `SMTP_PASS`: `your_app_password`
* `CONTACT_RECEIVER_EMAIL`: `gymzai@rasinnovatech.com`
