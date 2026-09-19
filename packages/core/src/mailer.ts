import 'server-only'
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import type { Brand } from '@femi9/db'
import {
  emailFromFor,
  mailProviderFor,
  replyToFor,
  resendKeyFor,
  sesConfigurationSetFor,
  sesRegionFor,
} from './mail-identity'

/**
 * The one place a transactional email leaves this platform.
 *
 * Before this file there were three: `otp.ts` posted a sign-in link to Resend,
 * `services/notifications.ts` posted order and contact mail to Resend, and
 * `thara/invite.ts` posted invitations to Resend — each with its own copy of
 * the fetch, its own error string and its own idea of what "configured" means.
 * Three copies is why the note at the top of `thara/invite.ts` promised that
 * "any future switch from Resend to SES is a single-file swap" and was wrong.
 * It is one file now, and this is it.
 *
 * ── Two providers ──────────────────────────────────────────────────────────
 * Which one a brand uses is decided in `mail-identity.ts` and nowhere else.
 * Lumi9 sends through SES; Femi9 is live on Resend and stays there. Callers
 * pass a message and a brand; nothing above this line knows the difference.
 *
 * ── SES has no API key ─────────────────────────────────────────────────────
 * It authenticates with the task's IAM role (infra/terraform/ses.tf grants
 * `ses:SendEmail` on one identity and one configuration set), so there is no
 * credential in the environment to leak, rotate or seed with a placeholder. On
 * a laptop the SDK finds whatever profile is configured, and finds nothing in
 * CI — which is why `ALLOW_MOCK_PROVIDERS` exists and why every caller checks
 * `mailConfigured()` before arriving here.
 *
 * ── Failure is thrown, never swallowed ─────────────────────────────────────
 * `sendEmailNotification` writes a NotificationLog row and needs the reason to
 * put in it; `sendMagicLink` must not tell a shopper to check her inbox for a
 * link that was never sent. So this throws with the provider and the provider's
 * own message, and each caller decides what that means.
 */

export interface OutboundMail {
  to: string
  subject: string
  html: string
  /** Plain-text alternative. Always worth having: a message with no text part
   *  scores worse with every spam filter, and some clients render nothing. */
  text?: string
}

/** Thrown when the provider refused the message. Carries which provider. */
export class MailSendError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'MailSendError'
  }
}

// One client per region, created on first use. The SDK holds a connection pool,
// so building one per message would open a new TLS session for every email.
const sesClients = new Map<string, SESv2Client>()

function sesClient(region: string | undefined): SESv2Client {
  const key = region ?? 'default'
  let client = sesClients.get(key)
  if (!client) {
    client = new SESv2Client(region ? { region } : {})
    sesClients.set(key, client)
  }
  return client
}

/**
 * Send one message as `brand`. Throws `MailSendError` if the provider refuses.
 *
 * Callers must have checked `mailConfigured(brand)` first — this throws rather
 * than mocking, because a silent no-op is how mail stops arriving without
 * anybody noticing.
 */
export async function sendMail(brand: Brand, mail: OutboundMail): Promise<void> {
  const from = emailFromFor(brand)
  if (!from) throw new MailSendError('none', `No EMAIL_FROM configured for ${brand}`)

  const provider = mailProviderFor(brand)
  if (provider === 'ses') return sendViaSes(brand, from, mail)
  if (provider === 'resend') return sendViaResend(brand, from, mail)
  throw new MailSendError('none', `No mail provider configured for ${brand}`)
}

async function sendViaSes(brand: Brand, from: string, mail: OutboundMail): Promise<void> {
  const replyTo = replyToFor(brand)
  const configurationSet = sesConfigurationSetFor(brand)

  try {
    await sesClient(sesRegionFor(brand)).send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [mail.to] },
        ReplyToAddresses: replyTo ? [replyTo] : undefined,
        // Omitted rather than empty: SES rejects an empty configuration set
        // name, and no config set is a valid (if unmonitored) way to send.
        ConfigurationSetName: configurationSet,
        Content: {
          Simple: {
            Subject: { Data: mail.subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: mail.html, Charset: 'UTF-8' },
              ...(mail.text ? { Text: { Data: mail.text, Charset: 'UTF-8' } } : {}),
            },
          },
        },
      }),
    )
  } catch (err) {
    // The two that will actually happen, and both read as nothing in a log that
    // only records "send failed":
    //
    //   MessageRejected: Email address is not verified — the account is still
    //   in the SES SANDBOX, where it may only send to addresses you have
    //   verified one by one. Every real customer bounces off this. Production
    //   access is a support request, not a setting.
    //
    //   AccessDeniedException — the task role may not send as this identity.
    //   See the ses:FromAddress condition in infra/terraform/ses.tf: it pins
    //   the From address, so changing EMAIL_FROM without changing Terraform
    //   fails here rather than sending as something unverified.
    const name = err instanceof Error ? err.name : 'Error'
    const detail = err instanceof Error ? err.message : String(err)
    throw new MailSendError('ses', `SES refused the message for ${brand} (${name}): ${detail}`, err)
  }
}

async function sendViaResend(brand: Brand, from: string, mail: OutboundMail): Promise<void> {
  const apiKey = resendKeyFor(brand)
  if (!apiKey) throw new MailSendError('resend', `No RESEND_API_KEY configured for ${brand}`)
  const replyTo = replyToFor(brand)

  let res: Response
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        ...(mail.text ? { text: mail.text } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    })
  } catch (err) {
    throw new MailSendError('resend', `Resend was unreachable for ${brand}: ${String(err)}`, err)
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new MailSendError('resend', `Resend returned ${res.status} for ${brand}: ${detail.slice(0, 300)}`)
  }
}
