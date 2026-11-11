import {
  escapeHtml,
  getRequestMetadata,
  isSupabaseConfigured,
  isValidEmail,
  normalizeEmail,
  parsePostRequest,
  renderEmailShell,
  sendEmailNotification,
  supabaseRest
} from '../lib/server.js';

const SPOT_OFFSET = 740;

const ALLOWED_ROLES = new Set([
  'Athlete',
  'Coach or trainer',
  'Gym owner',
  'Developer',
  'Investor or accelerator'
]);

function toSpotNumber(rowId) {
  const num = Number(rowId);
  return Number.isFinite(num) && num > 0 ? SPOT_OFFSET + num : null;
}

export default async function handler(req, res) {
  const body = parsePostRequest(req, res);
  if (!body) return;

  try {
    const email = normalizeEmail(body.email);
    const role = String(body.role || 'Athlete').trim();

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    if (!ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ error: 'Please select a valid role.' });
    }

    let persisted = false;
    let alreadyRegistered = false;
    let registeredRole = role;
    let spot = null;
    let dbError = null;

    if (isSupabaseConfigured()) {
      try {
        const metadata = getRequestMetadata(req);
        const insertRes = await supabaseRest('beta_waitlist', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: {
            email,
            role,
            source: 'landing_modal',
            metadata
          }
        });

        if (insertRes.ok && Array.isArray(insertRes.data) && insertRes.data[0]) {
          persisted = true;
          spot = toSpotNumber(insertRes.data[0].id);
          registeredRole = insertRes.data[0].role || role;
        } else if (insertRes.status === 409 || insertRes.data?.code === '23505') {
          const lookupRes = await supabaseRest(
            `beta_waitlist?email=eq.${encodeURIComponent(email)}&select=id,role,status&limit=1`
          );

          if (lookupRes.ok && Array.isArray(lookupRes.data) && lookupRes.data[0]) {
            persisted = true;
            alreadyRegistered = true;
            spot = toSpotNumber(lookupRes.data[0].id);
            registeredRole = lookupRes.data[0].role || role;
          }
        } else {
          dbError = `Supabase error (${insertRes.status})`;
          console.error('Supabase beta_waitlist insert failed:', insertRes.status, insertRes.data);
        }
      } catch (err) {
        dbError = err.message;
        console.error('Supabase beta_waitlist exception:', err);
      }
    }

    // Dispatch notification email for new signups (or when DB write failed so zero leads are lost)
    let emailResult = { attempted: false, dispatched: false, provider: null };
    if (!alreadyRegistered) {
      const spotLabel = spot ? `#${spot}` : 'Pending';
      const subject = `[GymZ AI Waitlist] New ${registeredRole} signup (${spotLabel})`;
      const html = renderEmailShell({
        title: 'GymZ AI — New Beta Waitlist Signup',
        rows: [
          { label: 'Email', valueHtml: `<a href="mailto:${escapeHtml(email)}" style="color: #f96500; text-decoration: none;">${escapeHtml(email)}</a>` },
          { label: 'Role', valueHtml: `<span style="display: inline-block; background: #fff2e8; color: #f96500; padding: 3px 10px; border-radius: 6px; font-weight: 600; font-size: 12px;">${escapeHtml(registeredRole)}</span>` },
          { label: 'Spot', valueHtml: escapeHtml(spotLabel) },
          { label: 'Saved in DB', valueHtml: persisted ? 'Yes (Supabase)' : 'No (email fallback)' },
          { label: 'Date', valueHtml: escapeHtml(new Date().toUTCString()) }
        ]
      });

      emailResult = await sendEmailNotification({
        senderLabel: 'GymZ AI Waitlist',
        replyTo: email,
        subject,
        html,
        web3Fields: { name: registeredRole, topic: `Beta Waitlist (${spotLabel})`, message: `Waitlist signup from ${email} as ${registeredRole}` }
      });
    }

    if (!persisted && (!emailResult.attempted || !emailResult.dispatched)) {
      if (dbError || emailResult.attempted) {
        return res.status(500).json({
          error: 'Unable to save waitlist signup right now. Please try again shortly.'
        });
      }

      console.log('[GymZ AI Waitlist - Preview Mode]', { email, role: registeredRole });
      return res.status(200).json({
        success: true,
        spot: null,
        alreadyRegistered: false,
        email,
        role: registeredRole,
        persisted: false,
        emailDispatched: false,
        provider: 'mock'
      });
    }

    return res.status(200).json({
      success: true,
      spot,
      alreadyRegistered,
      email,
      role: registeredRole,
      persisted,
      emailDispatched: emailResult.dispatched,
      provider: persisted ? 'supabase' : (emailResult.provider || 'resend')
    });
  } catch (error) {
    console.error('Waitlist handler exception:', error);
    return res.status(500).json({ error: 'Server error processing waitlist request', message: error.message });
  }
}

