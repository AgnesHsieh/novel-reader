# 📖 墨韻讀書 (WeRead Novel Reader)

微信讀書風格的極致純淨線上小說閱讀器。支援全網免費小說搜尋解析、多種音色 AI 聽書、自動記憶閱讀進度、自建精美書架與本地書籍（PDF、TXT、EPUB）匯入。

---

## 🚀 線上執行方式 (選擇任一種即可)

### 1️⃣ GitHub Pages（最快，已自動開通，免安裝直接開）
👉 **[點此直接開啟墨韻讀書 (GitHub Pages)](https://agneshsieh.github.io/novel-reader/)**
* 💡 **手機與電腦皆可隨點即用**。
* 支援本地 **PDF、TXT 書籍拖曳匯入**、離線書架記憶、AI 聽書（微軟/系統多音色）、閱讀自訂排版（5 種護眼主題、字級、間距）。
* *註：若需要在 GitHub Pages 靜態環境中即時檢索外部小說站點（如番茄/筆趣閣），可搭配下方的 Render 雲端後端。*

---

### 2️⃣ GitHub Codespaces（在 GitHub 雲端一鍵啟動完整後端）
[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/AgnesHsieh/novel-reader)

1. 點擊上方按鈕（或在 GitHub 倉庫點擊 **Code** -> **Codespaces** -> **Create codespace on main**）。
2. GitHub 將在瀏覽器雲端環境中自動開機並執行後端伺服器。
3. 終端機自動轉發 3001 連接埠，點擊彈出的「在瀏覽器中開啟」即可享受 100% 完整線上搜尋、爬蟲與閱讀功能！

---

### 3️⃣ Render 免費雲端託管（24 小時不中斷，全功能後端）
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/AgnesHsieh/novel-reader)

1. 點擊上方 **Deploy to Render** 按鈕（使用 GitHub 帳號 1 秒登入）。
2. 點擊 **Apply**，Render 將全自動建置並常駐運行後端爬蟲服務。
3. 取得專屬免費永久 HTTPS 網址（例如 `https://weread-novel-xxxx.onrender.com`），手機隨時隨地不受家裡 Wi-Fi 限制！

---

## 💻 本地電腦執行

```bash
# 1. 複製倉庫
git clone https://github.com/AgnesHsieh/novel-reader.git
cd novel-reader

# 2. 啟動伺服器 (純 Node.js 原生模組，零額外依賴)
node server.js
```

啟動後：
* **本機閱讀**：瀏覽器打開 `http://localhost:3001`
* **手機/同區網閱讀**：手機瀏覽器打開終端機顯示的 `http://192.168.x.x:3001`

---

## ✨ 核心特色

1. **微信讀書級排版體驗**：
   * 羊皮紙米黃、純白雅緻、護眼豆沙綠、雅灰夜讀、OLED 極致純黑等 5 款精心調校主題。
   * 自適應響應式佈局，完美相容 iPhone、Android 與桌面寬螢幕。
2. **多格式本地書籍解析**：
   * 支援拖曳或上傳 **PDF**（內建 Mozilla PDF.js 引擎逐頁解析分章）、**TXT**（智慧識別編碼與章節目錄）。
3. **番茄小說字型加密還原 (PUA Anti-Crawler Decryption)**：
   * 逆向解析並還原 362 個私有自定義字符映射，解決生僻字亂碼，實現流暢自然真人聽書。
4. **AI 多音色語音聽書**：
   * 完美支援 Microsoft 曉臻 (Xiaoxiao)、雅婷 (Yating)、雲希 (Yunxi)、志偉 (Zhiwei)、智宇 (Zhiyu) 等中文真人自然音色。
   * 邊聽邊同步段落高亮捲動，支援定時關閉與語速調節。
5. **離線 IndexedDB 本地儲存**：
   * 書籍正文、閱讀紀錄、書架與進度全部在瀏覽器 IndexedDB 中快取，離線也能順暢翻閱。
