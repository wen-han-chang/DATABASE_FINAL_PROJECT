import {
  buildIndicatorSeries,
  last,
  percentDiff,
  seriesCrossesAbove,
  seriesCrossesBelow,
  slopeOf,
} from './ruleUtils.js'

export function analyzeMovingAverageRules(bars) {
  const series = buildIndicatorSeries(bars)
  const latest = last(series.bars)
  const ma5 = last(series.ma5)
  const ma20 = last(series.ma20)
  const ma60 = last(series.ma60)

  if (!latest || [ma5, ma20, ma60].some((value) => value == null)) {
    return {
      available: false,
      reason: 'data_limited',
      structure: 'data_limited',
      crosses: [],
      slopes: { ma20: 'data_limited', ma60: 'data_limited' },
      summary: '均線資料不足',
    }
  }

  const close = latest.close
  const maxDiff = Math.max(
    percentDiff(ma5, ma20) || 0,
    percentDiff(ma20, ma60) || 0,
    percentDiff(ma5, ma60) || 0,
  )
  let structure = 'mixed'
  if (close > ma5 && ma5 > ma20 && ma20 > ma60) structure = 'bullish_alignment'
  else if (close < ma5 && ma5 < ma20 && ma20 < ma60) structure = 'bearish_alignment'
  else if (maxDiff <= 0.03) structure = 'ma_cluster'

  const crosses = []
  if (seriesCrossesAbove(series.ma5, series.ma20)) crosses.push('ma5_cross_above_ma20')
  if (seriesCrossesBelow(series.ma5, series.ma20)) crosses.push('ma5_cross_below_ma20')

  const slopes = {
    ma20: slopeOf(series.ma20, 5),
    ma60: slopeOf(series.ma60, 5),
  }

  const summary = {
    bullish_alignment: '短中期均線偏多',
    bearish_alignment: '短中期均線偏空',
    ma_cluster: '均線糾結，趨勢方向尚未明確',
    mixed: '均線結構混合',
  }[structure]

  return {
    available: true,
    structure,
    crosses,
    slopes,
    values: { ma5, ma20, ma60 },
    summary,
  }
}
