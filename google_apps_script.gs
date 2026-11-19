/**
 * Google Apps Script สำหรับ เทิงแมพ (Thoeng Map)
 * ใช้เชื่อมต่อ Google Sheet แบบอ่าน-เขียนได้ 2 ทาง (ดึงข้อมูล + เพิ่มหมุดใหม่ + ย้ายพิกัด)
 *
 * วิธีติดตั้ง:
 * 1. เปิด Google Sheet ของคุณ > เมนู Extensions (ส่วนขยาย) > Apps Script
 * 2. ลบโค้ดเดิมออกทั้งหมด แล้ววางโค้ดนี้ลงไป กด Save (Cmd+S)
 * 3. กด Deploy (ทำให้ใช้งานได้) > New deployment (การทำให้ใช้งานได้รายการใหม่)
 * 4. เลือก Type: Web app
 *    - Execute as: Me (ฉัน)
 *    - Who has access: Anyone (ทุกคน)
 * 5. กด Deploy > อนุญาตสิทธิ์ (Authorize) > คัดลอก Web app URL มาใส่ใน GOOGLE_SHEET_CONFIG.appsScriptUrl
 */

const SPREADSHEET_ID = '1InXBPZhHAxOTzJADn608cGhgzDOeJN67Z4bKXXvJIGE';
const SHEET_NAME = 'places';

function getSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// GET: ดึงข้อมูลสถานที่ทั้งหมดจาก Google Sheet
function doGet() {
  try {
    const sheet = getSheet();
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) {
      return jsonResponse({ ok: true, places: [] });
    }

    const headers = values[0].map(h => String(h).trim());
    const places = [];

    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = row[idx];
      });
      if (obj.name && obj.lat !== '' && obj.lng !== '') {
        places.push(obj);
      }
    }

    return jsonResponse({ ok: true, places: places });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// POST: รับคำสั่งเพิ่มหมุดใหม่ (action: 'add') หรือ ย้ายพิกัด (action: 'move')
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const sheet = getSheet();
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(h => String(h).trim());

    if (payload.action === 'move') {
      const idCol = headers.indexOf('id');
      const latCol = headers.indexOf('lat');
      const lngCol = headers.indexOf('lng');

      if (idCol === -1 || latCol === -1 || lngCol === -1) {
        return jsonResponse({ ok: false, error: 'Missing id/lat/lng columns' });
      }

      for (let i = 1; i < values.length; i++) {
        if (String(values[i][idCol]).trim() === String(payload.id).trim()) {
          sheet.getRange(i + 1, latCol + 1).setValue(Number(payload.lat));
          sheet.getRange(i + 1, lngCol + 1).setValue(Number(payload.lng));
          return jsonResponse({ ok: true, updatedRow: i + 1 });
        }
      }
      return jsonResponse({ ok: false, error: 'Place ID not found: ' + payload.id });
    }

    if (payload.action === 'add' && payload.place) {
      const p = payload.place;
      const newRow = headers.map(h => {
        const val = p[h];
        if (Array.isArray(val)) return val.join('|');
        if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
        return val !== undefined && val !== null ? val : '';
      });
      sheet.appendRow(newRow);
      return jsonResponse({ ok: true, addedId: p.id });
    }

    return jsonResponse({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}
