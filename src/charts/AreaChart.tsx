import { useId, useMemo, useState, type CSSProperties } from 'react'
import { useSize, scale, niceTicks, smoothPath, useTouchDismiss } from './util'
import { INK } from './theme'

export interface Series {
  name: string
  color: string
  points: number[]
}

interface Props {
  labels: string[]
  series: Series[]
  height?: number
  yFormat?: (n: number) => string
  /**
   * Axis-only formatter. The axis has ~50px per label and the tooltip has a
   * whole card, so a money chart wants "Rs.3k" on the axis and the exact
   * "Rs.3,240" in the tip — the tip is the ONLY place the real figure appears.
   * Defaults to `yFormat`, so existing callers are unaffected.
   */
  yAxisFormat?: (n: number) => string
  area?: boolean
  /** index at which values become a (dashed) forecast */
  forecastFrom?: number
}

/** Floor of the y-axis gutter. Historically the whole of it — a fixed 46 that a
 *  rupee label like "Rs.12,000" (~52px at 11px Kanit) simply painted straight
 *  through, and `.chart svg` is `overflow: visible`, so it escaped the card. */
const PAD_L_MIN = 46
const PAD_L_MAX = 70
const padR = 14
const padT = 14
const padB = 28

export function AreaChart({
  labels,
  series,
  height = 240,
  yFormat = String,
  yAxisFormat,
  area = true,
  forecastFrom,
}: Props) {
  const axisFormat = yAxisFormat ?? yFormat
  const { ref, width } = useSize<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const dismiss = useTouchDismiss(() => setActive(null))
  /** Per-instance prefix. `ag-${si}` alone is derived from the series index, so
   *  a second AreaChart in the same document emits a duplicate `ag-0` and
   *  `url(#ag-0)` silently resolves to the FIRST one in DOM order. */
  const uid = useId().replace(/:/g, '')

  const ticks = useMemo(() => {
    const max = Math.max(1, ...series.flatMap((s) => s.points))
    return niceTicks(max, 4)
  }, [series])
  const top = ticks[ticks.length - 1]

  // Derived from the widest tick label, never below the historical 46 — so the
  // gutter only ever GROWS, and desktop geometry is unchanged for every label
  // that already fitted.
  const padL = useMemo(() => {
    const widest = Math.max(...ticks.map((t) => axisFormat(t).length))
    return Math.max(PAD_L_MIN, Math.min(PAD_L_MAX, widest * 6.8 + 12))
  }, [ticks, axisFormat])

  if (width < 10) return <div className="chart" ref={ref} style={{ height }} />

  const innerW = width - padL - padR
  const innerH = height - padT - padB
  const n = labels.length
  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = scale(0, top, padT + innerH, padT)

  const xTickEvery = Math.max(1, Math.ceil(n / 7))

  const onMove = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect()
    const rel = e.clientX - rect.left - padL
    const i = Math.round((rel / innerW) * (n - 1))
    setActive(Math.max(0, Math.min(n - 1, i)))
  }

  const tipStyle: CSSProperties | undefined =
    active != null ? { left: x(active), top: padT } : undefined

  return (
    <div className="chart" ref={ref} style={{ height }}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <defs>
          {series.map((s, si) => (
            <linearGradient key={si} id={`ag-${uid}-${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>

        {/* gridlines + y labels */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke={INK.grid} strokeWidth={1} />
            <text x={padL - 10} y={y(t) + 4} textAnchor="end" className="axis-y">
              {axisFormat(t)}
            </text>
          </g>
        ))}

        {/* forecast band */}
        {forecastFrom != null && forecastFrom < n - 1 && (
          <rect x={x(forecastFrom)} y={padT} width={width - padR - x(forecastFrom)} height={innerH} fill={INK.grid} opacity={0.6} />
        )}

        {/* x labels */}
        {labels.map((l, i) =>
          i % xTickEvery === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className="axis-label">
              {l}
            </text>
          ) : null,
        )}

        {/* series */}
        {series.map((s, si) => {
          const pts = s.points.map((v, i) => ({ x: x(i), y: y(v) }))
          const solidPts = forecastFrom != null ? pts.slice(0, forecastFrom + 1) : pts
          const dashPts = forecastFrom != null ? pts.slice(forecastFrom) : []
          const linePath = smoothPath(solidPts)
          const areaPath =
            area && series.length === 1
              ? `${smoothPath(solidPts)} L${solidPts[solidPts.length - 1].x},${y(0)} L${solidPts[0].x},${y(0)} Z`
              : ''
          return (
            <g key={si}>
              {areaPath && <path d={areaPath} fill={`url(#ag-${uid}-${si})`} />}
              <path d={linePath} fill="none" stroke={s.color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
              {dashPts.length > 1 && (
                <path d={smoothPath(dashPts)} fill="none" stroke={s.color} strokeWidth={2.4} strokeDasharray="2 6" strokeLinecap="round" opacity={0.85} />
              )}
            </g>
          )
        })}

        {/* hover crosshair + markers */}
        {active != null && (
          <g pointerEvents="none">
            <line x1={x(active)} x2={x(active)} y1={padT} y2={padT + innerH} stroke={INK.axis} strokeWidth={1} strokeDasharray="3 4" />
            {series.map((s, si) => (
              <circle key={si} cx={x(active)} cy={y(s.points[active])} r={4.5} fill="#fff" stroke={s.color} strokeWidth={2.5} />
            ))}
          </g>
        )}

        {/* Capture layer. Pointer events rather than mouse events: this tooltip
            is the only path to a month's actual rupee figure (the axis shows
            rounded ticks), and on a phone `onMouseMove` fires at most once per
            tap with no `mouseleave` to follow — so the value was unreachable and,
            once shown, permanent. `pan-y` keeps the page scrolling under the
            finger; the move handler still runs for every mouse move, so desktop
            hover behaves exactly as before. */}
        <rect
          x={padL}
          y={padT}
          width={innerW}
          height={innerH}
          fill="transparent"
          style={{ touchAction: 'pan-y' }}
          onPointerDown={onMove}
          onPointerMove={(e) => {
            if (e.pointerType === 'mouse' || e.buttons) onMove(e)
          }}
          onPointerUp={dismiss}
          /* Mouse only: a touch pointer is destroyed on lift, so the UA fires
             pointerleave immediately after pointerup and this would close the
             tip in the same frame it opened. Touch is dismissed on a timer. */
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') setActive(null)
          }}
          onPointerCancel={() => setActive(null)}
        />
      </svg>

      {active != null && (
        <div className="tip" style={tipStyle}>
          <b>{labels[active]}</b>
          {series.map((s, si) => (
            <div className="row" key={si}>
              <span className="dot" style={{ background: s.color }} />
              {series.length > 1 && <span className="k">{s.name}</span>}
              <span className="v">{yFormat(s.points[active])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
