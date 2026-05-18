/**
 * dao.js — 資料存取層（Data Access Object）
 *
 * 角色：把「業務邏輯 + SQL」集中在這裡，server.js 只負責路由與 HTTP。
 * 這樣分層的好處：
 * - server.js 不被一堆 SQL 塞爆，容易看懂。
 * - 之後要改資料表或加驗證，只動這一個檔。
 *
 * 重點：買 / 賣一定包在資料庫交易（withTransaction）裡，
 *       保證「扣現金 + 改持股 + 寫委託」三件事全成功才提交。
 *
 * 費用規則（與前端 portfolio.js 及 schema 費用表一致）：
 * - 面額 face_amount = lots × 1000 × price
 * - 手續費 fee = max(20, face × 0.1425%)，買賣雙向
 * - 證交稅 tax = face × (ETF 0.1% / 一般 0.3%)，僅賣出
 * - 買入實付 total = face + fee
 * - 賣出實收 total = face − fee − tax
 */

import { query, withTransaction, sql } from './db.js'
import { hashPassword, verifyPassword, signToken } from './auth.js'
import {
  fetchRecentHistoryWithFallback,
  fetchHistoryBeforeWithFallback,
  fetchQuote,
} from './twseExtra.js'

/**
 * 建一個帶 HTTP 狀態碼的錯誤，讓 server.js 能回對應狀態。
 */
function httpError(statusCode, message) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

const FULL_HISTORY_MONTHS = 13
const QUICK_HISTORY_MONTHS = 2
const OLDER_HISTORY_BATCH_MONTHS = 12
const QUICK_BAR_LIMIT = 60
const QUICK_HISTORY_CACHE_TTL_MS = 60000
const fullHistoryJobs = new Set()
const quickHistoryCache = new Map()
const historyErrorCache = new Map()
const REAL_HISTORY_SOURCES = new Set(['twse', 'finmind'])

// 手續費 0.1425%；整張最低 20 元，零股最低 1 元
function calcFee(faceAmount, isOddLot = false) {
  return Math.max(isOddLot ? 1 : 20, +(faceAmount * 0.001425).toFixed(2))
}

// 證交稅：ETF 0.1%；當沖一般股 0.15%；一般股 0.3%
function calcTax(faceAmount, isEtf, isDayTrade = false) {
  if (isEtf) return +(faceAmount * 0.001).toFixed(2)
  return +(faceAmount * (isDayTrade ? 0.0015 : 0.003)).toFixed(2)
}

// ──────────────────────────────────────────────────────────────────────────
// 行情：從資料庫讀某檔股票的日 K 線（給首頁 K 線圖用）
// ──────────────────────────────────────────────────────────────────────────

/**
 * 依股票代碼，從 stock_daily_bars 撈出該檔所有日 K（由舊到新）。
 *
 * 這是「前端圖表的資料來自真實 SQL 查詢」的關鍵：
 * 圖表資料先查這張表（JOIN stocks 用 code 找 stock_id，並走 trade_date 索引排序）。
 * 如果 stock_sync 已經標成 twse，代表該檔已由 TWSE 歷史日線取代 seed 資料；
 * 如果尚未同步或 TWSE 暫時抓不到，資料庫可能仍保留 seed 備援資料。
 *
 * @param {string} code 股票代碼，例如 '2330'
 * @returns {Promise<Array<{date,open,high,low,close,volume}>>}
 */
// 只負責「從資料庫讀」某檔的日 K（排序、整理格式）
async function readBarsFromDb(code) {
  const rows = await query(
    `SELECT b.trade_date AS d,
            b.[open]  AS o,
            b.high    AS h,
            b.low     AS l,
            b.[close] AS c,
            b.volume  AS v
     FROM dbo.stock_daily_bars b
     JOIN dbo.stocks s ON s.id = b.stock_id
     WHERE s.code = @code
     ORDER BY b.trade_date ASC`,
    { code },
  )
  return rows.map((r) => {
    const dt = r.d instanceof Date ? r.d : new Date(r.d)
    const y = dt.getFullYear()
    const mo = String(dt.getMonth() + 1).padStart(2, '0')
    const da = String(dt.getDate()).padStart(2, '0')
    return {
      date: `${y}-${mo}-${da}`,
      open: Number(r.o),
      high: Number(r.h),
      low: Number(r.l),
      close: Number(r.c),
      volume: Number(r.v),
    }
  })
}

async function findStockIdByCode(code) {
  const sRows = await query('SELECT id FROM dbo.stocks WHERE code = @code', { code })
  return sRows[0]?.id ?? null
}

function toDateText(value) {
  if (!value) return null
  return new Date(value).toISOString().slice(0, 10)
}

async function readStockSync(stockId) {
  const syncRows = await query(
    `SELECT source,
            CONVERT(date, last_synced) AS synced_date
     FROM dbo.stock_sync WHERE stock_id = @sid`,
    { sid: stockId },
  )
  return syncRows[0] ?? null
}

function isRealHistorySource(source) {
  return REAL_HISTORY_SOURCES.has(source)
}

function isFreshFullSync(sync) {
  const todayStr = new Date().toISOString().slice(0, 10)
  return isRealHistorySource(sync?.source) && toDateText(sync.synced_date) === todayStr
}

async function replaceBarsWithHistory(stockId, bars, source) {
  if (!bars.length) return 0

  await withTransaction(async (tx) => {
    // 換成真實資料：先刪該檔舊 bars。
    await new sql.Request(tx)
      .input('sid', sql.SmallInt, stockId)
      .query('DELETE FROM dbo.stock_daily_bars WHERE stock_id = @sid')

    // 寫入真實 bars。
    for (const b of bars) {
      await new sql.Request(tx)
        .input('sid', sql.SmallInt, stockId)
        .input('d', sql.Date, b.date)
        .input('o', sql.Decimal(10, 2), b.open)
        .input('h', sql.Decimal(10, 2), b.high)
        .input('l', sql.Decimal(10, 2), b.low)
        .input('c', sql.Decimal(10, 2), b.close)
        .input('v', sql.BigInt, b.volume)
        .query(`INSERT INTO dbo.stock_daily_bars
                  (stock_id, trade_date, [open], high, low, [close], volume)
                VALUES (@sid, @d, @o, @h, @l, @c, @v)`)
    }

    // source = twse 代表這檔已完成完整歷史同步，不是 seed 備援資料。
    await new sql.Request(tx)
      .input('sid', sql.SmallInt, stockId)
      .input('source', sql.NVarChar(20), source)
      .query(`IF EXISTS (SELECT 1 FROM dbo.stock_sync WHERE stock_id = @sid)
                 UPDATE dbo.stock_sync
                    SET source = @source, last_synced = SYSDATETIME()
                  WHERE stock_id = @sid;
               ELSE
                 INSERT INTO dbo.stock_sync (stock_id, source, last_synced)
                 VALUES (@sid, @source, SYSDATETIME());`)
  })

  return bars.length
}

async function syncFullHistory(cleanCode, stockId) {
  const { bars, provider } = await fetchRecentHistoryWithFallback(cleanCode, FULL_HISTORY_MONTHS)
  if (!bars.length || !isRealHistorySource(provider)) {
    throw new Error(`No historical bars were returned for ${cleanCode}.`)
  }
  return replaceBarsWithHistory(stockId, bars, provider)
}

async function upsertRecentBars(stockId, bars, source) {
  if (!bars.length) return 0

  await withTransaction(async (tx) => {
    for (const b of bars) {
      await new sql.Request(tx)
        .input('sid', sql.SmallInt, stockId)
        .input('d', sql.Date, b.date)
        .input('o', sql.Decimal(10, 2), b.open)
        .input('h', sql.Decimal(10, 2), b.high)
        .input('l', sql.Decimal(10, 2), b.low)
        .input('c', sql.Decimal(10, 2), b.close)
        .input('v', sql.BigInt, b.volume)
        .query(`IF EXISTS (
                  SELECT 1 FROM dbo.stock_daily_bars
                   WHERE stock_id = @sid AND trade_date = @d
                )
                  UPDATE dbo.stock_daily_bars
                     SET [open] = @o, high = @h, low = @l, [close] = @c, volume = @v
                   WHERE stock_id = @sid AND trade_date = @d;
                ELSE
                  INSERT INTO dbo.stock_daily_bars
                    (stock_id, trade_date, [open], high, low, [close], volume)
                  VALUES
                    (@sid, @d, @o, @h, @l, @c, @v);`)
    }

    await new sql.Request(tx)
      .input('sid', sql.SmallInt, stockId)
      .input('source', sql.NVarChar(20), source)
      .query(`IF EXISTS (SELECT 1 FROM dbo.stock_sync WHERE stock_id = @sid)
                 UPDATE dbo.stock_sync
                    SET source = @source, last_synced = SYSDATETIME()
                  WHERE stock_id = @sid;
               ELSE
                 INSERT INTO dbo.stock_sync (stock_id, source, last_synced)
                 VALUES (@sid, @source, SYSDATETIME());`)
  })

  return bars.length
}

async function syncRecentHistory(cleanCode, stockId) {
  const { bars, provider } = await fetchRecentHistoryWithFallback(cleanCode, QUICK_HISTORY_MONTHS)
  if (!bars.length || !isRealHistorySource(provider)) return 0
  return upsertRecentBars(stockId, bars, provider)
}

async function syncOlderHistory(cleanCode, stockId, beforeDate, months = OLDER_HISTORY_BATCH_MONTHS) {
  const { bars, provider } = await fetchHistoryBeforeWithFallback(cleanCode, beforeDate, months)
  if (!bars.length || !isRealHistorySource(provider)) return { bars: [], provider }
  await upsertRecentBars(stockId, bars, provider)
  return { bars, provider }
}

/**
 * 取某檔日 K。核心策略：資料庫當「快取/真相來源」，TWSE 只在需要時補。
 *
 * 流程：
 * 1. 用 code 找 stock_id（不在 stocks 表 → 回空陣列）。
 * 2. quick=true 時若資料庫已有 TWSE 歷史，直接回資料庫資料，不顯示載入。
 * 3. quick=true 且資料庫還沒有 TWSE 歷史，才抓最近約 2 個月快速回圖。
 * 4. 非 quick 背景請求：已有舊 TWSE 歷史時只補最近 2 個月；完全沒有 TWSE 歷史才補完整 13 個月。
 * 5. 若帶 before=YYYY-MM-DD，代表前端已滑到最左側；後端只補 before 以前更早的 12 個月。
 *
 * 這樣可以避免第一次點股票時卡在多年歷史資料下載，也能讓使用者按需往前看。
 *
 * @param {string} code
 * @param {{ refresh?: boolean, quick?: boolean, before?: string, months?: number }} opts
 * @returns {Promise<{bars:Array, source:string, historyStatus:string}>}
 */
export async function getStockBars(code, opts = {}) {
  const cleanCode = String(code || '').trim()
  if (!cleanCode) throw httpError(400, '缺少股票代碼')

  // 1) 找 stock_id
  const stockId = await findStockIdByCode(cleanCode)
  if (!stockId) {
    return { bars: [], source: 'not_found', historyStatus: 'not_found' }
  }

  if (opts.before) {
    const months = Number(opts.months || OLDER_HISTORY_BATCH_MONTHS)
    const safeMonths = Number.isFinite(months) && months > 0
      ? Math.min(Math.floor(months), OLDER_HISTORY_BATCH_MONTHS)
      : OLDER_HISTORY_BATCH_MONTHS
    const olderHistory = await syncOlderHistory(cleanCode, stockId, opts.before, safeMonths)

    return {
      bars: olderHistory.bars,
      source: olderHistory.bars.length
        ? `${olderHistory.provider}.stock_day.older`
        : `${olderHistory.provider || 'history'}.stock_day.older.empty`,
      historyStatus: 'complete',
      hasMoreBefore: olderHistory.bars.length > 0,
    }
  }

  // 2) 是否需要同步
  const sync = await readStockSync(stockId)
  const hasFreshFullHistory = !opts.refresh && isFreshFullSync(sync)

  if (opts.quick === true) {
    const existingBars = await readBarsFromDb(cleanCode)

    // 資料庫已經有 TWSE 歷史時，先完整顯示既有資料；缺的近期資料交給背景請求補。
    if (isRealHistorySource(sync?.source) && existingBars.length) {
      return {
        bars: existingBars,
        source: hasFreshFullHistory
          ? `ncu_db.stock_daily_bars.${sync.source}`
          : `ncu_db.stock_daily_bars.${sync.source}.stale`,
        historyStatus: 'complete',
      }
    }

    const cachedQuick = quickHistoryCache.get(cleanCode)
    if (cachedQuick && Date.now() - cachedQuick.ts < QUICK_HISTORY_CACHE_TTL_MS) {
      return {
        bars: cachedQuick.bars,
        source: `${cachedQuick.source}.cache`,
        historyStatus: 'partial_loading',
      }
    }

    // 第一次看這檔時，直接向 TWSE 抓短期真實資料，不再用測試資料墊圖。
    let quickBars = []
    try {
      const quickHistory = await fetchRecentHistoryWithFallback(cleanCode, QUICK_HISTORY_MONTHS)
      quickBars = quickHistory.bars.slice(-QUICK_BAR_LIMIT)
      if (quickBars.length) {
        quickHistoryCache.set(cleanCode, {
          bars: quickBars,
          source: `${quickHistory.provider}.stock_day.quick`,
          ts: Date.now(),
        })
      }
    } catch {
      quickBars = []
    }

    return {
      bars: quickBars,
      source: quickBars.length
        ? quickHistoryCache.get(cleanCode)?.source || 'history.stock_day.quick'
        : 'history.stock_day.loading',
      historyStatus: quickBars.length ? 'partial_loading' : 'loading',
    }
  }

  const existingBars = await readBarsFromDb(cleanCode)
  const shouldFullSync = opts.refresh === true || !isRealHistorySource(sync?.source) || !existingBars.length
  const needSync = opts.refresh === true || !hasFreshFullHistory
  if (needSync) {
    if (!fullHistoryJobs.has(cleanCode)) {
      fullHistoryJobs.add(cleanCode)
      try {
        if (shouldFullSync) {
          await syncFullHistory(cleanCode, stockId)
        } else {
          await syncRecentHistory(cleanCode, stockId)
        }
        historyErrorCache.delete(cleanCode)
      } catch (error) {
        historyErrorCache.set(cleanCode, error instanceof Error ? error.message : String(error))
        // 抓失敗不動資料庫，回傳現有資料；前端會顯示資料仍在載入。
      } finally {
        fullHistoryJobs.delete(cleanCode)
      }
    }
  }

  const latestSync = await readStockSync(stockId)
  if (!isRealHistorySource(latestSync?.source)) {
    return {
      bars: [],
      source: 'history.stock_day.loading',
      historyStatus: 'loading',
      error: historyErrorCache.get(cleanCode) || null,
    }
  }

  return {
    bars: await readBarsFromDb(cleanCode),
    source: `ncu_db.stock_daily_bars.${latestSync.source}`,
    historyStatus: 'complete',
  }
}

// 即時報價的記憶體快取：同一檔 20 秒內不重複打 TWSE（避免濫用）
const QUOTE_TTL_MS = 5000
const quoteCache = new Map() // code -> { data, ts }

/**
 * 取單一檔準即時報價（TWSE MIS）。20 秒內重複查同一檔走快取。
 * @param {string} code
 */
export async function getQuote(code) {
  const cleanCode = String(code || '').trim()
  if (!cleanCode) throw httpError(400, '缺少股票代碼')

  const cached = quoteCache.get(cleanCode)
  if (cached && Date.now() - cached.ts < QUOTE_TTL_MS) {
    return { ...cached.data, cached: true }
  }

  try {
    const data = await fetchQuote(cleanCode)
    quoteCache.set(cleanCode, { data, ts: Date.now() })
    return { ...data, cached: false }
  } catch (e) {
    throw httpError(502, e.message || '即時報價暫時無法取得')
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 帳號：註冊 / 登入
// ──────────────────────────────────────────────────────────────────────────

/**
 * 註冊新帳號 → 寫進 users 表（密碼存 scrypt 雜湊）。
 * email 重複會違反 uq_users_email，這裡先檢查給出友善訊息。
 */
export async function registerUser({ email, password, name, avatar }) {
  const cleanEmail = String(email || '').trim().toLowerCase()
  if (!cleanEmail || !password || !name) {
    throw httpError(400, 'email、password、name 為必填')
  }

  const dup = await query('SELECT id FROM dbo.users WHERE email = @email', { email: cleanEmail })
  if (dup.length > 0) {
    throw httpError(409, '這個 email 已經註冊過了')
  }

  const rows = await query(
    `INSERT INTO dbo.users (email, password, name, avatar)
     OUTPUT INSERTED.id, INSERTED.email, INSERTED.name, INSERTED.avatar
     VALUES (@email, @password, @name, @avatar)`,
    {
      email: cleanEmail,
      password: hashPassword(password),
      name: String(name).trim(),
      avatar: avatar || '🧑‍💼',
    },
  )

  const user = rows[0]
  return { user, token: signToken({ userId: user.id, email: user.email }) }
}

/**
 * 登入：查 users，用 scrypt 驗密碼，成功回傳使用者與 token。
 */
export async function loginUser({ email, password }) {
  const cleanEmail = String(email || '').trim().toLowerCase()
  const rows = await query(
    'SELECT id, email, password, name, avatar FROM dbo.users WHERE email = @email',
    { email: cleanEmail },
  )

  const found = rows[0]
  // 帳號不存在或密碼錯，統一回同一句，避免洩漏「哪個帳號存在」
  if (!found || !verifyPassword(password, found.password)) {
    throw httpError(401, '電子郵件或密碼錯誤，請重試')
  }

  const user = { id: found.id, email: found.email, name: found.name, avatar: found.avatar }
  return { user, token: signToken({ userId: user.id, email: user.email }) }
}

// ──────────────────────────────────────────────────────────────────────────
// 投資人偏好（與 users 1:1）
// ──────────────────────────────────────────────────────────────────────────

export async function getInvestorProfile(userId) {
  const rows = await query(
    `SELECT user_id, capital_range AS capitalRange, risk_level AS riskLevel, period
     FROM dbo.investor_profiles WHERE user_id = @uid`,
    { uid: userId },
  )
  return rows[0] || null
}

/**
 * 儲存問卷結果。1:1 關係 → 已存在就 UPDATE，否則 INSERT（在一個批次內判斷）。
 */
export async function saveInvestorProfile(userId, { capitalRange, riskLevel, period }) {
  const validCapital = ['10萬以下', '10-50萬', '50-200萬', '200萬以上']
  const validPeriod = ['short', 'mid', 'long']
  if (!validCapital.includes(capitalRange)) throw httpError(400, 'capitalRange 不合法')
  if (!validPeriod.includes(period)) throw httpError(400, 'period 不合法')
  if (!(riskLevel >= 1 && riskLevel <= 5)) throw httpError(400, 'riskLevel 需在 1~5')

  await query(
    `IF EXISTS (SELECT 1 FROM dbo.investor_profiles WHERE user_id = @uid)
        UPDATE dbo.investor_profiles
           SET capital_range = @cap, risk_level = @risk, period = @period
         WHERE user_id = @uid;
     ELSE
        INSERT INTO dbo.investor_profiles (user_id, capital_range, risk_level, period)
        VALUES (@uid, @cap, @risk, @period);`,
    { uid: userId, cap: capitalRange, risk: riskLevel, period },
  )
  return getInvestorProfile(userId)
}

// ──────────────────────────────────────────────────────────────────────────
// 投資組合 / 持股 / 委託
// ──────────────────────────────────────────────────────────────────────────

/**
 * 設定初始資產。1:1 → 已存在就重設（清空持股與委託），否則新建。
 * 整段包交易，避免「建了組合卻沒清乾淨舊持股」。
 */
export async function setupPortfolio(userId, capital) {
  const amount = Number(capital)
  if (!(amount > 0)) throw httpError(400, '初始資產需大於 0')

  return withTransaction(async (tx) => {
    const exist = await new sql.Request(tx)
      .input('uid', sql.BigInt, userId)
      .query('SELECT id FROM dbo.portfolios WHERE user_id = @uid')

    if (exist.recordset.length > 0) {
      const pid = exist.recordset[0].id
      // 重設：清掉舊持股與委託，再把現金歸位
      await new sql.Request(tx).input('pid', sql.BigInt, pid)
        .query('DELETE FROM dbo.orders   WHERE portfolio_id = @pid')
      await new sql.Request(tx).input('pid', sql.BigInt, pid)
        .query('DELETE FROM dbo.holdings WHERE portfolio_id = @pid')
      await new sql.Request(tx)
        .input('pid', sql.BigInt, pid)
        .input('cap', sql.Decimal(15, 2), amount)
        .query(`UPDATE dbo.portfolios
                   SET capital = @cap, cash = @cap, is_ready = 1
                 WHERE id = @pid`)
    } else {
      await new sql.Request(tx)
        .input('uid', sql.BigInt, userId)
        .input('cap', sql.Decimal(15, 2), amount)
        .query(`INSERT INTO dbo.portfolios (user_id, capital, cash, is_ready)
                VALUES (@uid, @cap, @cap, 1)`)
    }
    return true
  })
}

/**
 * 重置帳戶：清空持股與委託，並把投資組合標記為「未設定」。
 * 對應前端 TradingView 的「重置帳戶」按鈕。整段包交易確保一致。
 */
export async function resetPortfolio(userId) {
  return withTransaction(async (tx) => {
    const p = await new sql.Request(tx)
      .input('uid', sql.BigInt, userId)
      .query('SELECT id FROM dbo.portfolios WHERE user_id = @uid')
    if (p.recordset.length === 0) return true // 本來就沒有，視為已重置

    const pid = p.recordset[0].id
    await new sql.Request(tx).input('pid', sql.BigInt, pid)
      .query('DELETE FROM dbo.orders   WHERE portfolio_id = @pid')
    await new sql.Request(tx).input('pid', sql.BigInt, pid)
      .query('DELETE FROM dbo.holdings WHERE portfolio_id = @pid')
    await new sql.Request(tx).input('pid', sql.BigInt, pid)
      .query('UPDATE dbo.portfolios SET capital = 0, cash = 0, is_ready = 0 WHERE id = @pid')
    return true
  })
}

/**
 * 取得使用者的完整投資組合：portfolio + 持股(JOIN stocks) + 委託(JOIN stocks)。
 * 這是課程 demo「跨表 JOIN」最直接的查詢。
 */
export async function getPortfolio(userId) {
  const pRows = await query(
    `SELECT id, capital, cash, is_ready AS isReady
     FROM dbo.portfolios WHERE user_id = @uid`,
    { uid: userId },
  )
  const portfolio = pRows[0]
  if (!portfolio) return { isReady: false, capital: 0, cash: 0, holdings: [], orders: [] }

  const holdings = await query(
    `SELECT s.code, s.name, sec.name AS sector,
            h.lots, h.avg_cost AS avgCost
     FROM dbo.holdings h
     JOIN dbo.stocks  s   ON s.id = h.stock_id
     JOIN dbo.sectors sec ON sec.id = s.sector_id
     WHERE h.portfolio_id = @pid
     ORDER BY s.code`,
    { pid: portfolio.id },
  )

  const orders = await query(
    `SELECT o.id, o.order_type AS type, s.code, s.name,
            o.lots, o.price, o.face_amount AS faceAmount,
            o.fee, o.tax, o.total_amount AS total, o.executed_at AS timestamp
     FROM dbo.orders o
     JOIN dbo.stocks s ON s.id = o.stock_id
     WHERE o.portfolio_id = @pid
     ORDER BY o.executed_at DESC, o.id DESC`,
    { pid: portfolio.id },
  )

  return {
    isReady: !!portfolio.isReady,
    capital: Number(portfolio.capital),
    cash: Number(portfolio.cash),
    holdings,
    orders,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 自選清單：後端保存，供股票建議分析使用
// ──────────────────────────────────────────────────────────────────────────

export async function getWatchlist(userId) {
  return query(
    `SELECT s.code, s.name, sec.name AS sector, w.created_at AS createdAt
     FROM dbo.watchlists w
     JOIN dbo.stocks s ON s.id = w.stock_id
     JOIN dbo.sectors sec ON sec.id = s.sector_id
     WHERE w.user_id = @uid
     ORDER BY w.created_at DESC, s.code ASC`,
    { uid: userId },
  )
}

export async function syncWatchlist(userId, codes = []) {
  const normalizedCodes = [...new Set(
    (codes || [])
      .map((code) => String(code || '').trim())
      .filter(Boolean),
  )]

  const stockRows = normalizedCodes.length
    ? await query(
      `SELECT id, code
       FROM dbo.stocks
       WHERE code IN (${normalizedCodes.map((_, index) => `@c${index}`).join(', ')})`,
      Object.fromEntries(normalizedCodes.map((code, index) => [`c${index}`, code])),
    )
    : []

  const validCodeSet = new Set(stockRows.map((row) => row.code))
  const invalidCodes = normalizedCodes.filter((code) => !validCodeSet.has(code))
  if (invalidCodes.length) {
    throw httpError(400, `自選清單包含不存在的股票代碼：${invalidCodes.join(', ')}`)
  }

  await withTransaction(async (tx) => {
    const delReq = new sql.Request(tx)
    await delReq
      .input('uid', sql.BigInt, userId)
      .query('DELETE FROM dbo.watchlists WHERE user_id = @uid')

    for (const row of stockRows) {
      await new sql.Request(tx)
        .input('uid', sql.BigInt, userId)
        .input('stockId', sql.SmallInt, row.id)
        .query(`INSERT INTO dbo.watchlists (user_id, stock_id)
                VALUES (@uid, @stockId)`)
    }
  })

  return getWatchlist(userId)
}

// 交易共用：在交易內抓 portfolio 與 stock，缺一不可
async function loadPortfolioAndStock(tx, userId, code) {
  const pRes = await new sql.Request(tx)
    .input('uid', sql.BigInt, userId)
    .query('SELECT id, cash FROM dbo.portfolios WHERE user_id = @uid')
  if (pRes.recordset.length === 0) throw httpError(400, '尚未設定投資組合')

  const sRes = await new sql.Request(tx)
    .input('code', sql.VarChar(10), code)
    .query('SELECT id, name, is_etf FROM dbo.stocks WHERE code = @code AND is_active = 1')
  if (sRes.recordset.length === 0) throw httpError(404, `找不到股票 ${code}`)

  return { portfolio: pRes.recordset[0], stock: sRes.recordset[0] }
}

// 台灣時間 UTC+8，交易日週一~五，交易時間 09:00-13:30
function checkTradingTime() {
  const twMs = Date.now() + 8 * 3600 * 1000
  const tw = new Date(twMs)
  const day = tw.getUTCDay() // 0=Sun, 6=Sat
  if (day === 0 || day === 6) throw httpError(400, '非交易日（週末休市）')
  const mins = tw.getUTCHours() * 60 + tw.getUTCMinutes()
  if (mins < 9 * 60 || mins > 13 * 60 + 30) {
    throw httpError(400, '非交易時間（台股交易時間：週一至週五 09:00－13:30）')
  }
}

/**
 * 買入。交易內：檢查現金 → 寫 orders → upsert holdings → 扣 portfolios.cash。
 * shares：實際股數（整張 = n×1000，零股 < 1000）。
 */
export async function buyStock(userId, code, shares, price) {
  checkTradingTime()
  const nShares = Number(shares)
  const nPrice = Number(price)
  if (!Number.isInteger(nShares) || nShares <= 0) throw httpError(400, '股數必須是正整數')
  if (!(nPrice > 0)) throw httpError(400, '價格需大於 0')

  const isOddLot = nShares < 1000

  return withTransaction(async (tx) => {
    const { portfolio, stock } = await loadPortfolioAndStock(tx, userId, code)

    const faceAmount = nShares * nPrice
    const fee = calcFee(faceAmount, isOddLot)
    const totalCost = +(faceAmount + fee).toFixed(2)

    if (Number(portfolio.cash) < totalCost) {
      throw httpError(400, `現金不足，需 ${Math.round(totalCost)} 元，可用 ${Math.round(portfolio.cash)} 元`)
    }

    // 1) 寫委託紀錄（lots 欄位存實際股數）
    await new sql.Request(tx)
      .input('pid', sql.BigInt, portfolio.id)
      .input('sid', sql.SmallInt, stock.id)
      .input('shares', sql.Int, nShares)
      .input('price', sql.Decimal(10, 4), nPrice)
      .input('face', sql.Decimal(15, 2), faceAmount)
      .input('fee', sql.Decimal(10, 2), fee)
      .input('total', sql.Decimal(15, 2), totalCost)
      .query(`INSERT INTO dbo.orders
                (portfolio_id, stock_id, order_type, lots, price, face_amount, fee, tax, total_amount)
              VALUES (@pid, @sid, 'buy', @shares, @price, @face, @fee, 0, @total)`)

    // 2) upsert 持股（lots 欄位存實際股數，重算加權平均成本）
    const hRes = await new sql.Request(tx)
      .input('pid', sql.BigInt, portfolio.id)
      .input('sid', sql.SmallInt, stock.id)
      .query('SELECT id, lots, avg_cost FROM dbo.holdings WHERE portfolio_id = @pid AND stock_id = @sid')

    if (hRes.recordset.length > 0) {
      const h = hRes.recordset[0]
      const newShares = h.lots + nShares
      const newAvg = +(((h.lots * Number(h.avg_cost)) + (nShares * nPrice)) / newShares).toFixed(4)
      await new sql.Request(tx)
        .input('id', sql.BigInt, h.id)
        .input('shares', sql.Int, newShares)
        .input('avg', sql.Decimal(10, 4), newAvg)
        .query('UPDATE dbo.holdings SET lots = @shares, avg_cost = @avg WHERE id = @id')
    } else {
      await new sql.Request(tx)
        .input('pid', sql.BigInt, portfolio.id)
        .input('sid', sql.SmallInt, stock.id)
        .input('shares', sql.Int, nShares)
        .input('avg', sql.Decimal(10, 4), nPrice)
        .query(`INSERT INTO dbo.holdings (portfolio_id, stock_id, lots, avg_cost)
                VALUES (@pid, @sid, @shares, @avg)`)
    }

    // 3) 扣現金
    await new sql.Request(tx)
      .input('pid', sql.BigInt, portfolio.id)
      .input('cost', sql.Decimal(15, 2), totalCost)
      .query('UPDATE dbo.portfolios SET cash = cash - @cost WHERE id = @pid')

    const displayQty = nShares >= 1000
      ? `${nShares / 1000} 張`
      : `${nShares} 股（零股）`
    return {
      ok: true,
      msg: `買入 ${stock.name} ${displayQty}，扣款 ${Math.round(totalCost)} 元（手續費 ${Math.round(fee)} 元）`,
    }
  })
}

/**
 * 賣出。交易內：檢查持股 → 偵測當沖 → 寫 orders → 減/刪 holdings → 加 portfolios.cash。
 * shares：實際股數；當沖（當日已買同股）→ 證交稅 0.15%。
 */
export async function sellStock(userId, code, shares, price) {
  const nShares = Number(shares)
  const nPrice = Number(price)
  if (!Number.isInteger(nShares) || nShares <= 0) throw httpError(400, '股數必須是正整數')
  if (!(nPrice > 0)) throw httpError(400, '價格需大於 0')

  checkTradingTime()
  const isOddLot = nShares < 1000

  return withTransaction(async (tx) => {
    const { portfolio, stock } = await loadPortfolioAndStock(tx, userId, code)

    const hRes = await new sql.Request(tx)
      .input('pid', sql.BigInt, portfolio.id)
      .input('sid', sql.SmallInt, stock.id)
      .query('SELECT id, lots FROM dbo.holdings WHERE portfolio_id = @pid AND stock_id = @sid')

    const holding = hRes.recordset[0]
    if (!holding || holding.lots < nShares) {
      throw httpError(400, `持股不足，目前持有 ${holding ? holding.lots : 0} 股`)
    }

    // 偵測當沖：今天已有買入同一檔 → 適用 0.15% 證交稅
    const dtRes = await new sql.Request(tx)
      .input('pid', sql.BigInt, portfolio.id)
      .input('sid', sql.SmallInt, stock.id)
      .query(`SELECT COUNT(*) AS cnt FROM dbo.orders
              WHERE portfolio_id = @pid AND stock_id = @sid
                AND order_type = 'buy'
                AND CAST(executed_at AS DATE) = CAST(GETDATE() AS DATE)`)
    const isDayTrade = dtRes.recordset[0].cnt > 0

    const faceAmount = nShares * nPrice
    const fee = calcFee(faceAmount, isOddLot)
    const tax = calcTax(faceAmount, !!stock.is_etf, isDayTrade)
    const received = +(faceAmount - fee - tax).toFixed(2)

    // 1) 寫委託紀錄（lots 欄位存實際股數）
    await new sql.Request(tx)
      .input('pid', sql.BigInt, portfolio.id)
      .input('sid', sql.SmallInt, stock.id)
      .input('shares', sql.Int, nShares)
      .input('price', sql.Decimal(10, 4), nPrice)
      .input('face', sql.Decimal(15, 2), faceAmount)
      .input('fee', sql.Decimal(10, 2), fee)
      .input('tax', sql.Decimal(10, 2), tax)
      .input('total', sql.Decimal(15, 2), received)
      .query(`INSERT INTO dbo.orders
                (portfolio_id, stock_id, order_type, lots, price, face_amount, fee, tax, total_amount)
              VALUES (@pid, @sid, 'sell', @shares, @price, @face, @fee, @tax, @total)`)

    // 2) 減持股；賣光就刪除整列
    if (holding.lots === nShares) {
      await new sql.Request(tx)
        .input('id', sql.BigInt, holding.id)
        .query('DELETE FROM dbo.holdings WHERE id = @id')
    } else {
      await new sql.Request(tx)
        .input('id', sql.BigInt, holding.id)
        .input('shares', sql.Int, holding.lots - nShares)
        .query('UPDATE dbo.holdings SET lots = @shares WHERE id = @id')
    }

    // 3) 加現金
    await new sql.Request(tx)
      .input('pid', sql.BigInt, portfolio.id)
      .input('recv', sql.Decimal(15, 2), received)
      .query('UPDATE dbo.portfolios SET cash = cash + @recv WHERE id = @pid')

    const displayQty = nShares >= 1000
      ? `${nShares / 1000} 張`
      : `${nShares} 股（零股）`
    const dayTradeNote = isDayTrade ? '，當沖稅率 0.15%' : ''
    return {
      ok: true,
      msg: `賣出 ${stock.name} ${displayQty}，到帳 ${Math.round(received)} 元（手續費 ${Math.round(fee)} 元，證交稅 ${Math.round(tax)} 元${dayTradeNote}）`,
    }
  })
}

// ──────────────────────────────────────────────────────────────────────────
// 槓桿部位：融券（先賣後買）/ 融資（借錢買）/ 違約交割
// ──────────────────────────────────────────────────────────────────────────

/**
 * 查詢使用者目前所有 open 的槓桿部位。
 */
export async function getMarginPositions(userId) {
  const pRows = await query(
    'SELECT id FROM dbo.portfolios WHERE user_id = @uid',
    { uid: userId },
  )
  if (!pRows[0]) return []
  const pid = pRows[0].id

  const rows = await query(
    `SELECT sp.id, sp.margin_type AS marginType, s.code, s.name,
            sp.shares, sp.entry_price AS entryPrice,
            sp.face_amount AS faceAmount, sp.fee, sp.tax,
            sp.cash_flow AS cashFlow, sp.status, sp.opened_at AS openedAt
     FROM dbo.short_positions sp
     JOIN dbo.stocks s ON s.id = sp.stock_id
     WHERE sp.portfolio_id = @pid
     ORDER BY sp.opened_at DESC`,
    { pid },
  )
  return rows.map((r) => ({
    ...r,
    shares: Number(r.shares),
    entryPrice: Number(r.entryPrice),
    faceAmount: Number(r.faceAmount),
    fee: Number(r.fee),
    tax: Number(r.tax),
    cashFlow: Number(r.cashFlow),
  }))
}

/**
 * 開倉：融券（先賣）或融資（借買）。
 * 融券：現金 += (face - fee - tax)，不動持股。
 * 融資：持股 += shares，不動現金（負債由 cash_flow 追蹤）。
 */
export async function openMarginPosition(userId, code, shares, price, marginType) {
  checkTradingTime()
  const nShares = Number(shares)
  const nPrice = Number(price)
  if (!Number.isInteger(nShares) || nShares <= 0) throw httpError(400, '股數必須是正整數')
  if (!(nPrice > 0)) throw httpError(400, '價格需大於 0')
  if (!['short', 'margin'].includes(marginType)) throw httpError(400, '槓桿類型不合法')

  const isOddLot = nShares < 1000

  return withTransaction(async (tx) => {
    const { portfolio, stock } = await loadPortfolioAndStock(tx, userId, code)

    const faceAmount = +(nShares * nPrice).toFixed(2)
    const fee = calcFee(faceAmount, isOddLot)

    if (marginType === 'short') {
      // 融券：先賣 → 現金到帳 = face - fee - tax（賣方稅率）
      const tax = calcTax(faceAmount, !!stock.is_etf, false)
      const cashFlow = +(faceAmount - fee - tax).toFixed(2)

      await new sql.Request(tx)
        .input('pid', sql.BigInt, portfolio.id)
        .input('sid', sql.SmallInt, stock.id)
        .input('sh', sql.Int, nShares)
        .input('ep', sql.Decimal(10, 4), nPrice)
        .input('fa', sql.Decimal(15, 2), faceAmount)
        .input('fe', sql.Decimal(10, 2), fee)
        .input('tx', sql.Decimal(10, 2), tax)
        .input('cf', sql.Decimal(15, 2), cashFlow)
        .query(`INSERT INTO dbo.short_positions
                  (portfolio_id, stock_id, margin_type, shares, entry_price, face_amount, fee, tax, cash_flow)
                VALUES (@pid, @sid, 'short', @sh, @ep, @fa, @fe, @tx, @cf)`)

      await new sql.Request(tx)
        .input('pid', sql.BigInt, portfolio.id)
        .input('cf', sql.Decimal(15, 2), cashFlow)
        .query('UPDATE dbo.portfolios SET cash = cash + @cf WHERE id = @pid')

      const qty = nShares >= 1000 ? `${nShares / 1000} 張` : `${nShares} 股（零股）`
      return { ok: true, msg: `融券 ${stock.name} ${qty}，到帳 ${Math.round(cashFlow)} 元（需當日回補）` }
    } else {
      // 融資：借款買入 → 持股增加，cash_flow 記錄借款金額（負值）
      const debt = +(faceAmount + fee).toFixed(2)
      const cashFlow = -debt

      await new sql.Request(tx)
        .input('pid', sql.BigInt, portfolio.id)
        .input('sid', sql.SmallInt, stock.id)
        .input('sh', sql.Int, nShares)
        .input('ep', sql.Decimal(10, 4), nPrice)
        .input('fa', sql.Decimal(15, 2), faceAmount)
        .input('fe', sql.Decimal(10, 2), fee)
        .input('cf', sql.Decimal(15, 2), cashFlow)
        .query(`INSERT INTO dbo.short_positions
                  (portfolio_id, stock_id, margin_type, shares, entry_price, face_amount, fee, tax, cash_flow)
                VALUES (@pid, @sid, 'margin', @sh, @ep, @fa, @fe, 0, @cf)`)

      // 持股 upsert
      const hRes = await new sql.Request(tx)
        .input('pid', sql.BigInt, portfolio.id)
        .input('sid', sql.SmallInt, stock.id)
        .query('SELECT id, lots, avg_cost FROM dbo.holdings WHERE portfolio_id = @pid AND stock_id = @sid')

      if (hRes.recordset.length > 0) {
        const h = hRes.recordset[0]
        const newShares = h.lots + nShares
        const newAvg = +(((h.lots * Number(h.avg_cost)) + (nShares * nPrice)) / newShares).toFixed(4)
        await new sql.Request(tx)
          .input('id', sql.BigInt, h.id)
          .input('sh', sql.Int, newShares)
          .input('avg', sql.Decimal(10, 4), newAvg)
          .query('UPDATE dbo.holdings SET lots = @sh, avg_cost = @avg WHERE id = @id')
      } else {
        await new sql.Request(tx)
          .input('pid', sql.BigInt, portfolio.id)
          .input('sid', sql.SmallInt, stock.id)
          .input('sh', sql.Int, nShares)
          .input('avg', sql.Decimal(10, 4), nPrice)
          .query(`INSERT INTO dbo.holdings (portfolio_id, stock_id, lots, avg_cost)
                  VALUES (@pid, @sid, @sh, @avg)`)
      }

      const qty = nShares >= 1000 ? `${nShares / 1000} 張` : `${nShares} 股（零股）`
      return { ok: true, msg: `融資 ${stock.name} ${qty}，股票已入帳（需當日賣出）` }
    }
  })
}

/**
 * 平倉：融券回補（買回）或融資賣出（還股）。
 * 融券回補：現金 -= (buy_face + buy_fee)
 * 融資平倉：持股 -= shares，現金 += (sell_face - fee - tax)
 */
export async function coverMarginPosition(userId, positionId, price) {
  checkTradingTime()
  const nPrice = Number(price)
  if (!(nPrice > 0)) throw httpError(400, '價格需大於 0')

  return withTransaction(async (tx) => {
    const pRes = await new sql.Request(tx)
      .input('uid', sql.BigInt, userId)
      .query('SELECT id, cash FROM dbo.portfolios WHERE user_id = @uid')
    if (!pRes.recordset[0]) throw httpError(400, '尚未設定投資組合')
    const { id: pid, cash } = pRes.recordset[0]

    const spRes = await new sql.Request(tx)
      .input('id', sql.BigInt, positionId)
      .input('pid', sql.BigInt, pid)
      .query(`SELECT sp.id, sp.margin_type, sp.shares, sp.entry_price,
                     sp.face_amount AS origFace, sp.cash_flow AS origCF,
                     s.id AS stockId, s.name, s.is_etf
              FROM dbo.short_positions sp
              JOIN dbo.stocks s ON s.id = sp.stock_id
              WHERE sp.id = @id AND sp.portfolio_id = @pid AND sp.status = 'open'`)

    if (!spRes.recordset[0]) throw httpError(404, '找不到開倉部位或已平倉')
    const pos = spRes.recordset[0]
    const nShares = Number(pos.shares)
    const isOddLot = nShares < 1000
    const coverFace = +(nShares * nPrice).toFixed(2)

    if (pos.margin_type === 'short') {
      // 融券回補：買回股票 → 扣現金
      const buyFee = calcFee(coverFace, isOddLot)
      const cost = +(coverFace + buyFee).toFixed(2)

      if (Number(cash) < cost) {
        throw httpError(400, `現金不足以回補，需 ${Math.round(cost)} 元，可用 ${Math.round(Number(cash))} 元`)
      }

      await new sql.Request(tx)
        .input('pid', sql.BigInt, pid)
        .input('cost', sql.Decimal(15, 2), cost)
        .query('UPDATE dbo.portfolios SET cash = cash - @cost WHERE id = @pid')

      await new sql.Request(tx)
        .input('id', sql.BigInt, positionId)
        .query(`UPDATE dbo.short_positions SET status = 'covered' WHERE id = @id`)

      const pnl = +(Number(pos.origCF) - cost).toFixed(2)
      const pnlNote = pnl >= 0 ? `獲利 ${Math.round(pnl)} 元` : `虧損 ${Math.round(-pnl)} 元`
      return { ok: true, msg: `融券回補 ${pos.name}，支出 ${Math.round(cost)} 元，${pnlNote}` }
    } else {
      // 融資平倉：賣出 → 收現金
      const sellFee = calcFee(coverFace, isOddLot)
      const tax = calcTax(coverFace, !!pos.is_etf, false)
      const received = +(coverFace - sellFee - tax).toFixed(2)

      const hRes = await new sql.Request(tx)
        .input('pid', sql.BigInt, pid)
        .input('sid', sql.SmallInt, pos.stockId)
        .query('SELECT id, lots FROM dbo.holdings WHERE portfolio_id = @pid AND stock_id = @sid')

      const h = hRes.recordset[0]
      if (!h || h.lots < nShares) {
        throw httpError(400, `持股不足，持有 ${h ? h.lots : 0} 股，需 ${nShares} 股`)
      }

      if (h.lots === nShares) {
        await new sql.Request(tx)
          .input('id', sql.BigInt, h.id)
          .query('DELETE FROM dbo.holdings WHERE id = @id')
      } else {
        await new sql.Request(tx)
          .input('id', sql.BigInt, h.id)
          .input('sh', sql.Int, h.lots - nShares)
          .query('UPDATE dbo.holdings SET lots = @sh WHERE id = @id')
      }

      await new sql.Request(tx)
        .input('pid', sql.BigInt, pid)
        .input('recv', sql.Decimal(15, 2), received)
        .query('UPDATE dbo.portfolios SET cash = cash + @recv WHERE id = @pid')

      await new sql.Request(tx)
        .input('id', sql.BigInt, positionId)
        .query(`UPDATE dbo.short_positions SET status = 'covered' WHERE id = @id`)

      // origCF 是負值（借款）；received 是賣出所得；損益 = received + origCF
      const pnl = +(received + Number(pos.origCF)).toFixed(2)
      const pnlNote = pnl >= 0 ? `獲利 ${Math.round(pnl)} 元` : `虧損 ${Math.round(-pnl)} 元`
      return { ok: true, msg: `融資平倉 ${pos.name}，到帳 ${Math.round(received)} 元，${pnlNote}` }
    }
  })
}

/**
 * 違約交割：強制平倉當日所有 open 部位，按懲罰價格結算並收 10% 面額罰款。
 * 融券：強制以 entry_price × 1.1 回補
 * 融資：強制以 entry_price × 0.9 賣出
 */
export async function settleDefaultPositions(userId) {
  return withTransaction(async (tx) => {
    const pRes = await new sql.Request(tx)
      .input('uid', sql.BigInt, userId)
      .query('SELECT id FROM dbo.portfolios WHERE user_id = @uid')
    if (!pRes.recordset[0]) throw httpError(400, '尚未設定投資組合')
    const pid = pRes.recordset[0].id

    const spRes = await new sql.Request(tx)
      .input('pid', sql.BigInt, pid)
      .query(`SELECT sp.id, sp.margin_type, sp.shares, sp.entry_price,
                     sp.face_amount AS origFace, sp.cash_flow AS origCF,
                     s.id AS stockId, s.name, s.is_etf
              FROM dbo.short_positions sp
              JOIN dbo.stocks s ON s.id = sp.stock_id
              WHERE sp.portfolio_id = @pid AND sp.status = 'open'
                AND CAST(sp.opened_at AS DATE) = CAST(GETDATE() AS DATE)`)

    if (spRes.recordset.length === 0) {
      return { ok: true, msg: '沒有需要違約交割的部位', settled: 0, totalPenalty: 0 }
    }

    const messages = []
    let totalPenalty = 0

    for (const pos of spRes.recordset) {
      const nShares = Number(pos.shares)
      const isOddLot = nShares < 1000
      const origFace = Number(pos.origFace)
      const facePenalty = +(origFace * 0.1).toFixed(2)

      if (pos.margin_type === 'short') {
        // 融券違約：強制以 1.1× 回補
        const penaltyPrice = +(Number(pos.entry_price) * 1.1).toFixed(4)
        const coverFace = +(nShares * penaltyPrice).toFixed(2)
        const buyFee = calcFee(coverFace, isOddLot)
        const cost = +(coverFace + buyFee + facePenalty).toFixed(2)

        await new sql.Request(tx)
          .input('pid', sql.BigInt, pid)
          .input('cost', sql.Decimal(15, 2), cost)
          .query('UPDATE dbo.portfolios SET cash = cash - @cost WHERE id = @pid')
      } else {
        // 融資違約：強制以 0.9× 賣出
        const penaltyPrice = +(Number(pos.entry_price) * 0.9).toFixed(4)
        const sellFace = +(nShares * penaltyPrice).toFixed(2)
        const sellFee = calcFee(sellFace, isOddLot)
        const tax = calcTax(sellFace, !!pos.is_etf, false)
        const received = +(sellFace - sellFee - tax - facePenalty).toFixed(2)

        // 移除持股
        const hRes = await new sql.Request(tx)
          .input('pid', sql.BigInt, pid)
          .input('sid', sql.SmallInt, pos.stockId)
          .query('SELECT id, lots FROM dbo.holdings WHERE portfolio_id = @pid AND stock_id = @sid')
        const h = hRes.recordset[0]
        if (h) {
          if (h.lots <= nShares) {
            await new sql.Request(tx)
              .input('id', sql.BigInt, h.id)
              .query('DELETE FROM dbo.holdings WHERE id = @id')
          } else {
            await new sql.Request(tx)
              .input('id', sql.BigInt, h.id)
              .input('sh', sql.Int, h.lots - nShares)
              .query('UPDATE dbo.holdings SET lots = @sh WHERE id = @id')
          }
        }

        await new sql.Request(tx)
          .input('pid', sql.BigInt, pid)
          .input('recv', sql.Decimal(15, 2), received)
          .query('UPDATE dbo.portfolios SET cash = cash + @recv WHERE id = @pid')
      }

      await new sql.Request(tx)
        .input('id', sql.BigInt, pos.id)
        .query(`UPDATE dbo.short_positions SET status = 'defaulted' WHERE id = @id`)

      totalPenalty += facePenalty
      const typeLabel = pos.margin_type === 'short' ? '融券' : '融資'
      messages.push(`${typeLabel}違約 ${pos.name}（罰款 ${Math.round(facePenalty)} 元）`)
    }

    return {
      ok: true,
      msg: messages.join('；'),
      settled: spRes.recordset.length,
      totalPenalty: Math.round(totalPenalty),
    }
  })
}
