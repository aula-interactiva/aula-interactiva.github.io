/**
 * Aula Interactiva — backend Google Apps Script
 *
 * Desplegament recomanat:
 *   Executa com: Jo
 *   Qui hi té accés: Qualsevol
 */

const SPREADSHEET_ID = '1EEpkuCvVn-VBsLdfcz1L8QCs5pmxOhkDfGXyRyixhW4';

const SHEETS = Object.freeze({
  students: 'Alumnes',
  submissions: 'Entregues',
  corrections: 'Correccions',
  activity: 'Activitat',
  practiceGrades: 'Notes_Practiques',
  pdfUploads: 'PDF_Entregues'
});

const TOKEN_TTL_SECONDS = 21600; // 6 hores
const PDF_ROOT_FOLDER_ID = '19kL-nxDJxMDj8IF2t7dwyFsN_bdT5j0t';
const MAX_PDF_BYTES = 10 * 1024 * 1024;

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const action = String(p.action || '').trim();
    let result;

    if (action === 'login') {
      result = login_(p.code);
    } else if (action === 'notes') {
      result = notes_(p.token, p.code);
    } else if (action === 'submission-status') {
      result = submissionStatus_(p.code, p.submissionId);
    } else if (action === 'pdf-status') {
      result = pdfStatus_(p.code, p.submissionId);
    } else if (action === 'ping') {
      result = {ok: true, serverTime: new Date().toISOString()};
    } else {
      result = {ok: false, error: 'unknown-action'};
    }

    return jsonp_(p.callback, result);
  } catch (err) {
    return jsonp_(e && e.parameter && e.parameter.callback, {
      ok: false,
      error: 'server-error',
      message: String(err && err.message || err)
    });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    const raw = e && e.parameter && e.parameter.payload;
    if (!raw) return json_({ok: false, error: 'missing-payload'});

    const payload = JSON.parse(raw);
    return json_(savePayload_(payload));
  } catch (err) {
    return json_({
      ok: false,
      error: 'server-error',
      message: String(err && err.message || err)
    });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function savePayload_(payload) {
  if (!payload || typeof payload !== 'object') {
    return {ok: false, error: 'invalid-payload'};
  }

  const id = normalizeId_(payload.id);
  if (!/^\d{6}$/.test(id)) return {ok: false, error: 'invalid-id'};

  const student = findStudent_(id);
  if (!student || !student.active) return {ok: false, error: 'unknown-student'};

  const status = String(payload.status || '').trim();

  // L'alumne de prova serveix per validar la web però no ha de generar registres.
  if (String(payload.id || '').trim() === '142858') {
    return {ok: true, skipped: true, test: true};
  }
  const submissionId = String(payload.submissionId || '').trim();
  if (!submissionId) return {ok: false, error: 'missing-submission-id'};

  // La telemetria va EXCLUSIVAMENT a Activitat.
  if (status === 'Activitat') {
    appendActivity_(payload, student);
    return {ok: true, type: 'activity'};
  }

  if (status === 'Fitxer') {
    return savePdf_(payload, student);
  }

  if (status !== 'Entregada') {
    return {ok: false, error: 'unsupported-status'};
  }

  // L'entrega final va EXCLUSIVAMENT a Entregues.
  // L'ID final és determinista: evita duplicats si es reintenta l'enviament.
  if (submissionExists_(submissionId)) {
    return {ok: true, duplicate: true, submissionId};
  }

  appendSubmission_(payload);

  const justifications = Array.isArray(payload.justifications)
    ? payload.justifications
    : [];

  justifications.forEach(j => appendCorrection_(payload, j));

  return {
    ok: true,
    type: 'submission',
    submissionId,
    corrections: justifications.length
  };
}

function submissionStatus_(code, submissionId) {
  const id = normalizeId_(code);
  const sid = String(submissionId || '').trim();
  if (!/^\d{6}$/.test(id) || !sid) return {ok: false, error: 'invalid-request'};

  const student = findStudent_(id);
  if (!student || !student.active) return {ok: false, error: 'unauthorized'};

  const sh = sheet_(SHEETS.submissions);
  const headers = headers_(sh);
  const idCol = headers.indexOf('ID');
  const sidCol = headers.indexOf('ID entrega');
  if (idCol < 0 || sidCol < 0 || sh.getLastRow() < 2) {
    return {ok: true, submitted: false, submissionId: sid};
  }

  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getDisplayValues();
  const submitted = rows.some(r =>
    normalizeId_(r[idCol]) === id && String(r[sidCol] || '').trim() === sid
  );

  return {ok: true, submitted, submissionId: sid};
}

function pdfStatus_(code, submissionId) {
  const id = normalizeId_(code);
  const sid = String(submissionId || '').trim();
  if (!/^\d{6}$/.test(id) || !sid) return {ok: false, error: 'invalid-request'};

  const student = findStudent_(id);
  if (!student || !student.active) return {ok: false, error: 'unauthorized'};

  const sh = sheet_(SHEETS.pdfUploads);
  const headers = headers_(sh);
  const idCol = headers.indexOf('ID');
  const sidCol = headers.indexOf('ID entrega');
  if (idCol < 0 || sidCol < 0 || sh.getLastRow() < 2) {
    return {ok: true, uploaded: false, submissionId: sid};
  }

  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getDisplayValues();
  const uploaded = rows.some(r =>
    normalizeId_(r[idCol]) === id && String(r[sidCol] || '').trim() === sid
  );

  return {ok: true, uploaded, submissionId: sid};
}

function savePdf_(p, student) {
  const mimeType = String(p.mimeType || '').toLowerCase();
  if (mimeType !== 'application/pdf') {
    return {ok: false, error: 'pdf-only'};
  }

  const base64 = String(p.fileBase64 || '').replace(/^data:application\/pdf;base64,/, '');
  if (!base64) return {ok: false, error: 'missing-file'};

  let bytes;
  try {
    bytes = Utilities.base64Decode(base64);
  } catch (_) {
    return {ok: false, error: 'invalid-file'};
  }

  if (!bytes || !bytes.length) return {ok: false, error: 'empty-file'};
  if (bytes.length > MAX_PDF_BYTES) return {ok: false, error: 'file-too-large'};

  const root = DriveApp.getFolderById(PDF_ROOT_FOLDER_ID);
  const areaFolder = getOrCreateFolder_(root, safeFilePart_(p.area || 'General'));
  const practiceFolder = getOrCreateFolder_(areaFolder, safeFilePart_(p.practice || 'Pràctica'));

  const filename =
    normalizeId_(p.id) + '_' +
    safeFilePart_(student.name || 'Alumne') + '_' +
    safeFilePart_(p.practice || 'Pràctica') + '.pdf';

  // Manté una sola versió activa per alumne i pràctica.
  const oldFiles = practiceFolder.getFilesByName(filename);
  while (oldFiles.hasNext()) {
    oldFiles.next().setTrashed(true);
  }

  const blob = Utilities.newBlob(bytes, 'application/pdf', filename);
  const file = practiceFolder.createFile(blob);

  appendByHeaders_(SHEETS.pdfUploads, {
    'Data/hora': new Date(),
    'ID': idNumber_(p.id),
    'Nom': student.name,
    'Àrea': clean_(p.area),
    'Pràctica': clean_(p.practice),
    'Fitxer': filename,
    'URL': file.getUrl(),
    'ID fitxer': file.getId(),
    'Mida bytes': bytes.length,
    'ID entrega': clean_(p.submissionId)
  });

  return {
    ok: true,
    type: 'pdf',
    fileId: file.getId(),
    url: file.getUrl(),
    name: filename
  };
}

function getOrCreateFolder_(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}

function safeFilePart_(value) {
  return String(value == null ? '' : value)
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Sense nom';
}

function appendSubmission_(p) {
  appendByHeaders_(SHEETS.submissions, {
    'Data/hora': new Date(),
    'ID': idNumber_(p.id),
    'Pràctica': clean_(p.practice),
    'Àrea': clean_(p.area),
    'Estat': 'Entregada',
    'Preguntes totals': numberOrBlank_(p.total),
    'Correctes': numberOrBlank_(p.correct),
    'Intents totals': numberOrBlank_(p.attempts),
    'Progrés %': numberOrBlank_(p.progress),
    'Temps (min)': numberOrBlank_(p.minutes),
    'Versió': clean_(p.version),
    'Detall JSON': safeJson_(p.detail || {}),
    'ID entrega': clean_(p.submissionId)
  });
}

function appendActivity_(p, student) {
  appendByHeaders_(SHEETS.activity, {
    'Data/hora': new Date(),
    'ID': idNumber_(p.id),
    'Nom': student.name,
    'Pràctica': clean_(p.practice),
    'Àrea': clean_(p.area),
    'Estat': 'Activitat',
    'Preguntes totals': numberOrBlank_(p.total),
    'Correctes': numberOrBlank_(p.correct),
    'Intents totals': numberOrBlank_(p.attempts),
    'Progrés %': numberOrBlank_(p.progress),
    'Temps (min)': numberOrBlank_(p.minutes),
    'Versió': clean_(p.version),
    'Detall JSON': safeJson_(p.detail || {}),
    'ID entrega': clean_(p.submissionId)
  });
}

function appendCorrection_(p, justification) {
  appendByHeaders_(SHEETS.corrections, {
    'Data/hora': new Date(),
    'ID': idNumber_(p.id),
    'Pràctica': clean_(p.practice),
    'Pregunta': clean_(justification && justification.question),
    'Justificació alumne': clean_(justification && justification.text),
    'ID entrega': clean_(p.submissionId)
  });
}

function submissionExists_(submissionId) {
  const sh = sheet_(SHEETS.submissions);
  const headers = headers_(sh);
  const idx = headers.indexOf('ID entrega');

  if (idx < 0 || sh.getLastRow() < 2) return false;

  return sh
    .getRange(2, idx + 1, sh.getLastRow() - 1, 1)
    .getDisplayValues()
    .flat()
    .includes(String(submissionId));
}

function login_(code) {
  const id = normalizeId_(code);
  if (!/^\d{6}$/.test(id)) return {ok: false, error: 'unauthorized'};

  const student = findStudent_(id);
  if (!student || !student.active) return {ok: false, error: 'unauthorized'};

  const token =
    Utilities.getUuid().replace(/-/g, '') +
    Utilities.getUuid().replace(/-/g, '');

  CacheService.getScriptCache().put(
    'auth:' + token,
    JSON.stringify({id: student.id, role: student.role}),
    TOKEN_TTL_SECONDS
  );

  return {
    ok: true,
    token,
    role: student.role,
    id: student.id
  };
}

function notes_(token, code) {
  let auth = null;

  const id = normalizeId_(code);
  if (/^\d{6}$/.test(id)) {
    const student = findStudent_(id);
    if (student && student.active) {
      auth = {id: student.id, role: student.role};
    }
  }

  // Compatibilitat amb tokens emesos per versions anteriors del portal.
  if (!auth) auth = authFromToken_(token);
  if (!auth) return {ok: false, error: 'unauthorized'};

  const sh = sheet_(SHEETS.practiceGrades);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return {ok: true, notes: []};

  // A Àrea | B Pràctica ID | C Pràctica | D Alumne | E ID alumne | F Nota
  const rows = sh.getRange(2, 1, lastRow - 1, 6).getDisplayValues();
  const teacher = auth.role === 'teacher';

  const notes = rows
    .filter(r => r.some(v => String(v).trim() !== ''))
    .filter(r => teacher || normalizeId_(r[4]) === auth.id)
    .map(r => ({
      area: String(r[0] || ''),
      practiceId: String(r[1] || ''),
      practice: String(r[2] || ''),
      student: String(r[3] || ''),
      studentId: normalizeId_(r[4]),
      grade: String(r[5] || '')
    }));

  return {ok: true, notes};
}

function authFromToken_(token) {
  token = String(token || '').trim();
  if (!token) return null;

  const raw = CacheService.getScriptCache().get('auth:' + token);
  if (!raw) return null;

  try {
    const auth = JSON.parse(raw);
    if (!auth || !/^\d{6}$/.test(String(auth.id || ''))) return null;
    return auth;
  } catch (_) {
    return null;
  }
}

function findStudent_(id) {
  id = normalizeId_(id);

  const sh = sheet_(SHEETS.students);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;

  // A Nom | B ID | C ... | D Actiu | E Rol
  const rows = sh.getRange(2, 1, lastRow - 1, 5).getValues();

  for (const r of rows) {
    if (normalizeId_(r[1]) !== id) continue;

    const active =
      r[3] === true ||
      String(r[3]).toLowerCase() === 'true' ||
      String(r[3]).toLowerCase() === 'sí' ||
      String(r[3]).toLowerCase() === 'si' ||
      String(r[3]) === '1';

    const roleRaw = String(r[4] || 'student').trim().toLowerCase();
    const role = roleRaw === 'teacher' ? 'teacher' : 'student';

    return {
      id,
      name: String(r[0] || '').trim(),
      active,
      role
    };
  }

  return null;
}

function appendByHeaders_(sheetName, valuesByHeader) {
  const sh = sheet_(sheetName);
  const headers = headers_(sh);

  if (!headers.length) throw new Error('No headers in ' + sheetName);

  const row = headers.map(header =>
    Object.prototype.hasOwnProperty.call(valuesByHeader, header)
      ? valuesByHeader[header]
      : ''
  );

  sh.appendRow(row);
}

function headers_(sh) {
  const lastCol = sh.getLastColumn();
  if (!lastCol) return [];

  return sh
    .getRange(1, 1, 1, lastCol)
    .getDisplayValues()[0]
    .map(v => String(v || '').trim());
}

function sheet_(name) {
  const sh = SpreadsheetApp
    .openById(SPREADSHEET_ID)
    .getSheetByName(name);

  if (!sh) throw new Error('Missing sheet: ' + name);
  return sh;
}

function normalizeId_(value) {
  return String(value == null ? '' : value)
    .replace(/\D/g, '')
    .slice(0, 6);
}

function idNumber_(value) {
  const id = normalizeId_(value);
  return /^\d{6}$/.test(id) ? Number(id) : '';
}

function clean_(value) {
  return value == null ? '' : String(value);
}

function numberOrBlank_(value) {
  if (value === '' || value == null) return '';
  const n = Number(value);
  return Number.isFinite(n) ? n : '';
}

function safeJson_(value) {
  try {
    return JSON.stringify(value == null ? {} : value);
  } catch (_) {
    return '{}';
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonp_(callback, obj) {
  const cb = String(callback || '').trim();

  if (!/^[A-Za-z_$][0-9A-Za-z_$]*$/.test(cb)) {
    return json_(obj);
  }

  return ContentService
    .createTextOutput(cb + '(' + JSON.stringify(obj) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
