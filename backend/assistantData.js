import { query, withTransaction, sql } from './db.js'
import vm from 'node:vm'
import { fetchStockDayAll } from './twseClient.js'
import { mapStockDayAll } from './twseMapper.js'
import { getQuote, getStockBars } from './dao.js'
import { summarizeTechnicalIndicators } from './technicalIndicators.js'
import { analyzeTechnicalRules } from './technicalRules/index.js'
import { getLatestFundamentals } from './assistantFundamentals.js'
import {
  getLatestIndustries,
  getStockCodesForTopics,
  getTopicsForStocks,
  normalizeRequestedSectors,
  normalizeRequestedTopics,
} from './assistantClassifications.js'

const YUANTA_RATIO_URL = (etfCode) => `https://www.yuantaetfs.com/product/detail/${encodeURIComponent(etfCode)}/ratio`
const YUANTA_PCF_URL = (etfCode) => `https://www.yuantaetfs.com/tradeInfo/pcf/${encodeURIComponent(etfCode)}`
const HOLDING_CACHE_HOURS = 12
const MAX_MARKET_CONTEXT_CODES = 12
const SCREENING_CONCURRENCY = 4
const MIN_RANKING_TECHNICAL_BARS = 120
const DEFAULT_RECOMMENDATION_ETF_CODE = '0050'

function toIsoDate(raw) {
  const match = String(raw || '').match(/(\d{4})[/-]?(\d{2})[/-]?(\d{2})/)
  if (!match) return null
  return `${match[1]}-${match[2]}-${match[3]}`
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseYuantaRatioPage(etfCode, html) {
  const text = htmlToText(html)
  const tradeDate = toIsoDate(
    text.match(/(?:交易日期|Trade Date):\s+(\d{4}[/-]\d{2}[/-]\d{2})/i)?.[1],
  )
  if (!tradeDate) return []

  const rows = []
  const regex = /股票代號\s+([A-Za-z0-9]+)\s+股票名稱\s+(.+?)\s+股數\s+([\d,]+)\s+權重\s+([\d.]+)/g
  let match
  while ((match = regex.exec(text)) !== null) {
    const stockCode = match[1].trim()
    if (!/^\d{4,6}$/.test(stockCode)) continue

    rows.push({
      etfCode,
      tradeDate,
      stockCode,
      stockName: match[2].trim(),
      quantity: Number(String(match[3]).replace(/,/g, '')),
      weight: Number(match[4]),
      sourceUrl: YUANTA_RATIO_URL(etfCode),
    })
  }

  return rows
}

async function fetchYuantaHoldings(etfCode) {
  const sourceUrl = YUANTA_RATIO_URL(etfCode)
  const response = await fetch(sourceUrl, {
    headers: {
      Accept: 'text/html',
      'User-Agent': 'database-final-project/1.0',
    },
    signal: AbortSignal.timeout(20000),
  })

  if (!response.ok) {
    throw new Error(`ETF holdings HTTP ${response.status}`)
  }

  const html = await response.text()
  return parseYuantaRatioPage(etfCode, html)
}

function parseYuantaPcfPage(etfCode, html) {
  const embeddedRows = parseYuantaEmbeddedPcfPage(etfCode, html)
  if (embeddedRows.length) return embeddedRows

  const text = htmlToText(html)
  const tradeDate = toIsoDate(
    text.match(/(?:交易日期|Trade Date):\s+(\d{4}[/-]\d{2}[/-]\d{2})/i)?.[1],
  )
  if (!tradeDate) return []

  const rows = []
  const regex = /股票代號\s+([A-Za-z0-9]+)\s+股票名稱\s+(.+?)\s+數量\s+([\d,]+)/g
  let match
  while ((match = regex.exec(text)) !== null) {
    const stockCode = match[1].trim()
    if (!/^\d{4,6}$/.test(stockCode)) continue

    rows.push({
      etfCode,
      tradeDate,
      stockCode,
      stockName: match[2].trim(),
      quantity: Number(String(match[3]).replace(/,/g, '')),
      weight: null,
      sourceUrl: YUANTA_PCF_URL(etfCode),
    })
  }

  return rows
}

function parseYuantaEmbeddedPcfPage(etfCode, html) {
  const match = String(html || '').match(/<script>window\.__NUXT__=([\s\S]*?)<\/script>/i)
  if (!match?.[1]) return []

  try {
    const sandbox = { window: {} }
    vm.runInNewContext(`window.__NUXT__=${match[1]}`, sandbox, { timeout: 1000 })
    const nuxt = sandbox.window.__NUXT__
    const pcfData = nuxt?.fetch?.[0]?.pcfData || nuxt?.data?.find((item) => item?.pcfData)?.pcfData
    const fundComposition = pcfData?.InKind?.FundComposition
    const stockWeights = pcfData?.FundWeights?.StockWeights
    const tradeDate = toIsoDate(pcfData?.PCF?.trandate)

    if (!Array.isArray(fundComposition) || !tradeDate) return []

    const weightsByCode = new Map((stockWeights || []).map((row) => [
      String(row.code || '').trim(),
      Number(row.weights),
    ]))

    return fundComposition
      .map((row) => ({
        etfCode,
        tradeDate,
        stockCode: String(row.stkcd || '').trim(),
        stockName: String(row.name || '').trim(),
        quantity: Number(row.qty),
        weight: weightsByCode.has(String(row.stkcd || '').trim())
          ? weightsByCode.get(String(row.stkcd || '').trim())
          : null,
        sourceUrl: YUANTA_PCF_URL(etfCode),
      }))
      .filter((row) => row.stockCode && /^\d{4,6}$/.test(row.stockCode))
  } catch (error) {
    console.warn(`[assistant] Failed to parse embedded PCF holdings for ${etfCode}:`, error.message)
    return []
  }
}

async function fetchYuantaPcfHoldings(etfCode) {
  const sourceUrl = YUANTA_PCF_URL(etfCode)
  const response = await fetch(sourceUrl, {
    headers: {
      Accept: 'text/html',
      'User-Agent': 'database-final-project/1.0',
    },
    signal: AbortSignal.timeout(20000),
  })

  if (!response.ok) {
    throw new Error(`ETF PCF holdings HTTP ${response.status}`)
  }

  const html = await response.text()
  return parseYuantaPcfPage(etfCode, html)
}

function mergeHoldings(ratioRows, pcfRows) {
  if (!pcfRows.length) return ratioRows
  const ratioByCode = new Map(ratioRows.map((row) => [row.stockCode, row]))

  return pcfRows.map((row) => {
    const ratioRow = ratioByCode.get(row.stockCode)
    return {
      ...row,
      weight: ratioRow?.weight ?? row.weight,
    }
  })
}

async function readLatestHoldings(etfCode) {
  return query(
    `WITH snapshot_counts AS (
       SELECT trade_date, COUNT(*) AS row_count
       FROM dbo.assistant_etf_holdings
       WHERE etf_code = @etfCode
       GROUP BY trade_date
     ),
     chosen AS (
       SELECT TOP (1) trade_date
       FROM snapshot_counts
       ORDER BY row_count DESC, trade_date DESC
     )
     SELECT h.etf_code AS etfCode,
            CONVERT(varchar(10), h.trade_date, 23) AS tradeDate,
            h.stock_code AS stockCode,
            h.stock_name AS stockName,
            h.quantity,
            h.weight,
            h.source_url AS sourceUrl,
            h.fetched_at AS fetchedAt
     FROM dbo.assistant_etf_holdings h
     JOIN chosen c ON h.trade_date = c.trade_date
     WHERE h.etf_code = @etfCode
     ORDER BY h.weight DESC, h.stock_code ASC`,
    { etfCode },
  )
}

function holdingsAreFresh(rows, etfCode) {
  if (!rows.length) return false
  if (etfCode === '0050' && rows.length < 40) return false
  const fetchedAt = rows[0].fetchedAt instanceof Date
    ? rows[0].fetchedAt
    : new Date(rows[0].fetchedAt)
  return Date.now() - fetchedAt.getTime() < HOLDING_CACHE_HOURS * 60 * 60 * 1000
}

async function saveHoldings(rows) {
  if (!rows.length) return

  await withTransaction(async (tx) => {
    for (const row of rows) {
      await new sql.Request(tx)
        .input('etfCode', sql.VarChar(10), row.etfCode)
        .input('tradeDate', sql.Date, row.tradeDate)
        .input('stockCode', sql.VarChar(10), row.stockCode)
        .input('stockName', sql.NVarChar(100), row.stockName)
        .input('quantity', sql.BigInt, row.quantity)
        .input('weight', sql.Decimal(8, 4), row.weight)
        .input('sourceUrl', sql.NVarChar(500), row.sourceUrl)
        .query(`IF EXISTS (
                  SELECT 1
                  FROM dbo.assistant_etf_holdings
                  WHERE etf_code = @etfCode
                    AND trade_date = @tradeDate
                    AND stock_code = @stockCode
                )
                  UPDATE dbo.assistant_etf_holdings
                     SET stock_name = @stockName,
                         quantity = @quantity,
                         weight = @weight,
                         source_url = @sourceUrl,
                         fetched_at = SYSDATETIME()
                   WHERE etf_code = @etfCode
                     AND trade_date = @tradeDate
                     AND stock_code = @stockCode;
                ELSE
                  INSERT INTO dbo.assistant_etf_holdings
                    (etf_code, trade_date, stock_code, stock_name, quantity, weight, source_url)
                  VALUES
                    (@etfCode, @tradeDate, @stockCode, @stockName, @quantity, @weight, @sourceUrl);`)
    }
  })
}

export async function getEtfHoldings(etfCode) {
  const cleanCode = String(etfCode || '').trim()
  if (!cleanCode) return []

  const cached = await readLatestHoldings(cleanCode)
  if (holdingsAreFresh(cached, cleanCode)) return cached

  let ratioRows = []
  let pcfRows = []

  try {
    ratioRows = await fetchYuantaHoldings(cleanCode)
  } catch (error) {
    console.warn(`[assistant] Failed to fetch ratio holdings for ${cleanCode}:`, error.message)
  }

  try {
    pcfRows = await fetchYuantaPcfHoldings(cleanCode)
  } catch (error) {
    console.warn(`[assistant] Failed to fetch PCF holdings for ${cleanCode}:`, error.message)
  }

  const mergedRows = mergeHoldings(ratioRows, pcfRows)
  if (mergedRows.length) {
    await saveHoldings(mergedRows)
    return readLatestHoldings(cleanCode)
  }

  if (ratioRows.length) {
    await saveHoldings(ratioRows)
    return readLatestHoldings(cleanCode)
  }

  if (pcfRows.length) {
    await saveHoldings(pcfRows)
    if (pcfRows.length) {
      return readLatestHoldings(cleanCode)
    }
  }

  return cached
}

async function readExistingStocks(codes) {
  if (!codes.length) return []
  const placeholders = codes.map((_, index) => `@c${index}`).join(', ')
  const params = Object.fromEntries(codes.map((code, index) => [`c${index}`, code]))
  return query(
    `SELECT s.code, s.name, sec.name AS sector
     FROM dbo.stocks s
     JOIN dbo.sectors sec ON sec.id = s.sector_id
     WHERE s.code IN (${placeholders})`,
    params,
  )
}

async function ensureSectorId(name) {
  const existing = await query('SELECT id FROM dbo.sectors WHERE name = @name', { name })
  if (existing[0]?.id) return existing[0].id

  const inserted = await query(
    `INSERT INTO dbo.sectors (name)
     OUTPUT INSERTED.id
     VALUES (@name)`,
    { name },
  )
  return inserted[0].id
}

async function insertMissingStocks(stockRows) {
  for (const row of stockRows) {
    const sectorId = await ensureSectorId(row.sector_name || '未分類')
    await query(
      `IF NOT EXISTS (SELECT 1 FROM dbo.stocks WHERE code = @code)
         INSERT INTO dbo.stocks
           (code, name, sector_id, base_price, volatility, is_etf, is_active)
         VALUES
           (@code, @name, @sectorId, @basePrice, @volatility, @isEtf, 1);`,
      {
        code: row.code,
        name: row.name,
        sectorId,
        basePrice: row.base_price ?? 0,
        volatility: row.volatility ?? 0.018,
        isEtf: row.is_etf ? 1 : 0,
      },
    )
  }
}

export async function ensureStocksExist(codes) {
  const uniqueCodes = [...new Set((codes || []).map((code) => String(code || '').trim()).filter(Boolean))]
  if (!uniqueCodes.length) return []

  const existing = await readExistingStocks(uniqueCodes)
  const existingCodes = new Set(existing.map((row) => row.code))
  const missingCodes = uniqueCodes.filter((code) => !existingCodes.has(code))

  if (missingCodes.length) {
    const latestRows = await fetchStockDayAll()
    const mapped = mapStockDayAll(latestRows)
    const missingStocks = mapped.stocks.filter((stock) => missingCodes.includes(stock.code))
    await insertMissingStocks(missingStocks)
  }

  return readExistingStocks(uniqueCodes)
}

function summarizeBars(bars) {
  if (!bars.length) return null
  const first = bars[0]
  const latest = bars[bars.length - 1]
  const bars20 = bars.slice(-20)
  const bars60 = bars.slice(-60)
  const first20 = bars20[0] || latest
  const first60 = bars60[0] || latest

  const pct = (from, to) => {
    if (!from || !to || !from.close) return null
    return +(((to.close - from.close) / from.close) * 100).toFixed(2)
  }

  return {
    firstDate: first.date,
    latestDate: latest.date,
    latestClose: latest.close,
    return20dPct: pct(first20, latest),
    return60dPct: pct(first60, latest),
    sampleSize: bars.length,
  }
}

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function positiveNumber(value) {
  const number = finiteNumber(value)
  return number != null && number > 0 ? number : null
}

function roundNumber(value, digits = 4) {
  const number = finiteNumber(value)
  return number == null ? null : +number.toFixed(digits)
}

function valuationAvailability({ dividendYield, peRatio, pbRatio }) {
  return {
    dividendYield: {
      available: dividendYield != null,
      reason: dividendYield == null
        ? 'TWSE BWIBBU_d 未提供有效殖利率，系統不自行推估股利。'
        : null,
    },
    peRatio: {
      available: peRatio != null,
      reason: peRatio == null
        ? 'TWSE BWIBBU_d 未提供有效本益比，常見原因是 EPS 為 0 或負值，或官方當日未提供該欄位；目前系統未接 EPS/季報資料源，因此不自行重算。'
        : null,
    },
    pbRatio: {
      available: pbRatio != null,
      reason: pbRatio == null
        ? 'TWSE BWIBBU_d 未提供有效股價淨值比，系統不自行推估每股淨值。'
        : null,
    },
  }
}

function snapshotValuationPrice(snapshot) {
  const quotePrice = finiteNumber(snapshot?.quote?.price)
  if (quotePrice != null && quotePrice > 0) {
    return {
      price: quotePrice,
      source: 'TWSE MIS quote',
      date: snapshot?.quote?.date || null,
      time: snapshot?.quote?.time || null,
    }
  }

  const latestClose = finiteNumber(snapshot?.bars?.latestClose)
  if (latestClose != null && latestClose > 0) {
    return {
      price: latestClose,
      source: 'latest daily bar',
      date: snapshot?.bars?.latestDate || null,
      time: null,
    }
  }

  return null
}

function adjustFundamentalsForPrice(fundamentals, snapshot) {
  if (!fundamentals) return null

  const referenceClose = finiteNumber(fundamentals.closePrice)
  const valuationPrice = snapshotValuationPrice(snapshot)
  const dividendYield = finiteNumber(fundamentals.dividendYield)
  const sourcePeRatio = finiteNumber(fundamentals.peRatio)
  const sourcePbRatio = finiteNumber(fundamentals.pbRatio)
  const peRatio = positiveNumber(fundamentals.peRatio)
  const pbRatio = positiveNumber(fundamentals.pbRatio)
  const sanitized = {
    ...fundamentals,
    peRatio,
    pbRatio,
    valuationAvailability: valuationAvailability({ dividendYield, peRatio, pbRatio }),
  }

  if (!referenceClose || !valuationPrice?.price) {
    return { ...sanitized, priceAdjusted: false }
  }

  const priceRatio = valuationPrice.price / referenceClose

  return {
    ...sanitized,
    rawClosePrice: referenceClose,
    rawDividendYield: dividendYield,
    rawPeRatio: sourcePeRatio,
    rawPbRatio: sourcePbRatio,
    dividendYield: dividendYield == null ? null : roundNumber(dividendYield / priceRatio, 4),
    peRatio: peRatio == null ? null : roundNumber(peRatio * priceRatio, 4),
    pbRatio: pbRatio == null ? null : roundNumber(pbRatio * priceRatio, 4),
    valuationPrice: valuationPrice.price,
    valuationPriceSource: valuationPrice.source,
    valuationPriceDate: valuationPrice.date,
    valuationPriceTime: valuationPrice.time,
    priceAdjusted: true,
  }
}

function hasRequiredTechnicalDepth(bars, minBars = 20) {
  return bars.length >= minBars && summarizeTechnicalIndicators(bars) != null
}

async function loadMarketSnapshot(
  code,
  { fullTechnical = false, ensureTechnical = false, minTechnicalBars = 20 } = {},
) {
  const quotePromise = getQuote(code)
  const primaryBarsPromise = getStockBars(code, fullTechnical ? {} : { quick: true })
  const [quoteResult, primaryBarsResult] = await Promise.allSettled([
    quotePromise,
    primaryBarsPromise,
  ])

  let barsResult = primaryBarsResult
  let bars = barsResult.status === 'fulfilled' ? barsResult.value.bars : []

  // ETF 篩選優先用 quick bars 保持回應速度；
  // 若資料不足以達到此次用途需要的技術深度，再同步補抓完整歷史資料。
  if (ensureTechnical && !hasRequiredTechnicalDepth(bars, minTechnicalBars)) {
    const fullBarsResult = await Promise.allSettled([getStockBars(code)])
    barsResult = fullBarsResult[0]
    if (barsResult.status === 'fulfilled' && barsResult.value.bars.length) {
      bars = fullBarsResult[0].value.bars
    }
  }

  return {
    code,
    quote: quoteResult.status === 'fulfilled' ? quoteResult.value : null,
    bars: summarizeBars(bars),
    barsMeta: barsResult.status === 'fulfilled'
      ? {
        count: bars.length,
        source: barsResult.value.source,
        historyStatus: barsResult.value.historyStatus,
        error: barsResult.value.error || null,
      }
      : {
        count: 0,
        source: null,
        historyStatus: 'error',
        error: barsResult.reason instanceof Error ? barsResult.reason.message : String(barsResult.reason || ''),
      },
    technicals: summarizeTechnicalIndicators(bars),
    technicalRules: analyzeTechnicalRules(bars),
  }
}

function chunkedMap(items, limit, mapper) {
  const results = []
  let index = 0

  async function worker() {
    while (index < items.length) {
      const current = items[index]
      index += 1
      results.push(await mapper(current))
    }
  }

  return Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  ).then(() => results)
}

function scoreTechnical(snapshot) {
  if (snapshot.technicalRules?.available && snapshot.technicalRules?.scoring) {
    return {
      score: snapshot.technicalRules.scoring.totalScore,
      reasons: snapshot.technicalRules.scoring.reasons || [],
    }
  }

  const technicals = snapshot.technicals
  if (!technicals) return null

  let score = 0
  const reasons = []

  if (technicals.movingAverages?.structure === '多頭排列') {
    score += 3
    reasons.push('均線多頭排列')
  } else if (technicals.movingAverages?.structure === '空頭排列') {
    score -= 3
    reasons.push('均線空頭排列')
  }

  if (technicals.kd?.signal === '黃金交叉') {
    score += 2
    reasons.push('KD 黃金交叉')
  } else if (technicals.kd?.signal === '死亡交叉') {
    score -= 2
    reasons.push('KD 死亡交叉')
  }

  if (technicals.rsi?.signal === '偏強') {
    score += 1
    reasons.push('RSI 偏強')
  } else if (technicals.rsi?.signal === '偏熱') {
    score += 0.5
    reasons.push('RSI 偏熱')
  } else if (technicals.rsi?.signal?.includes('弱')) {
    score -= 1
    reasons.push(`RSI ${technicals.rsi.signal}`)
  }

  if (technicals.macd?.signal === '多方增強') {
    score += 2
    reasons.push('MACD 多方增強')
  } else if (technicals.macd?.signal === '空方增強') {
    score -= 2
    reasons.push('MACD 空方增強')
  }

  if (snapshot.bars?.return20dPct != null) {
    score += Math.max(-2, Math.min(2, snapshot.bars.return20dPct / 10))
    reasons.push(`20 日報酬 ${snapshot.bars.return20dPct}%`)
  }

  return { score: +score.toFixed(4), reasons }
}

function rankValues(candidates, getter, direction = 'desc') {
  const valid = candidates
    .map((candidate) => ({ candidate, value: getter(candidate) }))
    .filter((item) => item.value != null && Number.isFinite(Number(item.value)))
    .sort((a, b) => direction === 'desc'
      ? Number(b.value) - Number(a.value)
      : Number(a.value) - Number(b.value))

  const size = valid.length
  const scores = new Map()
  valid.forEach((item, index) => {
    scores.set(item.candidate.code, {
      rank: index + 1,
      total: size,
      value: Number(item.value),
      score: size <= 1 ? 1 : 1 - (index / (size - 1)),
    })
  })
  return scores
}

function normalizeRankingFactors(factors) {
  const allowed = new Set([
    'technical_strength',
    'dividend_yield',
    'low_pe',
    'low_pb',
    'etf_weight',
  ])
  const normalized = [...new Set((factors || []).filter((factor) => allowed.has(factor)))]
  return normalized.length ? normalized : ['technical_strength']
}

function rankingFactorWeights(factors) {
  const defaultWeights = {
    technical_strength: 0.4,
    dividend_yield: 0.2,
    low_pe: 0.2,
    low_pb: 0.2,
    etf_weight: 0.2,
  }
  return Object.fromEntries(
    factors.map((factor) => [factor, defaultWeights[factor] ?? 1]),
  )
}

function normalizeText(value) {
  return String(value || '').trim()
}

function matchesIndustry(candidate, filters) {
  if (!filters.length) return true
  const haystack = [
    normalizeText(candidate.industry),
    normalizeText(candidate.sector),
  ].filter(Boolean)

  return filters.every((filter) => haystack.some((value) => value.includes(filter)))
}

function matchesTopics(candidate, filters) {
  if (!filters.length) return true
  const topicCodes = new Set((candidate.topics || []).map((topic) => topic.code))
  return filters.every((filter) => topicCodes.has(filter))
}

function industryKey(candidate) {
  return candidate.industry || candidate.sector || '未分類'
}

function diversifyByIndustry(candidates, targetCount, maxPerIndustry = 2) {
  const selected = []
  const selectedCodes = new Set()
  const industryCounts = new Map()

  for (const candidate of candidates) {
    const key = industryKey(candidate)
    const count = industryCounts.get(key) || 0
    if (count >= maxPerIndustry) continue
    selected.push(candidate)
    selectedCodes.add(candidate.code)
    industryCounts.set(key, count + 1)
    if (selected.length >= targetCount) return selected
  }

  for (const candidate of candidates) {
    if (selectedCodes.has(candidate.code)) continue
    selected.push(candidate)
    if (selected.length >= targetCount) return selected
  }

  return selected
}

function summarizeIndustryConcentration(candidates) {
  const counts = new Map()
  for (const candidate of candidates) {
    const key = industryKey(candidate)
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  const groups = [...counts.entries()]
    .map(([industry, count]) => ({ industry, count }))
    .filter((item) => item.count > 1)
    .sort((a, b) => b.count - a.count)

  return {
    hasConcentration: groups.length > 0,
    groups,
  }
}

function screeningUniverseLabel(universeType, etfCodes = []) {
  if (universeType === 'etf_holdings' && etfCodes.length) {
    return etfCodes.length === 1 ? `${etfCodes[0]} 成分股` : `${etfCodes.join('、')} 成分股`
  }
  if (universeType === 'topic_memberships') return '題材股票池'
  return '候選股票池'
}

function rankScreeningCandidates(candidates, factors, targetCount = 5, options = {}) {
  const rankingFactors = normalizeRankingFactors(factors)
  const factorWeights = rankingFactorWeights(rankingFactors)
  const factorScores = {
    technical_strength: rankValues(candidates, (item) => item.technicalScore, 'desc'),
    dividend_yield: rankValues(candidates, (item) => item.fundamentals?.dividendYield, 'desc'),
    low_pe: rankValues(candidates, (item) => positiveNumber(item.fundamentals?.peRatio), 'asc'),
    low_pb: rankValues(candidates, (item) => positiveNumber(item.fundamentals?.pbRatio), 'asc'),
    etf_weight: rankValues(candidates, (item) => item.weight, 'desc'),
  }

  const rankedCandidates = candidates
    .map((candidate) => {
      const factorDetails = rankingFactors
        .map((factor) => {
          const detail = factorScores[factor].get(candidate.code)
          return {
            factor,
            available: Boolean(detail),
            score: detail?.score ?? 0,
            rank: detail?.rank,
            total: detail?.total,
            value: detail?.value,
            weight: factorWeights[factor],
          }
        })
      const totalWeight = factorDetails.reduce((sum, item) => sum + item.weight, 0)
      const score = totalWeight
        ? factorDetails.reduce((sum, item) => sum + (item.score * item.weight), 0) / totalWeight
        : null
      const factorBreakdown = Object.fromEntries(
        factorDetails.map((item) => [item.factor, {
          available: item.available,
          rank: item.rank,
          total: item.total,
          value: item.value,
          score: +item.score.toFixed(4),
          weight: item.weight,
        }]),
      )
      return {
        ...candidate,
        rankingFactors,
        rankingFactorWeights: factorWeights,
        factorBreakdown,
        score: score == null ? null : +score.toFixed(4),
      }
    })
    .filter((candidate) => candidate.score != null)
    .sort((a, b) => b.score - a.score)

  const selectedCandidates = options.diversifyIndustry
    ? diversifyByIndustry(rankedCandidates, targetCount, options.industryLimit || 2)
    : rankedCandidates.slice(0, targetCount)

  return selectedCandidates
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }))
}

async function buildScreeningContext(plan, holdingsByEtf) {
  const hasStructuredFilters = Boolean(plan.sectorFilters?.length || plan.topicFilters?.length)
  if (!plan.needsRecommendation && !hasStructuredFilters) return null

  const topicFilters = normalizeRequestedTopics(plan.topicFilters)
  const holdings = Object.values(holdingsByEtf).flat()
  let universeType = null
  let universeRows = holdings

  if (holdings.length) {
    universeType = 'etf_holdings'
  } else if (topicFilters.length) {
    const topicStockCodes = await getStockCodesForTopics(topicFilters)
    const topicCodes = topicStockCodes.map((row) => row.stockCode)
    const topicStocks = await ensureStocksExist(topicCodes)
    universeRows = topicStocks.map((stock) => ({
      stockCode: stock.code,
      stockName: stock.name,
      weight: null,
    }))
    universeType = 'topic_memberships'
  }

  if (!universeRows.length) return null

  const codes = universeRows.map((row) => row.stockCode)
  const rankingFactors = normalizeRankingFactors(plan.rankingFactors)
  const needsFundamentals = rankingFactors.some((factor) => (
    factor === 'dividend_yield' || factor === 'low_pe' || factor === 'low_pb'
  ))
  const [fundamentals, industries, topicRows, stockRows] = await Promise.all([
    needsFundamentals ? getLatestFundamentals(codes) : Promise.resolve([]),
    getLatestIndustries(codes),
    getTopicsForStocks(codes),
    readExistingStocks(codes),
  ])
  const fundamentalsByCode = new Map(fundamentals.map((row) => [row.stockCode, row]))
  const industriesByCode = new Map(industries.map((row) => [row.stockCode, row]))
  const topicsByCode = new Map()
  for (const row of topicRows) {
    const current = topicsByCode.get(row.stockCode) || []
    current.push({
      code: row.topicCode,
      name: row.topicName,
      note: row.note,
      sourceType: row.sourceType,
    })
    topicsByCode.set(row.stockCode, current)
  }
  const stocksByCode = new Map(stockRows.map((row) => [row.code, row]))

  const baseCandidates = universeRows.map((holding) => ({
    code: holding.stockCode,
    name: holding.stockName,
    weight: holding.weight == null ? null : Number(holding.weight),
    industry: industriesByCode.get(holding.stockCode)?.industryName || null,
    sector: stocksByCode.get(holding.stockCode)?.sector || null,
    topics: topicsByCode.get(holding.stockCode) || [],
    fundamentals: fundamentalsByCode.get(holding.stockCode) || null,
    technicals: null,
    technicalRules: null,
    bars: null,
    barsMeta: null,
    technicalScore: null,
    technicalReasons: [],
  }))

  const sectorFilters = normalizeRequestedSectors(plan.sectorFilters)
  const filteredBaseCandidates = baseCandidates.filter((candidate) => (
    matchesIndustry(candidate, sectorFilters) && matchesTopics(candidate, topicFilters)
  ))

  const needsTechnicalSnapshots = rankingFactors.includes('technical_strength')
  const snapshotCodes = needsTechnicalSnapshots
    ? filteredBaseCandidates.map((candidate) => candidate.code)
    : []
  const snapshots = await chunkedMap(snapshotCodes, SCREENING_CONCURRENCY, (code) => (
    loadMarketSnapshot(code, {
      ensureTechnical: true,
      minTechnicalBars: MIN_RANKING_TECHNICAL_BARS,
    })
  ))
  const snapshotsByCode = new Map(snapshots.map((snapshot) => [snapshot.code, snapshot]))

  const filteredCandidates = filteredBaseCandidates.map((candidate) => {
    const snapshot = snapshotsByCode.get(candidate.code)
    const technical = snapshot ? scoreTechnical(snapshot) : null
    return {
      ...candidate,
      fundamentals: adjustFundamentalsForPrice(candidate.fundamentals, snapshot),
      technicals: snapshot?.technicals || null,
      technicalRules: snapshot?.technicalRules || null,
      bars: snapshot?.bars || null,
      barsMeta: snapshot?.barsMeta || null,
      technicalScore: technical?.score ?? null,
      technicalReasons: technical?.reasons || [],
    }
  })

  const targetCount = Math.min(Math.max(Number(plan.targetCount || 5), 1), 10)
  const diversifyIndustry = Boolean(plan.needsRecommendation && targetCount >= 3 && !sectorFilters.length)
  const rankedCandidates = rankScreeningCandidates(
    filteredCandidates,
    plan.rankingFactors,
    targetCount,
    {
      diversifyIndustry,
      industryLimit: 2,
    },
  )
  const universeLabel = screeningUniverseLabel(universeType, plan.etfCodes || [])

  return {
    universeType,
    universeLabel,
    etfCodes: plan.etfCodes,
    rankingFactors,
    appliedFilters: {
      sectors: sectorFilters,
      topics: topicFilters,
    },
    targetCount,
    totalCandidates: baseCandidates.length,
    matchedCandidateCount: filteredCandidates.length,
    rankedCandidates,
    diversityRule: {
      enabled: diversifyIndustry,
      maxPerIndustry: diversifyIndustry ? 2 : null,
    },
    industryConcentration: summarizeIndustryConcentration(rankedCandidates),
    dataBasis: {
      universe: universeLabel,
      price: 'TWSE MIS 即時或收盤報價',
      fundamentals: needsFundamentals
        ? 'TWSE BWIBBU_d 估值欄位，並以最新報價重新估算殖利率、PE、PB'
        : '本次排序未使用基本面估值欄位',
      technicals: 'TWSE 日線歷史資料計算 MA、KD、RSI、MACD、Bollinger 與技術規則',
    },
    candidates: filteredCandidates,
  }
}

export async function buildAssistantScreeningDiagnostics(etfCode) {
  const cleanCode = String(etfCode || '').trim()
  const holdingsByEtf = {
    [cleanCode]: await getEtfHoldings(cleanCode),
  }

  const context = await buildScreeningContext({
    etfCodes: [cleanCode],
    needsRecommendation: true,
    targetCount: 10,
    rankingFactors: ['technical_strength'],
    sectorFilters: [],
    topicFilters: [],
  }, holdingsByEtf)

  return {
    etfCode: cleanCode,
    holdingCount: holdingsByEtf[cleanCode].length,
    holdings: holdingsByEtf[cleanCode],
    candidateCount: context?.candidates?.length || 0,
    candidates: (context?.candidates || []).map((candidate) => ({
      code: candidate.code,
      name: candidate.name,
      industry: candidate.industry,
      sector: candidate.sector,
      topics: candidate.topics,
      barsCount: candidate.bars?.sampleSize || 0,
      barsMeta: candidate.barsMeta,
      hasTechnicals: Boolean(candidate.technicals),
    })),
  }
}

export async function buildAssistantContext(plan) {
  const etfCodes = plan.needsRecommendation
    ? [DEFAULT_RECOMMENDATION_ETF_CODE]
    : [...new Set(plan.etfCodes || [])]
  const explicitSymbols = [...new Set(plan.symbols || [])]

  const holdingsByEtf = {}
  for (const etfCode of etfCodes) {
    holdingsByEtf[etfCode] = await getEtfHoldings(etfCode)
  }

  const holdingCodes = Object.values(holdingsByEtf)
    .flat()
    .map((row) => row.stockCode)

  const relevantCodes = [...new Set([...explicitSymbols, ...holdingCodes])]
  const stocks = await ensureStocksExist(relevantCodes)

  const topHoldingCodes = Object.values(holdingsByEtf)
    .flat()
    .sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0))
    .slice(0, MAX_MARKET_CONTEXT_CODES)
    .map((row) => row.stockCode)

  const marketCodes = [...new Set([...explicitSymbols, ...topHoldingCodes])].slice(0, MAX_MARKET_CONTEXT_CODES)
  const explicitCodeSet = new Set(explicitSymbols)
  const marketSnapshots = await Promise.all(
    marketCodes.map((code) => loadMarketSnapshot(code, {
      fullTechnical: explicitCodeSet.has(code),
    })),
  )
  const contextRankingFactors = normalizeRankingFactors(plan.rankingFactors)
  const needsRecommendationFundamentals = contextRankingFactors.some((factor) => (
    factor === 'dividend_yield' || factor === 'low_pe' || factor === 'low_pb'
  ))
  const fundamentalCodes = plan.needsRecommendation && !needsRecommendationFundamentals
    ? explicitSymbols
    : [...new Set([...explicitSymbols, ...holdingCodes])]
  const fundamentalsRaw = fundamentalCodes.length
    ? await getLatestFundamentals(fundamentalCodes)
    : []
  const snapshotsByCode = new Map(marketSnapshots.map((snapshot) => [snapshot.code, snapshot]))
  const fundamentals = fundamentalsRaw.map((item) => (
    adjustFundamentalsForPrice(item, snapshotsByCode.get(item.stockCode))
  ))
  const effectivePlan = { ...plan, etfCodes }
  const screening = await buildScreeningContext(effectivePlan, holdingsByEtf)

  return {
    stocks,
    requestedCodes: relevantCodes,
    holdingsByEtf,
    marketSnapshots,
    fundamentals,
    screening,
    sources: [
      ...etfCodes.map((code) => ({
        type: 'etf_holdings',
        code,
        source: YUANTA_RATIO_URL(code),
      })),
      ...marketCodes.map((code) => ({
        type: 'quote_or_history',
        code,
        source: 'TWSE',
      })),
      ...(fundamentals.length ? [{
        type: 'fundamentals',
        source: 'TWSE.BWIBBU_d',
      }] : []),
      ...(screening && !fundamentals.length ? [{
        type: 'fundamentals',
        source: 'TWSE.BWIBBU_d',
      }] : []),
      ...(screening ? [{
        type: 'industries',
        source: 'TWSE.t187ap03_L',
      }] : []),
      ...(screening?.appliedFilters?.topics?.length ? [{
        type: 'topics',
        source: 'curated',
      }] : []),
    ],
  }
}

