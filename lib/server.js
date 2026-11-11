export const DEFAULT_RECEIVER_EMAIL = 'gymzai@rasinnovatech.com';
export const DEFAULT_SENDER_EMAIL = 'GymZ AI <gymzai@rasinnovatech.com>';

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function isValidEmail(email) {
  return typeof email === 'string' && email.length > 0 && email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Applies CORS headers, handles OPTIONS preflight, rejects non-POST requests,
 * and returns the parsed JSON body (or null if a response was already sent).
 */
export function parsePostRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return null;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return null;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ error: 'Invalid JSON payload' });
      return null;
    }
  }

  return body && typeof body === 'object' ? body : {};
}

export function getRequestMetadata(req) {
  const headers = req?.headers || {};
  const meta = {};
  if (headers.referer) meta.referer = String(headers.referer).slice(0, 500);
  if (headers['user-agent']) meta.userAgent = String(headers['user-agent']).slice(0, 300);
  if (headers['x-vercel-ip-country']) meta.country = String(headers['x-vercel-ip-country']);
  return meta;
}

export function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Calls Supabase PostgREST using the server-only service_role key.
 */
export async function supabaseRest(path, { method = 'GET', headers = {}, body } = {}) {
  const baseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  return { ok: response.ok, status: response.status, data };
}

export function renderEmailShell({ title, rows, bodySectionHtml = '', ctaHtml = '' }) {
  const rowsHtml = rows
    .map(
      ({ label, valueHtml }) => `
        <tr>
          <td style="padding: 8px 0; color: #666; width: 110px;"><strong>${escapeHtml(label)}:</strong></td>
          <td style="padding: 8px 0; color: #111;">${valueHtml}</td>
        </tr>`
    )
    .join('');

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eaeaea; border-radius: 12px; background: #ffffff; color: #111;">
      <div style="border-bottom: 2px solid #f96500; padding-bottom: 16px; margin-bottom: 20px;">
        <h2 style="margin: 0; color: #f96500; font-size: 22px;">${escapeHtml(title)}</h2>
        <p style="margin: 4px 0 0; color: #666; font-size: 13px;">RasInnovatech Deep-Tech Sports Engineering</p>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px;">
        ${rowsHtml}
      </table>
      ${bodySectionHtml}
      ${ctaHtml ? `<div style="text-align: center; margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee;">${ctaHtml}</div>` : ''}
    </div>
  `;
}

/**
 * Dispatches transactional notification email via Resend, SMTP (Nodemailer), or Web3Forms.
 * Never throws; callers decide how to handle failures alongside database persistence.
 */
export async function sendEmailNotification({ senderLabel, replyTo, subject, html, web3Fields = {} }) {
  const recipient = process.env.CONTACT_RECEIVER_EMAIL || DEFAULT_RECEIVER_EMAIL;

  try {
    if (process.env.RESEND_API_KEY) {
      const fromEmail = process.env.EMAIL_FROM || DEFAULT_SENDER_EMAIL;
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [recipient],
          reply_to: replyTo,
          subject,
          html
        })
      });

      if (!resendResponse.ok) {
        const errText = await resendResponse.text();
        console.error('Resend API error:', errText);
        return { attempted: true, dispatched: false, provider: 'resend', error: errText };
      }

      const resendData = await resendResponse.json();
      return { attempted: true, dispatched: true, provider: 'resend', id: resendData.id };
    }

    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });

      await transporter.sendMail({
        from: `"${senderLabel}" <${process.env.SMTP_USER}>`,
        replyTo,
        to: recipient,
        subject,
        html
      });

      return { attempted: true, dispatched: true, provider: 'smtp' };
    }

    if (process.env.WEB3FORMS_ACCESS_KEY) {
      const w3fResponse = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_key: process.env.WEB3FORMS_ACCESS_KEY,
          email: replyTo,
          subject,
          from_name: 'GymZ AI Landing Page',
          ...web3Fields
        })
      });

      const w3fData = await w3fResponse.json();
      if (!w3fData.success) {
        return { attempted: true, dispatched: false, provider: 'web3forms', error: JSON.stringify(w3fData) };
      }
      return { attempted: true, dispatched: true, provider: 'web3forms' };
    }

    return { attempted: false, dispatched: false, provider: null };
  } catch (err) {
    console.error('Email notification exception:', err);
    return { attempted: true, dispatched: false, provider: 'exception', error: err.message };
  }
}

