import { useState } from 'react'
import { fmtInt, useTouchDismiss } from './util'

export interface Slice {
  label: string
  value: number
  color: string
}

interface Props {
  data: Slice[]
  size?: number
  thickness?: number
  centerLabel?: string
  format?: (n: number) => string
}

export function DonutChart({ data, size = 180, thickness = 22, centerLabel = 'Total', format = fmtInt }: Props) {
  const [active, setActive] = useState<number | null>(null)
  const dismiss = useTouchDismiss(() => setActive(null))
  const total = data.reduce((s, d) => s + d.value, 0)
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const gap = 2 // px surface gap between segments

  let offset = 0
  const segs = data.map((d, i) => {
    const frac = total ? d.value / total : 0
    const len = Math.max(0, frac * c - gap)
    const seg = { i, d, len, dash: offset }
    offset += frac * c
    return seg
  })

  const center = active != null ? data[active] : null

  return (
    <div className="donut-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ touchAction: 'pan-y' }}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(11,42,91,.06)" strokeWidth={thickness} />
          {segs.map(({ i, d, len, dash }) => (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={d.color}
              strokeWidth={active === i ? thickness + 3 : thickness}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-dash}
              opacity={active == null || active === i ? 1 : 0.4}
              style={{ transition: 'stroke-width .15s, opacity .15s', cursor: 'pointer' }}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              // Touch has no enter/leave pair, so the centre label was stuck on
              // whatever the last tap landed on — or never changed at all.
              onPointerDown={() => setActive(i)}
              onPointerUp={dismiss}
            />
          ))}
        </g>
      </svg>
      <div className="donut-center" style={{ position: 'absolute' }}>
        <b>{format(center ? center.value : total)}</b>
        <span>{center ? center.label : centerLabel}</span>
      </div>
    </div>
  )
}
