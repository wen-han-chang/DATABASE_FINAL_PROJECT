# 投智 AI — 投資練習輔助系統

> 以引導式問卷了解投資偏好，搭配 AI 盤勢解讀、個股技術分析、與下單練習功能，幫助投資新手建立正確的投資思維。

---

## 功能總覽

| 功能 | 說明 |
|------|------|
| 登入系統 | 帳號驗證，未登入無法進入任何頁面 |
| 投資偏好問卷 | 三步驟引導（資金規模 → 風險承受 → 投資週期），產生個人投資畫像 |
| 首頁總覽 | AI 盤勢摘要、決策卡片、投資知識抽屜 |
| 個股查詢 | 輸入股票代碼或名稱，顯示 K 線圖（日/週/月）與 AI 技術分析 |
| 下單練習 | 設定練習資金，進行買賣練習，即時計算手續費與證交稅 |

---

## 技術架構

- **框架**：Vue 3 Composition API（`<script setup>`）
- **建構工具**：Vite 5
- **狀態管理**：Pinia
- **路由**：Vue Router 4
- **圖表**：ECharts 5（K 線 + 均線 + 成交量）
- **樣式**：Tailwind CSS 3
- **圖示**：Lucide Vue Next

---

## 專案結構

```
專案根目錄/
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
└── src/
    ├── main.js
    ├── App.vue                        # 主佈局（側邊欄 + RouterView）
    ├── router/
    │   └── index.js                   # 路由定義與 Navigation Guard
    ├── stores/
    │   ├── auth.js                    # 登入狀態管理
    │   ├── investor.js                # 投資偏好 Store
    │   └── portfolio.js               # 投資組合 Store（後端資料庫為主，localStorage 只作快取）
    ├── data/
    │   ├── twStocks.js                # 台股清單、搜尋資料與練習價格參考
    │   └── knowledgeBase.js           # 投資術語知識庫
    ├── components/
    │   ├── layout/
    │   │   └── SideNav.vue            # 左側導航欄
    │   ├── Login.vue                  # 登入表單
    │   ├── Onboarding.vue             # 投資偏好問卷精靈
    │   ├── StockChart.vue             # ECharts K 線圖組件
    │   ├── MarketAIView.vue           # AI 盤勢解讀卡片
    │   ├── DecisionSandbox.vue        # 投資決策卡片
    │   └── KnowledgeDrawer.vue        # 右側知識抽屜
    └── views/
        ├── LoginView.vue
        ├── OnboardingView.vue
        ├── HomeView.vue               # 首頁（AI 摘要 + 決策沙盒）
        ├── StockSearchView.vue        # 個股查詢頁
        └── TradingView.vue            # 下單練習頁
```

---

## 快速開始

### 環境需求

- [Node.js](https://nodejs.org/) v18 以上

### 安裝與啟動

```bash
# 1. 如果目前在專案根目錄，先進入 frontend
cd frontend

# 2. 安裝相依套件
npm install

# 3. 啟動開發伺服器
npm run dev
```

開啟瀏覽器至 `http://localhost:5173`

### 其他指令

```bash
npm run build    # 打包正式版（輸出至 dist/）
npm run preview  # 預覽打包結果
```

---

## 測試帳號

| Email | 密碼 |
|-------|------|
| `demo@invest.ai` | `demo123` |
| `user@example.com` | `password` |

---

## 核心設計說明

### 台股行情資料流程

個股查詢頁的 K 線圖不再用前端假 K 線產生器。現在流程是：

```txt
StockChart.vue
  -> getDbBars(code, { quick: 1 })
  -> 後端 /api/market/db-bars/:code?quick=1
  -> 有 SQL Server TWSE 歷史就直接顯示
  -> 沒有舊資料才先顯示近期 TWSE 真實資料
  -> 背景再呼叫 getDbBars(code) 補完整歷史
```

圖表上方的現價、漲跌、開高低量由 `LiveQuote.vue` 呼叫 `getQuote(code)`，資料來自後端 `/api/quote/:code`，後端會向 TWSE MIS 抓單檔準即時報價並做 20 秒快取。

`twStocks.js` 仍保留股票清單、搜尋資料與下單練習用的參考價函式；它不是個股查詢 K 線圖的主要資料來源。

### 手續費計算規則

| 項目 | 費率 | 收取時機 |
|------|------|----------|
| 手續費 | 0.1425%（最低 20 元） | 買入 + 賣出 |
| 證交稅 | 0.3%（ETF 為 0.1%） | 賣出時 |

### Navigation Guard 流程

```
未登入 → /login
已登入，未完成問卷 → /onboarding
已登入，已完成問卷 → 正常進入各頁面
```

### 資料持久化

登入、問卷、投資組合、持股與交易紀錄的真正資料來源是後端 SQL Server。前端 Store 仍使用 `localStorage` 作為短暫快取，目的是讓重新整理時畫面不會瞬間空白；後端載入成功後會覆蓋快取。

---

## 畫面預覽

| 頁面 | 說明 |
|------|------|
| 登入頁 | 帳號密碼驗證，錯誤提示 |
| 問卷精靈 | 三步驟卡片式選擇，完成後顯示投資畫像 |
| 首頁 | AI 盤勢解讀、決策卡片（買入/觀望/警示）、知識抽屜 |
| 個股查詢 | 即時搜尋、日/週/月 K 線、MA5～MA240 均線切換 |
| 下單練習 | 資金設定、下單表單、費用明細、持股與交易紀錄 |
