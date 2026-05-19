import { buildTechnicalSeries } from '../technicalIndicators.js'

export function round(value, digits = 4) {
  if (value == null || !Number.isFinite(Number(value))) return null
  return +Number(value).toFixed(digits)
}

export function safeBars(bars) {
  return buildTechnicalSeries(bars).bars
}

export function last(values) {
  return values?.length ? values[values.length - 1] : null
}

export function previous(values, offset = 1) {
  return values?.length > offset ? values[values.length - 1 - offset] : null
}

export function average(values) {
  const nums = values.filter((value) => value != null && Number.isFinite(Number(value)))
  if (!nums.length) return null
  return nums.reduce((sum, value) => sum + Number(value), 0) / nums.length
}

export function maxHigh(bars) {
  return bars.length ? Math.max(...bars.map((bar) => Number(bar.high))) : null
}

export function minLow(bars) {
  return bars.length ? Math.min(...bars.map((bar) => Number(bar.low))) : null
}

export function percentDiff(a, b) {
  if (!a || !b) return null
  return Math.abs(Number(a) - Number(b)) / Math.abs(Number(b))
}

export function slopeOf(series, lookback = 5, epsilon = 0.001) {
  const latest = last(series)
  const past = previous(series, lookback)
  if (latest == null || past == null || past === 0) return 'data_limited'
  const change = (latest - past) / Math.abs(past)
  if (change > epsilon) return 'up'
  if (change < -epsilon) return 'down'
  return 'flat'
}

export function seriesCrossesAbove(fast, slow) {
  const fastNow = last(fast)
  const slowNow = last(slow)
  const fastPrev = previous(fast)
  const slowPrev = previous(slow)
  return [fastNow, slowNow, fastPrev, slowPrev].every((value) => value != null)
    && fastPrev <= slowPrev
    && fastNow > slowNow
}

export function seriesCrossesBelow(fast, slow) {
  const fastNow = last(fast)
  const slowNow = last(slow)
  const fastPrev = previous(fast)
  const slowPrev = previous(slow)
  return [fastNow, slowNow, fastPrev, slowPrev].every((value) => value != null)
    && fastPrev >= slowPrev
    && fastNow < slowNow
}

export function percentile(values, ratio) {
  const nums = values
    .filter((value) => value != null && Number.isFinite(Number(value)))
    .map(Number)
    .sort((a, b) => a - b)
  if (!nums.length) return null
  const index = Math.min(nums.length - 1, Math.max(0, Math.floor((nums.length - 1) * ratio)))
  return nums[index]
}

export function buildIndicatorSeries(bars) {
  return buildTechnicalSeries(bars)
}

export function findSwingLows(bars, lookback = 2) {
  const swings = []
  for (let index = lookback; index < bars.length - lookback; index += 1) {
    const current = bars[index]
    const window = bars.slice(index - lookback, index + lookback + 1)
    if (current.low === Math.min(...window.map((bar) => bar.low))) {
      swings.push({ index, date: current.date, price: current.low })
    }
  }
  return swings
}

export function findSwingHighs(bars, lookback = 2) {
  const swings = []
  for (let index = lookback; index < bars.length - lookback; index += 1) {
    const current = bars[index]
    const window = bars.slice(index - lookback, index + lookback + 1)
    if (current.high === Math.max(...window.map((bar) => bar.high))) {
      swings.push({ index, date: current.date, price: current.high })
    }
  }
  return swings
}
