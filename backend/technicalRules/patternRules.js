import {
  average,
  buildIndicatorSeries,
  findSwingHighs,
  findSwingLows,
  last,
  maxHigh,
  minLow,
  percentDiff,
  round,
  slopeOf,
} from './ruleUtils.js'

function pattern(name, confirmed, strength, reason, extra = {}) {
  return { name, confirmed, strength, reason, ...extra }
}

export function analyzePatternRules(bars) {
  const series = buildIndicatorSeries(bars)
  const latest = last(series.bars)
  if (!latest || series.bars.length < 20) {
    return {
      available: false,
      reason: 'data_limited',
      detected: [],
      summary: '型態資料不足',
    }
  }

  const detected = []
  const recent20 = series.bars.slice(-20)
  const boxHigh = maxHigh(recent20)
  const boxLow = minLow(recent20)
  const volumeMA20 = average(series.volumes.slice(-20))
  const ma20Slope = slopeOf(series.ma20, 5, 0.003)
  const boxRange = boxLow ? (boxHigh - boxLow) / boxLow : null

  if (boxRange != null && boxRange < 0.08 && ma20Slope === 'flat') {
    detected.push(pattern('box_consolidation', true, 'low', '最近 20 日高低區間小於 8%，且 MA20 斜率接近走平。', {
      boxHigh: round(boxHigh, 2),
      boxLow: round(boxLow, 2),
    }))
  }
  if (boxHigh != null && volumeMA20 && latest.close > boxHigh && latest.volume > volumeMA20 * 1.5) {
    detected.push(pattern('box_breakout_up', true, 'medium', '股價突破 20 日箱型上緣，且成交量高於 20 日均量 1.5 倍。', {
      boxHigh: round(boxHigh, 2),
      volumeRatio20d: round(latest.volume / volumeMA20, 4),
    }))
  }
  if (boxLow != null && volumeMA20 && latest.close < boxLow && latest.volume > volumeMA20 * 1.5) {
    detected.push(pattern('box_breakdown_down', true, 'medium', '股價跌破 20 日箱型下緣，且成交量高於 20 日均量 1.5 倍。', {
      boxLow: round(boxLow, 2),
      volumeRatio20d: round(latest.volume / volumeMA20, 4),
    }))
  }

  detected.push(...detectDoubleBottom(series.bars, latest))
  detected.push(...detectDoubleTop(series.bars, latest))
  detected.push(...detectHeadAndShoulders(series.bars, latest))

  return {
    available: true,
    detected,
    summary: detected.length
      ? `偵測到 ${detected.map((item) => item.name).join('、')}`
      : '未偵測到明確型態',
  }
}

function detectDoubleBottom(bars, latest) {
  const recent = bars.slice(-60)
  const lows = findSwingLows(recent).slice(-6)
  const output = []
  for (let i = 0; i < lows.length - 1; i += 1) {
    for (let j = i + 1; j < lows.length; j += 1) {
      const first = lows[i]
      const second = lows[j]
      if ((percentDiff(first.price, second.price) || 1) > 0.05) continue
      if (second.price < first.price * 0.95) continue
      const middle = recent.slice(first.index, second.index + 1)
      const neckline = maxHigh(middle)
      if (neckline && latest.close > neckline) {
        output.push(pattern('double_bottom_confirmed', true, 'medium', '最近 60 日出現雙重底並突破 neckline。', {
          neckline: round(neckline, 2),
        }))
        return output
      }
    }
  }
  return output
}

function detectDoubleTop(bars, latest) {
  const recent = bars.slice(-60)
  const highs = findSwingHighs(recent).slice(-6)
  const output = []
  for (let i = 0; i < highs.length - 1; i += 1) {
    for (let j = i + 1; j < highs.length; j += 1) {
      const first = highs[i]
      const second = highs[j]
      if ((percentDiff(first.price, second.price) || 1) > 0.05) continue
      if (second.price > first.price * 1.05) continue
      const middle = recent.slice(first.index, second.index + 1)
      const neckline = minLow(middle)
      if (neckline && latest.close < neckline) {
        output.push(pattern('double_top_confirmed', true, 'medium', '最近 60 日出現雙重頂並跌破 neckline。', {
          neckline: round(neckline, 2),
        }))
        return output
      }
    }
  }
  return output
}

function detectHeadAndShoulders(bars, latest) {
  const recent = bars.slice(-90)
  const output = []
  const highs = findSwingHighs(recent).slice(-8)
  for (let i = 0; i < highs.length - 2; i += 1) {
    const left = highs[i]
    const head = highs[i + 1]
    const right = highs[i + 2]
    if (!(head.price > left.price && head.price > right.price)) continue
    if ((percentDiff(left.price, right.price) || 1) > 0.08) continue
    const neckline = minLow(recent.slice(left.index, right.index + 1))
    if (neckline && latest.close < neckline) {
      output.push(pattern('head_and_shoulders_top', true, 'medium', '最近 90 日出現簡化頭肩頂並跌破 neckline。', {
        neckline: round(neckline, 2),
      }))
      break
    }
  }

  const lows = findSwingLows(recent).slice(-8)
  for (let i = 0; i < lows.length - 2; i += 1) {
    const left = lows[i]
    const head = lows[i + 1]
    const right = lows[i + 2]
    if (!(head.price < left.price && head.price < right.price)) continue
    if ((percentDiff(left.price, right.price) || 1) > 0.08) continue
    const neckline = maxHigh(recent.slice(left.index, right.index + 1))
    if (neckline && latest.close > neckline) {
      output.push(pattern('inverse_head_and_shoulders', true, 'medium', '最近 90 日出現簡化頭肩底並突破 neckline。', {
        neckline: round(neckline, 2),
      }))
      break
    }
  }

  return output
}
