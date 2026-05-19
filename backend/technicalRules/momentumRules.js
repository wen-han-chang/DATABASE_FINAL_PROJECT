import {
  buildIndicatorSeries,
  last,
  maxHigh,
  minLow,
  previous,
  seriesCrossesAbove,
  seriesCrossesBelow,
} from './ruleUtils.js'

function classifyRsi(rsi14) {
  if (rsi14 == null) return 'data_limited'
  if (rsi14 >= 70) return 'overheated'
  if (rsi14 <= 30) return 'oversold'
  if (rsi14 >= 55) return 'strong_not_overheated'
  if (rsi14 > 45) return 'neutral'
  return 'weak'
}

export function analyzeMomentumRules(bars) {
  const series = buildIndicatorSeries(bars)
  if (series.bars.length < 20) {
    return {
      available: false,
      reason: 'data_limited',
      rsiStatus: 'data_limited',
      macdStatus: 'data_limited',
      kdStatus: 'data_limited',
      divergences: [],
      summary: '動能資料不足',
    }
  }

  const latestRsi = last(series.rsi14)
  const rsiStatus = classifyRsi(latestRsi)
  const macdSignals = []
  if (seriesCrossesAbove(series.macd.dif, series.macd.signal)) macdSignals.push('bullish_cross')
  if (seriesCrossesBelow(series.macd.dif, series.macd.signal)) macdSignals.push('bearish_cross')

  const hist = series.macd.histogram
  const h0 = last(hist)
  const h1 = previous(hist)
  const h2 = previous(hist, 2)
  if ([h0, h1, h2].every((value) => value != null) && h2 < h1 && h1 < h0 && h0 > 0) {
    macdSignals.push('bullish_momentum_expanding')
  }
  if ([h0, h1, h2].every((value) => value != null) && h2 > h1 && h1 > h0 && h0 < 0) {
    macdSignals.push('bearish_momentum_expanding')
  }
  const dif = last(series.macd.dif)
  const dea = last(series.macd.signal)
  if (dif != null && dea != null && dif > 0 && dea > 0) macdSignals.push('above_zero')
  if (dif != null && dea != null && dif < 0 && dea < 0) macdSignals.push('below_zero')

  const kdSignals = []
  if (seriesCrossesAbove(series.kd.k, series.kd.d)) kdSignals.push('kd_golden_cross')
  if (seriesCrossesBelow(series.kd.k, series.kd.d)) kdSignals.push('kd_death_cross')
  const k = last(series.kd.k)
  const d = last(series.kd.d)
  if (k != null && d != null && k >= 80 && d >= 80) kdSignals.push('high_zone')
  if (k != null && d != null && k <= 20 && d <= 20) kdSignals.push('low_zone')

  const recentBars = series.bars.slice(-20)
  const recentRsi = series.rsi14.slice(-20).filter((value) => value != null)
  const divergences = []
  const latest = last(series.bars)
  if (latest && recentRsi.length >= 10) {
    if (latest.low <= minLow(recentBars) && latestRsi > Math.min(...recentRsi)) {
      divergences.push('bullish_divergence')
    }
    if (latest.high >= maxHigh(recentBars) && latestRsi < Math.max(...recentRsi)) {
      divergences.push('bearish_divergence')
    }
  }

  const macdStatus = macdSignals.includes('bullish_momentum_expanding')
    ? 'bullish_momentum_expanding'
    : macdSignals.includes('bearish_momentum_expanding')
      ? 'bearish_momentum_expanding'
      : macdSignals[0] || 'neutral'
  const kdStatus = kdSignals[0] || 'neutral'

  return {
    available: true,
    rsiStatus,
    rsi14: latestRsi,
    macdStatus,
    macdSignals,
    kdStatus,
    kdSignals,
    divergences,
    values: {
      dif,
      dea,
      histogram: h0,
      k,
      d,
    },
    summary: buildMomentumSummary(rsiStatus, macdStatus, kdSignals),
  }
}

function buildMomentumSummary(rsiStatus, macdStatus, kdSignals) {
  if (macdStatus === 'bullish_momentum_expanding' && rsiStatus === 'strong_not_overheated') {
    return '動能偏多但尚未過熱'
  }
  if (macdStatus === 'bearish_momentum_expanding') return '空方動能增強'
  if (rsiStatus === 'overheated') return 'RSI 過熱，追高風險提高'
  if (rsiStatus === 'oversold') return 'RSI 超跌，可能出現反彈觀察'
  if (kdSignals.includes('kd_golden_cross')) return 'KD 出現偏多交叉'
  if (kdSignals.includes('kd_death_cross')) return 'KD 出現偏空交叉'
  return '動能訊號中性'
}
