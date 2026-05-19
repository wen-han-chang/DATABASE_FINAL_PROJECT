function round(value, digits = 2) {
  return value == null ? null : +Number(value).toFixed(digits)
}

export function calcMA(closes, period) {
  return closes.map((_, index) => {
    if (index < period - 1) return null
    const sum = closes.slice(index - period + 1, index + 1).reduce((acc, value) => acc + value, 0)
    return round(sum / period)
  })
}

export function calcEMA(values, period) {
  const multiplier = 2 / (period + 1)
  const result = []
  let previous = null

  values.forEach((value, index) => {
    if (index < period - 1) {
      result.push(null)
      return
    }

    if (index === period - 1) {
      previous = values.slice(0, period).reduce((sum, item) => sum + item, 0) / period
      result.push(round(previous, 4))
      return
    }

    previous = ((value - previous) * multiplier) + previous
    result.push(round(previous, 4))
  })

  return result
}

export function calcBollinger(closes, period = 20, multiplier = 2) {
  const middle = calcMA(closes, period)
  const calcBand = (direction) => closes.map((_, index) => {
    if (index < period - 1) return null
    const window = closes.slice(index - period + 1, index + 1)
    const mean = middle[index]
    const variance = window.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / period
    return round(mean + (direction * Math.sqrt(variance) * multiplier))
  })

  return {
    middle,
    upper: calcBand(1),
    lower: calcBand(-1),
  }
}

export function calcKD(candles, period = 9) {
  const k = []
  const d = []
  let previousK = 50
  let previousD = 50

  candles.forEach((candle, index) => {
    if (index < period - 1) {
      k.push(null)
      d.push(null)
      return
    }

    const window = candles.slice(index - period + 1, index + 1)
    const highest = Math.max(...window.map((item) => item.high))
    const lowest = Math.min(...window.map((item) => item.low))
    const rsv = highest === lowest ? 50 : ((candle.close - lowest) / (highest - lowest)) * 100

    previousK = ((2 / 3) * previousK) + ((1 / 3) * rsv)
    previousD = ((2 / 3) * previousD) + ((1 / 3) * previousK)

    k.push(round(previousK))
    d.push(round(previousD))
  })

  return { k, d }
}

export function calcRSI(closes, period = 14) {
  const result = Array(closes.length).fill(null)
  if (closes.length <= period) return result

  let gains = 0
  let losses = 0

  for (let index = 1; index <= period; index++) {
    const diff = closes[index] - closes[index - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }

  let avgGain = gains / period
  let avgLoss = losses / period
  result[period] = avgLoss === 0 ? 100 : round(100 - (100 / (1 + (avgGain / avgLoss))))

  for (let index = period + 1; index < closes.length; index++) {
    const diff = closes[index] - closes[index - 1]
    const gain = Math.max(diff, 0)
    const loss = Math.max(-diff, 0)
    avgGain = ((avgGain * (period - 1)) + gain) / period
    avgLoss = ((avgLoss * (period - 1)) + loss) / period
    result[index] = avgLoss === 0 ? 100 : round(100 - (100 / (1 + (avgGain / avgLoss))))
  }

  return result
}

export function calcMACD(closes) {
  const ema12 = calcEMA(closes, 12)
  const ema26 = calcEMA(closes, 26)
  const dif = closes.map((_, index) => (
    ema12[index] == null || ema26[index] == null
      ? null
      : round(ema12[index] - ema26[index], 4)
  ))

  const signal = []
  let previous = null
  const multiplier = 2 / 10

  dif.forEach((value, index) => {
    if (value == null) {
      signal.push(null)
      return
    }

    const available = dif.slice(0, index + 1).filter((item) => item != null)
    if (available.length < 9) {
      signal.push(null)
      return
    }

    if (available.length === 9) {
      previous = available.reduce((sum, item) => sum + item, 0) / 9
      signal.push(round(previous, 4))
      return
    }

    previous = ((value - previous) * multiplier) + previous
    signal.push(round(previous, 4))
  })

  return {
    dif,
    signal,
    histogram: dif.map((value, index) => (
      value == null || signal[index] == null ? null : round(value - signal[index], 4)
    )),
  }
}

function normalizeBars(bars) {
  return Array.isArray(bars)
    ? bars
      .map((bar) => ({
        ...bar,
        open: Number(bar.open),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.close),
        volume: Number(bar.volume || 0),
      }))
      .filter((bar) => (
        Number.isFinite(bar.open)
        && Number.isFinite(bar.high)
        && Number.isFinite(bar.low)
        && Number.isFinite(bar.close)
      ))
    : []
}

export function buildTechnicalSeries(bars) {
  const cleanBars = normalizeBars(bars)
  const closes = cleanBars.map((bar) => bar.close)
  const volumes = cleanBars.map((bar) => Number(bar.volume || 0))

  return {
    bars: cleanBars,
    closes,
    volumes,
    ma5: calcMA(closes, 5),
    ma20: calcMA(closes, 20),
    ma60: calcMA(closes, 60),
    kd: calcKD(cleanBars),
    rsi14: calcRSI(closes),
    macd: calcMACD(closes),
    bollinger: calcBollinger(closes),
    volumeMA5: calcMA(volumes, 5),
    volumeMA20: calcMA(volumes, 20),
  }
}

function lastDefined(values) {
  for (let index = values.length - 1; index >= 0; index--) {
    if (values[index] != null) return values[index]
  }
  return null
}

function previousDefined(values) {
  let foundLatest = false
  for (let index = values.length - 1; index >= 0; index--) {
    if (values[index] == null) continue
    if (!foundLatest) {
      foundLatest = true
      continue
    }
    return values[index]
  }
  return null
}

function describeTrend(latestClose, ma5, ma20, ma60) {
  if ([latestClose, ma5, ma20, ma60].some((value) => value == null)) return '資料不足'
  if (latestClose > ma5 && ma5 > ma20 && ma20 > ma60) return '多頭排列'
  if (latestClose < ma5 && ma5 < ma20 && ma20 < ma60) return '空頭排列'
  return '均線糾結'
}

function describeKd(k, d, previousK, previousD) {
  if ([k, d, previousK, previousD].some((value) => value == null)) return '資料不足'
  if (previousK <= previousD && k > d) return '黃金交叉'
  if (previousK >= previousD && k < d) return '死亡交叉'
  if (k >= 80 && d >= 80) return '高檔區'
  if (k <= 20 && d <= 20) return '低檔區'
  return k >= d ? 'K 在 D 之上' : 'K 在 D 之下'
}

function describeRsi(value) {
  if (value == null) return '資料不足'
  if (value >= 70) return '偏熱'
  if (value <= 30) return '偏弱'
  if (value >= 55) return '偏強'
  if (value <= 45) return '偏弱整理'
  return '中性'
}

function describeMacd(dif, signal, hist, previousHist) {
  if ([dif, signal, hist, previousHist].some((value) => value == null)) return '資料不足'
  if (dif > signal && hist > 0 && hist > previousHist) return '多方增強'
  if (dif < signal && hist < 0 && hist < previousHist) return '空方增強'
  if (hist > 0 && hist < previousHist) return '多方動能收斂'
  if (hist < 0 && hist > previousHist) return '空方動能收斂'
  return dif >= signal ? '偏多' : '偏空'
}

function describeBollinger(latestClose, upper, middle, lower) {
  if ([latestClose, upper, middle, lower].some((value) => value == null)) return '資料不足'
  if (latestClose >= upper) return '接近或突破上軌'
  if (latestClose <= lower) return '接近或跌破下軌'
  if (latestClose >= middle) return '位於中軌之上'
  return '位於中軌之下'
}

export function summarizeTechnicalIndicators(bars) {
  const series = buildTechnicalSeries(bars)
  if (series.bars.length < 20) return null

  const latest = series.bars[series.bars.length - 1]

  const latestMa5 = lastDefined(series.ma5)
  const latestMa20 = lastDefined(series.ma20)
  const latestMa60 = lastDefined(series.ma60)
  const latestK = lastDefined(series.kd.k)
  const latestD = lastDefined(series.kd.d)
  const previousK = previousDefined(series.kd.k)
  const previousD = previousDefined(series.kd.d)
  const latestRsi = lastDefined(series.rsi14)
  const latestDif = lastDefined(series.macd.dif)
  const latestSignal = lastDefined(series.macd.signal)
  const latestHist = lastDefined(series.macd.histogram)
  const previousHist = previousDefined(series.macd.histogram)
  const latestBbUpper = lastDefined(series.bollinger.upper)
  const latestBbMid = lastDefined(series.bollinger.middle)
  const latestBbLower = lastDefined(series.bollinger.lower)

  return {
    asOfDate: latest.date,
    close: latest.close,
    movingAverages: {
      ma5: latestMa5,
      ma20: latestMa20,
      ma60: latestMa60,
      structure: describeTrend(latest.close, latestMa5, latestMa20, latestMa60),
    },
    kd: {
      k: latestK,
      d: latestD,
      signal: describeKd(latestK, latestD, previousK, previousD),
    },
    rsi: {
      rsi14: latestRsi,
      signal: describeRsi(latestRsi),
    },
    macd: {
      dif: latestDif,
      dea: latestSignal,
      histogram: latestHist,
      signal: describeMacd(latestDif, latestSignal, latestHist, previousHist),
    },
    bollinger: {
      upper: latestBbUpper,
      middle: latestBbMid,
      lower: latestBbLower,
      signal: describeBollinger(latest.close, latestBbUpper, latestBbMid, latestBbLower),
    },
    sampleSize: series.bars.length,
  }
}
