import 'server-only'
import { createVerify, type KeyObject, createPublicKey } from 'node:crypto'

/**
 * Amazon SNS message verification, for the SES event feed.
 *
 * SES does not sign webhooks the way Resend does. Its configuration set
 * publishes delivery events to an SNS topic, SNS POSTs them to an HTTPS
 * endpoint, and the authenticity of that POST rests on an RSA signature over a
 * canonical string, checked against a certificate SNS names in the message.
 *
 * ── Why every check below is load-bearing ──────────────────────────────────
 * The endpoint is public and unauthenticated by construction: SNS will not send
 * a bearer token, and the body says what it wants to say. Anyone can POST to
 * it. Without verification, "this address hard-bounced" is a sentence any
 * stranger can say about any customer — and acting on it means suppressing mail
 * to a paying shopper who never bounced anything.
 *
 * Three things are checked, and skipping any one of them makes the other two
 * decorative:
 *
 *  1. The SIGNATURE, over the canonical string SNS defines per message type.
 *  2. The CERTIFICATE'S HOST. The message names the URL its certificate is
 *     fetched from, so an unvalidated fetch means the attacker chooses the key
 *     that verifies their own signature. Only `sns.<region>.amazonaws.com` (and
 *     the China partition) is accepted.
 *  3. The TOPIC ARN, against the one this deployment expects. A valid signature
 *     only proves AWS sent it — not that it came from OUR topic rather than
 *     from any SNS topic in any AWS account, including one the caller made.
 *
 * ── Subscription confirmation ──────────────────────────────────────────────
 * A new HTTPS subscription is pending until somebody GETs the SubscribeURL in
 * the first message. That is a live URL that arrives in an unauthenticated POST
 * body, so it is fetched only after all three checks pass — otherwise the
 * endpoint is a proxy that will fetch any URL an attacker puts in a body.
 */

export type SnsMessageType = 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation'

export interface SnsEnvelope {
  Type?: string
  MessageId?: string
  Token?: string
  TopicArn?: string
  Subject?: string
  Message?: string
  SubscribeURL?: string
  Timestamp?: string
  SignatureVersion?: string
  Signature?: string
  SigningCertURL?: string
  SigningCertUrl?: string
}

/** The fields, IN ORDER, that each message type signs. */
const SIGNED_FIELDS: Record<SnsMessageType, string[]> = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
}

/** `sns.ap-south-1.amazonaws.com` and nothing else. */
function isSnsCertHost(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(url.hostname)
  )
}

// One fetch per certificate, not per message: SNS rotates them rarely and a
// bounce storm is exactly when the endpoint should not be making an outbound
// request per event.
const certCache = new Map<string, KeyObject>()

async function signingKey(certUrl: string): Promise<KeyObject | null> {
  const cached = certCache.get(certUrl)
  if (cached) return cached

  let url: URL
  try {
    url = new URL(certUrl)
  } catch {
    return null
  }
  if (!isSnsCertHost(url)) return null

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return null
    const key = createPublicKey(await res.text())
    certCache.set(certUrl, key)
    return key
  } catch {
    return null
  }
}

function canonicalString(msg: SnsEnvelope, type: SnsMessageType): string {
  let out = ''
  for (const field of SIGNED_FIELDS[type]) {
    const value = (msg as Record<string, unknown>)[field]
    // Absent fields are SKIPPED, not written empty — `Subject` is optional on a
    // Notification, and including it as "" produces a string that will never
    // verify while looking perfectly reasonable in a log.
    if (typeof value !== 'string') continue
    out += `${field}\n${value}\n`
  }
  return out
}

export interface VerifyOptions {
  /** The topic this deployment accepts events from. Required: a signature
   *  proves AWS sent it, not that it is ours. */
  expectedTopicArn: string
}

/**
 * Verify an SNS envelope. Returns the message type on success, null otherwise.
 *
 * Deliberately returns null rather than throwing or explaining: the caller
 * answers a flat 400, and a public endpoint that says WHY a signature failed is
 * an oracle for constructing one that does not.
 */
export async function verifySnsMessage(
  msg: SnsEnvelope,
  { expectedTopicArn }: VerifyOptions,
): Promise<SnsMessageType | null> {
  const type = msg.Type as SnsMessageType | undefined
  if (!type || !(type in SIGNED_FIELDS)) return null
  if (!msg.Signature || !msg.TopicArn) return null
  if (!expectedTopicArn || msg.TopicArn !== expectedTopicArn) return null

  // SignatureVersion 1 is SHA1, 2 is SHA256. Both are current in SNS; anything
  // else is not a version we know how to check, so it is not verified.
  const algorithm = msg.SignatureVersion === '2' ? 'RSA-SHA256' : msg.SignatureVersion === '1' ? 'RSA-SHA1' : null
  if (!algorithm) return null

  const key = await signingKey(msg.SigningCertURL ?? msg.SigningCertUrl ?? '')
  if (!key) return null

  try {
    const verifier = createVerify(algorithm)
    verifier.update(canonicalString(msg, type), 'utf8')
    verifier.end()
    return verifier.verify(key, msg.Signature, 'base64') ? type : null
  } catch {
    return null
  }
}

/**
 * Complete a pending HTTPS subscription.
 *
 * Only ever called with a URL from a message that already verified — see the
 * header note about not becoming a URL fetcher for strangers.
 */
export async function confirmSnsSubscription(subscribeUrl: string): Promise<boolean> {
  try {
    const url = new URL(subscribeUrl)
    if (!isSnsCertHost(url)) return false
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    return res.ok
  } catch {
    return false
  }
}

// ── The SES event itself ─────────────────────────────────────────────────────
// SNS carries it as a JSON STRING in `Message`, so the payload is parsed twice:
// once for the envelope, once for what SES actually said.

export interface SesDeliveryEvent {
  /** SES calls this eventType on a config-set destination and notificationType
   *  on a legacy identity notification. Both shapes arrive in the wild. */
  kind: 'bounce' | 'complaint' | 'delivery' | 'other'
  /** Only meaningful for a bounce: a soft bounce is a full mailbox, not a bad
   *  address, and suppressing on one loses a real customer. */
  permanent: boolean
  recipients: string[]
  /** Short human-readable reason for the log. */
  detail?: string
}

interface SesMessageShape {
  eventType?: string
  notificationType?: string
  bounce?: {
    bounceType?: string
    bounceSubType?: string
    bouncedRecipients?: { emailAddress?: string; diagnosticCode?: string }[]
  }
  complaint?: {
    complaintFeedbackType?: string
    complainedRecipients?: { emailAddress?: string }[]
  }
  delivery?: { recipients?: string[] }
  mail?: { destination?: string[] }
}

/** Parse the SES payload carried inside a verified SNS `Message`. */
export function parseSesEvent(raw: string): SesDeliveryEvent | null {
  let body: SesMessageShape
  try {
    body = JSON.parse(raw)
  } catch {
    return null
  }

  const type = (body.eventType ?? body.notificationType ?? '').toLowerCase()
  const clean = (list: (string | undefined)[]) =>
    list.filter((a): a is string => Boolean(a)).map((a) => a.trim().toLowerCase())

  if (type === 'bounce') {
    const bounce = body.bounce ?? {}
    return {
      kind: 'bounce',
      // Only `Permanent` is a dead address. `Transient` is a full mailbox or a
      // greylist, and `Undetermined` is exactly what it says.
      permanent: bounce.bounceType === 'Permanent',
      recipients: clean((bounce.bouncedRecipients ?? []).map((r) => r.emailAddress)),
      detail: [bounce.bounceType, bounce.bounceSubType].filter(Boolean).join('/') || undefined,
    }
  }

  if (type === 'complaint') {
    const complaint = body.complaint ?? {}
    return {
      kind: 'complaint',
      permanent: true, // Somebody pressed "this is spam". Never mail them again.
      recipients: clean((complaint.complainedRecipients ?? []).map((r) => r.emailAddress)),
      detail: complaint.complaintFeedbackType,
    }
  }

  if (type === 'delivery') {
    return {
      kind: 'delivery',
      permanent: false,
      recipients: clean(body.delivery?.recipients ?? body.mail?.destination ?? []),
    }
  }

  return { kind: 'other', permanent: false, recipients: clean(body.mail?.destination ?? []), detail: type || undefined }
}
