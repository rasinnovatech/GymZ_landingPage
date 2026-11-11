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

const ALLOWED_TOPICS = new Set([
  'Partnership or gym pilot',
  'Investment or accelerator',
  'Press',
  'App support',
  'General'
]);

export default async function handler(req, res) {
  const body = parsePostRequest(req, res);
  if (!body) return;

  try {
    const name = String(body.name || '').trim();
    const email = normalizeEmail(body.email);
    const rawTopic = String(body.topic || '').trim();
    const topic = ALLOWED_TOPICS.has(rawTopic) ? rawTopic : 'General';
    const message = String(body.message || '').trim();

    if (!name || !isValidEmail(email) || !message) {
      return res.status(400).json({ error: 'Please provide a valid name, email, and message.' });
    }

    const emailSubject = `[GymZ AI Contact] ${topic} from ${name}`;
    const bodySectionHtml = `
      <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 18px; margin-bottom: 24px;">
        <strong style="display: block; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #666; margin-bottom: 10px;">Message:</strong>
        <div style="font-size: 15px; line-height: 1.6; color: #222; white-space: pre-wrap;">${escapeHtml(message)}</div>
      </div>
    `;

    const htmlContent = renderEmailShell({
      title: 'GymZ AI — New Contact Submission',
      rows: [
        { label: 'Name', valueHtml: escapeHtml(name) },
        { label: 'Email', valueHtml: `<a href="mailto:${escapeHtml(email)}" style="color: #f96500; text-decoration: none;">${escapeHtml(email)}</a>` },
        { label: 'Topic', valueHtml: `<span style="display: inline-block; background: #fff2e8; color: #f96500; padding: 3px 10px; border-radius: 6px; font-weight: 600; font-size: 12px;">${escapeHtml(topic)}</span>` },
        { label: 'Date', valueHtml: escapeHtml(new Date().toUTCString()) }
      ],
      bodySectionHtml,
      ctaHtml: `<a href="mailto:${escapeHtml(email)}?subject=Re: ${encodeURIComponent(emailSubject)}" style="display: inline-block; background: #f96500; color: #ffffff; text-decoration: none; font-weight: bold; font-size: 14px; padding: 10px 22px; border-radius: 8px;">Reply to ${escapeHtml(name)}</a>`
    });

    const emailResult = await sendEmailNotification({
      senderLabel: `${name} via GymZ AI`,
      replyTo: email,
      subject: emailSubject,
      html: htmlContent,
      web3Fields: { name, topic, message }
    });

    let persisted = false;
    let submissionId = null;

    if (isSupabaseConfigured()) {
      const metadata = getRequestMetadata(req);
      if (emailResult.provider) metadata.emailProvider = emailResult.provider;
      if (rawTopic && rawTopic !== topic) metadata.submittedTopic = rawTopic;

      try {
        const dbRes = await supabaseRest('contact_submissions', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: {
            name,
            email,
            topic,
            message,
            email_dispatched: emailResult.dispatched,
            metadata
          }
        });

        if (dbRes.ok && Array.isArray(dbRes.data) && dbRes.data[0]) {
          persisted = true;
          submissionId = dbRes.data[0].id;
        } else {
          console.error('Supabase contact_submissions insert failed:', dbRes.status, dbRes.data);
        }
      } catch (dbErr) {
        console.error('Supabase contact_submissions exception:', dbErr);
      }
    }

    if (!persisted && emailResult.attempted && !emailResult.dispatched) {
      return res.status(500).json({
        error: 'Failed to dispatch message',
        details: emailResult.error
      });
    }

    if (!persisted && !emailResult.attempted) {
      console.log('[GymZ AI Contact Form - Preview Mode]', { name, email, topic });
      return res.status(200).json({
        success: true,
        provider: 'mock',
        persisted: false,
        emailDispatched: false,
        message: 'Message logged in preview mode. Configure Vercel Environment Variables to persist to Supabase and send emails.'
      });
    }

    return res.status(200).json({
      success: true,
      id: emailResult.id || submissionId,
      persisted,
      emailDispatched: emailResult.dispatched,
      provider: emailResult.provider || 'supabase'
    });
  } catch (error) {
    console.error('Contact handler exception:', error);
    return res.status(500).json({ error: 'Server error processing contact request', message: error.message });
  }
}
