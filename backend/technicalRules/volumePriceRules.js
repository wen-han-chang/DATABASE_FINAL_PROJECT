import {
  average,
  buildIndicatorSeries,
  last,
  maxHigh,
  minLow,
  previous,
  round,
} from './ruleUtils.js'

export function analyzeVolumePriceRules(bars) {
  const series = buildIndicatorSeries(bars)
  const latest = last(series.bars)
  const yesterday = previous(series.bars)
  const volumeMA5 = average(series.volumes.slice(-5))
  const volumeMA20 = average(series.volumes.slice(-20))

  if (!latest || !yesterday || !volumeMA20) {
    return {
      available: false,
      reason: 'data_limited',
      status: 'data_limited',
      summary: '量價資料不足',
    }
  }

  const previous20 = series.bars.slice(-21, -1)
  const high20 = maxHigh(previous20)
  const low20 = minLow(previous20)
  const volumeRatio20d = round(latest.volume / volumeMA20, 4)
  const signals = []

  let status = 'price_flat'
  if (latest.close > yesterday.close && latest.volume > volumeMA20) status = 'price_up_volume_up'
  else if (latest.close > yesterday.close && latest.volume <= volumeMA20) status = 'price_up_volume_down'
  else if (latest.close < yesterday.close && latest.volume > volumeMA20) status = 'price_down_volume_up'
  else if (latest.close < yesterday.close && latest.volume <= volumeMA20) status = 'price_down_volume_down'
  signals.push(status)

  if (high20 != null && latest.close > high20 && latest.volume > volumeMA20 * 1.5) {
    status = 'breakout_with_volume'
    signals.push(status)
  }
  if (low20 != null && latest.close < low20 && latest.volume > volumeMA20 * 1.5) {
    status = 'breakdown_with_volume'
    signals.push(status)
  }

  const priorBreakout = series.bars.slice(-4, -1).some((bar, index, arr) => {
    const end = series.bars.length - 4 + index
    const priorWindow = series.bars.slice(Math.max(0, end - 20), end)
    const priorHigh = maxHigh(priorWindow)
    return priorHigh != null && bar.close > priorHigh
  })
  if (priorBreakout && high20 != null && latest.close < high20) {
    status = 'false_breakout'
    signals.push(status)
  }

  return {
    available: true,
    status,
    signals,
    volumeMA5: round(volumeMA5, 2),
    volumeMA20: round(volumeMA20, 2),
    volumeRatio20d,
    summary: {
      price_up_volume_up: '價漲量增，買盤動能有延續跡象',
      price_up_volume_down: '價漲量縮，追價力道需觀察',
      price_down_volume_up: '價跌量增，賣壓或換手提高',
      price_down_volume_down: '價跌量縮，短線觀望氣氛較重',
      breakout_with_volume: '放量突破，突破可信度較高',
      breakdown_with_volume: '放量跌破，風險提高',
      false_breakout: '可能是假突破',
      price_flat: '價格變化有限，量價訊號中性',
    }[status],
  }
}
