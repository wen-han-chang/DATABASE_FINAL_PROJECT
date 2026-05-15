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
import { fetchRecentHistory, fetchQuote } from './twseExtra.js'

/**
 * 建一個帶 HTTP 狀態碼的錯誤，讓 server.js 能回對應狀態。
 */
function httpError(statusCode, message) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

const LOT_SHARES = 1000 // 1 張 = 1000 股

function calcFee(faceAmount) {
  // 手續費 0.1425%，最低 20 元，取兩位小數
  return Math.max(20, +(faceAmount * 0.001425).toFixed(2))
}

function calcTax(faceAmount, isEtf) {
  // 證交稅：ETF 0.1%，一般股 0.3%
  return +(faceAmount * (isEtf ? 0.001 : 0.003)).toFixed(2)
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

/**
 * 取某檔日 K。核心策略：資料庫當「快取/真相來源」，TWSE 只在需要時補。
 *
 * 流程：
 * 1. 用 code 找 stock_id（不在 stocks 表 → 回空陣列，前端會自動退回模擬）。
 * 2. 看 stock_sync：沒同步過 / 來源還是 seed / 今天還沒同步過 / 指定強制，
 *    就去 TWSE STOCK_DAY 抓最近約 13 個月真實日線。
 * 3. 抓到 → 在「一個交易」內：刪掉該檔舊 bars、寫入真實 bars、更新 stock_sync。
 *    抓失敗 → 不動資料庫（保留現有，下次再試），畫面仍可用既有資料。
 * 4. 回傳資料庫裡該檔的日 K（給前端 K 線圖）。
 *
 * 「只在使用者看某檔時才抓、且每天每檔最多抓一次」→ 不會濫用官方資源。
 *
 * @param {string} code
 * @param {{ refresh?: boolean }} opts refresh=true 強制重抓（demo 用）
 */
export async function getStockBars(code, opts = {}) {
  const cleanCode = String(code || '').trim()
  if (!cleanCode) throw httpError(400, '缺少股票代碼')

  // 1) 找 stock_id
  const sRows = await query('SELECT id FROM dbo.stocks WHERE code = @code', { code: cleanCode })
  if (sRows.length === 0) return [] // 非已知股票 → 交給前端模擬 fallback
  const stockId = sRows[0].id

  // 2) 是否需要同步
  const syncRows = await query(
    `SELECT source,
            CONVERT(date, last_synced) AS synced_date
     FROM dbo.stock_sync WHERE stock_id = @sid`,
    { sid: stockId },
  )
  const sync = syncRows[0]
  const todayStr = new Date().toISOString().slice(0, 10)
  const syncedStr = sync?.synced_date
    ? new Date(sync.synced_date).toISOString().slice(0, 10)
    : null
  const needSync =
    opts.refresh === true ||
    !sync ||
    sync.source !== 'twse' ||
    syncedStr !== todayStr

  // 3) 需要就抓真實歷史並入庫
  if (needSync) {
    let realBars = []
    try {
      realBars = await fetchRecentHistory(cleanCode, 13)
    } catch {
      realBars = [] // 抓失敗 → 不動資料庫
    }

    if (realBars.length > 0) {
      await withTransaction(async (tx) => {
        // 換成真實資料：先刪該檔舊 bars
        await new sql.Request(tx)
          .input('sid', sql.SmallInt, stockId)
          .query('DELETE FROM dbo.stock_daily_bars WHERE stock_id = @sid')

        // 寫入真實 bars
        for (const b of realBars) {
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

        // 更新同步中繼表（沒有就新增，有就更新）
        await new sql.Request(tx)
          .input('sid', sql.SmallInt, stockId)
          .query(`IF EXISTS (SELECT 1 FROM dbo.stock_sync WHERE stock_id = @sid)
                     UPDATE dbo.stock_sync
                        SET source = N'twse', last_synced = SYSDATETIME()
                      WHERE stock_id = @sid;
                   ELSE
                     INSERT INTO dbo.stock_sync (stock_id, source, last_synced)
                     VALUES (@sid, N'twse', SYSDATETIME());`)
      })
    }
  }

  // 4) 回傳資料庫裡的資料
  return readBarsFromDb(cleanCode)
}

// 即時報價的記憶體快取：同一檔 20 秒內不重複打 TWSE（避免濫用）
const QUOTE_TTL_MS = 20000
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

/**
 * 買入。交易內：檢查現金 → 寫 orders → upsert holdings → 扣 portfolios.cash。
 */
export async function buyStock(userId, code, lots, price) {
  const nLots = Number(lots)
  const nPrice = Number(price)
  if (!(nLots > 0) || !(nPrice > 0)) throw httpError(400, '張數與價格需大於 0')

  return withTransaction(async (tx) => {
    const { portfolio, stock } = await loadPortfolioAndStock(tx, userId, code)

    const faceAmount = nLots * LOT_SHARES * nPrice
    const fee = calcFee(faceAmount)
    const totalCost = +(faceAmount + fee).toFixed(2)

    if (Number(portfolio.cash) < totalCost) {
      throw httpError(400, `現金不足，需 ${Math.round(totalCost)} 元，可用 ${Math.round(portfolio.cash)} 元`)
    }

    // 1) 寫委託紀錄
    await new sql.Request(tx)
      .input('pid', sql.BigInt, portfolio.id)
      .input('sid', sql.SmallInt, stock.id)
      .input('lots', sql.Int, nLots)
      .input('price', sql.Decimal(10, 4), nPrice)
      .input('face', sql.Decimal(15, 2), faceAmount)
      .input('fee', sql.Decimal(10, 2), fee)
      .input('total', sql.Decimal(15, 2), totalCost)
      .query(`INSERT INTO dbo.orders
                (portfolio_id, stock_id, order_type, lots, price, face_amount, fee, tax, total_amount)
              VALUES (@pid, @sid, 'buy', @lots, @price, @face, @fee, 0, @total)`)

    // 2) upsert 持股（已持有→重算平均成本；否則新增）
    const hRes = await new sql.Request(tx)
      .input('pid', sql.BigInt, portfolio.id)
      .input('sid', sql.SmallInt, stock.id)
      .query('SELECT id, lots, avg_cost FROM dbo.holdings WHERE portfolio_id = @pid AND stock_id = @sid')

    if (hRes.recordset.length > 0) {
      const h = hRes.recordset[0]
      const newLots = h.lots + nLots
      const newAvg = +(((h.lots * Number(h.avg_cost)) + (nLots * nPrice)) / newLots).toFixed(4)
      await new sql.Request(tx)
        .input('id', sql.BigInt, h.id)
        .input('lots', sql.Int, newLots)
        .input('avg', sql.Decimal(10, 4), newAvg)
        .query('UPDATE dbo.holdings SET lots = @lots, avg_cost = @avg WHERE id = @id')
    } else {
      await new sql.Request(tx)
        .input('pid', sql.BigInt, portfolio.id)
        .input('sid', sql.SmallInt, stock.id)
        .input('lots', sql.Int, nLots)
        .input('avg', sql.Decimal(10, 4), nPrice)
        .query(`INSERT INTO dbo.holdings (portfolio_id, stock_id, lots, avg_cost)
                VALUES (@pid, @sid, @lots, @avg)`)
    }

    // 3) 扣現金
    await new sql.Request(tx)
      .input('pid', sql.BigInt, portfolio.id)
      .input('cost', sql.Decimal(15, 2), totalCost)
      .query('UPDATE dbo.portfolios SET cash = cash - @cost WHERE id = @pid')

    return {
      ok: true,
      msg: `買入 ${stock.name} ${nLots} 張，扣款 ${Math.round(totalCost)} 元（含手續費 ${Math.round(fee)} 元）`,
    }
  })
}

/**
 * 賣出。交易內：檢查持股 → 寫 orders → 減/刪 holdings → 加 portfolios.cash。
 */
export async function sellStock(userId, code, lots, price) {
  const nLots = Number(lots)
  const nPrice = Number(price)
  if (!(nLots > 0) || !(nPrice > 0)) throw httpError(400, '張數與價格需大於 0')

  return withTransaction(async (tx) => {
    const { portfolio, stock } = await loadPortfolioAndStock(tx, userId, code)

    const hRes = await new sql.Request(tx)
      .input('pid', sql.BigInt, portfolio.id)
      .input('sid', sql.SmallInt, stock.id)
      .query('SELECT id, lots FROM dbo.holdings WHERE portfolio_id = @pid AND stock_id = @sid')

    const holding = hRes.recordset[0]
    if (!holding || holding.lots < nLots) {
      throw httpError(400, `持股不足，目前持有 ${holding ? holding.lots : 0} 張`)
    }

    const faceAmount = nLots * LOT_SHARES * nPrice
    const fee = calcFee(faceAmount)
    const tax = calcTax(faceAmount, !!stock.is_etf)
    const received = +(faceAmount - fee - tax).toFixed(2)

    // 1) 寫委託紀錄
    await new sql.Request(tx)
      .input('pid', sql.BigInt, portfolio.id)
      .input('sid', sql.SmallInt, stock.id)
      .input('lots', sql.Int, nLots)
      .input('price', sql.Decimal(10, 4), nPrice)
      .input('face', sql.Decimal(15, 2), faceAmount)
      .input('fee', sql.Decimal(10, 2), fee)
      .input('tax', sql.Decimal(10, 2), tax)
      .input('total', sql.Decimal(15, 2), received)
      .query(`INSERT INTO dbo.orders
                (portfolio_id, stock_id, order_type, lots, price, face_amount, fee, tax, total_amount)
              VALUES (@pid, @sid, 'sell', @lots, @price, @face, @fee, @tax, @total)`)

    // 2) 減持股；賣光就刪除整列
    if (holding.lots === nLots) {
      await new sql.Request(tx)
        .input('id', sql.BigInt, holding.id)
        .query('DELETE FROM dbo.holdings WHERE id = @id')
    } else {
      await new sql.Request(tx)
        .input('id', sql.BigInt, holding.id)
        .input('lots', sql.Int, holding.lots - nLots)
        .query('UPDATE dbo.holdings SET lots = @lots WHERE id = @id')
    }

    // 3) 加現金
    await new sql.Request(tx)
      .input('pid', sql.BigInt, portfolio.id)
      .input('recv', sql.Decimal(15, 2), received)
      .query('UPDATE dbo.portfolios SET cash = cash + @recv WHERE id = @pid')

    return {
      ok: true,
      msg: `賣出 ${stock.name} ${nLots} 張，到帳 ${Math.round(received)} 元（手續費 ${Math.round(fee)} 元，證交稅 ${Math.round(tax)} 元）`,
    }
  })
}
