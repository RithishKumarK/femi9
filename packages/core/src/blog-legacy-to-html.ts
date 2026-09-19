/**
 * Convert a legacy `BlogPost.body: string[]` column into Tiptap-compatible HTML.
 *
 * Every block-based renderer keys on the same handful of line markers, so this
 * mirrors those rules exactly rather than inventing a new grammar. The output
 * is deliberately conservative — a paragraph is a paragraph, a bullet list is
 * a bullet list, and anything unrecognised becomes a paragraph — because the
 * sanitiser on save will strip anything cleverer anyway.
 *
 * Markers understood (same as `apps/femi9-web/src/screens/BlogPost.tsx#Body`):
 *   "## "           → <h2>
 *   "> "            → <blockquote>
 *   "![alt](url)"   → <img alt="…" src="…">
 *   lines of "• "   → <ul><li>…</li></ul>
 *   "1. " / "2. "…  → <ol><li>…</li></ol>
 *   anything else   → <p>
 *
 * Round-trip note: this is a ONE-WAY conversion driven from the admin's
 * "Migrate to rich editor" button. Old `body[]` stays on the row untouched so
 * the previous renderer keeps working, and the save path writes the HTML into
 * `bodyHtml`; the storefront prefers `bodyHtml` when it exists.
 */

const HEADING = /^## (.+)$/
const QUOTE = /^> (.+)$/
const IMAGE = /^!\[(.*?)\]\((.*?)\)$/
const BULLET = /^\s*•\s+/
const NUMBERED = /^\s*\d+\.\s+/

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * A multi-line bullet block joins each `• ` line into one <li>. Blank lines are
 * dropped. Same shape for numbered blocks, without the `\d+\.` prefix.
 */
function toListItems(block: string, marker: RegExp): string {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<li>${escapeHtml(line.replace(marker, ''))}</li>`)
    .join('')
}

function convertBlock(block: string): string {
  const trimmed = block.trim()
  if (!trimmed) return ''

  const heading = trimmed.match(HEADING)
  if (heading) return `<h2>${escapeHtml(heading[1])}</h2>`

  const quote = trimmed.match(QUOTE)
  if (quote) return `<blockquote><p>${escapeHtml(quote[1])}</p></blockquote>`

  const image = trimmed.match(IMAGE)
  if (image) {
    const alt = escapeHtml(image[1] || '')
    const src = escapeHtml(image[2] || '')
    return `<p><img src="${src}" alt="${alt}"></p>`
  }

  if (BULLET.test(trimmed)) return `<ul>${toListItems(trimmed, BULLET)}</ul>`
  if (NUMBERED.test(trimmed)) return `<ol>${toListItems(trimmed, NUMBERED)}</ol>`

  // Preserve intra-block newlines as <br>, matching how the legacy renderer
  // shows them inside a plain paragraph.
  const inner = trimmed
    .split('\n')
    .map((line) => escapeHtml(line.trim()))
    .filter(Boolean)
    .join('<br>')
  return `<p>${inner}</p>`
}

/**
 * Convert every block, dropping empties, and join with a single newline so a
 * later diff (or a hand copy from the admin) reads block-by-block.
 */
export function legacyBodyToHtml(blocks: string[] | null | undefined): string {
  if (!blocks || blocks.length === 0) return ''
  return blocks.map(convertBlock).filter(Boolean).join('\n')
}
