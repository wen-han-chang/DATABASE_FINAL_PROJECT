/**
 * auth.js — 密碼雜湊與登入 token（零外部依賴，全用 Node 內建 crypto）
 *
 * 設計取捨（務實，符合期末專題範圍）：
 * - schema 註解原寫「bcrypt hash」，但 bcrypt 是原生編譯套件，
 *   在 Node 18 / Windows 常常裝不起來。這裡改用 Node 內建的 scrypt，
 *   它同樣是業界認可的慢雜湊（KDF），且零依賴、跨平台。
 *   → 欄位仍是 users.password VARCHAR(255)，存格式為 "salt:hash"。
 * - token 不做完整 JWT 基礎建設（對課程 demo 是過度設計）。
 *   改用最小可行的 HMAC 簽章 token：payload 用 base64url 編碼，
 *   後面接 HMAC-SHA256 簽章，能驗「沒被竄改」即足夠。
 */

import {
  scryptSync,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from 'node:crypto'

// scrypt 輸出長度（位元組）。64 byte 已很充足。
const KEY_LEN = 64

/**
 * 把明碼密碼雜湊成可存進資料庫的字串。
 * 格式："<salt hex>:<hash hex>"，自帶 salt，不需另存欄位。
 *
 * @param {string} plain 使用者輸入的明碼
 * @returns {string} 可直接存進 users.password 的字串
 */
export function hashPassword(plain) {
  // 每個密碼用獨立隨機 salt，避免相同密碼產生相同 hash（防彩虹表）
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(plain, salt, KEY_LEN).toString('hex')
  return `${salt}:${hash}`
}

/**
 * 驗證明碼是否符合先前存的雜湊。
 * 用 timingSafeEqual 做定時比較，避免時間側信道攻擊。
 *
 * @param {string} plain  使用者這次輸入的明碼
 * @param {string} stored 資料庫存的 "salt:hash"
 * @returns {boolean}
 */
export function verifyPassword(plain, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false

  const [salt, hashHex] = stored.split(':')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(plain, salt, KEY_LEN)

  // 長度不同 timingSafeEqual 會丟錯，先擋掉
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

// 從環境變數拿簽章金鑰；忘了設就用一個明顯的預設值（並提醒）
function getSecret() {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    console.warn('[auth] 未設定 AUTH_SECRET，使用不安全的預設值，請在 .env 補上。')
    return 'INSECURE_DEFAULT_SECRET'
  }
  return secret
}

function base64url(input) {
  return Buffer.from(input).toString('base64url')
}

/**
 * 簽發 token。
 * 內容會放 userId / email，並加上簽發時間 iat。
 *
 * @param {{ userId:number, email:string }} payload
 * @returns {string} "body.signature"
 */
export function signToken(payload) {
  const body = base64url(JSON.stringify({ ...payload, iat: Date.now() }))
  const sig = createHmac('sha256', getSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

/**
 * 驗證並解出 token 內容。簽章不符或格式錯回傳 null。
 *
 * @param {string} token
 * @returns {object|null} 原 payload（含 userId / email / iat）或 null
 */
export function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null

  const [body, sig] = token.split('.')
  const expected = createHmac('sha256', getSecret()).update(body).digest('base64url')

  // 比對簽章（定時比較）
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'))
  } catch {
    return null
  }
}
