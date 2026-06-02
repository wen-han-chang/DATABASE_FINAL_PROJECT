/**
 * TWSE API client.
 *
 * 這個檔案只負責兩件事：
 * 1. 組合 TWSE 官方 API 的 URL。
 * 2. 發送請求並把回傳資料轉成 JSON。
 *
 * 這樣拆開的原因很直接：
 * - server.js 只需要處理 HTTP 路由，不需要知道 TWSE 細節。
 * - 之後如果 TWSE 的 base URL 或路徑改了，只要改這一個檔案。
 */

const DEFAULT_BASE_URL = 'https://openapi.twse.com.tw/v1'
const DEFAULT_TWSE_WEB_BASE_URL = 'https://www.twse.com.tw'
const DEFAULT_TIMEOUT_MS = 30000
const DEFAULT_USER_AGENT = 'database-final-project/1.0'

/**
 * 取出環境變數，並做最基本的整理。
 * 這裡不做過度複雜的設定，因為你現在需要的是一個可以直接懂的版本。
 */
function getConfig() {
  const baseUrl = (process.env.TWSE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const timeoutMs = Number(process.env.TWSE_REQUEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  const userAgent = process.env.TWSE_USER_AGENT || DEFAULT_USER_AGENT

  return {
    baseUrl,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
    userAgent,
  }
}

/**
 * 把 upstream path 正規化成可拼接的格式。
 * 規則：
 * - 必須以 / 開頭，這樣看起來清楚，也比較不容易組錯。
 * - 不接受空字串，避免送出無意義請求。
 */
function normalizePath(path) {
  if (typeof path !== 'string') {
    throw new TypeError('TWSE path must be a string.')
  }

  const trimmed = path.trim()

  if (!trimmed) {
    throw new Error('TWSE path cannot be empty.')
  }

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/**
 * 把 query object 轉成 URLSearchParams。
 * 這裡會略過 null / undefined / 空字串，避免把無效參數送給 TWSE。
 */
function toSearchParams(query = {}) {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }

  return params
}

/**
 * 建立完整的 TWSE URL。
 * baseUrl 來自環境變數，path 由呼叫端指定，query 則可選。
 */
function buildTwseUrl(path, query = {}) {
  const { baseUrl } = getConfig()
  const normalizedPath = normalizePath(path)
  const url = new URL(`${baseUrl}${normalizedPath}`)
  const params = toSearchParams(query)

  for (const [key, value] of params.entries()) {
    url.searchParams.set(key, value)
  }

  return url
}

function buildTwseWebUrl(path, query = {}) {
  const normalizedPath = normalizePath(path)
  const url = new URL(`${DEFAULT_TWSE_WEB_BASE_URL}${normalizedPath}`)
  const params = toSearchParams(query)

  for (const [key, value] of params.entries()) {
    url.searchParams.set(key, value)
  }

  return url
}

async function fetchJsonUrl(url) {
  const { timeoutMs, userAgent } = getConfig()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`TWSE request timed out after ${timeoutMs} ms.`))
  }, timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': userAgent,
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      throw new Error(`TWSE request failed: ${response.status} ${response.statusText}${bodyText ? ` - ${bodyText.slice(0, 300)}` : ''}`)
    }

    return response.json()
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 發送 GET 請求到 TWSE，並把回傳內容當作 JSON 處理。
 *
 * 為什麼這裡直接回 JSON：
 * - 這類資料服務幾乎都是 JSON。
 * - 前端和後端都比較好處理。
 *
 * 如果 TWSE 某次回傳非 JSON，這裡會直接丟錯，讓 server.js 統一處理。
 */
export async function fetchTwseJson(path, query = {}) {
  const url = buildTwseUrl(path, query)
  return fetchJsonUrl(url)
}

/**
 * 這是你會最常用到的官方 Swagger 文件。
 * 先把它透過 backend 轉出去，方便前端或除錯工具直接讀。
 */
export async function fetchTwseSwagger() {
  return fetchTwseJson('/swagger.json')
}

/**
 * 這裡先放一個常見的市場總覽範例。
 * 如果你之後想換成別的資料，只要改這個常數，不用翻整個專案。
 *
 * 注意：
 * - 這個路徑是官方 Swagger 中常見的市場總覽端點。
 * - 若 TWSE 之後調整路徑，只有這個地方需要改。
 */
export const TWSE_SAMPLE_ENDPOINTS = {
  marketIndex: '/exchangeReport/MI_INDEX',
  marketIndexDaily: '/exchangeReport/MI_INDEX',
  stockDayAll: '/exchangeReport/STOCK_DAY_ALL',
  stockDayAverageAll: '/exchangeReport/STOCK_DAY_AVG_ALL',
}

function toTaipeiDate(date = new Date()) {
  return new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }))
}

function toTwseDateText(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

function toRocDateText(yyyymmdd) {
  const text = String(yyyymmdd || '')
  if (!/^\d{8}$/.test(text)) return ''
  const rocYear = String(Number(text.slice(0, 4)) - 1911).padStart(3, '0')
  return `${rocYear}${text.slice(4)}`
}

function previousCalendarDates(startDate, days = 5) {
  const dates = []
  const cursor = new Date(startDate)
  while (dates.length < days) {
    dates.push(toTwseDateText(cursor))
    cursor.setDate(cursor.getDate() - 1)
  }
  return dates
}

function normalizeDailyMarketIndex(payload, yyyymmdd) {
  const tables = Array.isArray(payload?.tables) ? payload.tables : []
  const table = tables.find((item) => {
    const fields = item?.fields || []
    return fields.includes('指數') && fields.some((field) => String(field).includes('收盤指數'))
  })

  if (!table || !Array.isArray(table.data) || !table.data.length) return []

  return table.data
    .map((row) => {
      const values = Array.isArray(row) ? row : []
      const indexName = values[0]
      const close = values[1]
      const directionRaw = values[2]
      const changePoint = values[3]
      const changePct = values[4]
      if (!indexName || close == null) return null
      const directionText = String(directionRaw || '')
      const direction = directionText.includes('-') ? '-' : '+'
      return {
        日期: toRocDateText(yyyymmdd),
        指數: String(indexName).trim(),
        收盤指數: String(close).trim(),
        漲跌: direction,
        漲跌點數: String(changePoint ?? '').trim(),
        漲跌百分比: String(changePct ?? '').trim(),
        特殊處理註記: '',
      }
    })
    .filter(Boolean)
}

async function fetchMarketIndexFromDailyReport() {
  const today = toTaipeiDate()
  const dates = previousCalendarDates(today, 7)

  for (const date of dates) {
    const url = buildTwseWebUrl(TWSE_SAMPLE_ENDPOINTS.marketIndexDaily, {
      response: 'json',
      date,
      type: 'ALLBUT0999',
    })

    try {
      const payload = await fetchJsonUrl(url)
      const rows = normalizeDailyMarketIndex(payload, date)
      const taiex = rows.find((row) => row['指數'] === '發行量加權股價指數')
      if (taiex) {
        return {
          source: 'TWSE daily MI_INDEX',
          endpoint: TWSE_SAMPLE_ENDPOINTS.marketIndexDaily,
          queryDate: date,
          dataDate: taiex['日期'],
          data: rows,
        }
      }
    } catch {
      // Try the next recent date, then fall back to OpenAPI below.
    }
  }

  return null
}

/**
 * 讀取市場總覽資料。
 * 這個函式會被 server.js 的 /api/twse/market-index 路由使用。
 */
export async function fetchMarketIndex() {
  const daily = await fetchMarketIndexFromDailyReport()
  if (daily) return daily

  const data = await fetchTwseJson(TWSE_SAMPLE_ENDPOINTS.marketIndex)
  const taiex = Array.isArray(data)
    ? data.find((row) => row?.['指數'] === '發行量加權股價指數')
    : null
  return {
    source: 'TWSE OpenAPI',
    endpoint: TWSE_SAMPLE_ENDPOINTS.marketIndex,
    dataDate: taiex?.['日期'] || null,
    data,
  }
}

/**
 * 讀取上市個股日成交資訊。
 * 這個端點是目前最能對應 stock_daily_bars 的 TWSE OpenAPI 資料來源。
 */
export async function fetchStockDayAll() {
  return fetchTwseJson(TWSE_SAMPLE_ENDPOINTS.stockDayAll)
}

/**
 * 讀取上市個股日收盤價及月平均價。
 * 它不含 open/high/low/volume，所以不能完整取代 stock_daily_bars。
 */
export async function fetchStockDayAverageAll() {
  return fetchTwseJson(TWSE_SAMPLE_ENDPOINTS.stockDayAverageAll)
}

/**
 * 讓 backend 能當成通用 proxy 使用。
 * 你可以透過 path 指定 TWSE 的任何官方路徑。
 */
export async function fetchRawTwsePath(path, query = {}) {
  return fetchTwseJson(path, query)
}
