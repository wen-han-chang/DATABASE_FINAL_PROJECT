/**
 * db.js — SQL Server (ncu_db) 連線模組
 *
 * 這個檔案只負責三件事：
 * 1. 從環境變數讀取資料庫連線設定（不把帳密寫死在程式裡）。
 * 2. 建立並重用一個連線池（connection pool），避免每次查詢都重連。
 * 3. 對外提供 query() / getPool()，讓 server.js 不必碰 mssql 細節。
 *
 * 為什麼要連線池：
 * - 每次查詢都開新連線很慢，且 SQL Server 連線數有限。
 * - 連線池會在第一次使用時建立，之後重複使用同一組連線。
 *
 * ⚠️ 安全注意：
 * - 真實帳號密碼只能放在 backend/.env（已被 .gitignore 排除，不會上傳）。
 * - 程式內只有「預設值 / 範例值」，不放真正的密碼。
 */

import sql from 'mssql'

/**
 * 從環境變數整理出連線設定。
 * 對應 backend/.env 裡的 DB_* 變數。
 *
 * 重點參數說明：
 * - server / port：SQL Server 位址與埠號（本機預設 127.0.0.1:1433）。
 * - user / password：SQL Server 驗證帳密（你給的 skyfire / 1487）。
 * - database：要連的資料庫（ncu_db）。
 * - options.encrypt：本機開發通常設 false；連雲端（如 Azure）才設 true。
 * - options.trustServerCertificate：本機自簽憑證需設 true，否則會連線失敗。
 */
function getDbConfig() {
  // parseBool：把 .env 的字串 'true'/'false' 轉成布林值
  const parseBool = (value, defaultValue) => {
    if (value === undefined || value === '') return defaultValue
    return String(value).toLowerCase() === 'true'
  }

  return {
    server: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 1433),
    user: process.env.DB_USER || 'skyfire',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ncu_db',
    options: {
      // 本機 SQL Server 預設不加密；連 Azure 等雲端時把 DB_ENCRYPT 設 true
      encrypt: parseBool(process.env.DB_ENCRYPT, false),
      // 本機多半是自簽憑證，要信任它連線才會成功
      trustServerCertificate: parseBool(process.env.DB_TRUST_CERT, true),
    },
    pool: {
      max: 10, // 連線池最多 10 條連線，對學生專題已足夠
      min: 0,
      idleTimeoutMillis: 30000, // 連線閒置 30 秒自動釋放
    },
    requestTimeout: Number(process.env.DB_REQUEST_TIMEOUT_MS || 15000), // 單次查詢逾時 15 秒
  }
}

/**
 * 用一個模組層級變數快取「連線池的建立 Promise」。
 * 這樣即使同時有多個請求進來，也只會建立一個連線池。
 */
let poolPromise = null

/**
 * 取得（必要時先建立）連線池。
 * server.js 任何需要查資料庫的地方，都先呼叫這個拿到 pool。
 *
 * 常見錯誤與排除：
 * - ELOGIN：帳號或密碼錯 → 檢查 .env 的 DB_USER / DB_PASSWORD，
 *   並確認 SQL Server 有開「SQL Server 驗證」模式。
 * - ESOCKET / ETIMEOUT：連不到 → 確認 SQL Server 服務有開、
 *   TCP/IP 通訊協定已啟用、port 1433 沒被防火牆擋。
 * - 'Login failed for user ... default database'：ncu_db 還沒建，
 *   請先在 SSMS 跑 database/schema.sql。
 */
export async function getPool() {
  if (!poolPromise) {
    const config = getDbConfig()
    // 建立連線池；連線失敗時把 poolPromise 清空，讓下次請求可重試
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then((pool) => {
        console.log(`[db] Connected to SQL Server: ${config.server}:${config.port}/${config.database}`)
        return pool
      })
      .catch((error) => {
        poolPromise = null
        throw error
      })
  }

  return poolPromise
}

/**
 * 執行參數化查詢（防 SQL Injection）。
 *
 * 用法範例：
 *   const rows = await query(
 *     'SELECT * FROM dbo.users WHERE email = @email',
 *     { email: 'demo@invest.ai' }
 *   )
 *
 * 為什麼一定要用參數而不是字串拼接：
 * - 字串拼接會被 SQL Injection 攻擊（例如 email 傳 `' OR 1=1 --`）。
 * - 用 request.input() 綁參數，mssql 會安全處理跳脫。
 *
 * @param {string} text   SQL 字串，參數用 @name 佔位
 * @param {object} params 參數物件，key 對應 @name
 * @returns {Promise<Array>} 查詢結果的列陣列（recordset）
 */
export async function query(text, params = {}) {
  const pool = await getPool()
  const request = pool.request()

  // 逐一把參數綁定上去，型別讓 mssql 自動推斷
  for (const [key, value] of Object.entries(params)) {
    request.input(key, value)
  }

  const result = await request.query(text)
  return result.recordset
}

/**
 * 在「資料庫交易」中執行一段邏輯（買賣下單必用）。
 *
 * 為什麼買賣一定要包交易：
 * - 一筆買單要同時做三件事：扣 portfolios.cash、改 holdings、寫 orders。
 * - 若中途出錯卻只做了一半（例如扣了錢卻沒記持股），資料就壞了。
 * - 交易保證「全部成功才提交，任一步失敗就整批回滾」。
 *
 * 用法：
 *   const result = await withTransaction(async (tx) => {
 *     const r = new sql.Request(tx)
 *     await r.input('id', 1).query('UPDATE ...')
 *     return something
 *   })
 *
 * @param {(tx: import('mssql').Transaction) => Promise<any>} work
 *        實際要做的事；收到 transaction 物件，請用它建立 Request。
 * @returns work 的回傳值（已提交）
 */
export async function withTransaction(work) {
  const pool = await getPool()
  const transaction = new sql.Transaction(pool)

  await transaction.begin()
  try {
    const result = await work(transaction)
    await transaction.commit()
    return result
  } catch (error) {
    // 任一步失敗就回滾，確保資料庫回到交易前狀態
    try {
      await transaction.rollback()
    } catch {
      // 回滾本身的錯誤不覆蓋原始錯誤，吞掉即可
    }
    throw error
  }
}

/**
 * 健康檢查用：跑一條最簡單的查詢確認 DB 真的連得上。
 * 給 server.js 的 /api/health 之類路由使用。
 */
export async function pingDb() {
  const rows = await query('SELECT 1 AS ok')
  return rows[0]?.ok === 1
}

/**
 * 程式結束時優雅關閉連線池。
 * server.js 的 SIGINT handler 會呼叫它。
 */
export async function closePool() {
  if (poolPromise) {
    try {
      const pool = await poolPromise
      await pool.close()
      console.log('[db] Connection pool closed.')
    } catch {
      // 關閉時的錯誤不影響程式結束，吞掉即可
    } finally {
      poolPromise = null
    }
  }
}

// 把 mssql 的型別物件也導出，之後若要明確指定參數型別會用到
export { sql }
