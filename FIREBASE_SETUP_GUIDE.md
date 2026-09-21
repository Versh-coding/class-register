# 班級預約系統：免費開啟 GitHub Pages 跨設備雲端同步指南

本系統已原生整合 **Google Firebase Realtime Database**。  
設定完成後，網站放上 GitHub Pages，無論同學用手機、老師用電腦，**所有人看到的預約名單、簽到紀錄與停練日期都將完全同步，且無需手動重新整理網頁！**

---

## ⚡ 快速 3 步驟設定（約 3 分鐘，完全免費）

### 第一步：建立 Google Firebase 免費專案
1. 開啟 [Firebase 控制台 (Firebase Console)](https://console.firebase.google.com/) 並以 Google 帳號登入。
2. 點擊 **「新增專案」 (Add Project)**。
3. 輸入專案名稱（例如：`class-register`），取消勾選 Google Analytics（不需要用到），點擊 **「建立專案」**。

---

### 第二步：建立 Realtime Database 資料庫與設定規則
1. 在專案首頁左側選單點擊 **「建立」 (Build) > 「Realtime Database」**。
2. 點擊 **「建立資料庫」 (Create Database)**，伺服器位置選擇預設（例如：`United States` 或 `Singapore`）即可。
3. 建立後，點擊上方分頁切換至 **「規則」 (Rules)**。
4. 將編輯器內的程式碼全部替換為以下設定，並點擊右上方 **「發布」 (Publish)**：

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

> ⚠️ **重要提醒（為什麼不能直接用預設的測試模式？）：**  
> Firebase 建立時預設的「測試模式」會加上 `now < 30天後時間戳` 的限制，**30 天後會自動過期關閉**，導致全班無法再同步！  
> 改成上述的 `.read: true` 與 `.write: true` 後，全班免註冊即可永久、跨手機與電腦即時同步預約與簽到。（Firebase 會提示黃色公開警告，這是正常的班級免登入機制）。

---

### 第三步：取得設定金鑰並填入系統
1. 點擊左側齒輪圖示 ⚙️ **「專案設定」 (Project Settings)**。
2. 往下滑動至「您的應用程式」，點擊網頁圖示 `</>`（新增網頁應用程式）。
3. 輸入應用程式暱稱（如 `web-app`），點擊「註冊應用程式」。
4. 畫面會出現一段 `firebaseConfig` 程式碼，複製其中的內容，例如：
```javascript
const firebaseConfig = {
  apiKey: "AIzaSyB-xxxxxxx",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:xxxxxxx"
};
```
5. **填入系統（二選一）：**
   - **方式 A（最簡單）：** 打開本預約網站，點擊頂部 **「☁️ 雲端同步」** 按鈕，將整段設定貼入並點擊儲存！
   - **方式 B：** 將設定貼至專案目錄下的 `firebase-config.js` 檔案中，並一起 push 到 GitHub 即可！

---

## 🚀 部署至 GitHub Pages
1. 將本專案的所有檔案（`index.html`, `style.css`, `app.js`, `firebase-config.js` 等）推送到 GitHub 儲存庫。
2. 進入儲存庫的 **Settings > Pages**。
3. **Branch** 選擇 `main`（或 `master`），資料夾選擇 `/ (root)`，點擊 **Save**。
4. 稍等約 1 分鐘，GitHub 會產生專屬網址（例如：`https://yourname.github.io/Register-website/`）。
5. 將網址傳到班級群組，全班即可同時使用與即時同步！
