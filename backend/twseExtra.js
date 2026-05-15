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
const UA = 'Mozilla/5.0 (database-final-project)'

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
    // z=最近成交價；收盤前/無成交時可能是 "-"，退而用昨收當顯示價
    let price = toNum(m.z)
    let closed = false
    if (price == null) {
      price = prevClose
      closed = true
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
