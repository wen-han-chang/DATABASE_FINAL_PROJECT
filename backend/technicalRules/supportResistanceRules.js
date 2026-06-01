import {
  last,
  maxHigh,
  minLow,
  round,
  safeBars,
} from './ruleUtils.js'

export function analyzeSupportResistanceRules(bars) {
  const cleanBars = safeBars(bars)
  const latest = last(cleanBars)
  if (!latest || cleanBars.length < 20) {
    return {
      available: false,
      reason: 'data_limited',
      summary: '支撐壓力資料不足',
    }
  }

  const bars20 = cleanBars.slice(-20)
  const bars60 = cleanBars.slice(-60)
  const previous20 = cleanBars.slice(-21, -1)
  const support20d = minLow(bars20)
  const resistance20d = maxHigh(bars20)
  const support60d = minLow(bars60)
  const resistance60d = maxHigh(bars60)
  const previousSupport20d = minLow(previous20)
  const previousResistance20d = maxHigh(previous20)
  const close = latest.close

  const nearSupport = support20d ? Math.abs(close - support20d) / support20d <= 0.02 : false
  const nearResistance = resistance20d ? Math.abs(close - resistance20d) / resistance20d <= 0.02 : false
  const resistanceBreak = previousResistance20d != null && close > previousResistance20d
  const supportBreak = previousSupport20d != null && close < previousSupport20d
  const range = resistance20d - support20d
  const rangePositionValue = range > 0 ? (close - support20d) / range : null
  const rangePosition = rangePositionValue == null
    ? 'data_limited'
    : rangePositionValue >= 0.8
      ? 'upper_range'
      : rangePositionValue <= 0.2
        ? 'lower_range'
        : 'middle_range'

  return {
    available: true,
    nearSupport,
    nearResistance,
    resistanceBreak,
    supportBreak,
    support20d: round(support20d, 2),
    resistance20d: round(resistance20d, 2),
    support60d: round(support60d, 2),
    resistance60d: round(resistance60d, 2),
    rangePosition,
    rangePositionValue: round(rangePositionValue, 4),
    summary: buildSummary({ nearSupport, nearResistance, resistanceBreak, supportBreak, rangePosition }),
  }
}

function buildSummary({ nearSupport, nearResistance, resistanceBreak, supportBreak, rangePosition }) {
  if (resistanceBreak) return '突破短期壓力區'
  if (supportBreak) return '跌破短期支撐區，風險提高'
  if (nearResistance) return '接近短期壓力區'
  if (nearSupport) return '接近短期支撐區'
  if (rangePosition === 'upper_range') return '位於短期區間上緣'
  if (rangePosition === 'lower_range') return '位於短期區間下緣'
  return '位於短期區間中段'
}
