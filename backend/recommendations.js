import { query, withTransaction, sql } from './db.js'
import { getPortfolio, getQuote, getStockBars, getWatchlist } from './dao.js'
import { summarizeTechnicalIndicators } from './technicalIndicators.js'

const TAIPEI_TIME_ZONE = 'Asia/Taipei'
const ON_DEMAND_SLOT = 'ondemand'

function getTaipeiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TAIPEI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

function getTaipeiDateText(date = new Date()) {
  const parts = getTaipeiParts(date)
  return `${parts.year}-${parts.month}-${parts.day}`
}

function summarizeBars(bars) {
  if (!bars.length) return null
  const latest = bars[bars.length - 1]
  const bars20 = bars.slice(-20)
  const first20 = bars20[0] || latest
  const return20dPct = first20.close
    ? +(((latest.close - first20.close) / first20.close) * 100).toFixed(2)
    : null

  return {
    firstDate: bars[0].date,
    latestDate: latest.date,
    latestClose: latest.close,
    return20dPct,
    sampleSize: bars.length,
  }
}

function scoreTechnical(technicals, barsSummary) {
  if (!technicals) return { score: null, reasons: ['技術資料不足'] }

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

  if (barsSummary?.return20dPct != null) {
    score += Math.max(-2, Math.min(2, barsSummary.return20dPct / 10))
    reasons.push(`20 日報酬 ${barsSummary.return20dPct}%`)
  }

  return { score: +score.toFixed(4), reasons }
}

function buildHoldingAction({ technicalScore, pnlPct }) {
  if (technicalScore == null) {
    return {
      code: 'data_limited',
      label: '資料不足',
    }
  }

  if (technicalScore <= -3 || (pnlPct <= -8 && technicalScore <= 0)) {
    return {
      code: 'reduce_or_sell',
      label: '建議減碼 / 賣出',
    }
  }

  if (pnlPct >= 12 && technicalScore < 1) {
    return {
      code: 'take_profit',
      label: '可考慮分批停利',
    }
  }

  if (technicalScore >= 3) {
    return {
      code: 'hold',
      label: '可續抱',
    }
  }

  return {
    code: 'hold_watch',
    label: '續抱觀察',
  }
}

function buildWatchlistAction(technicalScore) {
  if (technicalScore == null) {
    return {
      code: 'data_limited',
      label: '資料不足',
    }
  }

  if (technicalScore >= 3) {
    return {
      code: 'consider_buy',
      label: '可考慮買進',
    }
  }

  if (technicalScore <= -2) {
    return {
      code: 'avoid_entry',
      label: '暫不建議進場',
    }
  }

  return {
    code: 'watch',
    label: '持續觀察',
  }
}

function buildHoldingReason({ pnlPct, actionLabel, reasons }) {
  const pnlText = pnlPct >= 0
    ? `目前帳面報酬 ${pnlPct.toFixed(2)}%`
    : `目前帳面虧損 ${Math.abs(pnlPct).toFixed(2)}%`
  const technicalText = reasons.length ? reasons.join('、') : '技術資料不足'
  return `${pnlText}；${technicalText}，因此目前判斷為「${actionLabel}」。`
}

function buildWatchlistReason({ actionLabel, reasons }) {
  const technicalText = reasons.length ? reasons.join('、') : '技術資料不足'
  return `${technicalText}，因此目前判斷為「${actionLabel}」。`
}

async function loadSnapshot(code) {
  const [quoteResult, barsResult] = await Promise.allSettled([
    getQuote(code),
    getStockBars(code),
  ])

  const quote = quoteResult.status === 'fulfilled' ? quoteResult.value : null
  const bars = barsResult.status === 'fulfilled' ? barsResult.value.bars : []
  const barsSummary = summarizeBars(bars)
  const technicals = summarizeTechnicalIndicators(bars)
  const technical = scoreTechnical(technicals, barsSummary)

  return {
    quote,
    barsSummary,
    technicals,
    technicalScore: technical.score,
    technicalReasons: technical.reasons,
  }
}

async function buildHoldingItems(holdings) {
  const items = []

  for (const holding of holdings) {
    const snapshot = await loadSnapshot(holding.code)
    const latestPrice = Number(snapshot.quote?.price ?? snapshot.barsSummary?.latestClose ?? holding.avgCost)
    const shares = Number(holding.lots ?? holding.shares ?? 0)
    const avgCost = Number(holding.avgCost)
    const pnl = +(shares * (latestPrice - avgCost)).toFixed(2)
    const cost = shares * avgCost
    const pnlPct = cost > 0 ? +((pnl / cost) * 100).toFixed(4) : 0
    const action = buildHoldingAction({
      technicalScore: snapshot.technicalScore,
      pnlPct,
    })

    items.push({
      category: 'holding',
      code: holding.code,
      name: holding.name,
      actionCode: action.code,
      actionLabel: action.label,
      score: snapshot.technicalScore,
      price: latestPrice,
      avgCost,
      shares,
      pnl,
      pnlPct,
      reason: buildHoldingReason({
        pnlPct,
        actionLabel: action.label,
        reasons: snapshot.technicalReasons,
      }),
      snapshot,
    })
  }

  return items
}

async function buildWatchlistItems(watchlistRows) {
  const items = []

  for (const stock of watchlistRows) {
    const snapshot = await loadSnapshot(stock.code)
    const latestPrice = Number(snapshot.quote?.price ?? snapshot.barsSummary?.latestClose ?? 0)
    const action = buildWatchlistAction(snapshot.technicalScore)

    items.push({
      category: 'watchlist',
      code: stock.code,
      name: stock.name,
      actionCode: action.code,
      actionLabel: action.label,
      score: snapshot.technicalScore,
      price: latestPrice || null,
      avgCost: null,
      shares: null,
      pnl: null,
      pnlPct: null,
      reason: buildWatchlistReason({
        actionLabel: action.label,
        reasons: snapshot.technicalReasons,
      }),
      snapshot,
    })
  }

  return items
}

function summarizeHoldings(items) {
  const totalCost = items.reduce((sum, item) => sum + ((item.avgCost || 0) * (item.shares || 0)), 0)
  const totalValue = items.reduce((sum, item) => sum + ((item.price || 0) * (item.shares || 0)), 0)
  const totalPnl = +(totalValue - totalCost).toFixed(2)
  const totalPnlPct = totalCost > 0 ? +((totalPnl / totalCost) * 100).toFixed(4) : 0

  return {
    holdingCount: items.length,
    totalCost: +totalCost.toFixed(2),
    totalValue: +totalValue.toFixed(2),
    totalPnl,
    totalPnlPct,
    profitableCount: items.filter((item) => Number(item.pnl) > 0).length,
    losingCount: items.filter((item) => Number(item.pnl) < 0).length,
  }
}

function buildHoldingFingerprints(holdings = []) {
  return holdings
    .map((holding) => `${holding.code}:${Number(holding.lots ?? holding.shares ?? 0)}:${Number(holding.avgCost)}`)
    .sort()
}

function buildWatchlistCodes(watchlist = []) {
  return watchlist.map((stock) => stock.code).sort()
}

async function runExists(userId, slotDate, slotLabel) {
  const rows = await query(
    `SELECT id
     FROM dbo.assistant_recommendation_runs
     WHERE user_id = @uid
       AND slot_date = @slotDate
       AND slot_label = @slotLabel`,
    { uid: userId, slotDate, slotLabel },
  )
  return rows[0]?.id ?? null
}

export async function generateRecommendationRun(userId, slotDate, slotLabel, { force = false } = {}) {
  const existingRunId = await runExists(userId, slotDate, slotLabel)
  if (existingRunId && !force) return existingRunId

  const [portfolio, watchlist] = await Promise.all([
    getPortfolio(userId),
    getWatchlist(userId),
  ])
  const holdingItems = await buildHoldingItems(portfolio.holdings || [])
  const watchlistItems = await buildWatchlistItems(watchlist)
  const items = [...holdingItems, ...watchlistItems]
  const summary = {
    slotDate,
    slotLabel,
    holdingSummary: summarizeHoldings(holdingItems),
    holdingCount: holdingItems.length,
    watchlistCount: watchlistItems.length,
    holdingFingerprints: buildHoldingFingerprints(portfolio.holdings || []),
    watchlistCodes: buildWatchlistCodes(watchlist),
  }

  return withTransaction(async (tx) => {
    if (existingRunId && force) {
      await new sql.Request(tx)
        .input('runId', sql.BigInt, existingRunId)
        .query('DELETE FROM dbo.assistant_recommendation_runs WHERE id = @runId')
    }

    const runRows = await new sql.Request(tx)
      .input('uid', sql.BigInt, userId)
      .input('slotDate', sql.Date, slotDate)
      .input('slotLabel', sql.VarChar(10), slotLabel)
      .input('summaryJson', sql.NVarChar(sql.MAX), JSON.stringify(summary))
      .query(`INSERT INTO dbo.assistant_recommendation_runs
                (user_id, slot_date, slot_label, summary_json)
              OUTPUT INSERTED.id
              VALUES
                (@uid, @slotDate, @slotLabel, @summaryJson)`)

    const runId = runRows.recordset[0].id
    for (const item of items) {
      await new sql.Request(tx)
        .input('runId', sql.BigInt, runId)
        .input('category', sql.VarChar(20), item.category)
        .input('stockCode', sql.VarChar(10), item.code)
        .input('stockName', sql.NVarChar(100), item.name)
        .input('actionCode', sql.VarChar(30), item.actionCode)
        .input('actionLabel', sql.NVarChar(30), item.actionLabel)
        .input('score', sql.Decimal(8, 4), item.score)
        .input('price', sql.Decimal(10, 2), item.price)
        .input('avgCost', sql.Decimal(10, 4), item.avgCost)
        .input('shares', sql.Int, item.shares)
        .input('pnl', sql.Decimal(15, 2), item.pnl)
        .input('pnlPct', sql.Decimal(10, 4), item.pnlPct)
        .input('reason', sql.NVarChar(sql.MAX), item.reason)
        .input('snapshotJson', sql.NVarChar(sql.MAX), JSON.stringify(item.snapshot))
        .query(`INSERT INTO dbo.assistant_recommendation_items
                  (run_id, category, stock_code, stock_name, action_code, action_label,
                   score, price, avg_cost, shares, pnl, pnl_pct, reason, snapshot_json)
                VALUES
                  (@runId, @category, @stockCode, @stockName, @actionCode, @actionLabel,
                   @score, @price, @avgCost, @shares, @pnl, @pnlPct, @reason, @snapshotJson)`)
    }

    return runId
  })
}

export async function getLatestRecommendation(userId) {
  const runs = await query(
    `SELECT TOP (1)
            id,
            CONVERT(varchar(10), slot_date, 23) AS slotDate,
            slot_label AS slotLabel,
            generated_at AS generatedAt,
            summary_json AS summaryJson
     FROM dbo.assistant_recommendation_runs
     WHERE user_id = @uid
     ORDER BY slot_date DESC, slot_label DESC, generated_at DESC`,
    { uid: userId },
  )

  const run = runs[0]
  if (!run) return null

  const items = await query(
    `SELECT category,
            stock_code AS code,
            stock_name AS name,
            action_code AS actionCode,
            action_label AS actionLabel,
            score,
            price,
            avg_cost AS avgCost,
            shares,
            pnl,
            pnl_pct AS pnlPct,
            reason,
            snapshot_json AS snapshotJson
     FROM dbo.assistant_recommendation_items
     WHERE run_id = @runId
     ORDER BY CASE category WHEN 'holding' THEN 0 ELSE 1 END,
              stock_code ASC`,
    { runId: run.id },
  )

  return {
    id: run.id,
    slotDate: run.slotDate,
    slotLabel: run.slotLabel,
    generatedAt: run.generatedAt,
    summary: JSON.parse(run.summaryJson),
    items: items.map((item) => ({
      ...item,
      score: item.score == null ? null : Number(item.score),
      price: item.price == null ? null : Number(item.price),
      avgCost: item.avgCost == null ? null : Number(item.avgCost),
      pnl: item.pnl == null ? null : Number(item.pnl),
      pnlPct: item.pnlPct == null ? null : Number(item.pnlPct),
      snapshot: JSON.parse(item.snapshotJson),
    })),
  }
}

export async function generateOnDemandRecommendationForUser(userId, date = new Date()) {
  const slotDate = getTaipeiDateText(date)
  await generateRecommendationRun(userId, slotDate, ON_DEMAND_SLOT, { force: true })
  return getLatestRecommendation(userId)
}
