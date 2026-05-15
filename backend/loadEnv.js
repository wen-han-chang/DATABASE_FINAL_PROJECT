/**
 * loadEnv.js — 極簡 .env 載入器（零外部依賴）
 *
 * 為什麼需要這個檔案：
 * - 你的 Node 是 v18.1.0，不支援 Node 20.6+ 才有的 `node --env-file=.env`。
 * - 專案原本的 process.env.TWSE_* 其實一直沒被載入（因為沒人讀 .env）。
 * - 為了維持「不多裝套件、看得懂」的風格，這裡手寫一個最小解析器，
 *   而不是再裝 dotenv。
 *
 * 它怎麼運作：
 * 1. 讀取 backend/.env 純文字檔。
 * 2. 一行一行解析 KEY=VALUE。
 * 3. 略過空行與 # 開頭的註解行。
 * 4. 只在該變數「尚未被設定」時才寫入 process.env
 *    （這樣命令列或系統環境變數仍可覆蓋 .env，優先權正確）。
 *
 * 使用方式：
 *   在 server.js 最上方第一行 import './loadEnv.js'
 *   （用 import 的副作用，模組一被載入就自動執行）。
 *
 * 常見錯誤：
 * - 找不到 .env：會印出警告但不中斷程式（讓你還能用系統環境變數跑）。
 * - 值含 = 號：只用「第一個 = 」切割，等號後面整段都當值，不會被切壞。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 由目前檔案位置推導 backend/.env，避免寫死任何開發者本機的專案路徑
const currentDir = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(currentDir, '.env')

try {
  const raw = fs.readFileSync(envPath, 'utf-8')

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()

    // 空行或註解行（# 開頭）直接略過
    if (!trimmed || trimmed.startsWith('#')) continue

    // 找第一個 = 的位置，前面是 key、後面是 value
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue

    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()

    // 只在尚未設定時寫入，保留「系統環境變數 > .env」的優先權
    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  }

  console.log('[env] Loaded backend/.env')
} catch (error) {
  // 找不到 .env 不應讓整個 backend 掛掉，只提醒使用者
  console.warn(`[env] Could not load .env (${error.code || error.message}). ` +
    'Falling back to system environment variables.')
}
