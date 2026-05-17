/**
 * api.js — 前端呼叫「應用後端」的封裝（帳號 / 問卷 / 投資組合 / 下單）。
 *
 * 與 twseApi.js 的分工：
 * - twseApi.js：只管 TWSE 行情查詢（GET）。
 * - api.js（本檔）：管會讀寫 ncu_db 的業務 API，且需要登入 token。
 *
 * token 設計：
 * - 登入成功後，後端回一段 HMAC token。
 * - 我們存在 localStorage（key: invest_ai_token），每次請求帶
 *   Authorization: Bearer <token>。
 * - 這樣重新整理頁面仍維持登入（DB 才是真正資料來源，token 只是憑證）。
 */

const DEFAULT_BACKEND_BASE_URL = 'http://localhost:3001'
const TOKEN_KEY = 'invest_ai_token'

function getBackendBaseUrl() {
  const envBaseUrl = import.meta.env.VITE_BACKEND_BASE_URL
  return (envBaseUrl || DEFAULT_BACKEND_BASE_URL).replace(/\/+$/, '')
}

// ── token 存取 ──────────────────────────────────────────────
export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

/**
 * 共用請求函式。
 * - 自動帶 JSON header 與（若有）Authorization。
 * - 後端回 ok:false 或 HTTP 非 2xx 時，丟出帶後端訊息的 Error，
 *   讓呼叫端（store）能把訊息顯示給使用者。
 *
 * @param {string} path   例如 '/api/auth/login'
 * @param {object} options { method, body, auth }
 */
async function request(path, { method = 'GET', body = null, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (auth) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(`${getBackendBaseUrl()}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const payload = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))

  if (!res.ok || payload.ok === false) {
    throw new Error(payload?.error || `Request failed (${res.status})`)
  }
  return payload
}

// ── 帳號 ────────────────────────────────────────────────────
export function registerApi({ email, password, name, avatar }) {
  return request('/api/auth/register', { method: 'POST', body: { email, password, name, avatar } })
}
export function loginApi({ email, password }) {
  return request('/api/auth/login', { method: 'POST', body: { email, password } })
}

// ── 投資人偏好 ──────────────────────────────────────────────
export function getProfileApi() {
  return request('/api/investor-profile', { auth: true })
}
export function saveProfileApi({ capitalRange, riskLevel, period }) {
  return request('/api/investor-profile', {
    method: 'POST', auth: true, body: { capitalRange, riskLevel, period },
  })
}

// ── 投資組合 / 下單 ─────────────────────────────────────────
export function getPortfolioApi() {
  return request('/api/portfolio', { auth: true })
}
export function setupPortfolioApi(capital) {
  return request('/api/portfolio/setup', { method: 'POST', auth: true, body: { capital } })
}
export function resetPortfolioApi() {
  return request('/api/portfolio/reset', { method: 'POST', auth: true })
}
export function buyApi({ code, shares, price }) {
  return request('/api/orders/buy', { method: 'POST', auth: true, body: { code, shares, price } })
}
export function sellApi({ code, shares, price }) {
  return request('/api/orders/sell', { method: 'POST', auth: true, body: { code, shares, price } })
}

export function chatAssistantApi(message) {
  return request('/api/assistant/chat', {
    method: 'POST',
    auth: true,
    body: { message },
  })
}
