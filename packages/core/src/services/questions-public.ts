import 'server-only'
import { createHash } from 'node:crypto'
import { dbFor, type Brand } from '@femi9/db'
import { sendEmailNotification } from './notifications'

/**
 * "Ask a question" from the product page.
 *
 * A question is not a review: it has no rating, it must never appear on the
 * storefront, and it needs a human to answer rather than a moderator to
 * approve. So it does not touch the Review table — it goes straight to the
 * support inbox through the same audited, deduplicated mailer the rest of the
 * app uses, which means a delivery failure is recorded in NotificationLog
 * rather than silently swallowed.
 */

export class ProductNotFoundError extends Error {
  constructor(slug: string) {
    super(`Product not found: ${slug}`)
    this.name = 'ProductNotFoundError'
  }
}

export interface QuestionInput {
  name: string
  email: string
  question: string
}

/** Support inbox. Falls back to the admin address the console already uses. */
function supportInbox(): string | null {
  const to = process.env.SUPPORT_EMAIL?.trim() || process.env.ADMIN_EMAIL?.trim()
  return to || null
}

/**
 * Escape text destined for the HTML body. The name and question are shopper
 * input arriving verbatim in an email a colleague opens, so an unescaped `<`
 * would let a submission inject markup into staff mail.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Email a product question to support. Resolves the slug first so a forged or
 * stale product reference is rejected rather than mailed on.
 *
 * Returns whether the mail actually went out; the caller answers 200 either way
 * once the input is valid, because a shopper cannot act on our SMTP problems
 * and the attempt is durably logged regardless.
 */
export async function submitQuestion(brand: Brand, 
  productSlug: string,
  input: QuestionInput,
): Promise<{ sent: boolean }> {
  const prisma = dbFor(brand)
  const product = await prisma.product.findUnique({
    where: { slug: productSlug },
    select: { name: true },
  })
  if (!product) throw new ProductNotFoundError(productSlug)

  const to = supportInbox()
  // Nothing to send to. Reported to the caller rather than thrown: the shopper
  // did nothing wrong, and a 500 would tell her to try again forever.
  if (!to) return { sent: false }

  // Same shopper asking the same thing twice about the same product is one
  // question, not two. Hashed so the key stays a fixed length regardless of how
  // long the question ran.
  const dedupeKey =
    'product-question:' +
    createHash('sha256')
      .update(`${productSlug}|${input.email.toLowerCase()}|${input.question.trim()}`)
      .digest('hex')
      .slice(0, 40)

  const subject = `Product question — ${product.name}`
  const text = [
    `Product: ${product.name} (${productSlug})`,
    `From: ${input.name} <${input.email}>`,
    '',
    input.question,
  ].join('\n')
  const html = [
    `<p><strong>Product:</strong> ${esc(product.name)} (${esc(productSlug)})</p>`,
    `<p><strong>From:</strong> ${esc(input.name)} &lt;${esc(input.email)}&gt;</p>`,
    `<p style="white-space:pre-wrap">${esc(input.question)}</p>`,
  ].join('')

  const res = await sendEmailNotification(brand, {
    to,
    subject,
    html,
    text,
    template: 'product-question',
    dedupeKey,
  })
  return { sent: res.sent }
}
