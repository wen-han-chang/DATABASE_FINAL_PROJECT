/**
 * 前端專用的 TWSE API 呼叫封裝。
 *
 * 這個檔案不直接跟 TWSE 官方網址溝通，而是先打你自己的 backend。
 * 原因很簡單：
 * 1. 前端不用處理 CORS。
 * 2. TWSE 官方路徑變動時，只要 backend 改就好。
 * 3. 之後如果要加快取、權限、資料清洗，也只要改 backend。
 */

const DEFAULT_BACKEND_BASE_URL = 'http://localhost:3001'

/**
 * 取得 backend base URL。
 * 這裡支援 Vite 環境變數，方便你之後部署時切換。
 */
function getBackendBaseUrl() {
  const envBaseUrl = import.meta.env.VITE_BACKEND_BASE_URL
  return (envBaseUrl || DEFAULT_BACKEND_BASE_URL).replace(/\/+$/, '')
}

/**
 * 組合查詢字串。
 * 當你之後要傳 stockCode、date、path 等參數時，這裡會重複用到。
 */
function buildQueryString(query = {}) {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }

  const text = params.toString()
  return text ? `?${text}` : ''
}

/**
 * 統一處理 backend 回應。
 * 如果 backend 回傳 ok: false，這裡直接丟錯，讓元件自己決定怎麼顯示。
 */
async function requestJson(path, query = {}) {
  const url = `${getBackendBaseUrl()}${path}${buildQueryString(query)}`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  })

  const payload = await response.json().catch(async () => ({
    ok: false,
    error: await response.text(),
  }))

  if (!response.ok || payload.ok === false) {
    const message = payload?.error || `Request failed with status ${response.status}`
    throw new Error(message)
  }

  return payload
}

/**
 * 讀取 backend 健康檢查。
 */
export function getBackendHealth() {
  return requestJson('/api/health')
}

/**
 * 讀取 TWSE Swagger。
 * 這個通常用在除錯、文件確認、或列出可用端點。
 */
export function getTwseSwagger() {
  return requestJson('/api/twse/swagger')
}

/**
 * 讀取市場總覽資料。
 * 這是最適合先接到畫面的資料。
 */
export function getMarketIndex() {
  return requestJson('/api/twse/market-index')
}

/**
 * 讀取已整理成 stocks 表格式的股票資料。
 */
export function getMappedStocks() {
  return requestJson('/api/market/stocks')
}

/**
 * 讀取單一股票資料。
 */
export function getMappedStockByCode(code) {
  return requestJson(`/api/market/stocks/${encodeURIComponent(code)}`)
}

/**
 * 讀取已整理成 stock_daily_bars 表格式的最新交易日資料。
 */
export function getMappedDailyBars(query = {}) {
  return requestJson('/api/market/daily-bars', query)
}

/**
 * 讀取單一股票最新交易日 K 棒資料。
 */
export function getMappedDailyBarByCode(code) {
  return requestJson(`/api/market/daily-bars/${encodeURIComponent(code)}`)
}

/**
 * 讀取匯入預覽資料。
 * 回傳會包含 sectors、stocks、stock_daily_bars 三個區塊。
 */
export function getMarketImportPreview() {
  return requestJson('/api/market/import-preview')
}

/**
 * 通用 TWSE 代理入口。
 * path 會傳給 backend，再由 backend 轉給 TWSE 官方 API。
 */
export function getTwseRaw(path, query = {}) {
  return requestJson('/api/twse/raw', {
    path,
    ...query,
  })
}
