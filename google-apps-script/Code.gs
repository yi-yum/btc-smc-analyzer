// ════════════════════════════════════════════════════════════════
//  SMC 模擬倉 — Google Apps Script Web App
//  使用方式：
//    1. 開啟 Google Sheet
//    2. 點「擴充功能」→「Apps Script」
//    3. 貼上此程式碼，儲存
//    4. 點「部署」→「新增部署作業」
//       - 類型：網頁應用程式
//       - 執行身分：我（你的帳號）
//       - 存取權：所有人
//    5. 複製「網頁應用程式網址」貼到儀表板設定
// ════════════════════════════════════════════════════════════════

const SHEET_NAME = 'SMC_Trades';

// ── 讀取所有交易記錄 ────────────────────────────────────────────
function doGet(e) {
  try {
    const sheet  = getSheet();
    const stored = sheet.getRange('A1').getValue();
    const trades = stored ? JSON.parse(stored) : [];
    return json({ trades });
  } catch (err) {
    return json({ trades: [], error: err.message });
  }
}

// ── 儲存所有交易記錄 ────────────────────────────────────────────
function doPost(e) {
  try {
    // 支援 URLSearchParams 格式（e.parameter.data）
    // 也向下相容 JSON body（e.postData.contents）
    let payload;
    if (e.parameter && e.parameter.data) {
      payload = JSON.parse(e.parameter.data);
    } else if (e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else {
      throw new Error('找不到資料，請確認請求格式');
    }

    const sheet = getSheet();

    if (Array.isArray(payload.trades)) {
      // A1 存 JSON（供網頁讀取）
      sheet.getRange('A1').setValue(JSON.stringify(payload.trades));

      // 從第 3 行起寫人類可讀表格
      writeTable(sheet, payload.trades);
    }

    return json({ success: true, count: payload.trades?.length ?? 0 });
  } catch (err) {
    return json({ success: false, error: err.message });
  }
}

// ── 取得或建立工作表 ────────────────────────────────────────────
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

// ── 寫入人類可讀表格（第 3 行起）────────────────────────────────
function writeTable(sheet, trades) {
  const HEADERS = [
    'ID', '幣種', '方向', '進場價', 'SL', 'TP1', 'TP2', 'RR1', 'RR2',
    '狀態', '盈虧%', '信心', '1D', '4H', '1H',
    '開倉時間', '平倉時間', '出場價', '備註'
  ];

  // 標題列
  const headerRange = sheet.getRange(3, 1, 1, HEADERS.length);
  headerRange.setValues([HEADERS]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#263238');
  headerRange.setFontColor('#ffffff');

  if (!trades.length) return;

  const rows = trades.map(t => [
    t.id,
    t.symbol,
    t.direction,
    t.entry   || '',
    t.sl      || '',
    t.tp1     || '',
    t.tp2     || '',
    t.rr1     || '',
    t.rr2     || '',
    t.status,
    t.pnlPct  != null ? Number(t.pnlPct) : '',
    t.confidence || '',
    t.trends?.d1 || '',
    t.trends?.h4 || '',
    t.trends?.h1 || '',
    t.openTime  ? new Date(t.openTime) .toLocaleString('zh-TW') : '',
    t.closeTime ? new Date(t.closeTime).toLocaleString('zh-TW') : '',
    t.closePrice || '',
    t.note || '',
  ]);

  const dataRange = sheet.getRange(4, 1, rows.length, HEADERS.length);
  dataRange.setValues(rows);

  // 顏色標記
  rows.forEach((row, i) => {
    const statusCell = sheet.getRange(4 + i, 10); // 狀態欄
    const pnlCell    = sheet.getRange(4 + i, 11); // 盈虧欄
    const status     = row[9];
    const pnl        = row[10];

    const statusColor = {
      open:   '#fff9c4', tp1: '#c8e6c9', tp2: '#a5d6a7',
      sl:     '#ffcdd2', manual: '#f5f5f5',
    }[status] || '#ffffff';

    statusCell.setBackground(statusColor);

    if (typeof pnl === 'number') {
      pnlCell.setFontColor(pnl >= 0 ? '#2e7d32' : '#c62828');
      pnlCell.setFontWeight('bold');
    }
  });

  // 清除多餘舊行
  const lastRow = sheet.getLastRow();
  const newLast = 3 + rows.length;
  if (lastRow > newLast) {
    sheet.deleteRows(newLast + 1, lastRow - newLast);
  }
}

// ── JSON 回應輔助 ───────────────────────────────────────────────
function json(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
