import {
  buildIndicatorSeries,
  last,
  previous,
  round,
  slopeOf,
} from './ruleUtils.js'

const SLOPE_LOOKBACK = 5
const NEAR_MA_THRESHOLD = 0.02
const FAR_FROM_MA_THRESHOLD = 0.08
const RECOVERY_DAYS = 3

function addRule(matchedRules, id, name, side, strength, reason) {
  matchedRules.push({ id, name, side, strength, reason })
}

export function analyzeGranvilleRules(bars) {
  const series = buildIndicatorSeries(bars)
  const latest = last(series.bars)
  const prev = previous(series.bars)
  const ma20 = last(series.ma20)
  const prevMa20 = previous(series.ma20)
  const ma20Slope = slopeOf(series.ma20, SLOPE_LOOKBACK)

  if (!latest || !prev || ma20 == null || prevMa20 == null) {
    return {
      available: false,
      reason: 'data_limited',
      matchedRules: [],
      summary: '葛蘭碧規則資料不足',
    }
  }

  const matchedRules = []
  const close = latest.close
  const prevClose = prev.close
  const distance = ma20 ? (close - ma20) / ma20 : 0
  const recent = series.bars.slice(-RECOVERY_DAYS - 1)
  const recentMa20 = series.ma20.slice(-RECOVERY_DAYS - 1)
  const recentlyBelowMa = recent.some((bar, index) => recentMa20[index] != null && bar.close < recentMa20[index])
  const recentlyAboveMa = recent.some((bar, index) => recentMa20[index] != null && bar.close > recentMa20[index])
  const latestLowNearMa = Math.abs(latest.low - ma20) / ma20 <= NEAR_MA_THRESHOLD
  const latestHighNearMa = Math.abs(latest.high - ma20) / ma20 <= NEAR_MA_THRESHOLD

  if (prevClose <= prevMa20 && close > ma20 && ['up', 'flat'].includes(ma20Slope)) {
    addRule(matchedRules, 'G1', '葛蘭碧買進法則一', 'buy', 'medium', '股價由 MA20 下方重新站上 MA20，且 MA20 走平或上彎。')
  }
  if (recentlyBelowMa && close > ma20 && ma20Slope === 'up') {
    addRule(matchedRules, 'G2', '葛蘭碧買進法則二', 'buy', 'medium', '股價短暫跌破上升中的 MA20 後重新站回。')
  }
  if (close > ma20 && latestLowNearMa && ma20Slope === 'up') {
    addRule(matchedRules, 'G3', '葛蘭碧買進法則三', 'buy', 'low', '股價在 MA20 上方回測均線附近且未跌破。')
  }
  if (distance <= -FAR_FROM_MA_THRESHOLD) {
    addRule(matchedRules, 'G4', '葛蘭碧買進法則四', 'buy', 'low', `股價低於 MA20 ${round(Math.abs(distance) * 100, 2)}%，乖離偏大。`)
  }
  if (prevClose >= prevMa20 && close < ma20 && ['down', 'flat'].includes(ma20Slope)) {
    addRule(matchedRules, 'G5', '葛蘭碧賣出法則一', 'sell', 'medium', '股價由 MA20 上方跌破 MA20，且 MA20 走平或下彎。')
  }
  if (recentlyAboveMa && close < ma20 && ma20Slope === 'down') {
    addRule(matchedRules, 'G6', '葛蘭碧賣出法則二', 'sell', 'medium', '股價短暫突破下降中的 MA20 後又跌回下方。')
  }
  if (close < ma20 && latestHighNearMa && ma20Slope === 'down') {
    addRule(matchedRules, 'G7', '葛蘭碧賣出法則三', 'sell', 'low', '股價在 MA20 下方反彈至均線附近但未突破。')
  }
  if (distance >= FAR_FROM_MA_THRESHOLD) {
    addRule(matchedRules, 'G8', '葛蘭碧賣出法則四', 'sell', 'low', `股價高於 MA20 ${round(distance * 100, 2)}%，乖離偏大。`)
  }

  const buyCount = matchedRules.filter((rule) => rule.side === 'buy').length
  const sellCount = matchedRules.filter((rule) => rule.side === 'sell').length

  return {
    available: true,
    matchedRules,
    ma20,
    ma20Slope,
    priceToMa20Pct: round(distance * 100, 2),
    summary: buyCount > sellCount
      ? '出現偏多的葛蘭碧訊號'
      : sellCount > buyCount
        ? '出現偏空的葛蘭碧訊號'
        : '未出現明確葛蘭碧訊號',
  }
}
