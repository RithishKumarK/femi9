import 'server-only'
import type { Brand } from '@femi9/db'
import { sendMail, MailSendError } from '../../mailer'
import { mailConfigured } from '../../mail-identity'

/**
 * Send an admin the details they need to sign in for the first time:
 *
 *   - the login URL of the console they now hold roles on
 *   - a one-time temporary password
 *   - the note that they'll be asked to set their own on first login
 *
 * `mustChangePassword` is set on the account by the caller (see
 * `inviteAdmin`); this function just delivers the credentials. Sent via the
 * brand that owns the invitee's first membership, which is what the invite
 * form's toggle expresses — a Femi9-only invite goes through Femi9's mailer,
 * a Lumi9-only through Lumi9's, both-brands through Femi9's since Resend is
 * the currently-verified sender.
 *
 * Throws `MailSendError` on refusal. The caller decides what that means; the
 * account has ALREADY been created, so an invite whose email failed is a
 * useful state ("re-send invite email" is a natural next action) — never one
 * we want to hide by deleting the account.
 */

export interface AdminInviteEmailInput {
  to: string
  name: string
  tempPassword: string
  /** e.g. `https://admin.femi9.in/login` — the console the invitee first
   *  signs into. Included in the email so a mobile shopper never has to
   *  guess the URL. */
  loginUrl: string
}

export async function sendAdminInviteEmail(
  brand: Brand,
  input: AdminInviteEmailInput,
): Promise<void> {
  if (!mailConfigured(brand)) {
    throw new MailSendError(
      'none',
      `Mail is not configured for ${brand} — cannot send admin invite`,
    )
  }
  const subject = `You've been added to the ${labelFor(brand)} admin console`

  await sendMail(brand, {
    to: input.to,
    subject,
    html: renderHtml(input, brand),
    text: renderText(input, brand),
  })
}

function labelFor(brand: Brand): string {
  return brand === 'femi9' ? 'Femi9' : 'Lumi9'
}

/**
 * Plain-text email — every mail client renders it, and every anti-spam
 * scorer expects a text alternative. Intentionally short, intentionally does
 * not repeat the temp password in caps or coloured HTML.
 */
function renderText(input: AdminInviteEmailInput, brand: Brand): string {
  const brandLabel = labelFor(brand)
  return [
    `Hi ${input.name},`,
    '',
    `You've been added as an admin on the ${brandLabel} console.`,
    '',
    `Sign in here: ${input.loginUrl}`,
    `Email:  ${input.to}`,
    `Temporary password:  ${input.tempPassword}`,
    '',
    `You'll be asked to set your own password the first time you sign in. The temporary password above stops working the moment you change it.`,
    '',
    `If you weren't expecting this email, ignore it and let ${brandLabel} know.`,
  ].join('\n')
}

/** Inline styles only — every serious mail client strips <style> and none
 *  loads external CSS. */
function renderHtml(input: AdminInviteEmailInput, brand: Brand): string {
  const brandLabel = labelFor(brand)
  const accent = brand === 'femi9' ? '#5B3FDA' : '#4F6F52'
  const bg = brand === 'femi9' ? '#F5F0FF' : '#EAF3EC'

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:${bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1e1630;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:white;border-radius:12px;padding:32px;">
            <tr>
              <td>
                <h1 style="margin:0 0 8px;font-size:22px;font-weight:500;color:${accent};">${brandLabel} Ops</h1>
                <p style="margin:0 0 20px;font-size:16px;line-height:1.5;color:#1e1630;">Hi ${escapeHtml(input.name)},</p>
                <p style="margin:0 0 20px;font-size:16px;line-height:1.5;color:#1e1630;">You&rsquo;ve been added as an admin on the ${brandLabel} console. Use the credentials below to sign in for the first time.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};border-radius:10px;padding:20px;margin:0 0 20px;">
                  <tr>
                    <td>
                      <p style="margin:0 0 8px;font-size:13px;color:#544a63;text-transform:uppercase;letter-spacing:0.06em;">Email</p>
                      <p style="margin:0 0 16px;font-family:ui-monospace,monospace;font-size:15px;color:#1e1630;">${escapeHtml(input.to)}</p>
                      <p style="margin:0 0 8px;font-size:13px;color:#544a63;text-transform:uppercase;letter-spacing:0.06em;">Temporary password</p>
                      <p style="margin:0;font-family:ui-monospace,monospace;font-size:17px;color:#1e1630;">${escapeHtml(input.tempPassword)}</p>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 24px;text-align:center;">
                  <a href="${escapeAttr(input.loginUrl)}" style="display:inline-block;background:${accent};color:white;text-decoration:none;padding:12px 28px;border-radius:999px;font-size:14px;font-weight:500;">Sign in to ${brandLabel}</a>
                </p>
                <p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#544a63;">You&rsquo;ll be asked to set your own password the first time you sign in. The temporary password above stops working the moment you change it.</p>
                <p style="margin:0;font-size:13px;line-height:1.5;color:#544a63;">If you weren&rsquo;t expecting this email, ignore it and let ${brandLabel} know.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
function escapeAttr(s: string): string {
  return escapeHtml(s)
}
