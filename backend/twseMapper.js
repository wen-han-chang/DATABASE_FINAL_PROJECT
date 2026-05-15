/**
 * TWSE data mapper.
 *
 * 這個檔案負責把 TWSE 官方欄位轉成專題資料庫需要的欄位。
 * 目前只處理能從 TWSE OpenAPI 穩定對應到的兩類資料：
 * 1. stocks：股票基本資料的一部分。
 * 2. stock_daily_bars：個股單日 OHLCV 資料。
 */

/**
 * 把民國日期轉成西元日期。
 * TWSE OpenAPI 常見格式是 1150514，代表民國 115 年 05 月 14 日。
 * 資料庫 DATE 欄位通常使用西元 yyyy-mm-dd，所以這裡要先轉換。
 */
export function convertTwseDateToIsoDate(rawDate) {
  const text = String(rawDate || '').trim()

  if (!/^\d{7}$/.test(text)) {
    return null
  }

  const rocYear = Number(text.slice(0, 3))
  const month = text.slice(3, 5)
  const day = text.slice(5, 7)
  const westernYear = rocYear + 1911

  return `${westernYear}-${month}-${day}`
}

/**
 * 把 TWSE 的數字字串轉成 number。
 * 官方資料有時會有逗號或空字串，因此這裡集中處理。
 */
export function parseTwseNumber(value) {
  const text = String(value ?? '').replace(/,/g, '').trim()

  if (!text || text === '--') {
    return null
  }

  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

/**
 * 判斷代號是否比較像 ETF。
 * 這不是完美分類，只是目前不接產業分類 API 時的務實做法。
 * 真正的 sector_id 之後應該由 sectors/stocks 種子資料或交易所分類資料決定。
 */
export function inferIsEtfByCode(code) {
  const text = String(code || '').trim()
  return /^00\d{2,4}[A-Z]?$/.test(text)
}

/**
 * 把股票代號轉成簡單的類別名稱。
 * 這裡先回傳文字 sector_name，而不是 sector_id。
 * 原因是 sector_id 是資料庫自動產生的外鍵，必須等 sectors 表建立後才能決定。
 */
export function inferSectorName(code) {
  return inferIsEtfByCode(code) ? 'ETF' : '未分類'
}

/**
 * 從 STOCK_DAY_ALL 的單筆資料整理出 stocks 表可使用的資料。
 * 注意：TWSE 這個端點沒有提供 sector_id 與 volatility。
 * 所以這裡先提供 sector_name 與預設 volatility，後續入庫時再轉成正式欄位。
 */
export function mapStockFromDailyRow(row) {
  const code = String(row?.Code || '').trim()
  const closingPrice = parseTwseNumber(row?.ClosingPrice)

  return {
    code,
    name: String(row?.Name || '').trim(),
    sector_name: inferSectorName(code),
    base_price: closingPrice,
    volatility: 0.018,
    is_etf: inferIsEtfByCode(code),
    is_active: true,
  }
}

/**
 * 從 STOCK_DAY_ALL 的單筆資料整理出 stock_daily_bars 表可使用的資料。
 * 這裡用 stock_code，而不是 stock_id。
 * 原因是 stock_id 是資料庫內部主鍵，必須等 stocks 寫入後才會知道。
 */
export function mapDailyBarFromDailyRow(row) {
  return {
    stock_code: String(row?.Code || '').trim(),
    trade_date: convertTwseDateToIsoDate(row?.Date),
    open: parseTwseNumber(row?.OpeningPrice),
    high: parseTwseNumber(row?.HighestPrice),
    low: parseTwseNumber(row?.LowestPrice),
    close: parseTwseNumber(row?.ClosingPrice),
    volume: parseTwseNumber(row?.TradeVolume),
  }
}

/**
 * 過濾掉不完整的股票資料。
 * 如果 code/name/base_price 缺少，這筆資料對 stocks 表沒有實際價值。
 */
export function isValidStock(stock) {
  return Boolean(stock.code && stock.name && stock.base_price !== null)
}

/**
 * 過濾掉不完整的日 K 資料。
 * open/high/low/close/volume 缺少時，不應該寫進 stock_daily_bars。
 */
export function isValidDailyBar(bar) {
  return Boolean(
    bar.stock_code &&
    bar.trade_date &&
    bar.open !== null &&
    bar.high !== null &&
    bar.low !== null &&
    bar.close !== null &&
    bar.volume !== null,
  )
}

/**
 * 將 STOCK_DAY_ALL 整批資料轉成資料庫匯入預覽格式。
 * 這個格式可以直接給前端看，也可以作為之後寫入 SQL Server 的中介資料。
 */
export function mapStockDayAll(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const stocks = safeRows.map(mapStockFromDailyRow).filter(isValidStock)
  const stockDailyBars = safeRows.map(mapDailyBarFromDailyRow).filter(isValidDailyBar)

  return {
    sectors: [
      { name: 'ETF' },
      { name: '未分類' },
    ],
    stocks,
    stock_daily_bars: stockDailyBars,
  }
}

