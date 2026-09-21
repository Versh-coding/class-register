/**
 * 班級練習預約與簽到系統 - 核心邏輯
 * 規則：
 * 1. 班級座號 1 ~ 31 號，預設密碼為座號。
 * 2. 僅每週二 (Tuesday) 與每週四 (Thursday) 開放練習時段 (16:30 - 18:00)。
 * 3. 隨時可提前預約未來開放日，但當日到達 16:30 ~ 18:00 練習開始後，預約即截止鎖定，並全面轉為簽到模式。
 * 4. 日曆自動定位至當天年月，並特別標記「今日」。
 */

(function () {
  'use strict';

  // ==========================================
  // 1. 常數與系統狀態 (State Management)
  // ==========================================
  const TOTAL_SEATS = 31;
  const PRACTICE_START_MINUTES = 16 * 60 + 30; // 16:30 (990 mins)
  const PRACTICE_END_MINUTES = 18 * 60;        // 18:00 (1080 mins)

  // Simulation state: null means real-time, or a simulated Date
  let simulatedTimeOffset = null;

  // Currently viewed month/year on calendar
  let viewYear = new Date().getFullYear();
  let viewMonth = new Date().getMonth(); // 0-indexed

  // Track active real-time/simulated month and date to detect auto-progression
  let lastActiveMonthKey = null;
  let lastActiveDateKey = null;

  // Active selected date in modal
  let selectedDateStr = null;

  // LocalStorage Keys & Admin Credentials
  const ADMIN_PASSWORD = 'Im_versh0908';
  let pendingAdminAction = null;

  const STORAGE_KEYS = {
    BOOKINGS: 'class_res_bookings_v2',
    PASSWORDS: 'class_res_passwords_v2',
    HOLIDAYS: 'class_res_holidays_v2',
    CURRENT_USER: 'class_res_current_user_v2',
    INITIALIZED: 'class_res_initialized_v2'
  };

  // ==========================================
  // 2. 時間輔助函式 (Date & Time Utilities)
  // ==========================================

  /**
   * 取得系統當前時間（若有啟用測試模擬則使用模擬時間）
   */
  function getCurrentDateTime() {
    if (simulatedTimeOffset !== null) {
      return new Date(Date.now() + simulatedTimeOffset);
    }
    return new Date();
  }

  /**
   * 格式化 Date 為 YYYY-MM-DD
   */
  function formatDateKey(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * 判斷是否為預約開放日 (週二=2, 週四=4)
   */
  function isBookableDay(dateObj) {
    const day = dateObj.getDay();
    return day === 2 || day === 4;
  }

  /**
   * 取得某天的預約與簽到時段狀態
   * 回傳: 'OPEN' (自由預約) | 'PRACTICE_LIVE' (16:30~18:00 練習中/簽到中/預約鎖定) | 'ENDED' (已過期)
   */
  function getDatePracticeStatus(dateStr) {
    const now = getCurrentDateTime();
    const todayStr = formatDateKey(now);

    const [y, m, d] = dateStr.split('-').map(Number);
    const targetDate = new Date(y, m - 1, d);

    // 過去的日期
    if (dateStr < todayStr) {
      return 'ENDED';
    }

    // 未來的日期 (隨時可自由預約)
    if (dateStr > todayStr) {
      return 'OPEN';
    }

    // 今天 (Today)
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    if (currentMinutes < PRACTICE_START_MINUTES) {
      return 'OPEN'; // 16:30 前隨時可預約
    } else if (currentMinutes >= PRACTICE_START_MINUTES && currentMinutes <= PRACTICE_END_MINUTES) {
      return 'PRACTICE_LIVE'; // 16:30 ~ 18:00 練習開始，預約截止鎖定，簽到開放
    } else {
      return 'ENDED'; // 18:00 後練習已結束
    }
  }

  // ==========================================
  // 3. 資料持久化 (Data - Firebase + LocalStorage Dual Mode)
  // ==========================================

  /**
   * 管理員密碼 SHA-256 雜湊驗證（密碼不以明文存在程式碼）
   * Hash of 'Im_versh0908'
   */
  const ADMIN_PWD_HASH = '80da963e97483615b52967e8e43a9f10b6935a5031514eb656c84c7f866f149f';

  async function hashString(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function verifyAdminPassword(inputPwd) {
    const h = await hashString(inputPwd.trim());
    return h === ADMIN_PWD_HASH;
  }

  // ---- 本地快取（做為 Firebase 斷線時的備援 & 即時 cache）----
  let _cachedBookings = null;
  let _cachedHolidays = null; // { 'YYYY-MM-DD': { reason, createdAt }, ... }
  let _cachedPasswords = null;

  // ---- 讀取函式（優先使用記憶體快取）----

  function getStoredBookings() {
    if (_cachedBookings !== null) return _cachedBookings;
    try {
      const data = localStorage.getItem(STORAGE_KEYS.BOOKINGS);
      _cachedBookings = data ? JSON.parse(data) : {};
      return _cachedBookings;
    } catch (e) {
      console.error('Error reading bookings:', e);
      _cachedBookings = {};
      return {};
    }
  }

  /**
   * 寫入預約（同步更新快取 + localStorage + Firebase）
   */
  function saveStoredBookings(bookings) {
    _cachedBookings = bookings;
    localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify(bookings));
    // 寫入 Firebase（若已連線）
    if (window.CloudDB && window.CloudDB.isOnline()) {
      window.CloudDB.write(window.CloudDB.PATHS.BOOKINGS, bookings)
        .catch(e => console.error('[CloudDB] 預約寫入失敗:', e));
    }
  }

  function getStoredPasswords() {
    if (_cachedPasswords !== null) return _cachedPasswords;
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PASSWORDS);
      _cachedPasswords = data ? JSON.parse(data) : {};
      return _cachedPasswords;
    } catch (e) {
      _cachedPasswords = {};
      return {};
    }
  }

  function saveStoredPasswords(passwords) {
    _cachedPasswords = passwords;
    localStorage.setItem(STORAGE_KEYS.PASSWORDS, JSON.stringify(passwords));
    if (window.CloudDB && window.CloudDB.isOnline()) {
      window.CloudDB.write(window.CloudDB.PATHS.PASSWORDS, passwords)
        .catch(e => console.error('[CloudDB] 密碼寫入失敗:', e));
    }
  }

  function getCurrentUser() {
    const user = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
    return user ? parseInt(user, 10) : null;
  }

  function setCurrentUser(seatNum) {
    if (seatNum) {
      localStorage.setItem(STORAGE_KEYS.CURRENT_USER, seatNum);
    } else {
      localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
    }
    updateUserSessionUI();
    renderCalendar();
    renderTodayView();
    renderRosterView();
  }

  /**
   * 驗證座號密碼（預設密碼即為座號本身）
   */
  function verifyPassword(seatNum, inputPwd) {
    const passwords = getStoredPasswords();
    const correctPwd = passwords[seatNum] || String(seatNum);
    return String(inputPwd).trim() === String(correctPwd).trim();
  }

  /**
   * 更新座號密碼
   */
  function updatePassword(seatNum, newPwd) {
    const passwords = getStoredPasswords();
    passwords[seatNum] = String(newPwd).trim();
    saveStoredPasswords(passwords);
  }

  // ---- 不可預約日（含理由）管理 ----

  /**
   * 取得不可預約日物件
   * 格式：{ 'YYYY-MM-DD': { reason: '...', createdAt: '...' }, ... }
   */
  function getStoredHolidays() {
    if (_cachedHolidays !== null) return _cachedHolidays;
    try {
      const data = localStorage.getItem(STORAGE_KEYS.HOLIDAYS);
      if (data) {
        const parsed = JSON.parse(data);
        // 相容舊版格式（array of strings）
        if (Array.isArray(parsed)) {
          _cachedHolidays = {};
          parsed.forEach(d => { _cachedHolidays[d] = { reason: '停練', createdAt: '' }; });
        } else {
          _cachedHolidays = parsed;
        }
      } else {
        _cachedHolidays = {};
      }
      return _cachedHolidays;
    } catch (e) {
      _cachedHolidays = {};
      return {};
    }
  }

  function saveStoredHolidays(holidays) {
    _cachedHolidays = holidays;
    localStorage.setItem(STORAGE_KEYS.HOLIDAYS, JSON.stringify(holidays));
    if (window.CloudDB && window.CloudDB.isOnline()) {
      window.CloudDB.write(window.CloudDB.PATHS.HOLIDAYS, holidays)
        .catch(e => console.error('[CloudDB] 停練日寫入失敗:', e));
    }
  }

  function isHolidayDate(dateStr) {
    const holidays = getStoredHolidays();
    return !!holidays[dateStr];
  }

  function getHolidayReason(dateStr) {
    const holidays = getStoredHolidays();
    return holidays[dateStr] ? holidays[dateStr].reason : '';
  }

  /**
   * 設定或解除不可預約日
   * @param {string} dateStr - 'YYYY-MM-DD'
   * @param {boolean} isBlocked - true=設為停練, false=解除
   * @param {string} reason - 停練理由（僅 isBlocked=true 時使用）
   */
  function setHolidayStatus(dateStr, isBlocked, reason) {
    const holidays = getStoredHolidays();
    if (isBlocked) {
      holidays[dateStr] = {
        reason: reason || '停練',
        createdAt: new Date().toLocaleString('zh-TW')
      };
    } else {
      delete holidays[dateStr];
    }
    saveStoredHolidays(holidays);
  }

  /**
   * Firebase 即時監聽：當雲端資料有任何異動時，
   * 自動更新本地快取並重新渲染所有畫面
   */
  function setupFirebaseListeners() {
    if (!window.CloudDB || !window.CloudDB.isOnline()) return;

    // 監聽預約資料
    window.CloudDB.listen(window.CloudDB.PATHS.BOOKINGS, (data) => {
      _cachedBookings = data || {};
      localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify(_cachedBookings));
      renderCalendar();
      renderTodayView();
      renderRosterView();
      console.log('[CloudDB] 預約資料即時更新');
    });

    // 監聽停練日資料
    window.CloudDB.listen(window.CloudDB.PATHS.HOLIDAYS, (data) => {
      if (data && Array.isArray(data)) {
        // 相容舊格式
        _cachedHolidays = {};
        data.forEach(d => { _cachedHolidays[d] = { reason: '停練', createdAt: '' }; });
      } else {
        _cachedHolidays = data || {};
      }
      localStorage.setItem(STORAGE_KEYS.HOLIDAYS, JSON.stringify(_cachedHolidays));
      renderCalendar();
      renderTodayView();
      console.log('[CloudDB] 停練日資料即時更新');
    });

    // 監聽密碼資料
    window.CloudDB.listen(window.CloudDB.PATHS.PASSWORDS, (data) => {
      _cachedPasswords = data || {};
      localStorage.setItem(STORAGE_KEYS.PASSWORDS, JSON.stringify(_cachedPasswords));
      console.log('[CloudDB] 密碼資料即時更新');
    });
  }

  /**
   * 初始化 Firebase 雲端連線並同步現有本地資料
   */
  async function initCloudSync(configStr) {
    const savedCfg = configStr || localStorage.getItem('firebase_config_saved');
    const connected = window.CloudDB ? window.CloudDB.init(savedCfg) : false;

    if (connected) {
      // 從雲端載入最新資料（覆蓋本地）
      try {
        const [cloudBookings, cloudHolidays, cloudPasswords] = await Promise.all([
          window.CloudDB.read(window.CloudDB.PATHS.BOOKINGS),
          window.CloudDB.read(window.CloudDB.PATHS.HOLIDAYS),
          window.CloudDB.read(window.CloudDB.PATHS.PASSWORDS)
        ]);

        // 若需要清理示範資料且雲端尚未重置，則將雲端資料清空
        if (localStorage.getItem('class_res_cloud_cleaned_v3') !== 'true') {
          await window.CloudDB.write(window.CloudDB.PATHS.BOOKINGS, {});
          localStorage.setItem('class_res_cloud_cleaned_v3', 'true');
          _cachedBookings = {};
          localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify({}));
        } else if (cloudBookings) {
          _cachedBookings = cloudBookings;
          localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify(cloudBookings));
        } else {
          _cachedBookings = _cachedBookings || {};
        }

        if (cloudHolidays) {
          _cachedHolidays = cloudHolidays;
          localStorage.setItem(STORAGE_KEYS.HOLIDAYS, JSON.stringify(cloudHolidays));
        }

        if (cloudPasswords) {
          _cachedPasswords = cloudPasswords;
          localStorage.setItem(STORAGE_KEYS.PASSWORDS, JSON.stringify(cloudPasswords));
        }

        // 啟動即時雙向監聽（持續自動同步，無需詢問）
        setupFirebaseListeners();

        renderCalendar();
        renderTodayView();
        renderRosterView();
      } catch (e) {
        console.error('[CloudDB] 初始載入失敗:', e);
      }
    }
  }

  /**
   * 初始化預約資料與快取清理
   * 徹底移除自動預填假示範資料的邏輯，確保新舊快取完全重置為乾淨空白的名冊
   */
  function initDemoDataIfNeeded() {
    // 執行一次性清理既有瀏覽器快取中的幽靈假預約
    if (localStorage.getItem('class_res_demo_cleaned_v3') !== 'true') {
      localStorage.removeItem(STORAGE_KEYS.BOOKINGS);
      localStorage.removeItem(STORAGE_KEYS.INITIALIZED);
      localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify({}));
      localStorage.setItem('class_res_demo_cleaned_v3', 'true');
      _cachedBookings = {};
      if (window.CloudDB && window.CloudDB.isOnline()) {
        window.CloudDB.write(window.CloudDB.PATHS.BOOKINGS, {}).catch(e => console.error(e));
      }
      console.log('[System] 已成功清除舊示範預約資料，恢復完全空白！');
    }
  }

  /**
   * 清空並重置全班所有預約與簽到紀錄
   */
  function resetAllBookings() {
    _cachedBookings = {};
    localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify({}));
    localStorage.removeItem(STORAGE_KEYS.INITIALIZED);
    if (window.CloudDB && window.CloudDB.isOnline()) {
      window.CloudDB.write(window.CloudDB.PATHS.BOOKINGS, {})
        .catch(e => console.error('[CloudDB] 重置預約失敗:', e));
    }
    renderCalendar();
    renderTodayView();
    renderRosterView();
  }

  // ==========================================
  // 4. 預約與簽到核心操作 (Booking & Check-in API)
  // ==========================================

  /**
   * 新增預約
   */
  function addBooking(dateStr, seatNum) {
    if (isHolidayDate(dateStr)) {
      return { success: false, msg: '🏖️ 本日已由管理員設定為放假停練日，禁止登記預約！' };
    }

    const status = getDatePracticeStatus(dateStr);
    if (status === 'PRACTICE_LIVE') {
      return { success: false, msg: '練習已開始 (16:30~18:00)，當日預約已截止鎖定！' };
    }
    if (status === 'ENDED') {
      return { success: false, msg: '該日練習時段已結束，無法再進行預約！' };
    }

    const bookings = getStoredBookings();
    if (!bookings[dateStr]) {
      bookings[dateStr] = [];
    }

    // 檢查是否已預約
    if (bookings[dateStr].some(b => b.seat === seatNum)) {
      return { success: false, msg: `座號 ${seatNum} 號已經預約此時段囉！` };
    }

    bookings[dateStr].push({
      seat: seatNum,
      checkedIn: false,
      bookedAt: getCurrentDateTime().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
    });

    // 排序座號
    bookings[dateStr].sort((a, b) => a.seat - b.seat);
    saveStoredBookings(bookings);
    return { success: true, msg: `座號 ${seatNum} 號預約成功！` };
  }

  /**
   * 取消預約 (只有本人能取消，且練習開始後鎖定禁止取消)
   */
  function cancelBooking(dateStr, seatNum) {
    const status = getDatePracticeStatus(dateStr);
    if (status === 'PRACTICE_LIVE') {
      return { success: false, msg: '練習時間已開始 (16:30~18:00)，無法取消預約！' };
    }
    if (status === 'ENDED') {
      return { success: false, msg: '已結束的時段無法變更！' };
    }

    const bookings = getStoredBookings();
    if (!bookings[dateStr]) {
      return { success: false, msg: '找不到該日的預約紀錄' };
    }

    const initialLen = bookings[dateStr].length;
    bookings[dateStr] = bookings[dateStr].filter(b => b.seat !== seatNum);

    if (bookings[dateStr].length === initialLen) {
      return { success: false, msg: '您尚未預約此時段' };
    }

    saveStoredBookings(bookings);
    return { success: true, msg: `已取消座號 ${seatNum} 號的預約` };
  }

  /**
   * 執行簽到打卡
   * 嚴格規則：僅限在練習日當天 16:30 (4:30 PM) ~ 18:00 練習時段內才能簽到！
   */
  function performCheckIn(dateStr, seatNum) {
    const now = getCurrentDateTime();
    const todayStr = formatDateKey(now);

    // 1. 僅能在當天簽到
    if (dateStr !== todayStr) {
      return { success: false, msg: '只能在練習當天進行簽到打卡喔！' };
    }

    // 2. 當天時間檢查：必須到達 16:30 才能簽到
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    if (currentMinutes < PRACTICE_START_MINUTES) {
      return {
        success: false,
        msg: '⏳ 尚未到達簽到時間！簽到限定於當天下午 16:30 (4:30 PM) 練習開始後才能打卡。'
      };
    }

    // 3. 練習時段結束檢查
    if (currentMinutes > PRACTICE_END_MINUTES) {
      return {
        success: false,
        msg: '今日練習已於 18:00 結束，簽到時段已截止！'
      };
    }

    const bookings = getStoredBookings();
    if (!bookings[dateStr]) {
      return { success: false, msg: '本日尚無預約紀錄，無法簽到' };
    }

    const record = bookings[dateStr].find(b => b.seat === seatNum);
    if (!record) {
      return { success: false, msg: `座號 ${seatNum} 號尚未預約本日練習，請先預約才能簽到！` };
    }

    if (record.checkedIn) {
      return { success: false, msg: `座號 ${seatNum} 號已經在 ${record.checkInTime} 簽到過了！` };
    }

    // 登記簽到時間
    const timeStr = now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    record.checkedIn = true;
    record.checkInTime = timeStr;

    saveStoredBookings(bookings);
    return { success: true, msg: `座號 ${seatNum} 號簽到成功！時間：${timeStr}` };
  }

  // ==========================================
  // 5. UI 渲染：日曆核心 (Calendar Engine)
  // ==========================================

  function renderCalendar() {
    const daysGrid = document.getElementById('daysGrid');
    const monthYearDisplay = document.getElementById('monthYearDisplay');
    if (!daysGrid || !monthYearDisplay) return;

    daysGrid.innerHTML = '';

    const now = getCurrentDateTime();
    const todayStr = formatDateKey(now);
    const currentUser = getCurrentUser();
    const bookings = getStoredBookings();

    // 更新標題：例如 "2026 年 9 月 (民國 115 年)"
    const rocYear = viewYear - 1911;
    monthYearDisplay.textContent = `${viewYear} 年 ${viewMonth + 1} 月 (民國 ${rocYear} 年)`;

    // 計算當月第一天與天數
    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    const totalDays = lastDay.getDate();
    const startingDayIndex = firstDay.getDay(); // 0 = 週日, 1 = 週一, 2 = 週二...

    // 取得上個月的天數以填補開頭
    const prevMonthLastDay = new Date(viewYear, viewMonth, 0).getDate();

    // 1. 上個月的灰色格子 (Prefix - 支援點擊快速切換上月)
    for (let i = startingDayIndex - 1; i >= 0; i--) {
      const prevDate = prevMonthLastDay - i;
      const prevDateObj = new Date(viewYear, viewMonth - 1, prevDate);
      const cell = document.createElement('div');
      cell.className = 'day-cell other-month clickable-other-month';
      cell.title = `點擊切換至 ${prevDateObj.getMonth() + 1} 月`;
      cell.innerHTML = `
        <div class="cell-top">
          <span class="date-number">${prevDate}</span>
        </div>
        <div class="cell-content">
          <span style="font-size:0.7rem; color:var(--text-dim); text-align:center;">${prevDateObj.getMonth() + 1} 月</span>
        </div>
      `;
      cell.addEventListener('click', () => {
        viewMonth--;
        if (viewMonth < 0) {
          viewMonth = 11;
          viewYear--;
        }
        renderCalendar();
      });
      daysGrid.appendChild(cell);
    }

    // 2. 當月所有日期 (Current Month)
    for (let d = 1; d <= totalDays; d++) {
      const currentDateObj = new Date(viewYear, viewMonth, d);
      const dateStr = formatDateKey(currentDateObj);
      const dayOfWeek = currentDateObj.getDay();
      const isTueThu = (dayOfWeek === 2 || dayOfWeek === 4);
      const isToday = (dateStr === todayStr);
      const isBlocked = isHolidayDate(dateStr);
      const holidayReason = getHolidayReason(dateStr);

      const cell = document.createElement('div');
      cell.className = 'day-cell';

      // 標註「今日」
      if (isToday) {
        cell.classList.add('is-today');
      }

      // 當日預約名單
      const dayBookings = bookings[dateStr] || [];
      const bookedCount = dayBookings.length;
      const hasMyBooking = currentUser && dayBookings.some(b => b.seat === currentUser);
      const checkedInCount = dayBookings.filter(b => b.checkedIn).length;

      if (isBlocked) {
        // 設定為不可預約（放假停練）
        cell.classList.add('blocked-date-cell');
        cell.innerHTML = `
          ${isToday ? '<span class="today-banner-pill">今日</span>' : ''}
          <div class="cell-top">
            <span class="date-number">${d}</span>
            <span class="cell-badge badge-holiday" style="background:rgba(239,68,68,0.2);color:#fca5a5;border:1px solid rgba(239,68,68,0.4);">🚫 停練</span>
          </div>
          <div class="cell-content">
            <span class="status-chip chip-holiday" style="background:rgba(239,68,68,0.15);color:#f87171;font-size:0.75rem;">🚫 停練 (${holidayReason || '放假'})</span>
            <div style="font-size:0.74rem; color:#fca5a5; margin-top:4px; text-align:center;">${holidayReason || '本日停止練習'}</div>
          </div>
          <div class="cell-footer-hint">不開放預約</div>
        `;
        cell.addEventListener('click', () => {
          showToast(`🏖️ ${dateStr} 已設定為停練日（理由：${holidayReason || '放假'}），不開放預約！`, 'warning');
        });

      } else if (isTueThu) {
        // 週二或週四：正常開放預約
        cell.classList.add('bookable');
        const practiceStatus = getDatePracticeStatus(dateStr);

        let statusChipHtml = '';
        if (practiceStatus === 'PRACTICE_LIVE') {
          statusChipHtml = `<span class="status-chip chip-practice-live">⚡ 練習中·簽到中</span>`;
        } else if (practiceStatus === 'ENDED') {
          statusChipHtml = `<span class="status-chip chip-ended">已結束 (${checkedInCount}/${bookedCount}到)</span>`;
        } else {
          statusChipHtml = `<span class="status-chip" style="background:rgba(14,165,233,0.15); color:#38bdf8;">開放預約</span>`;
        }

        cell.innerHTML = `
          ${isToday ? '<span class="today-banner-pill">今日</span>' : ''}
          <div class="cell-top">
            <span class="date-number">${d}</span>
            <span class="cell-badge badge-tue-thu">${dayOfWeek === 2 ? '週二' : '週四'}</span>
          </div>
          <div class="cell-content">
            ${statusChipHtml}
            <div class="booking-indicator-pill ${hasMyBooking ? 'has-my-booking' : ''}">
              <span>${hasMyBooking ? '★ 您已登記' : '已預約'}</span>
              <strong>${bookedCount} 人</strong>
            </div>
          </div>
          <div class="cell-footer-hint">16:30~18:00</div>
        `;

        // 點擊事件：開啟預約與簽到詳情彈窗
        cell.addEventListener('click', () => {
          openBookingModal(dateStr);
        });

      } else {
        // 非週二、週四：不可預約
        cell.classList.add('non-bookable');
        cell.innerHTML = `
          ${isToday ? '<span class="today-banner-pill">今日</span>' : ''}
          <div class="cell-top">
            <span class="date-number">${d}</span>
          </div>
          <div class="cell-content">
            <span style="font-size:0.72rem; color:var(--text-dim); text-align:center; padding:10px 0;">非練習日</span>
          </div>
        `;

        cell.addEventListener('click', () => {
          showToast('⚠️ 僅每週二與每週四開放練習預約與簽到喔！', 'info');
        });
      }

      daysGrid.appendChild(cell);
    }

    // 3. 下個月的補充格子，湊齊 7 的倍數 (Suffix - 支援點擊快速切換至次月，如 10 月)
    const currentCells = startingDayIndex + totalDays;
    const remainingCells = (7 - (currentCells % 7)) % 7;
    for (let j = 1; j <= remainingCells; j++) {
      const nextMonthObj = new Date(viewYear, viewMonth + 1, j);
      const nextDateKey = formatDateKey(nextMonthObj);
      const isNextTueThu = (nextMonthObj.getDay() === 2 || nextMonthObj.getDay() === 4);
      const nextMonthNum = nextMonthObj.getMonth() + 1;

      const cell = document.createElement('div');
      cell.className = 'day-cell other-month clickable-other-month';
      cell.title = `點擊切換至 ${nextMonthNum} 月${isNextTueThu ? '並查看預約' : ''}`;
      cell.innerHTML = `
        <div class="cell-top">
          <span class="date-number">${j}</span>
          ${isNextTueThu ? `<span class="cell-badge" style="background:rgba(14,165,233,0.15);color:#38bdf8;font-size:0.68rem;">週${nextMonthObj.getDay() === 2 ? '二' : '四'}</span>` : ''}
        </div>
        <div class="cell-content">
          <span style="font-size:0.7rem; color:var(--text-dim); text-align:center;">進入 ${nextMonthNum} 月</span>
        </div>
      `;

      cell.addEventListener('click', () => {
        viewMonth++;
        if (viewMonth > 11) {
          viewMonth = 0;
          viewYear++;
        }
        renderCalendar();
        if (isNextTueThu) {
          openBookingModal(nextDateKey);
        }
      });
      daysGrid.appendChild(cell);
    }

    // 更新「回到今天」按鈕提示狀態
    const btnJumpToday = document.getElementById('btnJumpToday');
    if (btnJumpToday) {
      const isViewingCurrentMonth = (viewYear === now.getFullYear() && viewMonth === now.getMonth());
      if (!isViewingCurrentMonth) {
        btnJumpToday.classList.add('highlight-return-today');
        btnJumpToday.title = `目前正在檢視 ${viewMonth + 1} 月，點此回當前月份`;
      } else {
        btnJumpToday.classList.remove('highlight-return-today');
        btnJumpToday.title = '點擊回到今天所屬月份';
      }
    }
  }

  // ==========================================
  // 6. 預約與簽到彈窗 (Booking & Check-in Modal)
  // ==========================================

  function openBookingModal(dateStr) {
    selectedDateStr = dateStr;
    const modalBackdrop = document.getElementById('bookingModalBackdrop');
    const modalDateBadge = document.getElementById('modalDateBadge');
    const modalTimeAlert = document.getElementById('modalTimeAlert');
    const userBookingStateCard = document.getElementById('userBookingStateCard');
    const modalBookedChips = document.getElementById('modalBookedChips');
    const modalBookedCount = document.getElementById('modalBookedCount');
    const modalFooterActions = document.getElementById('modalFooterActions');

    const [y, m, d] = dateStr.split('-').map(Number);
    const targetDate = new Date(y, m - 1, d);
    const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const weekdayStr = dayNames[targetDate.getDay()];

    modalDateBadge.textContent = `${dateStr} (星期${weekdayStr})`;

    const practiceStatus = getDatePracticeStatus(dateStr);
    const now = getCurrentDateTime();
    const isToday = (dateStr === formatDateKey(now));
    const currentUser = getCurrentUser();
    const bookings = getStoredBookings();
    const dayBookings = bookings[dateStr] || [];
    const myRecord = currentUser ? dayBookings.find(b => b.seat === currentUser) : null;

    // 1. 時段與規則提示 Alert
    modalTimeAlert.className = 'modal-time-alert';
    if (practiceStatus === 'PRACTICE_LIVE') {
      modalTimeAlert.classList.add('alert-practice-live');
      modalTimeAlert.innerHTML = `
        <div>🔥</div>
        <div>
          <strong>練習正在進行中 (16:30 ~ 18:00)！</strong><br>
          目前已進入現場簽到時段，當日預約已截止鎖定，請已預約同學立即點擊「簽到」完成打卡。
        </div>
      `;
    } else if (practiceStatus === 'ENDED') {
      modalTimeAlert.classList.add('alert-ended');
      modalTimeAlert.innerHTML = `
        <div>⌛</div>
        <div><strong>本次練習時段已結束。</strong> 預約與簽到紀錄已封存。</div>
      `;
    } else if (isToday) {
      modalTimeAlert.classList.add('alert-open');
      modalTimeAlert.innerHTML = `
        <div>⚡</div>
        <div>
          <strong>今日即將於 16:30 開始練習！</strong><br>
          目前仍可自由預約或變更；注意一到 16:30 預約即刻截止鎖定並轉為簽到模式。
        </div>
      `;
    } else {
      modalTimeAlert.classList.add('alert-open');
      modalTimeAlert.innerHTML = `
        <div>📅</div>
        <div>
          <strong>提前預約開放中！</strong><br>
          每週二、四 16:30~18:00 練習時段，隨時皆可提早登記您的座號。
        </div>
      `;
    }

    // 2. 當前登入使用者的狀態 Card
    if (!currentUser) {
      userBookingStateCard.innerHTML = `
        <div class="state-header">您的預約狀態</div>
        <div class="state-content">
          <span style="color:var(--text-muted); font-size:0.9rem;">⚠️ 尚未登入座號，請先登入即可進行登記或簽到</span>
          <button class="primary-btn" id="btnModalLoginPrompt" style="padding:6px 14px; font-size:0.85rem;">🔑 點此登入 (1-31號)</button>
        </div>
      `;
      document.getElementById('btnModalLoginPrompt')?.addEventListener('click', () => {
        closeBookingModal();
        openLoginModal();
      });
    } else {
      let stateBadge = '';
      if (myRecord) {
        if (myRecord.checkedIn) {
          stateBadge = `<span class="status-badge-lg badge-is-checked-in">✅ 已簽到 (${myRecord.checkInTime})</span>`;
        } else {
          stateBadge = `<span class="status-badge-lg badge-is-booked">📋 已預約 (待簽到)</span>`;
        }
      } else {
        stateBadge = `<span class="status-badge-lg badge-not-booked">⚪ 尚未登記預約</span>`;
      }

      userBookingStateCard.innerHTML = `
        <div class="state-header">座號 <strong>${String(currentUser).padStart(2, '0')} 號</strong> 的狀態：</div>
        <div class="state-content">
          ${stateBadge}
          <span style="font-size:0.8rem; color:var(--text-muted);">${myRecord ? `登記時間：${myRecord.bookedAt || '已預約'}` : '名額充足，歡迎登記'}</span>
        </div>
      `;
    }

    // 3. 已預約學生名單 Chips
    modalBookedCount.textContent = dayBookings.length;
    modalBookedChips.innerHTML = '';
    if (dayBookings.length === 0) {
      modalBookedChips.innerHTML = `<span class="no-bookings-hint">目前尚無同學登記預約此時段</span>`;
    } else {
      dayBookings.forEach(b => {
        const chip = document.createElement('div');
        const isMe = (currentUser === b.seat);
        chip.className = `student-chip ${isMe ? 'is-me' : ''}`;
        chip.innerHTML = `
          <span class="chip-status-dot ${b.checkedIn ? 'checked-in' : 'pending'}"></span>
          <span><strong>${String(b.seat).padStart(2, '0')} 號</strong></span>
          <small style="color:${b.checkedIn ? '#34d399' : 'var(--text-dim)'}; font-size:0.75rem;">
            ${b.checkedIn ? `(${b.checkInTime}已到)` : '(已預約)'}
          </small>
        `;
        modalBookedChips.appendChild(chip);
      });
    }

    // 4. 操作按鈕 (Footer Actions)
    modalFooterActions.innerHTML = '';

    if (!currentUser) {
      const loginBtn = document.createElement('button');
      loginBtn.className = 'primary-btn';
      loginBtn.textContent = '🔑 請先登入座號以預約/簽到';
      loginBtn.onclick = () => {
        closeBookingModal();
        openLoginModal();
      };
      modalFooterActions.appendChild(loginBtn);
    } else {
      // 若已預約
      if (myRecord) {
        // 簽到按鈕 (僅在當日練習時段 16:30 ~ 18:00 開放)
        if (isToday && !myRecord.checkedIn) {
          if (practiceStatus === 'PRACTICE_LIVE') {
            const checkInBtn = document.createElement('button');
            checkInBtn.className = 'success-btn';
            checkInBtn.innerHTML = '⚡ 立即簽到打卡';
            checkInBtn.onclick = () => {
              const res = performCheckIn(dateStr, currentUser);
              if (res.success) {
                showToast(res.msg, 'success');
                openBookingModal(dateStr);
                renderCalendar();
                renderTodayView();
                renderRosterView();
              } else {
                showToast(res.msg, 'warning');
              }
            };
            modalFooterActions.appendChild(checkInBtn);
          } else if (practiceStatus === 'OPEN') {
            const waitCheckInBtn = document.createElement('button');
            waitCheckInBtn.className = 'secondary-btn';
            waitCheckInBtn.innerHTML = '⏳ 16:30 開放簽到';
            waitCheckInBtn.title = '練習將於 16:30 開始，屆時將開放簽到打卡！';
            waitCheckInBtn.onclick = () => {
              showToast('⏳ 尚未到達簽到時間！簽到於當天下午 16:30 (4:30 PM) 練習開始後開放打卡。', 'warning');
            };
            modalFooterActions.appendChild(waitCheckInBtn);
          }
        }

        // 取消預約按鈕 (16:30 鎖定後禁用)
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'danger-btn';
        cancelBtn.textContent = '取消我的預約';

        if (practiceStatus === 'PRACTICE_LIVE') {
          cancelBtn.disabled = true;
          cancelBtn.title = '練習已開始 (16:30~18:00)，預約已鎖定無法取消！';
        } else if (practiceStatus === 'ENDED') {
          cancelBtn.disabled = true;
          cancelBtn.title = '時段已結束';
        } else {
          cancelBtn.onclick = () => {
            if (confirm(`確定要取消座號 ${currentUser} 號在 ${dateStr} 的預約嗎？`)) {
              const res = cancelBooking(dateStr, currentUser);
              if (res.success) {
                showToast(res.msg, 'info');
                openBookingModal(dateStr);
                renderCalendar();
                renderTodayView();
                renderRosterView();
              } else {
                showToast(res.msg, 'danger');
              }
            }
          };
        }
        modalFooterActions.appendChild(cancelBtn);

      } else {
        // 尚未預約：我要預約按鈕
        const bookBtn = document.createElement('button');
        bookBtn.className = 'primary-btn';
        bookBtn.innerHTML = '✍️ 我要登記預約 (16:30 - 18:00)';

        if (practiceStatus === 'PRACTICE_LIVE') {
          bookBtn.disabled = true;
          bookBtn.innerHTML = '🔒 練習已開始 (16:30~18:00 預約已截止)';
        } else if (practiceStatus === 'ENDED') {
          bookBtn.disabled = true;
          bookBtn.innerHTML = '⌛ 本次練習已結束';
        } else {
          bookBtn.onclick = () => {
            const res = addBooking(dateStr, currentUser);
            if (res.success) {
              showToast(res.msg, 'success');
              openBookingModal(dateStr);
              renderCalendar();
              renderTodayView();
              renderRosterView();
            } else {
              showToast(res.msg, 'warning');
            }
          };
        }
        modalFooterActions.appendChild(bookBtn);
      }
    }

    modalBackdrop.classList.add('open');
  }

  function closeBookingModal() {
    const modalBackdrop = document.getElementById('bookingModalBackdrop');
    if (modalBackdrop) modalBackdrop.classList.remove('open');
  }

  // ==========================================
  // 7. 今日快速簽到專區 (Today Panel View)
  // ==========================================

  function renderTodayView() {
    const now = getCurrentDateTime();
    const todayStr = formatDateKey(now);
    const dayOfWeek = now.getDay();
    const isTueThu = (dayOfWeek === 2 || dayOfWeek === 4);
    const practiceStatus = isTueThu ? getDatePracticeStatus(todayStr) : 'NOT_PRACTICE_DAY';

    const heroCard = document.getElementById('todayHeroCard');
    const todaySlotsSection = document.getElementById('todaySlotsSection');
    const todayTotalBooked = document.getElementById('todayTotalBooked');
    const todayCheckedInCount = document.getElementById('todayCheckedInCount');
    const todayPendingCheckInCount = document.getElementById('todayPendingCheckInCount');

    if (!heroCard || !todaySlotsSection) return;

    const bookings = getStoredBookings();
    const todayBookings = bookings[todayStr] || [];
    const bookedCount = todayBookings.length;
    const checkedCount = todayBookings.filter(b => b.checkedIn).length;
    const pendingCount = bookedCount - checkedCount;

    todayTotalBooked.textContent = bookedCount;
    todayCheckedInCount.textContent = checkedCount;
    todayPendingCheckInCount.textContent = pendingCount;

    const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const weekdayStr = dayNames[dayOfWeek];

    // Hero Card 狀態更新
    if (!isTueThu) {
      heroCard.innerHTML = `
        <div class="today-hero-info">
          <h2>今日：${todayStr} (星期${weekdayStr})</h2>
          <p>⚠️ 今天不是每週二或週四，今日無安排固定練習時段。您可以透過「月曆檢視」預約未來的練習日！</p>
        </div>
        <button class="primary-btn" id="btnGoToCalendar">切換至日曆預約 📅</button>
      `;
      document.getElementById('btnGoToCalendar')?.addEventListener('click', () => {
        switchTab('calendar');
      });

      todaySlotsSection.innerHTML = `
        <div style="text-align:center; padding:30px; color:var(--text-muted);">
          <p style="font-size:1.1rem; margin-bottom:8px;">🏖️ 今日非練習預約日</p>
          <small>請點擊上方「月曆預約檢視」查看下次開放的每週二、四練習時段。</small>
        </div>
      `;
      return;
    }

    // 今天是週二或週四！
    let statusText = '';
    let statusPillClass = '';
    if (practiceStatus === 'PRACTICE_LIVE') {
      statusText = '🔥 練習進行中 (16:30~18:00) - 簽到開放中，預約已截止鎖定';
      statusPillClass = 'status-live';
    } else if (practiceStatus === 'OPEN') {
      statusText = '☀️ 練習前時段 (16:30截止預約) - 目前開放隨時預約';
      statusPillClass = 'status-waiting';
    } else {
      statusText = '🌙 今日練習已結束 (18:00 後)';
      statusPillClass = 'status-locked';
    }

    heroCard.innerHTML = `
      <div class="today-hero-info">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
          <span class="practice-status-pill ${statusPillClass}">${statusText}</span>
        </div>
        <h2>今日練習日：${todayStr} (星期${weekdayStr})</h2>
        <p>練習時間：16:30 ~ 18:00 (下午 4:30 ~ 6:00)。請登入座號並於現場完成簽到打卡。</p>
      </div>
      <div>
        <button class="primary-btn" id="btnOpenTodayModal">開啟本日詳情與簽到 ⚡</button>
      </div>
    `;

    document.getElementById('btnOpenTodayModal')?.addEventListener('click', () => {
      openBookingModal(todayStr);
    });

    // Today slots & quick checkin list
    const currentUser = getCurrentUser();
    let myRecord = currentUser ? todayBookings.find(b => b.seat === currentUser) : null;

    let mySectionHtml = '';
    if (currentUser) {
      mySectionHtml = `
        <div style="background:rgba(99,102,241,0.12); border:1px solid rgba(99,102,241,0.3); border-radius:12px; padding:16px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div>
            <span style="font-size:0.85rem; color:#cbd5e1;">目前登入：<strong>座號 ${String(currentUser).padStart(2, '0')} 號</strong></span>
            <div style="margin-top:4px; font-weight:700; font-size:1.1rem; color:#fff;">
              ${myRecord ? (myRecord.checkedIn ? `✅ 您已於 ${myRecord.checkInTime} 完成簽到` : (practiceStatus === 'PRACTICE_LIVE' ? '🔥 練習進行中！請點擊右方按鈕簽到' : (practiceStatus === 'OPEN' ? '📋 您已登記預約 (簽到於 16:30 開放)' : '⌛ 今日練習已結束 (未簽到)'))) : '⚪ 您今日尚未登記預約'}
            </div>
          </div>
          <div>
            ${myRecord && !myRecord.checkedIn ? (
          practiceStatus === 'PRACTICE_LIVE' ? `
                <button class="success-btn" id="btnQuickCheckInToday">⚡ 立即簽到打卡</button>
              ` : (practiceStatus === 'OPEN' ? `
                <button class="secondary-btn" id="btnWaitQuickCheckInToday">⏳ 16:30 開放簽到</button>
              ` : `
                <span style="font-size:0.85rem; color:#94a3b8;">練習已結束</span>
              `)
        ) : (myRecord && myRecord.checkedIn ? `
              <button class="secondary-btn" disabled style="opacity:0.8;">簽到已完成 ✓</button>
            ` : (practiceStatus === 'OPEN' ? `
              <button class="primary-btn" id="btnQuickBookToday">✍️ 登記今日預約</button>
            ` : `
              <span style="font-size:0.85rem; color:#f59e0b;">已達 16:30，今日預約已截止</span>
            `))}
          </div>
        </div>
      `;
    }

    let studentsListHtml = todayBookings.map(b => `
      <div class="student-chip ${currentUser === b.seat ? 'is-me' : ''}" style="padding:8px 14px; font-size:0.9rem;">
        <span class="chip-status-dot ${b.checkedIn ? 'checked-in' : 'pending'}"></span>
        <span>座號 <strong>${String(b.seat).padStart(2, '0')} 號</strong></span>
        <span style="font-size:0.75rem; color:${b.checkedIn ? '#34d399' : '#f59e0b'}; margin-left:4px;">
          ${b.checkedIn ? `✓ 已於 ${b.checkInTime} 簽到` : '待簽到'}
        </span>
      </div>
    `).join('');

    todaySlotsSection.innerHTML = `
      ${mySectionHtml}
      <h3 style="font-size:1.1rem; color:#fff; margin-bottom:14px;">📋 今日預約全體名冊 (${bookedCount} 人)</h3>
      <div style="display:flex; flex-wrap:wrap; gap:10px;">
        ${studentsListHtml || '<div style="color:var(--text-dim); font-style:italic;">今日尚無同學登記預約</div>'}
      </div>
    `;

    document.getElementById('btnQuickCheckInToday')?.addEventListener('click', () => {
      const res = performCheckIn(todayStr, currentUser);
      showToast(res.msg, res.success ? 'success' : 'warning');
      renderTodayView();
      renderCalendar();
      renderRosterView();
    });

    document.getElementById('btnWaitQuickCheckInToday')?.addEventListener('click', () => {
      showToast('⏳ 尚未到達簽到時間！簽到限定於當天下午 16:30 (4:30 PM) 練習開始後開放打卡。', 'warning');
    });

    document.getElementById('btnQuickBookToday')?.addEventListener('click', () => {
      const res = addBooking(todayStr, currentUser);
      showToast(res.msg, res.success ? 'success' : 'warning');
      renderTodayView();
      renderCalendar();
      renderRosterView();
    });
  }

  // ==========================================
  // 8. 全班名冊總覽 (1 - 31 號)
  // ==========================================

  function renderRosterView() {
    const seatGrid = document.getElementById('seatRosterGrid');
    if (!seatGrid) return;
    seatGrid.innerHTML = '';

    const bookings = getStoredBookings();
    const currentUser = getCurrentUser();

    // 統計每個座號的預約次數與簽到次數
    for (let seat = 1; seat <= TOTAL_SEATS; seat++) {
      let reservedTotal = 0;
      let checkedInTotal = 0;

      Object.keys(bookings).forEach(dateStr => {
        const list = bookings[dateStr] || [];
        const record = list.find(b => b.seat === seat);
        if (record) {
          reservedTotal++;
          if (record.checkedIn) checkedInTotal++;
        }
      });

      const rate = reservedTotal > 0 ? Math.round((checkedInTotal / reservedTotal) * 100) : 0;

      const card = document.createElement('div');
      card.className = `seat-card ${currentUser === seat ? 'is-current-user' : ''}`;
      card.innerHTML = `
        <div class="seat-card-header">
          <span class="seat-card-number">${String(seat).padStart(2, '0')} 號</span>
          ${currentUser === seat ? '<span style="font-size:0.68rem; color:#38bdf8; font-weight:700;">★ 您</span>' : ''}
        </div>
        <div class="seat-card-stats">
          <span>預約：<strong>${reservedTotal}</strong> 次</span>
          <span>簽到：<strong style="color:#34d399;">${checkedInTotal}</strong> 次</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
          <span style="font-size:0.7rem; color:var(--text-dim);">出席率</span>
          <span class="seat-card-rate" style="color:${rate >= 80 ? '#34d399' : (rate >= 50 ? '#fbbf24' : '#94a3b8')};">
            ${reservedTotal > 0 ? `${rate}%` : '無紀錄'}
          </span>
        </div>
      `;

      card.onclick = () => {
        showSeatHistoryModal(seat, reservedTotal, checkedInTotal, rate);
      };

      seatGrid.appendChild(card);
    }
  }

  function showSeatHistoryModal(seat, reservedTotal, checkedInTotal, rate) {
    const bookings = getStoredBookings();
    let historyList = [];

    Object.keys(bookings).sort().reverse().forEach(dateStr => {
      const record = bookings[dateStr].find(b => b.seat === seat);
      if (record) {
        historyList.push({
          date: dateStr,
          checkedIn: record.checkedIn,
          time: record.checkInTime || '未簽到'
        });
      }
    });

    let historyHtml = historyList.length > 0 ? historyList.map(h => `
      <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.06); font-size:0.85rem;">
        <span>📅 ${h.date}</span>
        <span style="color:${h.checkedIn ? '#34d399' : '#f59e0b'};">
          ${h.checkedIn ? `已簽到 (${h.time})` : '未出席 / 待簽到'}
        </span>
      </div>
    `).join('') : '<p style="color:var(--text-dim); text-align:center; padding:12px;">該座號尚無練習預約紀錄</p>';

    alertModalCustom(`座號 ${String(seat).padStart(2, '0')} 號 履歷詳情`, `
      <div style="display:flex; justify-content:space-around; background:rgba(15,23,42,0.6); padding:12px; border-radius:10px; margin-bottom:14px; text-align:center;">
        <div><div style="font-size:1.3rem; font-weight:700; color:#fff;">${reservedTotal}</div><small style="color:var(--text-muted);">總預約</small></div>
        <div><div style="font-size:1.3rem; font-weight:700; color:#34d399;">${checkedInTotal}</div><small style="color:var(--text-muted);">已簽到</small></div>
        <div><div style="font-size:1.3rem; font-weight:700; color:#38bdf8;">${reservedTotal > 0 ? `${rate}%` : '-'}</div><small style="color:var(--text-muted);">出席率</small></div>
      </div>
      <h4 style="font-size:0.9rem; color:#cbd5e1; margin-bottom:8px;">歷史預約與打卡紀錄：</h4>
      <div style="max-height:220px; overflow-y:auto;">
        ${historyHtml}
      </div>
    `);
  }

  function alertModalCustom(title, contentHtml) {
    const helpModal = document.getElementById('helpModal');
    const helpModalBackdrop = document.getElementById('helpModalBackdrop');
    if (!helpModal || !helpModalBackdrop) return;

    helpModal.querySelector('.modal-title').textContent = title;
    helpModal.querySelector('.modal-date-badge').textContent = '個人紀錄查詢';
    helpModal.querySelector('.modal-body').innerHTML = contentHtml;
    helpModalBackdrop.classList.add('open');
  }

  // ==========================================
  // 9. 登入與身分認證 (Seat Login: 1 - 31)
  // ==========================================

  function populateLoginSeatOptions() {
    const select = document.getElementById('loginSeatSelect');
    if (!select) return;
    select.innerHTML = '<option value="" disabled selected>-- 請選擇您的座號 (1 ~ 31 號) --</option>';
    for (let i = 1; i <= TOTAL_SEATS; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `座號 ${String(i).padStart(2, '0')} 號`;
      select.appendChild(opt);
    }
  }

  function openLoginModal() {
    const modalBackdrop = document.getElementById('loginModalBackdrop');
    const pwdInput = document.getElementById('loginPasswordInput');
    const errDiv = document.getElementById('loginErrorMsg');
    if (pwdInput) pwdInput.value = '';
    if (errDiv) errDiv.textContent = '';
    modalBackdrop.classList.add('open');
  }

  function closeLoginModal() {
    const modalBackdrop = document.getElementById('loginModalBackdrop');
    modalBackdrop.classList.remove('open');
  }

  function updateUserSessionUI() {
    const container = document.getElementById('userInfoArea');
    if (!container) return;

    const currentUser = getCurrentUser();
    if (currentUser) {
      container.innerHTML = `
        <div class="user-logged-in-box">
          <div class="user-seat-pill">
            <span>👤</span>
            <strong>${String(currentUser).padStart(2, '0')} 號</strong>
          </div>
          <div class="user-actions-btns">
            <button class="user-action-btn" id="btnChangePwd">密碼</button>
            <button class="user-action-btn" id="btnLogout">登出</button>
          </div>
        </div>
      `;

      document.getElementById('btnLogout')?.addEventListener('click', () => {
        setCurrentUser(null);
        showToast('已安全登出', 'info');
      });

      document.getElementById('btnChangePwd')?.addEventListener('click', () => {
        openPwdChangeModal(currentUser);
      });

    } else {
      container.innerHTML = `
        <button class="user-login-prompt-btn" id="btnHeaderLogin">
          <span>🔑</span>
          <span>座號登入 (1-31)</span>
        </button>
      `;

      document.getElementById('btnHeaderLogin')?.addEventListener('click', () => {
        openLoginModal();
      });
    }
  }

  // 密碼修改
  function openPwdChangeModal(seatNum) {
    const modal = document.getElementById('pwdModalBackdrop');
    document.getElementById('pwdChangeSeatNum').textContent = String(seatNum).padStart(2, '0');
    document.getElementById('currentPwdInput').value = '';
    document.getElementById('newPwdInput').value = '';
    document.getElementById('pwdChangeErrorMsg').textContent = '';
    modal.classList.add('open');
  }

  function closePwdChangeModal() {
    document.getElementById('pwdModalBackdrop').classList.remove('open');
  }

  // ==========================================
  // 10. 即時時鐘與時段狀態條 (Live Clock & Ticker)
  // ==========================================

  function updateLiveClock() {
    const now = getCurrentDateTime();
    const currentDateStr = document.getElementById('currentDateStr');
    const currentTimeStr = document.getElementById('currentTimeStr');
    const practiceStatusPill = document.getElementById('practiceStatusPill');
    const practiceStatusText = document.getElementById('practiceStatusText');

    if (!currentDateStr || !currentTimeStr) return;

    const dayNames = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const dayName = dayNames[now.getDay()];

    currentDateStr.textContent = `${y}/${m}/${d} (${dayName})`;
    currentTimeStr.textContent = now.toLocaleTimeString('zh-TW', { hour12: false });

    // 檢查今天是否為週二或週四
    const isTueThu = (now.getDay() === 2 || now.getDay() === 4);
    const todayKey = `${y}-${m}-${d}`;
    const currentMonthKey = `${y}-${now.getMonth()}`;

    // 自動跟隨時間前進：進入新月份（如進入 10 月）自動切換月曆
    if (lastActiveMonthKey === null) {
      lastActiveMonthKey = currentMonthKey;
      lastActiveDateKey = todayKey;
    } else if (lastActiveMonthKey !== currentMonthKey) {
      console.log(`[Clock] 跨月自動同步：${lastActiveMonthKey} -> ${currentMonthKey}`);
      lastActiveMonthKey = currentMonthKey;
      lastActiveDateKey = todayKey;
      viewYear = now.getFullYear();
      viewMonth = now.getMonth();
      renderCalendar();
      renderTodayView();
      renderRosterView();
      showToast(`🗓️ 系統時間已進入 ${viewYear} 年 ${viewMonth + 1} 月，日曆已自動為您切換至當月！`, 'info');
    } else if (lastActiveDateKey !== todayKey) {
      // 跨日（午夜 00:00 過後）
      lastActiveDateKey = todayKey;
      renderCalendar();
      renderTodayView();
      renderRosterView();
    }

    practiceStatusPill.className = 'practice-status-pill';

    if (!isTueThu) {
      practiceStatusPill.classList.add('status-waiting');
      practiceStatusText.textContent = '非練習日 (僅二、四開放)';
    } else {
      const status = getDatePracticeStatus(todayKey);
      if (status === 'PRACTICE_LIVE') {
        practiceStatusPill.classList.add('status-live');
        practiceStatusText.textContent = '🔥 練習中 (16:30-18:00)';
      } else if (status === 'OPEN') {
        practiceStatusPill.classList.add('status-waiting');
        practiceStatusText.textContent = '今日練習 (16:30截止預約)';
      } else {
        practiceStatusPill.classList.add('status-locked');
        practiceStatusText.textContent = '今日練習已結束';
      }
    }
  }

  // ==========================================
  // 11. Toast 提示通知 (Toast Notification System)
  // ==========================================

  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'warning') icon = '⚠️';
    if (type === 'danger') icon = '❌';

    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  // ==========================================
  // 12. 標籤頁切換 (Tabs switching)
  // ==========================================

  function switchTab(targetTab) {
    const tabs = {
      calendar: { btn: document.getElementById('tabCalendarBtn'), panel: document.getElementById('calendarView') },
      today: { btn: document.getElementById('tabTodayBtn'), panel: document.getElementById('todayView') },
      roster: { btn: document.getElementById('tabRosterBtn'), panel: document.getElementById('rosterView') }
    };

    Object.keys(tabs).forEach(k => {
      if (tabs[k].btn && tabs[k].panel) {
        if (k === targetTab) {
          tabs[k].btn.classList.add('active');
          tabs[k].panel.classList.add('active');
        } else {
          tabs[k].btn.classList.remove('active');
          tabs[k].panel.classList.remove('active');
        }
      }
    });

    if (targetTab === 'calendar') renderCalendar();
    if (targetTab === 'today') renderTodayView();
    if (targetTab === 'roster') renderRosterView();
  }

  // ==========================================
  // 13. CSV 匯出功能
  // ==========================================

  function exportCSV() {
    const bookings = getStoredBookings();
    let csvContent = '\uFEFF日期,座號,狀態,簽到時間,登記時間\n';

    Object.keys(bookings).sort().forEach(dateStr => {
      bookings[dateStr].forEach(b => {
        csvContent += `"${dateStr}","${b.seat} 號","${b.checkedIn ? '已簽到' : '未簽到'}","${b.checkInTime || '-'}","${b.bookedAt || '-'}"\n`;
      });
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `班級練習預約與簽到名冊_${formatDateKey(getCurrentDateTime())}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('名冊 CSV 匯出成功！', 'success');
  }

  // ==========================================
  // 14. 事件監聽器綁定 (Event Listeners Setup)
  // ==========================================

  function bindEvents() {
    // 日曆切換上/下月
    document.getElementById('prevMonthBtn')?.addEventListener('click', () => {
      viewMonth--;
      if (viewMonth < 0) {
        viewMonth = 11;
        viewYear--;
      }
      renderCalendar();
    });

    document.getElementById('nextMonthBtn')?.addEventListener('click', () => {
      viewMonth++;
      if (viewMonth > 11) {
        viewMonth = 0;
        viewYear++;
      }
      renderCalendar();
    });

    // 回到今天
    document.getElementById('btnJumpToday')?.addEventListener('click', () => {
      const now = getCurrentDateTime();
      viewYear = now.getFullYear();
      viewMonth = now.getMonth();
      renderCalendar();
      showToast('已定位至今天所屬月份', 'info');
    });

    // 關閉預約彈窗
    document.getElementById('closeBookingModalBtn')?.addEventListener('click', closeBookingModal);
    document.getElementById('bookingModalBackdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'bookingModalBackdrop') closeBookingModal();
    });

    // 關閉登入彈窗
    document.getElementById('closeLoginModalBtn')?.addEventListener('click', closeLoginModal);
    document.getElementById('loginModalBackdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'loginModalBackdrop') closeLoginModal();
    });

    // 密碼顯示切換
    document.getElementById('togglePwdVisibility')?.addEventListener('click', () => {
      const pwdInput = document.getElementById('loginPasswordInput');
      if (pwdInput.type === 'password') {
        pwdInput.type = 'text';
      } else {
        pwdInput.type = 'password';
      }
    });

    // 登入表單提交
    document.getElementById('loginForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const seatNum = parseInt(document.getElementById('loginSeatSelect').value, 10);
      const inputPwd = document.getElementById('loginPasswordInput').value;
      const errDiv = document.getElementById('loginErrorMsg');

      if (!seatNum || seatNum < 1 || seatNum > TOTAL_SEATS) {
        errDiv.textContent = '請選擇有效的 1 ~ 31 號座號！';
        return;
      }

      if (verifyPassword(seatNum, inputPwd)) {
        setCurrentUser(seatNum);
        closeLoginModal();
        showToast(`歡迎座號 ${String(seatNum).padStart(2, '0')} 號同學登入！`, 'success');
        // 若是在預約彈窗中發起登入，登入後重新打開該日彈窗
        if (selectedDateStr) {
          openBookingModal(selectedDateStr);
        }
      } else {
        errDiv.textContent = '❌ 密碼錯誤！提示：預設密碼為您自己的座號。';
      }
    });

    // 修改密碼提交
    document.getElementById('pwdChangeForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const currentUser = getCurrentUser();
      const currentPwd = document.getElementById('currentPwdInput').value;
      const newPwd = document.getElementById('newPwdInput').value;
      const errDiv = document.getElementById('pwdChangeErrorMsg');

      if (!verifyPassword(currentUser, currentPwd)) {
        errDiv.textContent = '原密碼不正確！';
        return;
      }

      if (!newPwd || newPwd.trim().length === 0) {
        errDiv.textContent = '新密碼不能為空！';
        return;
      }

      updatePassword(currentUser, newPwd);
      closePwdChangeModal();
      showToast('密碼修改成功！下次登入請使用新密碼。', 'success');
    });

    document.getElementById('closePwdModalBtn')?.addEventListener('click', closePwdChangeModal);
    document.getElementById('pwdModalBackdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'pwdModalBackdrop') closePwdChangeModal();
    });

    // 競賽介紹卡片區塊 收合/展開切換
    document.getElementById('toggleCompShowcaseBtn')?.addEventListener('click', function () {
      const showcase = document.getElementById('competitionsShowcase');
      showcase.classList.toggle('minimized');
      this.textContent = showcase.classList.contains('minimized') ? '展開介紹' : '收合介紹';
    });

    // 規則 Banner 收合切換
    document.getElementById('toggleNoticeBtn')?.addEventListener('click', function () {
      const banner = document.getElementById('rulesBanner');
      banner.classList.toggle('minimized');
      this.textContent = banner.classList.contains('minimized') ? '展開' : '縮小';
    });

    // 標籤頁切換
    document.getElementById('tabCalendarBtn')?.addEventListener('click', () => switchTab('calendar'));
    document.getElementById('tabTodayBtn')?.addEventListener('click', () => switchTab('today'));
    document.getElementById('tabRosterBtn')?.addEventListener('click', () => switchTab('roster'));

    // CSV 匯出與重設資料
    document.getElementById('btnExportCSV')?.addEventListener('click', exportCSV);
    document.getElementById('btnResetDemoData')?.addEventListener('click', () => {
      if (confirm('確定要清空全班的所有預約與打卡紀錄嗎？此動作將重置為完全空白的名冊。')) {
        resetAllBookings();
        showToast('✅ 全班預約與簽到紀錄已全數清空重置！', 'success');
      }
    });

    // 模擬測試工具彈窗
    document.getElementById('btnTimeSimulation')?.addEventListener('click', () => {
      document.getElementById('simModalBackdrop').classList.add('open');
    });
    document.getElementById('closeSimModalBtn')?.addEventListener('click', () => {
      document.getElementById('simModalBackdrop').classList.remove('open');
    });
    document.getElementById('simModalBackdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'simModalBackdrop') {
        document.getElementById('simModalBackdrop').classList.remove('open');
      }
    });

    // 模擬時段按鈕（含 10 月練習日時段支援）
    document.querySelectorAll('.sim-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const mode = this.getAttribute('data-sim');
        const now = new Date();

        if (mode === 'real') {
          simulatedTimeOffset = null;
          const realNow = new Date();
          viewYear = realNow.getFullYear();
          viewMonth = realNow.getMonth();
          lastActiveMonthKey = `${viewYear}-${viewMonth}`;
          lastActiveDateKey = formatDateKey(realNow);
          showToast('已恢復使用電腦真實時間（日曆已自動同步至當前月份）', 'info');
        } else {
          let simDate;
          if (mode === 'oct-practice') {
            // 2026 年 10 月 1 日 (週四 16:30 練習時段)
            simDate = new Date(now.getFullYear(), 9, 1, 16, 30, 0, 0);
          } else if (mode === 'oct-tue') {
            // 2026 年 10 月 6 日 (週二 10:00 預約開放時段)
            simDate = new Date(now.getFullYear(), 9, 6, 10, 0, 0, 0);
          } else {
            // 找尋本週最近的週二或週四
            let targetDay = 2; // 預設週二
            if (mode === 'thu-practice') targetDay = 4;

            const currentDay = now.getDay();
            const diffDays = (targetDay - currentDay + 7) % 7;
            simDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffDays);

            if (mode === 'tue-morning') {
              simDate.setHours(10, 0, 0, 0);
            } else if (mode === 'tue-practice') {
              simDate.setHours(16, 45, 0, 0); // 練習中！
            } else if (mode === 'thu-practice') {
              simDate.setHours(17, 15, 0, 0); // 週四練習中！
            } else if (mode === 'tue-after') {
              simDate.setHours(18, 30, 0, 0); // 練習已結束
            }
          }

          simulatedTimeOffset = simDate.getTime() - Date.now();
          viewYear = simDate.getFullYear();
          viewMonth = simDate.getMonth();
          lastActiveMonthKey = `${viewYear}-${viewMonth}`;
          lastActiveDateKey = formatDateKey(simDate);
          showToast(`已切換模擬時間為：${simDate.toLocaleString('zh-TW')}（日曆已自動跳轉至 ${viewMonth + 1} 月）`, 'success');
        }

        document.getElementById('simModalBackdrop').classList.remove('open');
        updateLiveClock();
        renderCalendar();
        renderTodayView();
        renderRosterView();
      });
    });

    // 說明指南彈窗
    document.getElementById('btnHelpGuide')?.addEventListener('click', () => {
      document.getElementById('helpModalBackdrop').classList.add('open');
    });
    document.getElementById('closeHelpModalBtn')?.addEventListener('click', () => {
      document.getElementById('helpModalBackdrop').classList.remove('open');
    });
    document.getElementById('helpModalBackdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'helpModalBackdrop') {
        document.getElementById('helpModalBackdrop').classList.remove('open');
      }
    });

    // ============================================================
    // 🔒 管理員授權彈窗（設定不可預約日 - 密碼保護）
    // ============================================================

    function openAdminAuthModal() {
      const input = document.getElementById('adminPasswordInput');
      const err   = document.getElementById('adminAuthErrorMsg');
      if (input) input.value = '';
      if (err)   err.textContent = '';
      document.getElementById('adminAuthModalBackdrop')?.classList.add('open');
    }
    function closeAdminAuthModal() {
      document.getElementById('adminAuthModalBackdrop')?.classList.remove('open');
    }
    function openBlockDatePanel() {
      populateBlockDateSelector();
      renderBlockedDatesList();
      document.getElementById('adminHolidayPickerModalBackdrop')?.classList.add('open');
    }
    function closeBlockDatePanel() {
      document.getElementById('adminHolidayPickerModalBackdrop')?.classList.remove('open');
    }

    // 觸發管理員授權的按鈕（工具列 + 日曆工具列）
    ['btnAdminHolidayManage', 'btnToolbarAdminBlock'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', openAdminAuthModal);
    });
    document.getElementById('closeAdminAuthModalBtn')?.addEventListener('click', closeAdminAuthModal);
    document.getElementById('adminAuthModalBackdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'adminAuthModalBackdrop') closeAdminAuthModal();
    });

    // 密碼顯示切換
    document.getElementById('toggleAdminPwdVisibility')?.addEventListener('click', () => {
      const inp = document.getElementById('adminPasswordInput');
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    });

    // 管理員密碼提交（SHA-256 雜湊驗證，不暴露明文）
    document.getElementById('adminAuthForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input  = document.getElementById('adminPasswordInput');
      const err    = document.getElementById('adminAuthErrorMsg');
      const btn    = document.getElementById('btnSubmitAdminAuth');
      const inputVal = input?.value || '';

      btn.disabled = true;
      btn.textContent = '驗證中...';

      const ok = await verifyAdminPassword(inputVal);
      btn.disabled = false;
      btn.textContent = '驗證並開啟設定面板 🔓';

      if (ok) {
        closeAdminAuthModal();
        openBlockDatePanel();
      } else {
        if (err) {
          err.textContent = '❌ 密碼錯誤！此功能僅限管理員操作。';
          err.style.color = '#f87171';
        }
        input.value = '';
        input.focus();
      }
    });

    document.getElementById('closeAdminHolidayPickerBtn')?.addEventListener('click', closeBlockDatePanel);
    document.getElementById('adminHolidayPickerModalBackdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'adminHolidayPickerModalBackdrop') closeBlockDatePanel();
    });

    // 自選日期按鈕切換
    let usingCustomDate = false;
    document.getElementById('btnToggleCustomDate')?.addEventListener('click', () => {
      usingCustomDate = !usingCustomDate;
      const sel    = document.getElementById('selectBlockDate');
      const custom = document.getElementById('inputCustomBlockDate');
      const btn    = document.getElementById('btnToggleCustomDate');
      if (sel)    sel.style.display    = usingCustomDate ? 'none' : '';
      if (custom) custom.style.display = usingCustomDate ? '' : 'none';
      if (btn)    btn.textContent      = usingCustomDate ? '近期週二/四' : '自選日期';
    });

    // 快速理由標籤
    document.querySelectorAll('.reason-tag-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const reasonInput = document.getElementById('inputBlockReason');
        if (reasonInput) reasonInput.value = pill.getAttribute('data-reason') || '';
        document.querySelectorAll('.reason-tag-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
      });
    });

    // 設定不可預約日表單提交
    document.getElementById('formSetBlockDate')?.addEventListener('submit', (e) => {
      e.preventDefault();
      let dateStr = '';
      if (usingCustomDate) {
        dateStr = document.getElementById('inputCustomBlockDate')?.value;
      } else {
        dateStr = document.getElementById('selectBlockDate')?.value;
      }
      const reason = (document.getElementById('inputBlockReason')?.value || '').trim();

      if (!dateStr) {
        showToast('請選擇要設定的日期！', 'warning');
        return;
      }
      if (!reason) {
        showToast('請填寫停練理由！', 'warning');
        return;
      }

      setHolidayStatus(dateStr, true, reason);
      renderCalendar();
      renderTodayView();
      renderBlockedDatesList();

      // 清空欄位
      if (document.getElementById('inputBlockReason')) document.getElementById('inputBlockReason').value = '';
      document.querySelectorAll('.reason-tag-pill').forEach(p => p.classList.remove('active'));

      showToast(`🚫 ${dateStr} 已設為不可預約（${reason}）`, 'success');
    });

    /**
     * 填充近期週二/週四日期選單（未來 8 週）
     */
    function populateBlockDateSelector() {
      const sel = document.getElementById('selectBlockDate');
      if (!sel) return;
      sel.innerHTML = '<option value="" disabled selected>-- 選擇近期練習日 --</option>';

      const now = getCurrentDateTime();
      const dayNames = ['日', '一', '二', '三', '四', '五', '六'];

      for (let i = 0; i <= 60; i++) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
        const dow = d.getDay();
        if (dow === 2 || dow === 4) {
          const key = formatDateKey(d);
          const opt = document.createElement('option');
          opt.value = key;
          const isBlocked = isHolidayDate(key);
          opt.textContent = `${key} (週${dayNames[dow]})${isBlocked ? ' 🚫 已設停練' : ''}`;
          sel.appendChild(opt);
        }
      }
    }

    /**
     * 渲染已設定停練日清單
     */
    function renderBlockedDatesList() {
      const list = document.getElementById('holidayDatesList');
      const countEl = document.getElementById('blockedDatesCount');
      if (!list) return;

      const holidays = getStoredHolidays();
      const entries = Object.entries(holidays).sort(([a], [b]) => a.localeCompare(b));

      if (countEl) countEl.textContent = entries.length;

      if (entries.length === 0) {
        list.innerHTML = `<div style="text-align:center; color:var(--text-muted); font-size:0.85rem; padding:16px;">
          目前尚未設定任何停練日
        </div>`;
        return;
      }

      list.innerHTML = '';
      entries.forEach(([dateStr, info]) => {
        const item = document.createElement('div');
        item.className = 'holiday-row-item';
        item.innerHTML = `
          <div>
            <div style="font-weight:600; color:#f1f5f9;">📅 ${dateStr}</div>
            <div style="font-size:0.78rem; color:#fca5a5; margin-top:2px;">📌 ${info.reason || '停練'}</div>
            ${info.createdAt ? `<div style="font-size:0.72rem; color:var(--text-dim);">${info.createdAt} 設定</div>` : ''}
          </div>
          <button class="holiday-toggle-action-btn btn-unmark-holiday" data-date="${dateStr}">
            ✅ 恢復開放
          </button>
        `;
        list.appendChild(item);
      });

      // 解鎖按鈕
      list.querySelectorAll('.btn-unmark-holiday').forEach(btn => {
        btn.addEventListener('click', () => {
          const d = btn.getAttribute('data-date');
          setHolidayStatus(d, false, '');
          renderCalendar();
          renderTodayView();
          renderBlockedDatesList();
          showToast(`✅ ${d} 已恢復正常開放預約`, 'success');
        });
      });
    }

    // ============================================================
    // ☁️ 雲端同步設定彈窗 (Firebase Config)
    // ============================================================

    function openCloudSyncModal() {
      // 更新彈窗內的狀態說明
      if (window.CloudDB) window.CloudDB.updateStatusUI(window.CloudDB.isOnline());
      // 若有已儲存的設定，填入文字框供編輯
      const saved = localStorage.getItem('firebase_config_saved');
      const textarea = document.getElementById('firebaseConfigInput');
      if (textarea && saved) {
        try {
          textarea.value = JSON.stringify(JSON.parse(saved), null, 2);
        } catch (e) {
          textarea.value = saved;
        }
      }
      document.getElementById('cloudSyncModalBackdrop')?.classList.add('open');
    }
    function closeCloudSyncModal() {
      document.getElementById('cloudSyncModalBackdrop')?.classList.remove('open');
    }

    // 若使用者需要手動開啟雲端設定（可選）
    document.getElementById('closeCloudSyncModalBtn')?.addEventListener('click', closeCloudSyncModal);
    document.getElementById('cloudSyncModalBackdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'cloudSyncModalBackdrop') closeCloudSyncModal();
    });

    // 儲存並連線 Firebase
    document.getElementById('formCloudSyncConfig')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const raw = (document.getElementById('firebaseConfigInput')?.value || '').trim();
      if (!raw) {
        showToast('請貼上 Firebase 設定內容', 'warning');
        return;
      }

      // 嘗試解析 JSON（相容 JS 物件語法或純 JSON）
      let cfg;
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        cfg = match ? JSON.parse(match[0]) : JSON.parse(raw);
      } catch (err) {
        showToast('❌ 格式錯誤！請複製 Firebase 控制台的 firebaseConfig 物件', 'danger');
        return;
      }

      if (!cfg.databaseURL) {
        showToast('❌ 缺少 databaseURL 欄位！請確認你已建立 Realtime Database', 'danger');
        return;
      }

      // 儲存設定到 localStorage
      localStorage.setItem('firebase_config_saved', JSON.stringify(cfg));
      closeCloudSyncModal();
      await initCloudSync(JSON.stringify(cfg));
    });

    // 斷開雲端 / 恢復本地模式
    document.getElementById('btnDisconnectCloud')?.addEventListener('click', () => {
      if (window.CloudDB) window.CloudDB.disconnect();
      localStorage.removeItem('firebase_config_saved');
      showToast('已切換回本地儲存模式', 'info');
      closeCloudSyncModal();
    });
  }

  // ==========================================
  // 15. 初始化啟動 (Application Entry Point)
  // ==========================================

  function initApp() {
    initDemoDataIfNeeded();
    populateLoginSeatOptions();
    updateUserSessionUI();

    // 日曆自動定位至當天年月，並初始化時間追蹤
    const now = getCurrentDateTime();
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();
    lastActiveMonthKey = `${viewYear}-${viewMonth}`;
    lastActiveDateKey = formatDateKey(now);

    renderCalendar();
    renderTodayView();
    renderRosterView();
    updateLiveClock();

    // 啟動即時時鐘 (每秒更新一次，自動偵測跨日與跨月)
    setInterval(updateLiveClock, 1000);

    bindEvents();

    // 嘗試初始化 Firebase 雲端同步（若有設定則自動連線）
    initCloudSync(null);
  }

  // 確保 DOM 載入後啟動
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

})();
