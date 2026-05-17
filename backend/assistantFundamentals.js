import { query, withTransaction, sql } from './db.js'

const BWIBBU_URL = 'https://www.twse.com.tw/exchangeReport/BWIBBU_d'
const CACHE_HOURS = 12

function toNumber(value) {
  const text = String(value ?? '').replace(/,/g, '').trim()
  if (!text || text === '-' || text === '--') return null
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

function toIsoDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toTwseDate(date) {
  return toIsoDate(date).replace(/-/g, '')
}

function buildUrl(dateText) {
  const params = new URLSearchParams({
    response: 'json',
    date: dateText,
    selectType: 'ALL',
  })
  return `${BWIBBU_URL}?${params.toString()}`
}

async function fetchFundamentalsForDate(date) {
  const twseDate = toTwseDate(date)
  const sourceUrl = buildUrl(twseDate)
  const response = await fetch(sourceUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'database-final-project/1.0',
    },
    signal: AbortSignal.timeout(20000),
  })

  if (!response.ok) throw new Error(`BWIBBU_d HTTP ${response.status}`)
  const json = await response.json()
  if (!json || json.stat !== 'OK' || !Array.isArray(json.data) || !json.data.length) return []

  return json.data
    .map((row) => ({
      tradeDate: toIsoDate(date),
      stockCode: String(row[0] || '').trim(),
      stockName: String(row[1] || '').trim(),
      closePrice: toNumber(row[2]),
      dividendYield: toNumber(row[3]),
      dividendYear: row[4] == null ? null : String(row[4]).trim(),
      peRatio: toNumber(row[5]),
      pbRatio: toNumber(row[6]),
      financialPeriod: row[7] == null ? null : String(row[7]).trim(),
      sourceUrl,
    }))
    .filter((row) => row.stockCode && /^\d{4,6}$/.test(row.stockCode))
}

async function fetchLatestFundamentals() {
  const today = new Date()
  for (let offset = 0; offset < 10; offset++) {
    const date = new Date(today)
    date.setDate(today.getDate() - offset)
    try {
      const rows = await fetchFundamentalsForDate(date)
      if (rows.length) return rows
    } catch {
      // 休市日或暫時失敗時，繼續往前找最近可用交易日。
    }
  }
  return []
}

async function readLatestFundamentals(codes = []) {
  const filterCodes = [...new Set(codes.map((code) => String(code || '').trim()).filter(Boolean))]
  const codeFilter = filterCodes.length
    ? `AND stock_code IN (${filterCodes.map((_, index) => `@c${index}`).join(', ')})`
    : ''
  const params = Object.fromEntries(filterCodes.map((code, index) => [`c${index}`, code]))

  return query(
    `WITH latest AS (
       SELECT MAX(trade_date) AS trade_date
       FROM dbo.assistant_fundamentals
     )
     SELECT CONVERT(varchar(10), trade_date, 23) AS tradeDate,
            stock_code AS stockCode,
            stock_name AS stockName,
            close_price AS closePrice,
            dividend_yield AS dividendYield,
            dividend_year AS dividendYear,
            pe_ratio AS peRatio,
            pb_ratio AS pbRatio,
            financial_period AS financialPeriod,
            source_url AS sourceUrl,
            fetched_at AS fetchedAt
     FROM dbo.assistant_fundamentals
     WHERE trade_date = (SELECT trade_date FROM latest)
       ${codeFilter}
     ORDER BY stock_code`,
    params,
  )
}

function fundamentalsAreFresh(rows) {
  if (!rows.length) return false
  const fetchedAt = rows[0].fetchedAt instanceof Date
    ? rows[0].fetchedAt
    : new Date(rows[0].fetchedAt)
  return Date.now() - fetchedAt.getTime() < CACHE_HOURS * 60 * 60 * 1000
}

async function saveFundamentals(rows) {
  if (!rows.length) return

  await withTransaction(async (tx) => {
    for (const row of rows) {
      await new sql.Request(tx)
        .input('tradeDate', sql.Date, row.tradeDate)
        .input('stockCode', sql.VarChar(10), row.stockCode)
        .input('stockName', sql.NVarChar(100), row.stockName)
        .input('closePrice', sql.Decimal(10, 2), row.closePrice)
        .input('dividendYield', sql.Decimal(8, 4), row.dividendYield)
        .input('dividendYear', sql.NVarChar(20), row.dividendYear)
        .input('peRatio', sql.Decimal(12, 4), row.peRatio)
        .input('pbRatio', sql.Decimal(12, 4), row.pbRatio)
        .input('financialPeriod', sql.NVarChar(30), row.financialPeriod)
        .input('sourceUrl', sql.NVarChar(500), row.sourceUrl)
        .query(`IF EXISTS (
                  SELECT 1
                  FROM dbo.assistant_fundamentals
                  WHERE trade_date = @tradeDate
                    AND stock_code = @stockCode
                )
                  UPDATE dbo.assistant_fundamentals
                     SET stock_name = @stockName,
                         close_price = @closePrice,
                         dividend_yield = @dividendYield,
                         dividend_year = @dividendYear,
                         pe_ratio = @peRatio,
                         pb_ratio = @pbRatio,
                         financial_period = @financialPeriod,
                         source_url = @sourceUrl,
                         fetched_at = SYSDATETIME()
                   WHERE trade_date = @tradeDate
                     AND stock_code = @stockCode;
                ELSE
                  INSERT INTO dbo.assistant_fundamentals
                    (trade_date, stock_code, stock_name, close_price, dividend_yield, dividend_year,
                     pe_ratio, pb_ratio, financial_period, source_url)
                  VALUES
                    (@tradeDate, @stockCode, @stockName, @closePrice, @dividendYield, @dividendYear,
                     @peRatio, @pbRatio, @financialPeriod, @sourceUrl);`)
    }
  })
}

export async function getLatestFundamentals(codes = []) {
  const cached = await readLatestFundamentals(codes)
  if (fundamentalsAreFresh(cached)) return cached

  const freshRows = await fetchLatestFundamentals()
  if (freshRows.length) {
    await saveFundamentals(freshRows)
    return readLatestFundamentals(codes)
  }

  return cached
}
