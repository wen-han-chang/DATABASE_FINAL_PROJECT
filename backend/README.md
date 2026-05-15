# Backend API 設計說明

這個 backend 目前只處理「能從 TWSE OpenAPI 對應到專題資料庫」的資料流。

## 目前能對應的資料表

### `stocks`

來源：`/exchangeReport/STOCK_DAY_ALL`

可對應欄位：

- `code`：來自 TWSE `Code`
- `name`：來自 TWSE `Name`
- `base_price`：來自 TWSE `ClosingPrice`
- `is_etf`：由股票代號推估
- `is_active`：預設 `true`
- `volatility`：TWSE 沒有提供，暫時給預設值 `0.018`
- `sector_name`：TWSE 此端點沒有提供正式產業分類，目前先回 `ETF` 或 `未分類`

注意：正式資料庫的 `stocks.sector_id` 必須等 `sectors` 表建立後，再由 `sector_name` 對應成外鍵。

### `stock_daily_bars`

來源：`/exchangeReport/STOCK_DAY_ALL`

可對應欄位：

- `stock_code`：來自 TWSE `Code`
- `trade_date`：來自 TWSE `Date`，並由民國日期轉成西元日期
- `open`：來自 TWSE `OpeningPrice`
- `high`：來自 TWSE `HighestPrice`
- `low`：來自 TWSE `LowestPrice`
- `close`：來自 TWSE `ClosingPrice`
- `volume`：來自 TWSE `TradeVolume`

注意：正式資料庫的 `stock_daily_bars.stock_id` 必須先用 `stock_code` 找到 `stocks.id` 後才能寫入。

## API 路由

### `GET /api/health`

確認 backend 是否正常啟動。

### `GET /api/market/stocks`

回傳整理後的股票清單，格式接近 `stocks` 表。

### `GET /api/market/stocks/:code`

回傳單一股票資料。

範例：

```txt
/api/market/stocks/2330
```

### `GET /api/market/daily-bars`

回傳最新交易日的全部日 K 資料，格式接近 `stock_daily_bars` 表。

也可以用 query string 篩選單一股票：

```txt
/api/market/daily-bars?code=2330
```

### `GET /api/market/daily-bars/:code`

回傳單一股票最新交易日的日 K 資料。

範例：

```txt
/api/market/daily-bars/2330
```

### `GET /api/market/import-preview`

回傳接近資料庫匯入格式的資料：

- `sectors`
- `stocks`
- `stock_daily_bars`

這個路由適合之後接 SQL Server 匯入流程。

## 目前限制

TWSE OpenAPI 的 `/exchangeReport/STOCK_DAY_ALL` 只提供最新交易日，不會一次提供每檔股票 300 筆歷史 K 棒。

如果資料庫真的需要 `stock_daily_bars` 每檔約 300 筆，有兩條比較務實的路：

1. 每天排程抓一次 `/exchangeReport/STOCK_DAY_ALL`，長期累積。
2. 另外找可合法取得歷史 OHLCV 的資料來源，再轉成相同格式匯入。

目前 backend 先把欄位整理好，下一步才適合接資料庫寫入。
