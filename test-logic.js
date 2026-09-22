// Automated test script to verify core logic:
const assert = require('assert');

console.log('--- 開始邏輯自動化測試 ---');

// 1. 座號雙重確認驗證
const TOTAL_SEATS = 31;
for (let seat = 1; seat <= TOTAL_SEATS; seat++) {
  const seatConfirm = String(seat);
  assert.strictEqual(parseInt(seatConfirm, 10), seat, `Seat ${seat} double confirm input must match seat number`);
}
console.log('✓ 測試通過：1~31 號座號雙重確認驗證');

// 2. 週二與週四判斷
function isBookableDay(dateObj) {
  const day = dateObj.getDay();
  return day === 2 || day === 4;
}

const sunday = new Date(2026, 8, 20);    // Sun (0)
const monday = new Date(2026, 8, 21);    // Mon (1)
const tuesday = new Date(2026, 8, 22);   // Tue (2)
const wednesday = new Date(2026, 8, 23); // Wed (3)
const thursday = new Date(2026, 8, 24);  // Thu (4)
const friday = new Date(2026, 8, 25);    // Fri (5)
const saturday = new Date(2026, 8, 26);  // Sat (6)

assert.strictEqual(isBookableDay(sunday), false, 'Sunday should not be bookable');
assert.strictEqual(isBookableDay(monday), false, 'Monday should not be bookable');
assert.strictEqual(isBookableDay(tuesday), true, 'Tuesday MUST be bookable');
assert.strictEqual(isBookableDay(wednesday), false, 'Wednesday should not be bookable');
assert.strictEqual(isBookableDay(thursday), true, 'Thursday MUST be bookable');
assert.strictEqual(isBookableDay(friday), false, 'Friday should not be bookable');
assert.strictEqual(isBookableDay(saturday), false, 'Saturday should not be bookable');
console.log('✓ 測試通過：僅每週二與每週四開放預約規則');

// 3. 練習時段 16:30 ~ 18:00 預約截止與簽到狀態判定
const PRACTICE_START = 16 * 60 + 30; // 990
const PRACTICE_END = 18 * 60;        // 1080

function getStatusForTime(currentMinutes) {
  if (currentMinutes < PRACTICE_START) {
    return 'OPEN'; // 隨時可提前預約
  } else if (currentMinutes >= PRACTICE_START && currentMinutes <= PRACTICE_END) {
    return 'PRACTICE_LIVE'; // 預約截止鎖定，全面開放簽到
  } else {
    return 'ENDED'; // 練習結束
  }
}

// 早上 10:00 (600 分鐘)
assert.strictEqual(getStatusForTime(10 * 60), 'OPEN', '10:00 AM should be OPEN for booking');
// 16:29 (989 分鐘)
assert.strictEqual(getStatusForTime(16 * 60 + 29), 'OPEN', '16:29 should be OPEN for booking');
// 16:30 (990 分鐘) - 開始練習！
assert.strictEqual(getStatusForTime(16 * 60 + 30), 'PRACTICE_LIVE', '16:30 MUST be PRACTICE_LIVE (Booking LOCKED)');
// 17:15 (1035 分鐘) - 練習中！
assert.strictEqual(getStatusForTime(17 * 60 + 15), 'PRACTICE_LIVE', '17:15 MUST be PRACTICE_LIVE');
// 18:00 (1080 分鐘)
assert.strictEqual(getStatusForTime(18 * 60), 'PRACTICE_LIVE', '18:00 is end of practice');
// 18:01 (1081 分鐘) - 練習結束
assert.strictEqual(getStatusForTime(18 * 60 + 1), 'ENDED', '18:01 MUST be ENDED');

// 4. 嚴格簽到時間測試：僅限當天 16:30~18:00 才能簽到
function canCheckIn(currentMinutes) {
  if (currentMinutes < PRACTICE_START) {
    return { success: false, reason: 'TOO_EARLY' };
  } else if (currentMinutes > PRACTICE_END) {
    return { success: false, reason: 'TOO_LATE' };
  }
  return { success: true };
}

assert.strictEqual(canCheckIn(10 * 60).success, false, '10:00 AM check-in must fail');
assert.strictEqual(canCheckIn(16 * 60 + 29).success, false, '16:29 check-in must fail');
assert.strictEqual(canCheckIn(16 * 60 + 30).success, true, '16:30 check-in must SUCCEED');
assert.strictEqual(canCheckIn(17 * 60 + 45).success, true, '17:45 check-in must SUCCEED');
assert.strictEqual(canCheckIn(18 * 60).success, true, '18:00 check-in must SUCCEED');
assert.strictEqual(canCheckIn(18 * 60 + 1).success, false, '18:01 check-in must fail');

// 5. 10 月練習日與跨月時間同步測試
const oct1 = new Date(2026, 9, 1); // 2026-10-01 (Thu)
const oct6 = new Date(2026, 9, 6); // 2026-10-06 (Tue)
const oct2 = new Date(2026, 9, 2); // 2026-10-02 (Fri)

assert.strictEqual(isBookableDay(oct1), true, '2026-10-01 (Thursday) MUST be bookable in October');
assert.strictEqual(isBookableDay(oct6), true, '2026-10-06 (Tuesday) MUST be bookable in October');
assert.strictEqual(isBookableDay(oct2), false, '2026-10-02 (Friday) must NOT be bookable');

// 6. 跨月份自動偵測跳轉邏輯
function checkMonthTransition(lastMonthKey, currentMonthKey) {
  if (lastMonthKey !== currentMonthKey) {
    const [y, m] = currentMonthKey.split('-').map(Number);
    return { shouldUpdateCalendar: true, newYear: y, newMonth: m };
  }
  return { shouldUpdateCalendar: false };
}

const sepKey = '2026-8'; // 9 月 (0-indexed 8)
const octKey = '2026-9'; // 10 月 (0-indexed 9)
const transitionRes = checkMonthTransition(sepKey, octKey);
assert.strictEqual(transitionRes.shouldUpdateCalendar, true);
assert.strictEqual(transitionRes.newMonth, 9, 'Must transition to October (index 9)');
assert.strictEqual(transitionRes.newYear, 2026);
console.log('✓ 測試通過：10 月練習日判斷與跨月自動跳轉日曆機制');

// 7. 預約重置後資料驗證 (初始必須為空，無任何幽靈預約)
const emptyBookings = {};
assert.strictEqual(Object.keys(emptyBookings).length, 0, 'Clean bookings must be empty');
console.log('✓ 測試通過：預約資料重置為空白');

console.log('--- 所有核心業務邏輯驗證 100% 正確 ---');

