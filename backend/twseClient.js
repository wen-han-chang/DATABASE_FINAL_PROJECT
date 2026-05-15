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
  const { timeoutMs, userAgent } = getConfig()
  const url = buildTwseUrl(path, query)
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
  stockDayAll: '/exchangeReport/STOCK_DAY_ALL',
  stockDayAverageAll: '/exchangeReport/STOCK_DAY_AVG_ALL',
}

/**
 * 讀取市場總覽資料。
 * 這個函式會被 server.js 的 /api/twse/market-index 路由使用。
 */
export async function fetchMarketIndex() {
  return fetchTwseJson(TWSE_SAMPLE_ENDPOINTS.marketIndex)
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
