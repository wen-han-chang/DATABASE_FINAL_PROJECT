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
