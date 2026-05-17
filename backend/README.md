# 後端工程師 Backend API 設計說明

> 閱讀對象：負責 backend、資料庫、API route、TWSE 資料串接的後端工程師。
> 這份文件說明 backend 目前對前端提供哪些資料、資料從哪裡來、如何避免濫用官方資料來源。
> 如果只是要啟動專案，請看專案根目錄的《團隊專案啟動操作手冊.md》。

---

## 1. 目前結論

目前 backend 已經把「歷史 K 線」與「單檔準即時報價」分成兩條資料流，這是比較務實的做法。

| 需求 | 是否完成 | 後端做法 |
|------|----------|----------|
| 顯示歷史 K 線 | 已完成 | 前端優先呼叫 `/api/market/db-bars/:code?quick=1`，後端先查 SQL Server，必要時優先向 TWSE 抓資料；若 TWSE 歷史端點不可用，改用 FinMind fallback |
| 計算技術指標 | 已完成在前端 | 後端回傳日線 OHLCV，前端用這些資料計算 MA、VOL、KD、RSI、MACD、BB Band |
| 顯示單檔準即時報價 | 已完成 | 前端呼叫 `/api/quote/:code`，後端向 TWSE MIS 抓現價、漲跌、開高低量 |
| 避免一次抓全部股票報價 | 已完成 | 只有使用者正在看某檔股票時才抓，後端另有 20 秒快取 |
| OpenAPI 最新交易日資料 | 已完成但不是 K 線主資料源 | `/api/market/*` 與 `/api/market/import-preview` 可用於股票清單、最新交易日資料與匯入預覽 |

直接結論：TWSE OpenAPI 的 `STOCK_DAY_ALL` 不適合拿來做歷史 K 線，因為它主要提供最新交易日的整體市場資料。歷史 K 線優先使用 TWSE `STOCK_DAY`；若該歷史端點暫時不可用，後端會改用 FinMind 的台股日線資料作為 fallback。準即時報價仍使用 TWSE MIS。

### 本次更新完成事項

這次更新主要是修正「第一次看股票圖表太慢、畫面殘留載入字樣、以及前端搜尋誤判找不到」三個問題。

| 更新項目 | 修改後行為 | 為什麼要這樣做 |
|----------|------------|----------------|
| 歷史 K 線 quick 模式 | 前端先呼叫 `/api/market/db-bars/:code?quick=1` | 讓圖表先用可用資料顯示，不必每次都等完整歷史同步 |
| 資料庫已有 TWSE 歷史 | 直接回傳 SQL Server 既有完整資料，`historyStatus` 為 `complete` | 舊資料已在資料庫時，不應該重新等待，也不應該顯示載入中 |
| 資料庫尚無 TWSE 歷史 | 先抓最近約 2 個月真實資料回前端 | 讓首次查詢有真實資料可以快速畫圖 |
| 背景補資料 | 非 quick 請求會在背景補資料：有舊資料只補最近 2 個月，完全沒有歷史才補 13 個月；若 TWSE 歷史端點沒有可用資料，會改走 FinMind fallback | 初次載入先保留足夠長度，又不必一次抓多年資料 |
| 向左補歷史 | K 線拖到最左側時，前端會呼叫 `before=YYYY-MM-DD&months=12` 再補更早 12 個月 | 使用者需要時才逐段往前載入，不再被固定年數上限綁住 |
| 前端載入提示 | 只在沒有任何 K 線資料時顯示「真實歷史資料載入中」 | 一旦已有資料，就不應該讓使用者誤以為還沒完成 |
| 前端搜尋 | `2382 廣達` 這種「代碼 + 名稱」會拆成多個關鍵字比對 | 避免已選到股票卻還顯示「找不到」 |

---

## 2. 資料來源分工

### 2-1 TWSE OpenAPI：最新交易日與匯入預覽

使用檔案：

```txt
backend/twseClient.js
backend/twseMapper.js
backend/server.js
```

主要來源：

```txt
https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL
```

用途：

- 取得股票代號、股票名稱、最新一個交易日的開高低收量。
- 做 `/api/market/stocks`、`/api/market/daily-bars`、`/api/market/import-preview`。
- 讓工程團隊檢查 TWSE OpenAPI 欄位能不能對應到專案資料庫。

不適合做的事：

- 不適合一次取得每檔股票過去 300 天或多年 K 線。
- 不適合當作準即時報價，因為它不是盤中即時跳動資料。

### 2-2 TWSE STOCK_DAY + FinMind fallback：歷史 K 線資料源

使用檔案：

```txt
backend/twseExtra.js
backend/dao.js
backend/server.js
```

主要來源（優先）：

```txt
https://www.twse.com.tw/exchangeReport/STOCK_DAY
```

用途：

- 抓單一股票、單一月份的歷史日線。
- 初次完整同步先抓最近約 13 個月，讓前端可以計算到 MA240。
- 使用者把 K 線拖到最左側時，後端會依 `before` 參數再往前補 12 個月。
- 抓到後寫入 SQL Server 的 `stock_daily_bars`。
- 使用 `stock_sync` 記錄該股票今天是否已同步，避免同一天重複打官方 API。

備援來源：

```txt
https://api.finmindtrade.com/api/v4/data
```

用途：

- 當 TWSE 歷史日線端點沒有回傳可用資料時，改抓 FinMind 的 `TaiwanStockPrice`。
- fallback 成功後，`stock_sync.source` 會記成 `finmind`，前端來源標籤也會顯示 FinMind。
- 可在 `backend/.env` 選填 `FINMIND_TOKEN`；不填時仍會先使用公開額度。

### 2-3 TWSE MIS：單檔準即時報價

使用檔案：

```txt
backend/twseExtra.js
backend/dao.js
backend/server.js
```

主要來源：

```txt
https://mis.twse.com.tw/stock/api/getStockInfo.jsp
```

用途：

- 取得單檔股票目前報價。
- 回傳現價、昨收、開盤、最高、最低、成交量、時間、漲跌、漲跌幅。
- 後端用 20 秒快取，避免使用者切換或重整時一直打官方來源。

限制：

- 這不是逐筆成交 tick data。
- 收盤後可能回傳最後成交價或接近收盤狀態。
- 如果官方來源暫時沒有現價，後端會用昨收作為保底顯示，並標記 `closed`。

---

## 3. 歷史 K 線資料流程

前端第一次載入圖表時呼叫 quick 模式：

```txt
GET /api/market/db-bars/2330?quick=1
```

quick 模式用途：

- 如果資料庫已有 TWSE 歷史資料，直接回傳既有完整資料，畫面不需要等。
- 如果資料庫還沒有 TWSE 歷史資料，才先抓近期真實日線，讓圖表快速顯示。
- 前端另發非 quick 背景請求；若已有舊資料，後端只補最近約 2 個月，若完全沒有 TWSE 歷史才補 13 個月。
- 之後若使用者把圖表拖到最左側，前端會用 `before=最早日期&months=12` 逐段補更早歷史。
- 回傳的 `historyStatus` 可讓前端判斷目前是 `complete`、`partial_loading`、`loading` 或 `not_found`。

若需要強制等待完整資料，可呼叫：

```txt
GET /api/market/db-bars/2330
```

完整流程：

```txt
前端 StockChart.vue
  -> frontend/src/services/twseApi.js 的 getDbBars(code, { quick: 1 })
  -> backend/server.js 的 /api/market/db-bars/:code?quick=1
  -> backend/dao.js 的 getStockBars(code)
  -> 先查 SQL Server 的 stocks，確認股票存在
  -> 如果已有 TWSE 歷史，直接回 SQL Server 完整資料
  -> 如果尚未有 TWSE 歷史，先抓近期 TWSE 真實日線回前端
  -> 前端另發背景請求補資料
  -> 若已有舊 TWSE 歷史，背景只補最近約 2 個月並 upsert
  -> 若完全沒有 TWSE 歷史，背景才補最近約 13 個月完整資料
  -> 使用者拖到最左側時，再用 before 參數往前補 12 個月
```

這樣設計的原因：

- 歷史 K 線是「日線資料」，不應該每秒更新。
- 使用者沒看的股票不需要馬上抓，否則會浪費官方 API 與本機資源。
- 第一次看某檔才抓，之後同一天直接查資料庫，符合系統展示與資源控制。
- 初次最近約 13 個月通常足夠前端計算 MA240；更早歷史改成按需逐段載入。
- 若資料庫已有舊 TWSE 歷史，畫面應直接顯示舊資料；背景只補缺的近期資料，不應該讓使用者一直看到載入中。

回傳格式重點：

```json
{
  "ok": true,
  "source": "ncu_db.stock_daily_bars",
  "historyStatus": "complete",
  "code": "2330",
  "count": 253,
  "data": [
    {
      "date": "2025-05-02",
      "open": 968,
      "high": 968,
      "low": 959,
      "close": 963,
      "volume": 28923
    }
  ]
}
```

`source` 與 `historyStatus` 的意義：

| 欄位值 | 意義 | 前端建議 |
|--------|------|----------|
| `source = ncu_db.stock_daily_bars.twse` | 後端回傳 SQL Server 內已同步完成的 TWSE 歷史資料 | 標示為資料庫 TWSE 歷史 |
| `source = ncu_db.stock_daily_bars.finmind` | 後端回傳 SQL Server 內已同步完成的 FinMind fallback 歷史資料 | 標示為資料庫 FinMind 歷史 |
| `source = ncu_db.stock_daily_bars.<provider>.stale` | 資料庫已有歷史，但今天尚未補最新近期資料 | 仍可直接畫圖，背景補資料即可 |
| `source = twse.stock_day.quick` / `finmind.stock_day.quick` | 資料庫尚無完整歷史，後端先回最近約 2 個月真實資料 | 可先畫近期圖，不要標成測試資料 |
| `historyStatus = complete` | 前端已有完整可用歷史資料 | 不顯示載入提示 |
| `historyStatus = partial_loading` | 目前先有近期真實資料，背景仍可能補完整歷史 | 可畫圖；如果要提示，提示應避免遮住主要畫面 |
| `historyStatus = loading` | 目前還沒有可畫的真實 K 線 | 才顯示「真實歷史資料載入中」 |
| `historyStatus = not_found` | 後端股票表找不到該代碼 | 前端應提示股票不存在或未支援 |

欄位說明：

- `date`：交易日期。
- `open`：開盤價，當天第一段成交附近的價格。
- `high`：最高價，當天成交過的最高價格。
- `low`：最低價，當天成交過的最低價格。
- `close`：收盤價，當天最後收盤價格。
- `volume`：成交量，代表當天成交多少張或股數，實際單位依來源整理方式為準。

---

## 4. 準即時報價資料流程

前端呼叫：

```txt
GET /api/quote/2330
```

完整流程：

```txt
前端 LiveQuote.vue
  -> frontend/src/services/twseApi.js 的 getQuote(code)
  -> backend/server.js 的 /api/quote/:code
  -> backend/dao.js 的 getQuote(code)
  -> 先檢查 quoteCache 是否 20 秒內已有同股票報價
  -> 如果有快取，直接回傳快取
  -> 如果沒有快取，呼叫 backend/twseExtra.js 的 fetchQuote(code)
  -> 向 TWSE MIS 抓單檔報價
  -> 整理成前端容易顯示的格式
  -> 寫入 20 秒記憶體快取
  -> 回傳給前端
```

這樣設計的原因：

- 準即時報價適合顯示在 K 線圖上方，而不是硬塞進日 K 線資料。
- 日 K 線代表一整天結束後的 OHLCV；盤中現價只是「目前狀態」，不是正式日 K。
- 使用者主動看某檔或切換到某檔時才抓，符合資源控制。
- 20 秒快取可避免使用者連點更新造成官方來源壓力。

回傳格式重點：

```json
{
  "ok": true,
  "data": {
    "code": "2330",
    "name": "台積電",
    "price": 2265,
    "prevClose": 2270,
    "open": 2310,
    "high": 2325,
    "low": 2250,
    "volume": 29774,
    "time": "13:30:00",
    "date": "20260515",
    "change": -5,
    "changePct": -0.22,
    "closed": false,
    "cached": false
  }
}
```

欄位說明：

- `price`：目前成交價或最近可取得價格。
- `prevClose`：前一個交易日收盤價，用來計算漲跌。
- `change`：現價減昨收。
- `changePct`：漲跌幅百分比。
- `closed`：後端判斷是否比較像收盤或沒有盤中現價。
- `cached`：是否來自後端 20 秒快取。

---

## 5. 前端整合方式

目前前端採用正確的整合方式：

```txt
同一張 K 線圖
  -> 下方主要圖形：使用歷史日線資料
  -> 上方即時報價條：使用準即時報價資料
```

為什麼不建議把準即時報價直接塞進最後一根日 K：

- 盤中價格還沒收盤，不能代表正式 `close`。
- 如果把盤中價格塞進日 K，MA 指標會跟著跳動，容易讓使用者誤解。
- 系統展示時比較好解釋：歷史 K 線是資料庫日線，報價條是當下報價。

建議說法：

```txt
K 線與 MA 指標使用 SQL Server 中的歷史日線資料；
上方報價條使用 TWSE MIS 的單檔準即時報價。
兩者視覺上放在同一個股票圖表區，但資料流分開，避免混淆正式日線與盤中報價。
```

---

## 6. 主要 API 清單

| Route | 用途 | 前端主要使用情境 |
|-------|------|------------------|
| `GET /api/health` | 檢查 backend 與資料庫是否正常 | 啟動檢查 |
| `GET /api/market/db-bars/:code` | 取得某檔歷史 K 線，必要時 lazy 同步 TWSE 歷史資料 | K 線圖與 MA 指標 |
| `GET /api/market/db-bars/:code?refresh=1` | 強制重新抓該股票歷史 K 線 | 測試或資料異常時使用 |
| `GET /api/quote/:code` | 取得某檔準即時報價 | K 線圖上方即時報價條 |
| `GET /api/market/stocks` | 從 TWSE OpenAPI 整理股票清單 | 股票清單或匯入預覽 |
| `GET /api/market/stocks/:code` | 從 TWSE OpenAPI 整理單檔最新交易日資料 | 單檔基本資訊 |
| `GET /api/market/daily-bars` | 從 TWSE OpenAPI 整理最新交易日 K 資料 | 最新交易日市場資料 |
| `GET /api/market/import-preview` | 預覽可匯入 SQL Server 的資料格式 | 後端與資料庫對照 |
| `POST /api/assistant/chat` | AI 助理聊天；先判斷是否股票題，再查詢資料後交給 OpenAI 生成回答 | AI 助理頁面 |
| `GET /api/assistant/diagnostics?etf=0050` | 顯示 AI 篩選用的 ETF 成分、產業、題材與技術面可用狀態 | 開發除錯 |

---

## 7. 目前資料庫相關表

### `stocks`

用途：

- 保存股票基本資料。
- `getStockBars(code)` 會先查這張表，確認該股票是否在系統支援清單內。

重要欄位：

- `id`：資料庫內部股票 ID。
- `code`：股票代號，例如 `2330`。
- `name`：股票名稱，例如 `台積電`。

### `stock_daily_bars`

用途：

- 保存歷史日線 OHLCV。
- 前端 K 線圖與 MA 指標主要使用這張表。

重要欄位：

- `stock_id`：對應 `stocks.id`。
- `trade_date`：交易日期。
- `[open]`：開盤價，因為 `open` 接近 SQL 保留字，所以在 SQL 查詢內用中括號包住。
- `high`：最高價。
- `low`：最低價。
- `[close]`：收盤價，因為 `close` 接近 SQL 保留字，所以在 SQL 查詢內用中括號包住。
- `volume`：成交量。

### `stock_sync`

用途：

- 記錄每檔股票歷史資料的同步狀態。
- 避免同一檔股票同一天重複向 TWSE 抓歷史資料。

重要欄位：

- `stock_id`：對應 `stocks.id`。
- `source`：資料來源，例如 `seed` 或 `twse`。
- `last_synced`：最後同步時間。

### `assistant_etf_holdings`

用途：

- 保存 AI 助理查到的 ETF 成分股快取。
- 若使用者詢問如 `0050` 成分股，後端會優先讀取這張表；資料過期或不存在時，才重新抓取公開來源後寫回資料庫。

重要欄位：

- `etf_code`：ETF 代碼，例如 `0050`。
- `trade_date`：成分股資料日期。
- `stock_code` / `stock_name`：成分股代碼與名稱。
- `weight`：基金權重。
- `source_url`：資料來源。
- `fetched_at`：本地最後抓取時間。

---

## 8. AI 助理設定

在 `backend/.env` 內加入：

```env
OPENAI_API_KEY=你的_OpenAI_API_Key
OPENAI_MODEL=gpt-5-mini
```

AI 助理目前流程：

```txt
前端 /assistant
  -> POST /api/assistant/chat
  -> 先用 OpenAI 做問題分類
  -> 非股票題直接回固定拒答
  -> 股票題先查 SQL Server / ETF 成分股快取 / TWSE 市場資料
  -> 若使用者明確詢問個股技術面，後端會用同一批 K 線資料計算 MA / KD / RSI / MACD / BB Band
  -> 若使用者要求 ETF 成分股推薦，後端會讀取最新官方成分股、TWSE 估值面資料與可用技術摘要，產生可量化的排名候選
  -> 若問題含有產業或題材條件，後端會先套用官方產業分類與本地題材標籤，再進行排名
  -> ETF 內選股排名若使用 technical_strength，後端會先補到至少 120 根日 K 後再評分，避免只用 20～30 根短期資料做排名
  -> 缺資料時先補抓，再把 context 交給 OpenAI 生成回答
```

設計原則：

- 只要涉及個股、ETF、價格、成分股或推薦，回答必須建立在實際 context 上。
- 若使用者詢問技術面，AI 會使用 `marketSnapshots[].technicals` 中的實際指標摘要，而不是憑印象解讀。
- 若使用者要求 ETF 內選股，AI 會優先使用 `screening.rankedCandidates` 的量化結果；目前支援的排名因子包含技術面、殖利率、低本益比、低股價淨值比與 ETF 權重。
- 若使用者指定正式產業，例如 `金融`，系統會優先使用 `assistant_stock_industries` 的官方產業分類。
- 若使用者指定市場題材，例如 `記憶體`、`AI 伺服器`、`散熱`、`PCB`、`電信`、`航運`、`重電`、`機器人`、`矽光子`，系統會使用 `assistant_topics` / `assistant_stock_topics` 的可維護標籤資料。
- 若使用者問的是「最值得買」、「首選」這類沒有指定單一指標的推薦問題，系統預設採用綜合評估：技術面 40%、殖利率 20%、低本益比 20%、低股價淨值比 20%。
- 若使用者只輸入已支援的台股語境詞，例如 `記憶體股`、`金融股`、`AI 伺服器股`、`高股息`，即使沒有明寫「台股」，系統也會預設視為台股問題處理。
- `高股息` 不做成固定題材，而是保留為動態篩選條件，實際依殖利率資料排序。
- `金融` 屬於產業，不屬於題材；未支援的 topic 不會直接套進篩選條件，避免把候選股錯誤濾空。
- 如果資料不足，助理要明講不足，不可自行捏造推薦名單。
- 非台股題固定回覆：`抱歉，這題我沒辦法回答，歡迎詢問我台股相關問題~`

---

## 9. 目前限制與務實修正路徑

### 限制 1：不是所有股票都一定能抓到歷史資料

原因：

- 系統會先檢查 `stocks` 表，股票不存在就不抓。
- TWSE 可能查不到 ETF、上櫃或特殊商品的同一來源資料。

修正路徑：

- 先確保 `stocks` 有系統展示需要的股票。
- 如果要支援上櫃股票，需要補充 OTC 來源。

### 限制 2：初次只抓最近約 13 個月，舊資料採按需往前補

原因：

- 系統展示重點是 K 線與 MA 指標，不是建立完整金融資料倉儲。
- 一次抓多年資料會增加官方 API 壓力與資料清理成本。

修正路徑：

- 若審查者要求更長期間，可把 `fetchRecentHistory(code, 13)` 的月份數改大。
- 更成熟的做法是新增排程，每天收盤後只更新關注清單內股票。

### 限制 3：準即時報價不是正式逐筆即時行情

原因：

- TWSE MIS 可提供接近即時的單檔報價，但不是交易所付費等級逐筆資料。
- 產品不應宣稱自己有完整即時交易所行情。

修正路徑：

- 對外說「準即時報價」或「接近即時報價」，不要說「逐筆即時」。
- 畫面上保留時間欄位，讓使用者知道報價時間。

---

## 10. 此專案較完整的解法

最適合目前專案的完整方案如下：

1. 股票清單與最新交易日資料：使用 TWSE OpenAPI。
2. 歷史 K 線：使用 TWSE `STOCK_DAY`，以單檔 lazy loading 方式寫入 SQL Server。
3. 技術指標：前端用後端回傳的歷史 OHLCV 計算 MA、週 K、月 K。
4. 準即時報價：使用 TWSE MIS，只在使用者正在看某檔股票時抓。
5. 資源控制：歷史資料同檔同日最多同步一次；報價 20 秒快取。
6. 展示方式：K 線圖不換，圖表上方加報價條，讓歷史分析與當下價格同區呈現。

這個方案比「一次抓全部股票即時報價」更合理，因為本系統不需要承擔大量行情請求，也不會被誤認為在做高頻交易系統。
