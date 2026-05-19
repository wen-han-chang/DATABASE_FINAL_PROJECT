import {
  average,
  buildIndicatorSeries,
  last,
  percentile,
  round,
} from './ruleUtils.js'

export function analyzeVolatilityRules(bars) {
  const series = buildIndicatorSeries(bars)
  const latest = last(series.bars)
  const upper = last(series.bollinger.upper)
  const middle = last(series.bollinger.middle)
  const lower = last(series.bollinger.lower)
  const volumeMA20 = average(series.volumes.slice(-20))

  if (!latest || [upper, middle, lower].some((value) => value == null) || !middle) {
    return {
      available: false,
      reason: 'data_limited',
      status: 'data_limited',
      summary: '波動資料不足',
    }
  }

  const widths = series.bollinger.upper.map((value, index) => {
    const mid = series.bollinger.middle[index]
    const low = series.bollinger.lower[index]
    return value != null && mid ? (value - low) / mid : null
  })
  const bbWidth = (upper - lower) / middle
  const threshold = percentile(widths.slice(-120), 0.2)
  const signals = []
  let status = 'normal'

  if (threshold != null && bbWidth < threshold) {
    status = 'volatility_squeeze'
    signals.push(status)
  }
  if (volumeMA20 && latest.close > upper && latest.volume > volumeMA20 * 1.3) {
    status = 'upside_volatility_breakout'
    signals.push(status)
  }
  if (volumeMA20 && latest.close < lower && latest.volume > volumeMA20 * 1.3) {
    status = 'downside_volatility_breakout'
    signals.push(status)
  }

  return {
    available: true,
    status,
    signals,
    bbWidth: round(bbWidth, 4),
    bbWidthPercentileThreshold20: round(threshold, 4),
    summary: {
      volatility_squeeze: 'Bollinger 波動壓縮，後續方向突破需觀察',
      upside_volatility_breakout: '向上波動突破且量能放大',
      downside_volatility_breakout: '向下波動突破且量能放大，風險提高',
      normal: '波動未明顯壓縮',
    }[status],
  }
}
