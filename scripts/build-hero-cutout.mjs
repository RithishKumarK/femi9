import sharp from 'sharp'

/**
 * Rebuild the hero cutout at full resolution.
 *
 * `image 19.png` (698x872) is a hand-cut transparent version of the same render
 * that ships uncut as `hero-imgImage19.png` (1114x1412). The hero displays it at
 * up to 680 CSS px wide, so on any retina screen the 698px source is upscaled
 * ~2x and looks soft — the "hero first image looks bad" report.
 *
 * The two files are the same render at different scales (measured subject boxes
 * differ by a uniform 1.685x / 1.683x), so the artist's matte can be mapped onto
 * the sharp original with a plain scale+translate. That keeps the hand-cut edge
 * — a threshold or flood fill cannot reproduce it, because the model's cream
 * dress is the same luminance as the paper background.
 */

const DIR = 'public/assets/figma-home/'
const OUT = DIR + 'hero-lifestyle.png'

// Subject boxes measured from both files.
const LO = { x0: 145, y0: 103, w: 507, h: 693 }
const HI = { x0: 190, y0: 144, w: 856, h: 1168 }

const lo = await sharp(DIR + 'image 19.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const hi = await sharp(DIR + 'hero-imgImage19.png').raw().toBuffer({ resolveWithObject: true })
const { width: W, height: H } = hi.info

// Pull the alpha channel out of the shipped cutout, crop to its subject box and
// scale it to the high-res subject box.
const loAlpha = Buffer.alloc(lo.info.width * lo.info.height)
for (let p = 0; p < loAlpha.length; p++) loAlpha[p] = lo.data[p * 4 + 3]

// NB: sharp promotes a 1-channel raw input to 3-channel sRGB across a resize,
// so read the channel count back rather than assuming the stride is 1.
const scaled = await sharp(loAlpha, {
  raw: { width: lo.info.width, height: lo.info.height, channels: 1 },
})
  .extract({ left: LO.x0, top: LO.y0, width: LO.w, height: LO.h })
  .resize(HI.w, HI.h, { kernel: 'lanczos3' })
  .raw()
  .toBuffer({ resolveWithObject: true })
const S = scaled.info.channels

// Paste it back into a full-frame mask at the high-res subject offset.
const mask = Buffer.alloc(W * H, 0)
for (let y = 0; y < HI.h; y++) {
  const ty = HI.y0 + y
  if (ty < 0 || ty >= H) continue
  for (let x = 0; x < HI.w; x++) {
    const tx = HI.x0 + x
    if (tx < 0 || tx >= W) continue
    mask[ty * W + tx] = scaled.data[(y * HI.w + x) * S]
  }
}

// The high-res render still has its white paper behind the subject, so an alpha
// edge landing even one pixel outside the silhouette leaves a white rim against
// the purple hero. Pull the matte in slightly to sit inside the subject.
const tightened = Buffer.alloc(W * H)
for (let p = 0; p < W * H; p++) {
  const a = mask[p] / 255
  tightened[p] = Math.round(Math.max(0, Math.min(1, (a - 0.22) / 0.62)) * 255)
}

const rgba = Buffer.alloc(W * H * 4)
for (let p = 0; p < W * H; p++) {
  rgba[p * 4] = hi.data[p * 3]
  rgba[p * 4 + 1] = hi.data[p * 3 + 1]
  rgba[p * 4 + 2] = hi.data[p * 3 + 2]
  rgba[p * 4 + 3] = tightened[p]
}

/**
 * Emit the SAME FRAME as the file being replaced, just at 1.69x the pixels.
 *
 * This matters more than it looks. The hero positions the photo by its own box
 * (`bottom: -32px`, `width: clamp(540px, 46vw, 680px)`, height auto), so the
 * asset's aspect ratio and the subject's placement inside it decide the
 * composition. Trimming to the subject's bounding box instead produced a taller,
 * tighter file — at the same CSS width the figure rendered ~76px larger and the
 * hero's top edge cropped her head. A drop-in replacement has to keep the
 * original framing so the layout is untouched.
 *
 * So map the old file's full canvas into high-res coordinates through the same
 * scale+offset used for the matte, and pad with transparency where that frame
 * extends past the high-res image.
 */
const scaleX = HI.w / LO.w
const scaleY = HI.h / LO.h
// Where the old canvas's origin lands in high-res coordinates (negative: the old
// frame starts outside the high-res image, so that edge needs padding).
const originX = HI.x0 - LO.x0 * scaleX
const originY = HI.y0 - LO.y0 * scaleY
const frameW = Math.round(lo.info.width * scaleX)
const frameH = Math.round(lo.info.height * scaleY)

const padLeft = Math.max(0, Math.round(-originX))
const padTop = Math.max(0, Math.round(-originY))

console.log(
  `frame ${frameW}x${frameH} (aspect ${(frameW / frameH).toFixed(4)}; ` +
    `source aspect ${(lo.info.width / lo.info.height).toFixed(4)}), ` +
    `subject offset ${padLeft},${padTop}`,
)

const canvas = Buffer.alloc(frameW * frameH * 4, 0)
for (let y = 0; y < H; y++) {
  const ty = y + padTop
  if (ty < 0 || ty >= frameH) continue
  for (let x = 0; x < W; x++) {
    const tx = x + padLeft
    if (tx < 0 || tx >= frameW) continue
    const s = (y * W + x) * 4
    const d = (ty * frameW + tx) * 4
    canvas[d] = rgba[s]
    canvas[d + 1] = rgba[s + 1]
    canvas[d + 2] = rgba[s + 2]
    canvas[d + 3] = rgba[s + 3]
  }
}

await sharp(canvas, { raw: { width: frameW, height: frameH, channels: 4 } })
  .png({ compressionLevel: 9, palette: false })
  .toFile(OUT)

const meta = await sharp(OUT).metadata()
console.log(`${OUT} — ${meta.width}x${meta.height}`)
