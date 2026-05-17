# 投智 AI — 台股模擬交易系統

Vue 3 + Node.js + SQL Server 全端專案，串接 TWSE 即時報價，支援整張／零股下單、當沖偵測、AI 分析建議。

---

## 環境需求

| 軟體 | 版本 |
|------|------|
| Node.js | v18 以上 |
| SQL Server | 2019 以上（或 2022） |
| SSMS | 任意版本（執行 .sql 用） |

---

## 首次安裝（只需做一次）

### 步驟 1 — 建立資料庫與資料表

用 **Windows 驗證** 登入 SSMS，開新查詢，依序執行以下兩個檔案：

```
database/schema.sql        ← 建立 ncu_db 與所有資料表
database/setup-login.sql   ← 建立 SQL Server 登入帳號 skyfire，並開啟混合驗證
```

執行完 `setup-login.sql` 後，**右鍵點 SSMS 物件總管最上層的伺服器 → 重新啟動**，讓混合驗證生效。

### 步驟 2 — 安裝後端套件並灌入股票資料

```powershell
cd backend
npm install
node seed.js
```

`seed.js` 會把台灣前 50 大股票的代碼、名稱、產業別寫入資料庫。

### 步驟 3 — 建立示範帳號

```powershell
# 在 backend 目錄下執行（backend 必須先啟動）
node server.js
```

另開一個終端機，執行：

```powershell
Invoke-RestMethod -Uri http://localhost:3001/api/auth/register `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"email":"demo@invest.ai","password":"demo123","name":"示範用戶"}'
```

> 只需建立一次。之後資料存在資料庫，重啟服務不會消失。

### 步驟 4 — 安裝前端套件

```powershell
cd frontend
npm install
```

---

## 每次啟動

需要開兩個終端機視窗：

**終端機 1 — 後端**

```powershell
cd backend
node server.js
```

後端啟動後顯示 `Backend is running at http://localhost:3001`。

**終端機 2 — 前端**

```powershell
cd frontend
npm run dev
```

開啟瀏覽器至 `http://localhost:5173`

---

## 登入

| 欄位 | 值 |
|------|----|
| 電子郵件 | demo@invest.ai |
| 密碼 | demo123 |

登入頁有「**快速填入示範帳號**」按鈕，點一下即可自動填入並登入。

---

## 功能說明

### 下單規則

- **交易日**：週一至週五，09:00－13:30（台灣時間）
- **整張**：1 張 = 1,000 股，手續費最低 20 元
- **零股**：任意正整數股，手續費最低 1 元
- **當沖**：同一天買賣同一檔股票，證交稅自動套用 0.15%（一般為 0.3%）

### 費用計算

| 項目 | 規則 |
|------|------|
| 手續費 | 面額 × 0.1425%，整張最低 20 元，零股最低 1 元（買賣雙向） |
| 證交稅 | 面額 × 0.3%（ETF 0.1%，當沖 0.15%），**僅賣出時收取** |

### 報價來源

即時報價由 TWSE MIS API 提供，後端有 20 秒快取避免頻繁呼叫。非交易時間報價仍可顯示（收盤價），但無法下單。

---

## 專案結構

```
DATABASE_FINAL_PROJECT/
├── backend/
│   ├── server.js       # HTTP 伺服器（路由）
│   ├── dao.js          # 資料存取層（SQL 查詢）
│   ├── db.js           # SQL Server 連線池
│   ├── auth.js         # JWT token / 密碼雜湊
│   ├── seed.js         # 股票資料種子腳本
│   ├── twseClient.js   # TWSE OpenAPI 用戶端
│   ├── twseExtra.js    # TWSE MIS 即時報價
│   └── .env            # 資料庫連線設定
├── frontend/
│   └── src/
│       ├── views/      # 頁面元件
│       ├── stores/     # Pinia 狀態管理
│       └── services/   # API 呼叫封裝
└── database/
    ├── schema.sql      # 建立資料庫與所有資料表
    └── setup-login.sql # 建立 SQL Server 登入帳號
```

---

## 連線設定（backend/.env）

```
PORT=3001
DB_HOST=127.0.0.1
DB_PORT=1433
DB_USER=skyfire
DB_PASSWORD=Demo1234!
DB_NAME=ncu_db
```

如需修改資料庫帳密，同步更新 `.env` 與 `database/setup-login.sql`。
