import { Resend } from 'resend';

function getClient() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

const APP_NAME = 'Kitchen Keeper';

export async function sendHouseholdInvite({ toEmail, householdName, joinCode }) {
  const client = getClient();
  if (!client) {
    const err = new Error('Email service is not configured — set RESEND_API_KEY');
    err.status = 503;
    throw err;
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  const appUrl    = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
  const joinLink  = `${appUrl}/join?code=${joinCode}`;

  await client.emails.send({
    from:    `${APP_NAME} <${fromEmail}>`,
    to:      toEmail,
    subject: `You're invited to join a ${APP_NAME} household`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1f2937">
        <h1 style="font-size:22px;font-weight:700;color:#ea580c;margin:0 0 8px">${APP_NAME}</h1>
        <p style="margin:0 0 24px;color:#6b7280">
          You've been invited to join the <strong>${householdName}</strong> household on ${APP_NAME}.
        </p>

        <div style="text-align:center;margin-bottom:24px">
          <a href="${joinLink}"
             style="display:inline-block;padding:14px 28px;background:#ea580c;color:#fff;font-weight:700;font-size:16px;border-radius:10px;text-decoration:none">
            Join household
          </a>
        </div>

        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px">
          <p style="margin:0 0 6px;font-size:13px;color:#9a3412;font-weight:600;letter-spacing:.05em;text-transform:uppercase">Or enter the code manually</p>
          <p style="margin:0;font-size:32px;font-weight:700;letter-spacing:.2em;color:#c2410c;font-family:monospace">${joinCode}</p>
        </div>

        <p style="margin:0;font-size:13px;color:#9ca3af">
          ${APP_NAME} helps families track their pantry, reduce food waste, and plan meals together.
        </p>
      </div>
    `,
  });
}
