const CONFIG = Object.freeze({
  SPREADSHEET_ID: '1EEpkuCvVn-VBsLdfcz1L8QCs5pmxOhkDfGXyRyixhW4',
  SHEETS: {
    students: 'Alumnes',
    submissions: 'Entregues',
    corrections: 'Correccions',
    activity: 'Activitat'
  },
  UPLOAD_FOLDERS: {
    'practiques/estadistica/probabilitat-4b.html': '1zZXpuuhFubCGX5WpcZb80pJzWH3hN6Z7',
    'practiques/estadistica/probabilitat-4c.html': '1M9gta8J11mOgU6oEEjYW15xlbfFPlYud',
    'practiques/estadistica/mostreig-5b.html': '1YVOQSDbppxOK-62La30W5oZBn3s-zK1h',
    'practiques/estadistica/mostreig-5c.html': '12Uv2lu82YeTYEzqj5ZsXlLsYC-QceqJa',
    'practiques/estadistica/inferencia-6b.html': '1xCjH3GVr6-ljWkYa3XCy2q3oKa7VCS7h',
    'practiques/estadistica/inferencia-6c.html': '10afaNefv1PW-cSrYh7-nbtwiVjvgkwYy',
    'practiques/estadistica/aplicacions-7b.html': '1_zL_2-EWz7m_6oJ_FlrTdvi_fAEyrMxy'
  },
  MAX_FILES: 5,
  MAX_FILE_BYTES: 8 * 1024 * 1024
});

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function text_(v) {
  return v == null ? '' : String(v);
}

function number_(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeId_(v) {
  return text_(v).replace(/\D/g, '').slice(0, 6);
}

function activeStudent_(id) {
  if (!/^\d{6}$/.test(id)) return false;
  const sh = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.SHEETS.students);
  const last = sh.getLastRow();
  if (last < 2) return false;
  const values = sh.getRange(2, 2, last - 1, 4).getDisplayValues(); // ID, darrers4, Actiu, Rol
  return values.some(row =>
    normalizeId_(row[0]) === id &&
    String(row[2]).toUpperCase() === 'TRUE' &&
    String(row[3]).toLowerCase() === 'student'
  );
}

function existingSubmission_(submissionId) {
  if (!submissionId) return false;
  const sh = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.SHEETS.submissions);
  const last = sh.getLastRow();
  if (last < 2) return false;
  const found = sh.getRange(2, 13, last - 1, 1)
    .createTextFinder(submissionId)
    .matchEntireCell(true)
    .findNext();
  return !!found;
}

function safeFilename_(name) {
  return text_(name)
    .replace(/[\\/:*?"<>|#%{}~&]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'fitxer';
}

function stamp_() {
  return Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyyMMdd_HHmmss');
}

function saveAttachments_(payload) {
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  if (!attachments.length) return [];

  const practiceKey = text_(payload.practiceKey).replace(/^\/+/, '');
  const folderId = CONFIG.UPLOAD_FOLDERS[practiceKey];
  if (!folderId) throw new Error('Aquesta pràctica no té carpeta de pujada configurada.');
  if (attachments.length > CONFIG.MAX_FILES) throw new Error('Massa fitxers adjunts.');

  const folder = DriveApp.getFolderById(folderId);
  const out = [];

  attachments.forEach((item, index) => {
    const mimeType = text_(item.mimeType || item.type || 'application/octet-stream');
    const originalName = safeFilename_(item.name || ('fitxer-' + (index + 1)));
    const raw = text_(item.base64).replace(/^data:[^;]+;base64,/, '');
    if (!raw) throw new Error('Fitxer adjunt buit.');

    const bytes = Utilities.base64Decode(raw);
    if (bytes.length > CONFIG.MAX_FILE_BYTES) throw new Error('Un fitxer supera el límit de 8 MB.');

    const filename =
      normalizeId_(payload.id) + '_' +
      safeFilename_(text_(payload.practice).replace(/\s+/g, '-')) + '_' +
      stamp_() + '_' + originalName;

    const file = folder.createFile(Utilities.newBlob(bytes, mimeType, filename));
    out.push({
      name: filename,
      originalName,
      mimeType,
      size: bytes.length,
      fileId: file.getId(),
      url: file.getUrl()
    });
  });

  return out;
}

function appendSubmission_(payload, uploadedFiles) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sh = ss.getSheetByName(CONFIG.SHEETS.submissions);
  const detail = Object.assign({}, payload.detail || {});
  if (uploadedFiles.length) detail.driveFiles = uploadedFiles;

  sh.appendRow([
    new Date(),
    normalizeId_(payload.id),
    text_(payload.practice),
    text_(payload.area),
    text_(payload.status),
    number_(payload.total),
    number_(payload.correct),
    number_(payload.attempts),
    payload.progress === '' ? '' : number_(payload.progress),
    payload.minutes === '' ? '' : number_(payload.minutes),
    text_(payload.version),
    JSON.stringify(detail),
    text_(payload.submissionId)
  ]);

  if (text_(payload.status) === 'Activitat') {
    const activity = ss.getSheetByName(CONFIG.SHEETS.activity);
    activity.appendRow([
      new Date(),
      normalizeId_(payload.id),
      text_(payload.practice),
      text_(payload.area),
      text_(payload.status),
      number_(payload.total),
      number_(payload.correct),
      number_(payload.attempts),
      payload.progress === '' ? '' : number_(payload.progress),
      payload.minutes === '' ? '' : number_(payload.minutes),
      text_(payload.version),
      JSON.stringify(detail),
      text_(payload.submissionId)
    ]);
  }

  const corrections = ss.getSheetByName(CONFIG.SHEETS.corrections);
  (Array.isArray(payload.justifications) ? payload.justifications : []).forEach(j => {
    const answer = text_(j && j.text).trim();
    if (!answer) return;
    corrections.appendRow([
      new Date(),
      normalizeId_(payload.id),
      text_(payload.practice),
      text_(j.question),
      answer,
      '',
      '',
      '',
      '',
      '',
      '',
      text_(payload.submissionId)
    ]);
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);

    const raw = e && e.parameter ? e.parameter.payload : '';
    if (!raw) return json_({ok: false, error: 'missing-payload'});

    const payload = JSON.parse(raw);
    const id = normalizeId_(payload.id);
    if (!activeStudent_(id)) return json_({ok: false, error: 'invalid-student'});

    const submissionId = text_(payload.submissionId);
    if (!submissionId) return json_({ok: false, error: 'missing-submission-id'});
    if (existingSubmission_(submissionId)) return json_({ok: true, duplicate: true});

    payload.id = id;
    const uploadedFiles = saveAttachments_(payload);
    appendSubmission_(payload, uploadedFiles);

    return json_({ok: true, files: uploadedFiles.map(f => ({name: f.name, url: f.url}))});
  } catch (err) {
    console.error(err);
    return json_({ok: false, error: String(err && err.message || err)});
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function doGet(e) {
  return json_({ok: true, service: 'Aula Interactiva backend', version: '2'});
}
