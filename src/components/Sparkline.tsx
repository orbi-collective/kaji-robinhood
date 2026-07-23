type SparkProps = {
  points: number[]
  width?: number
  height?: number
  down?: boolean
}

/** Inspection-trace sparkline in signal lime. */
export function Sparkline({ points, width = 120, height = 34, down = false }: SparkProps) {
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const step = width / (points.length - 1)
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - 3 - ((p - min) / span) * (height - 6)).toFixed(1)}`)
    .join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} fill="none" stroke={down ? '#8a9c00' : '#cfff00'} strokeWidth="1.6" />
    </svg>
  )
}

/** Small bar histogram used in the instrument rail. */
export function Bars({ values, width = 120, height = 34 }: { values: number[]; width?: number; height?: number }) {
  const max = Math.max(...values)
  const bw = width / values.length - 3
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {values.map((v, i) => {
        const h = Math.max(2, (v / max) * (height - 4))
        return <rect key={i} x={i * (bw + 3)} y={height - h} width={bw} height={h} fill="#cfff00" opacity={0.9} />
      })}
    </svg>
  )
}
