import 'server-only'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { dbFor, type Brand } from '@femi9/db'
import { brandConfig } from '../brands'

/**
 * The order receipt, as a PDF.
 *
 * ── What this deliberately is NOT ───────────────────────────────────────────
 * It is not a GST tax invoice. It carries no GSTIN, no HSN codes and no
 * CGST/SGST split, and it says "ORDER RECEIPT" at the top rather than "Tax
 * invoice", because a document that LOOKS like a tax invoice and omits those
 * fields is worse than one that never claimed to be: a customer cannot claim
 * input credit against it, and issuing an incomplete one under a GSTIN is the
 * seller's problem rather than the customer's.
 *
 * The upgrade path is additive on purpose. When the seller's GSTIN, place of
 * supply, rate and per-item HSN exist as data, this file grows a tax block and
 * the title changes — it does not need rewriting. What it must NOT do is
 * back-compute a tax split today and print it next to a blank GSTIN.
 *
 * ── Why the amounts are re-read, never recomputed ───────────────────────────
 * Every number below comes off the Order and OrderItem rows, which snapshot
 * `unitPrice` and `lineTotal` at purchase. A receipt regenerated a year later
 * must show what she actually paid, not what the catalogue charges now — so
 * nothing here touches a Product, a variant or a price zone.
 *
 * ── Why "Rs." and not the rupee sign ────────────────────────────────────────
 * The PDF standard fonts are WinAnsi-encoded and have no glyph for U+20B9.
 * pdf-lib THROWS on encoding it rather than dropping it, so a rupee sign here
 * is a 500 on the download route, not a cosmetic flaw. Embedding a Unicode font
 * would add ~300KB to every PDF to render one character. `Rs.` is what
 * order-whatsapp.ts already prints, for the same reason.
 */

/** Rupees, grouped Indian-style. Matches what the WhatsApp templates print. */
function money(rupees: number): string {
  return `Rs.${Math.round(rupees).toLocaleString('en-IN')}`
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Strip anything the standard fonts cannot encode.
 *
 * Product names, address lines and customer names are free text a human typed:
 * a curly apostrophe pasted out of Word, an emoji in a name, a non-breaking
 * space from a copied address. Any one of them makes pdf-lib throw mid-draw,
 * which turns one bad character in one address into a failed download — and,
 * once the WhatsApp path is live, into a failed order notification.
 *
 * The common typographic characters fold to their ASCII equivalents so the text
 * still reads correctly; everything else is dropped rather than substituted.
 */
function asciiSafe(value: string): string {
  return (value ?? '')
    .replace(/[‘’‚‹›]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[   ]/g, ' ')
    .replace(/₹/g, 'Rs.')
    // WinAnsi covers Latin-1; anything above it, plus control characters, goes.
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    .trim()
}

/** One line of the receipt, as snapshotted at purchase. */
export interface InvoiceLine {
  productName: string
  variantLabel: string
  qty: number
  unitPrice: number
  lineTotal: number
}

/** Everything the PDF prints, resolved once so the renderer touches no db. */
export interface InvoiceData {
  brandName: string
  tagline: string
  host: string
  orderNo: string
  placedAt: Date
  status: string
  customerName: string
  lines: InvoiceLine[]
  subtotal: number
  discount: number
  couponCode: string | null
  shipping: number
  total: number
  address: {
    name: string
    line: string
    city: string
    state: string
    pincode: string
    phone: string
  } | null
}

/**
 * Gather one order into the shape the renderer prints.
 *
 * Returns null for an order that does not exist. Authorisation is the CALLER's
 * job and is deliberately not attempted here: this is reached both by a route
 * that has already checked a session or a capability token, and by the
 * notification path, which has no request to check at all.
 */
export async function buildInvoiceData(brand: Brand, orderNo: string): Promise<InvoiceData | null> {
  const prisma = dbFor(brand)
  const order = await prisma.order.findUnique({
    where: { orderNo },
    select: {
      orderNo: true,
      status: true,
      placedAt: true,
      subtotal: true,
      discount: true,
      shipping: true,
      total: true,
      user: { select: { name: true } },
      coupon: { select: { code: true } },
      address: {
        select: { name: true, line: true, city: true, state: true, pincode: true, phone: true },
      },
      items: {
        orderBy: { id: 'asc' },
        select: {
          productName: true,
          variantLabel: true,
          qty: true,
          unitPrice: true,
          lineTotal: true,
        },
      },
    },
  })
  if (!order) return null

  const config = brandConfig(brand)

  return {
    brandName: config.name,
    tagline: config.tagline,
    host: config.host,
    orderNo: order.orderNo,
    placedAt: order.placedAt,
    status: order.status,
    customerName: order.user?.name?.trim() || order.address?.name?.trim() || 'Customer',
    lines: order.items,
    subtotal: order.subtotal,
    discount: order.discount,
    couponCode: order.coupon?.code ?? null,
    shipping: order.shipping,
    total: order.total,
    // state, pincode and phone are nullable columns - an address captured
    // before those fields were required, or one a courier integration filled in
    // partially. Normalised to '' here so the renderer has one rule for a
    // missing part (skip it) instead of printing "Chennai, null 600001".
    address: order.address
      ? {
          name: order.address.name ?? '',
          line: order.address.line ?? '',
          city: order.address.city ?? '',
          state: order.address.state ?? '',
          pincode: order.address.pincode ?? '',
          phone: order.address.phone ?? '',
        }
      : null,
  }
}

/** The filename both the browser and WhatsApp show. */
export function invoiceFilename(orderNo: string): string {
  return `${orderNo.replace(/[^A-Za-z0-9-]/g, '')}-receipt.pdf`
}

// A4 at 72dpi, the unit pdf-lib works in.
const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 48
const INK = rgb(0.12, 0.13, 0.11)
const MUTED = rgb(0.42, 0.44, 0.4)
const RULE = rgb(0.82, 0.84, 0.8)
const ACCENT = rgb(0.31, 0.44, 0.32) // #4F6F52, the Lumi9 green

// Column anchors for the line-item table. All three are right edges: amounts
// must line up on their last digit, not their first.
const COL_QTY = 360
const COL_UNIT = 450
const COL_AMOUNT = PAGE_W - MARGIN
const TOTALS_LEFT = 330

type Colour = ReturnType<typeof rgb>

interface Ctx {
  page: PDFPage
  regular: PDFFont
  bold: PDFFont
}

function drawLeft(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  size: number,
  opts?: { bold?: boolean; color?: Colour },
): void {
  ctx.page.drawText(asciiSafe(text), {
    x,
    y,
    size,
    font: opts?.bold ? ctx.bold : ctx.regular,
    color: opts?.color ?? INK,
  })
}

function drawRight(
  ctx: Ctx,
  text: string,
  right: number,
  y: number,
  size: number,
  opts?: { bold?: boolean; color?: Colour },
): void {
  const safe = asciiSafe(text)
  const font = opts?.bold ? ctx.bold : ctx.regular
  ctx.page.drawText(safe, {
    x: right - font.widthOfTextAtSize(safe, size),
    y,
    size,
    font,
    color: opts?.color ?? INK,
  })
}

/**
 * Cut a string to fit its column, with an ellipsis.
 *
 * Product names and address lines are seller- and shopper-entered and
 * unbounded; without this a long one runs under the qty column and overlaps the
 * price, which reads as a corrupt file rather than as a long name.
 */
function truncate(font: PDFFont, text: string, size: number, maxWidth: number): string {
  const safe = asciiSafe(text)
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe
  let cut = safe
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > maxWidth) {
    cut = cut.slice(0, -1)
  }
  return `${cut}...`
}

/**
 * Render the receipt.
 *
 * Single page by design. An order with more line items than fit is not
 * something this catalogue can produce today — five sizes of one product — and
 * a paginating layout that is never exercised is a paginating layout that is
 * wrong the first time it runs. Instead the item loop stops above the totals
 * block and prints a count of what it could not show, so an overflowing order
 * degrades to an honest page with correct totals rather than to text drawn on
 * top of them.
 */
export async function renderInvoicePdf(data: InvoiceData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${data.brandName} receipt ${data.orderNo}`)
  pdf.setSubject(`Order receipt for ${data.orderNo}`)
  pdf.setProducer(data.brandName)
  pdf.setCreationDate(data.placedAt)

  const page = pdf.addPage([PAGE_W, PAGE_H])
  const ctx: Ctx = {
    page,
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  }

  let y = PAGE_H - MARGIN

  // ── Masthead ──────────────────────────────────────────────────────────────
  drawLeft(ctx, data.brandName, MARGIN, y - 22, 26, { bold: true, color: ACCENT })
  drawRight(ctx, 'ORDER RECEIPT', COL_AMOUNT, y - 16, 11, { bold: true, color: MUTED })
  y -= 40
  drawLeft(ctx, data.tagline, MARGIN, y, 9.5, { color: MUTED })
  drawRight(ctx, data.host, COL_AMOUNT, y, 9.5, { color: MUTED })

  y -= 22
  page.drawLine({ start: { x: MARGIN, y }, end: { x: COL_AMOUNT, y }, thickness: 1, color: ACCENT })

  // ── Order meta and delivery address, side by side ──────────────────────────
  y -= 26
  const metaTop = y
  drawLeft(ctx, 'ORDER', MARGIN, y, 8.5, { bold: true, color: MUTED })
  drawLeft(ctx, data.orderNo, MARGIN, y - 16, 13, { bold: true })
  drawLeft(ctx, `Placed ${formatDate(data.placedAt)}`, MARGIN, y - 32, 10, { color: MUTED })
  drawLeft(ctx, `Status: ${data.status}`, MARGIN, y - 46, 10, { color: MUTED })
  let metaBottom = y - 46

  if (data.address) {
    let ay = metaTop
    drawLeft(ctx, 'DELIVERED TO', TOTALS_LEFT, ay, 8.5, { bold: true, color: MUTED })
    ay -= 16
    // Built from the parts that exist, so a missing state does not leave a
    // stranded comma and a missing pincode does not leave a trailing space.
    const locality = [data.address.city, data.address.state].filter(Boolean).join(', ')
    for (const line of [
      data.address.name,
      data.address.line,
      [locality, data.address.pincode].filter(Boolean).join(' '),
      data.address.phone,
    ]) {
      if (!asciiSafe(line)) continue
      drawLeft(ctx, truncate(ctx.regular, line, 10, COL_AMOUNT - TOTALS_LEFT), TOTALS_LEFT, ay, 10)
      ay -= 14
    }
    metaBottom = Math.min(metaBottom, ay)
  }
  y = metaBottom

  // ── Line items ────────────────────────────────────────────────────────────
  y -= 34
  drawLeft(ctx, 'ITEM', MARGIN, y, 8.5, { bold: true, color: MUTED })
  drawRight(ctx, 'QTY', COL_QTY, y, 8.5, { bold: true, color: MUTED })
  drawRight(ctx, 'UNIT', COL_UNIT, y, 8.5, { bold: true, color: MUTED })
  drawRight(ctx, 'AMOUNT', COL_AMOUNT, y, 8.5, { bold: true, color: MUTED })
  y -= 9
  page.drawLine({ start: { x: MARGIN, y }, end: { x: COL_AMOUNT, y }, thickness: 0.75, color: RULE })

  // Below this the totals block and footer need the space, so rows stop.
  const ITEMS_FLOOR = 250
  const nameWidth = COL_QTY - MARGIN - 70
  let shown = 0
  for (const line of data.lines) {
    if (y - 36 < ITEMS_FLOOR) break
    // 30pt of leading, not 24. The variant label hangs 12pt under its product
    // name, so a 24pt step leaves 12pt between one row's label and the next
    // row's name - which reads as the label belonging to the row BELOW it.
    y -= 30
    drawLeft(ctx, truncate(ctx.bold, line.productName, 10.5, nameWidth), MARGIN, y, 10.5, { bold: true })
    drawLeft(ctx, truncate(ctx.regular, line.variantLabel, 9, nameWidth), MARGIN, y - 12, 9, { color: MUTED })
    drawRight(ctx, String(line.qty), COL_QTY, y, 10.5)
    drawRight(ctx, money(line.unitPrice), COL_UNIT, y, 10.5)
    drawRight(ctx, money(line.lineTotal), COL_AMOUNT, y, 10.5)
    shown += 1
  }

  const hidden = data.lines.length - shown
  if (hidden > 0) {
    y -= 24
    drawLeft(ctx, `+ ${hidden} more item${hidden === 1 ? '' : 's'} - see your order page`, MARGIN, y, 9.5, {
      color: MUTED,
    })
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  y -= 22
  page.drawLine({ start: { x: TOTALS_LEFT, y }, end: { x: COL_AMOUNT, y }, thickness: 0.75, color: RULE })

  const totalRow = (label: string, value: string, opts?: { bold?: boolean; color?: Colour }) => {
    y -= 18
    const size = opts?.bold ? 11.5 : 10.5
    drawLeft(ctx, label, TOTALS_LEFT, y, size, opts)
    drawRight(ctx, value, COL_AMOUNT, y, size, opts)
  }

  totalRow('Subtotal', money(data.subtotal))
  if (data.discount > 0) {
    // The coupon is named: "Discount -Rs.150" with no reason attached is the
    // line a customer emails support about.
    totalRow(
      data.couponCode ? `Discount (${data.couponCode})` : 'Discount',
      `-${money(data.discount)}`,
    )
  }
  // Free delivery is stated rather than omitted. A missing row reads as a charge
  // that was forgotten, not as one that was zero.
  totalRow('Delivery', data.shipping > 0 ? money(data.shipping) : 'Free')

  y -= 8
  page.drawLine({ start: { x: TOTALS_LEFT, y }, end: { x: COL_AMOUNT, y }, thickness: 0.75, color: RULE })
  totalRow('Total paid', money(data.total), { bold: true })

  // ── Footer ────────────────────────────────────────────────────────────────
  const footerY = MARGIN + 26
  page.drawLine({
    start: { x: MARGIN, y: footerY + 22 },
    end: { x: COL_AMOUNT, y: footerY + 22 },
    thickness: 0.75,
    color: RULE,
  })
  drawLeft(ctx, `Thank you, ${data.customerName.split(' ')[0] ?? 'there'}.`, MARGIN, footerY + 6, 10, {
    bold: true,
  })
  drawLeft(
    ctx,
    'This is an order receipt, not a GST tax invoice. Amounts are as charged at the time of purchase.',
    MARGIN,
    footerY - 8,
    8,
    { color: MUTED },
  )

  return pdf.save()
}

/** Build and render in one call — what both the route and the notifier want. */
export async function generateInvoicePdf(
  brand: Brand,
  orderNo: string,
): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const data = await buildInvoiceData(brand, orderNo)
  if (!data) return null
  return { bytes: await renderInvoicePdf(data), filename: invoiceFilename(orderNo) }
}
