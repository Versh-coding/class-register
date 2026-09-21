/**
 * 班級預約系統 - Firebase Realtime Database 雲端同步模組
 * 
 * 使用說明：
 * 1. 到 https://console.firebase.google.com/ 建立免費專案
 * 2. 建立 Realtime Database（選 Test Mode）
 * 3. 進入「專案設定 > 您的應用程式」取得 firebaseConfig
 * 4. 將以下 firebaseConfig 的各欄位替換成你的真實金鑰
 * 5. 儲存後 push 到 GitHub，全班即可共用即時同步！
 * 
 * ⚠️ 注意：apiKey 不是密碼，在 Firebase Realtime Database 的安全規則中
 *          用「規則 (Rules)」來控制誰能讀寫，不是靠 apiKey 保密。
 */

const firebaseConfig = {
  apiKey: "AIzaSyDXNjC0kA-97RJjtqKX0cHV0nscLjhOMow",
  authDomain: "class-register-492b9.firebaseapp.com",
  databaseURL: "https://class-register-492b9-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "class-register-492b9",
  storageBucket: "class-register-492b9.firebasestorage.app",
  messagingSenderId: "751385120026",
  appId: "1:751385120026:web:24f3798f2744d018b1b0a3"
};
window.FIREBASE_CONFIG = firebaseConfig;


/**
 * Firebase Cloud Sync Adapter
 * 
 * 負責：
 * - 初始化 Firebase App + Database
 * - 提供 db.read / db.write / db.listen 介面給 app.js 使用
 * - 若 config 未設定（databaseURL 為空），自動切換回 localStorage 模式
 */
window.CloudDB = (function () {
  let _db = null;        // Firebase Database reference
  let _isOnline = false; // 是否已成功連上 Firebase

  // 雲端資料的節點路徑（對應 Realtime Database 的樹狀結構）
  const PATHS = {
    BOOKINGS: 'data/bookings',
    HOLIDAYS: 'data/holidays',
    PASSWORDS: 'data/passwords'
  };

  /**
   * 嘗試初始化 Firebase
   * 若 FIREBASE_CONFIG.databaseURL 為空則停留在 localStorage 模式
   */
  function init(savedConfigStr) {
    // 嘗試從 localStorage 讀取使用者手動儲存的設定（覆蓋預設）
    let cfg = window.FIREBASE_CONFIG || firebaseConfig;

    if (savedConfigStr) {
      try {
        const parsed = JSON.parse(savedConfigStr);
        cfg = Object.assign({}, cfg, parsed);
      } catch (e) {
        console.warn('[CloudDB] 無法解析儲存的 Firebase 設定，使用預設值');
      }
    }

    if (!cfg || !cfg.databaseURL || cfg.databaseURL.trim() === '') {
      console.info('[CloudDB] 未設定 databaseURL，使用本地 localStorage 模式');
      _isOnline = false;
      updateStatusUI(false);
      return false;
    }

    try {
      // 避免重複初始化（Firebase SDK 不允許重複 initializeApp）
      let app;
      if (firebase.apps.length === 0) {
        app = firebase.initializeApp(cfg);
      } else {
        app = firebase.app(); // 使用已存在的 app
      }
      _db = firebase.database(app);
      _isOnline = true;
      console.info('[CloudDB] ✅ Firebase 連線成功！databaseURL:', cfg.databaseURL);
      updateStatusUI(true);
      return true;
    } catch (e) {
      console.error('[CloudDB] Firebase 初始化失敗:', e);
      _isOnline = false;
      updateStatusUI(false);
      return false;
    }
  }

  /**
   * 更新頁面上的連線狀態指示器
   */
  function updateStatusUI(online) {
    const dot = document.getElementById('cloudStatusDot');
    const text = document.getElementById('cloudStatusText');
    if (dot) {
      dot.className = 'cloud-status-indicator ' + (online ? 'online' : 'offline');
    }
    if (text) {
      text.textContent = online ? '🟢 雲端已即時同步' : '☁️ 離線模式';
    }

    // 更新彈窗內的狀態說明框
    const statusBox = document.getElementById('cloudConnectionStatusBox');
    if (statusBox) {
      if (online) {
        statusBox.innerHTML = `
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <span class="cloud-status-indicator online" style="flex-shrink:0;"></span>
              <strong style="color:#34d399;">已連線 Firebase 雲端！</strong>
            </div>
            <div style="font-size:0.82rem;color:#94a3b8;">
              全班同學使用手機或電腦開啟此網頁，所有預約、簽到與停練紀錄皆即時秒級共用。
              重新設定請重新填入新的 Firebase Config 並點擊儲存。
            </div>
          </div>
        `;
      } else {
        statusBox.innerHTML = `
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <span class="cloud-status-indicator offline" style="flex-shrink:0;"></span>
              <strong style="color:#f59e0b;">本地儲存模式（各設備各自獨立）</strong>
            </div>
            <div style="font-size:0.82rem;color:#94a3b8;">
              目前資料只存在這台設備的瀏覽器中，換裝置或清除瀏覽器資料就會消失。
              填入下方 Firebase 設定即可升級為跨設備即時共用！
            </div>
          </div>
        `;
      }
    }
  }

  /**
   * 判斷是否為雲端模式
   */
  function isOnline() {
    return _isOnline && _db !== null;
  }

  /**
   * 一次性讀取雲端節點資料
   * @param {string} path - PATHS 中的路徑
   * @returns {Promise<any>}
   */
  async function read(path) {
    if (!isOnline()) return null;
    try {
      const snapshot = await _db.ref(path).get();
      return snapshot.exists() ? snapshot.val() : null;
    } catch (e) {
      console.error('[CloudDB] 讀取失敗:', path, e);
      return null;
    }
  }

  /**
   * 寫入雲端節點
   * @param {string} path
   * @param {any} data
   */
  async function write(path, data) {
    if (!isOnline()) return false;
    try {
      await _db.ref(path).set(data);
      return true;
    } catch (e) {
      console.error('[CloudDB] 寫入失敗:', path, e);
      return false;
    }
  }

  /**
   * 訂閱雲端節點的即時更新（每次資料變動都會呼叫 callback）
   * @param {string} path
   * @param {function} callback - 收到新資料時呼叫，傳入 data（null 表示無資料）
   * @returns {function} 取消訂閱的 unsubscribe 函式
   */
  function listen(path, callback) {
    if (!isOnline()) return () => { };
    const ref = _db.ref(path);
    const handler = (snapshot) => {
      callback(snapshot.exists() ? snapshot.val() : null);
    };
    ref.on('value', handler);
    // 回傳 unsubscribe 函式
    return () => ref.off('value', handler);
  }

  /**
   * 斷開 Firebase 連線（切換回 localStorage 模式）
   */
  function disconnect() {
    if (_db) {
      _db.goOffline();
    }
    _db = null;
    _isOnline = false;
    localStorage.removeItem('firebase_config_saved');
    updateStatusUI(false);
    console.info('[CloudDB] 已斷開雲端，切換回本地模式');
  }

  return {
    PATHS,
    init,
    isOnline,
    read,
    write,
    listen,
    disconnect,
    updateStatusUI
  };
})();
