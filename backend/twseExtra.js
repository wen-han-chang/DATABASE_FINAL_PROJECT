/**
 * twseExtra.js — TWSE 額外資料來源
 *
 * 與 twseClient.js 的分工：
 * - twseClient.js：openapi.twse.com.tw（整理過的開放資料，只有最新一天）
 * - twseExtra.js（本檔）：兩個「另外的」官方來源——
 *   1. 歷史日線：www.twse.com.tw 的 STOCK_DAY（一檔、一個月）
 *   2. 即時報價：mis.twse.com.tw 的 getStockInfo（單檔準即時，延遲數秒）
 *
 * 為什麼分檔：這兩個不在 openapi 基底網址、回傳格式也不同（民國日期、
 * 數字含逗號、即時報價是 msgArray），獨立成一個檔比較好維護。
 */

const STOCK_DAY_URL = 'https://www.twse.com.tw/exchangeReport/STOCK_DAY'
const MIS_URL = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp'
const FINMIND_URL = 'https://api.finmindtrade.com/api/v4/data'
const UA = 'Mozilla/5.0 (database-final-project)'

function isMarketCloseTime(timeText) {
  const match = String(timeText || '').match(/^(\d{1,2}):(\d{2})/)
  if (!match) return false
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return minutes >= (13 * 60 + 30)
}

// 共用：把 "1,234.00" 這種字串轉成數字；轉不出來回 null
function toNum(s) {
  if (s == null) return null
  const n = Number(String(s).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

// 民國日期 "113/06/03" → 西元 "2024-06-03"
function rocToIso(roc) {
  const m = String(roc).trim().split('/')
  if (m.length !== 3) return null
  const y = Number(m[0]) + 1911
  const mo = String(Number(m[1])).padStart(2, '0')
  const d = String(Number(m[2])).padStart(2, '0')
  return `${y}-${mo}-${d}`
}

/**
 * 抓某檔股票「某個月」的日線。
 * @param {string} stockNo 例 '2330'
 * @param {number} year 西元年，例 2025
 * @param {number} month 1~12
 * @returns {Promise<Array<{date,open,high,low,close,volume}>>} 該月日線（可能空陣列）
 */
export async function fetchStockDayMonth(stockNo, year, month) {
  // date 參數給該月任一天（用 01 號），TWSE 會回整個月
  const dateParam = `${year}${String(month).padStart(2, '0')}01`
  const url = `${STOCK_DAY_URL}?response=json&date=${dateParam}&stockNo=${encodeURIComponent(stockNo)}`

  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`STOCK_DAY HTTP ${res.status}`)

  const json = await res.json()
  // stat 不是 OK（例如該月無資料、代碼錯）就回空陣列，不丟錯（讓上層續跑）
  if (!json || json.stat !== 'OK' || !Array.isArray(json.data)) return []

  const bars = []
  for (const row of json.data) {
    // row = [日期, 成交股數, 成交金額, 開, 高, 低, 收, 漲跌, 筆數, 註記]
    const date = rocToIso(row[0])
    const open = toNum(row[3])
    const high = toNum(row[4])
    const low = toNum(row[5])
    const close = toNum(row[6])
    const volume = toNum(row[1])
    // 任一關鍵欄位壞掉就跳過這筆，確保進資料庫的資料乾淨
    if (!date || open == null || high == null || low == null || close == null) continue
    bars.push({ date, open, high, low, close, volume: volume ?? 0 })
  }
  return bars
}

/**
 * 抓某檔最近 N 個月的日線（由舊到新、去重）。
 * 月與月之間留一點間隔，對官方伺服器客氣一點，避免被擋。
 *
 * @param {string} stockNo
 * @param {number} months 要回溯幾個月（MA240 約需 12 個月）
 * @returns {Promise<Array<{date,open,high,low,close,volume}>>}
 */
export async function fetchRecentHistory(stockNo, months = 13) {
  const now = new Date()
  const byDate = new Map()

  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    let monthBars = []
    try {
      monthBars = await fetchStockDayMonth(stockNo, d.getFullYear(), d.getMonth() + 1)
    } catch {
      // 單一月份失敗不要讓整批掛掉，跳過該月
      monthBars = []
    }
    for (const b of monthBars) byDate.set(b.date, b)
    // 對官方客氣：每次間隔 250ms（最後一次不用等）
    if (i < months - 1) await new Promise((r) => setTimeout(r, 250))
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function toIsoDay(date) {
  return date.toISOString().slice(0, 10)
}

function monthsAgo(months) {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() - months, now.getDate())
}

async function fetchFinMindHistoryRange(stockNo, startDate, endDate) {
  const url = new URL(FINMIND_URL)
  url.searchParams.set('dataset', 'TaiwanStockPrice')
  url.searchParams.set('data_id', stockNo)
  url.searchParams.set('start_date', startDate)
  url.searchParams.set('end_date', endDate)
  if (process.env.FINMIND_TOKEN) {
    url.searchParams.set('token', process.env.FINMIND_TOKEN)
  }

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': UA,
    },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`FinMind HTTP ${res.status}`)

  const json = await res.json()
  if (!json || Number(json.status) !== 200 || !Array.isArray(json.data)) {
    throw new Error(`FinMind invalid response for ${stockNo}`)
  }

  return json.data
    .map((row) => ({
      date: String(row.date || '').trim(),
      open: toNum(row.open),
      high: toNum(row.max),
      low: toNum(row.min),
      close: toNum(row.close),
      volume: toNum(row.Trading_Volume) ?? 0,
    }))
    .filter((bar) => (
      /^\d{4}-\d{2}-\d{2}$/.test(bar.date)
      && bar.open != null
      && bar.high != null
      && bar.low != null
      && bar.close != null
    ))
}

export async function fetchRecentHistoryWithFallback(stockNo, months = 13) {
  const twseBars = await fetchRecentHistory(stockNo, months)
  if (twseBars.length) {
    return { bars: twseBars, provider: 'twse' }
  }

  const startDate = toIsoDay(monthsAgo(months))
  const endDate = toIsoDay(new Date())
  const finMindBars = await fetchFinMindHistoryRange(stockNo, startDate, endDate)
  return { bars: finMindBars, provider: finMindBars.length ? 'finmind' : 'finmind.empty' }
}

/**
 * 以 beforeDate 為界，往更早的月份補抓歷史日線。
 * 例如 beforeDate=2025-05-02、months=12，會抓 2024-05 ~ 2025-04。
 *
 * @param {string} stockNo
 * @param {string} beforeDate YYYY-MM-DD
 * @param {number} months
 * @returns {Promise<Array<{date,open,high,low,close,volume}>>}
 */
export async function fetchHistoryBefore(stockNo, beforeDate, months = 12) {
  const match = String(beforeDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) throw new Error('beforeDate must use YYYY-MM-DD format.')

  const anchorYear = Number(match[1])
  const anchorMonth = Number(match[2])
  const byDate = new Map()

  for (let i = 1; i <= months; i++) {
    // anchorMonth 是 1-based；Date 的月份是 0-based。
    const d = new Date(anchorYear, anchorMonth - 1 - i, 1)
    let monthBars = []
    try {
      monthBars = await fetchStockDayMonth(stockNo, d.getFullYear(), d.getMonth() + 1)
    } catch {
      monthBars = []
    }
    for (const b of monthBars) byDate.set(b.date, b)
    if (i < months) await new Promise((r) => setTimeout(r, 250))
  }

  return [...byDate.values()]
    .filter((b) => b.date < beforeDate)
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function fetchHistoryBeforeWithFallback(stockNo, beforeDate, months = 12) {
  const twseBars = await fetchHistoryBefore(stockNo, beforeDate, months)
  if (twseBars.length) {
    return { bars: twseBars, provider: 'twse' }
  }

  const match = String(beforeDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) throw new Error('beforeDate must use YYYY-MM-DD format.')

  const anchorYear = Number(match[1])
  const anchorMonth = Number(match[2])
  const start = new Date(anchorYear, anchorMonth - 1 - months, 1)
  const end = new Date(anchorYear, anchorMonth - 1, 0)
  const finMindBars = await fetchFinMindHistoryRange(stockNo, toIsoDay(start), toIsoDay(end))
  return {
    bars: finMindBars.filter((bar) => bar.date < beforeDate),
    provider: finMindBars.length ? 'finmind' : 'finmind.empty',
  }
}

/**
 * 抓單一檔「準即時」報價（TWSE MIS，延遲約數秒～20 秒）。
 * 收盤後/假日會等於最新收盤。
 *
 * @param {string} code 例 '2330'
 * @returns {Promise<{code,name,price,prevClose,open,high,low,volume,time,date,change,changePct,closed:boolean}>}
 */
export async function fetchQuote(code) {
  // 先試上市(tse)，查不到再試上櫃(otc)
  for (const ex of ['tse', 'otc']) {
    const url = `${MIS_URL}?ex_ch=${ex}_${encodeURIComponent(code)}.tw&json=1&delay=0`
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) continue

    const json = JSON.parse((await res.text()).trim())
    const m = json?.msgArray?.[0]
    if (!m) continue

    const prevClose = toNum(m.y)
    // z=最近成交價；盤中偶爾回傳 "-"（無最近成交），改用委買賣中間價估算
    let price = toNum(m.z)
    let closed = isMarketCloseTime(m.t || m['%'])
    if (price == null) {
      const bestBid = toNum((m.b || '').split('_')[0])
      const bestAsk = toNum((m.a || '').split('_')[0])
      if (bestBid != null && bestAsk != null) {
        price = +((bestBid + bestAsk) / 2).toFixed(2)
      } else {
        price = bestBid ?? bestAsk ?? prevClose
      }
      // closed 由 isMarketCloseTime 決定，z="-" 不代表收盤
    }
    const change = price != null && prevClose != null ? +(price - prevClose).toFixed(2) : null
    const changePct =
      change != null && prevClose ? +((change / prevClose) * 100).toFixed(2) : null

    return {
      code: m.c || code,
      name: m.n || '',
      price,
      prevClose,
      open: toNum(m.o),
      high: toNum(m.h),
      low: toNum(m.l),
      volume: toNum(m.v), // 累積成交量（張）
      time: m.t || m['%'] || '',
      date: m.d || '',
      change,
      changePct,
      closed,
    }
  }
  throw new Error(`查無 ${code} 的即時報價`)
}
