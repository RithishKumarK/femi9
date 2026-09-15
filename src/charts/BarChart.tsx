import { useMemo, useState } from 'react'
import { useSize, scale, niceTicks, useTouchDismiss } from './util'
import { INK, C } from './theme'

export interface Bar {
  label: string
  value: number
  color?: string
}

interface Props {
  data: Bar[]
  height?: number
  yFormat?: (n: number) => string
  color?: string
}

/** Same story as AreaChart: the y gutter was a fixed guess the money labels grew
 *  straight through. Floor is the historical value, so it only ever widens. */
const PAD_L_MIN = 42
const PAD_L_MAX = 70
const padR = 12
const padT = 12
/** Enough room under the plot for a horizontal label; a rotated one needs more. */
const PAD_B = 26
const PAD_B_ROTATED = 44
/** Below this much room per bar, a city name cannot be drawn horizontally. */
const TIGHT_SLOT = 56

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h, w / 2)
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`
}

export function BarChart({ data, height = 240, yFormat = String, color = C.forest }: Props) {
  const { ref, width } = useSize<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const dismiss = useTouchDismiss(() => setActive(null))

  const ticks = useMemo(() => niceTicks(Math.max(1, ...data.map((d) => d.value)), 4), [data])
  const top = ticks[ticks.length - 1]

  const padL = useMemo(() => {
    const widest = Math.max(...ticks.map((t) => yFormat(t).length))
    return Math.max(PAD_L_MIN, Math.min(PAD_L_MAX, widest * 6.8 + 12))
  }, [ticks, yFormat])

  if (width < 10) return <div className="chart" ref={ref} style={{ height }} />

  const innerW = width - padL - padR
  const slot = innerW / data.length
  // Six Indian city names share ~43px slots inside a 390px admin card; drawn
  // horizontally they collide into a smear and the outermost one escapes the
  // card entirely. Above TIGHT_SLOT (every desktop width) nothing changes.
  const tight = slot < TIGHT_SLOT
  const padB = tight ? PAD_B_ROTATED : PAD_B
  const innerH = height - padT - padB
  const y = scale(0, top, padT + innerH, padT)
  const bw = Math.min(46, slot * 0.62)

  return (
    <div className="chart" ref={ref} style={{ height }}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" style={{ touchAction: 'pan-y' }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke={INK.grid} strokeWidth={1} />
            <text x={padL - 10} y={y(t) + 4} textAnchor="end" className="axis-y">
              {yFormat(t)}
            </text>
          </g>
        ))}

        {/* Tapping the plot ground closes an open tooltip. Sits before the bars
            so their own hit rects stay on top of it. */}
        <rect
          x={padL}
          y={padT}
          width={innerW}
          height={innerH}
          fill="transparent"
          onPointerDown={() => setActive(null)}
        />

        {data.map((d, i) => {
          const cx = padL + slot * i + slot / 2
          const bx = cx - bw / 2
          const bh = padT + innerH - y(d.value)
          const on = active === i
          return (
            <g
              key={i}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              // A finger produces no mouseenter/mouseleave pair, so the figure
              // behind this tooltip was mouse-only.
              onPointerDown={() => setActive(i)}
              onPointerUp={dismiss}
            >
              <rect x={bx - 3} y={padT} width={bw + 6} height={innerH} fill="transparent" />
              <path
                d={roundedTop(bx, y(d.value), bw, bh, 4)}
                fill={d.color ?? color}
                opacity={active == null || on ? 1 : 0.45}
              />
              <text
                x={cx}
                y={height - 8}
                textAnchor={tight ? 'end' : 'middle'}
                transform={tight ? `rotate(-40 ${cx} ${height - 8})` : undefined}
                className="axis-label"
              >
                {tight && d.label.length > 9 ? `${d.label.slice(0, 8)}…` : d.label}
              </text>
            </g>
          )
        })}
      </svg>

      {active != null && (
        <div
          className="tip"
          style={{ left: padL + slot * active + slot / 2, top: y(data[active].value) }}
        >
          <b>{data[active].label}</b>
          <div className="row">
            <span className="dot" style={{ background: data[active].color ?? color }} />
            <span className="v">{yFormat(data[active].value)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
