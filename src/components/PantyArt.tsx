import type { CSSProperties } from 'react'

/* Illustrated cover for the Period Panties product (no photo asset). Soft,
   on-brand silhouette on a lavender field. Three tints for gallery variety. */

const TINTS: Record<string, { bg: string; body: string; line: string; gusset: string }> = {
  lilac: { bg: 'linear-gradient(150deg,#F4EFFA,#DAC8EE)', body: '#C9AEE4', line: '#563184', gusset: '#EFE7F9' },
  plum: { bg: 'linear-gradient(150deg,#EDE4F7,#C6ABE6)', body: '#B79BD8', line: '#3A2158', gusset: '#F2ECF9' },
  gold: { bg: 'linear-gradient(150deg,#FCF3DC,#EAD9F1)', body: '#CDB4E6', line: '#563184', gusset: '#FBF6E6' },
}

export function PantyArt({
  variant = 'lilac',
  className = '',
  style,
}: {
  variant?: 'lilac' | 'plum' | 'gold'
  className?: string
  style?: CSSProperties
}) {
  const t = TINTS[variant] ?? TINTS.lilac
  return (
    <span
      className={`panty-art ${className}`}
      aria-hidden="true"
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        background: t.bg,
        position: 'relative',
        ...style,
      }}
    >
      <svg
        viewBox="0 0 200 200"
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        role="presentation"
        style={{ position: 'absolute', inset: 0 }}
      >
        {/* soft depth blobs */}
        <circle cx="52" cy="46" r="40" fill="#ffffff" opacity=".28" />
        <circle cx="158" cy="150" r="46" fill={t.line} opacity=".06" />
        {/* brief silhouette */}
        <path
          d="M46 74 Q100 62 154 74 L150 92 Q140 132 118 150 Q104 160 100 138 Q96 160 82 150 Q60 132 50 92 Z"
          fill={t.body}
          fillOpacity=".92"
          stroke={t.line}
          strokeWidth="2.4"
          strokeOpacity=".5"
          strokeLinejoin="round"
        />
        {/* waistband */}
        <path
          d="M46 74 Q100 62 154 74 L152 84 Q100 73 48 84 Z"
          fill={t.line}
          fillOpacity=".18"
        />
        {/* leak-proof gusset panel */}
        <path
          d="M78 96 Q100 90 122 96 Q120 126 100 140 Q80 126 78 96 Z"
          fill={t.gusset}
          stroke={t.line}
          strokeWidth="1.4"
          strokeOpacity=".35"
        />
        {/* tiny protective drop mark */}
        <path
          d="M100 106 c5 6 8 9 8 13 a8 8 0 0 1 -16 0 c0 -4 3 -7 8 -13 Z"
          fill={t.line}
          fillOpacity=".42"
        />
      </svg>
    </span>
  )
}
