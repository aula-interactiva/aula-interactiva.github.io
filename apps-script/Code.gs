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
  pdfUploads: 'PDF_Entregues',
  messages: 'Missatges',
  messageReads: 'Missatges_Llegits'
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
    } else if (action === 'messages') {
      result = messages_(p.token, p.code);
    } else if (action === 'message-status') {
      result = messageStatus_(p.code, p.messageId);
    } else if (action === 'operation-status') {
      result = operationStatus_(p.token, p.code, p.kind, p.operationId);
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

  const auth = authFromRequest_(payload.token, payload.id);
  if (!auth) return {ok: false, error: 'unauthorized'};

  const student = findStudent_(auth.id);
  if (!student || !student.active || student.role !== auth.role) {
    return {ok: false, error: 'unauthorized'};
  }

  // La identitat efectiva sempre la decideix el servidor, mai el navegador.
  payload.id = student.id;

  const status = String(payload.status || '').trim();

  // Missatgeria: va separada del sistema d'entregues i activitat.
  if (status === 'MissatgeEnviar') {
    return sendMessage_(payload, student);
  }
  if (status === 'MissatgeLlegit') {
    return markMessageRead_(payload, student);
  }

  // L'alumne de prova serveix per validar la web però no ha de generar registres de pràctiques.
  if (student.id === '142858') {
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
  const result = operationStatus_('', code, 'submission', submissionId);
  return result.ok
    ? {ok: true, submitted: result.exists === true, submissionId: result.operationId}
    : result;
}

function pdfStatus_(code, submissionId) {
  const result = operationStatus_('', code, 'pdf', submissionId);
  return result.ok
    ? {ok: true, uploaded: result.exists === true, submissionId: result.operationId}
    : result;
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
  const auth = authFromRequest_(token, code);
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

function messages_(token, code) {
  const auth = authFromRequest_(token, code);
  if (!auth) return {ok: false, error: 'unauthorized'};

  const sh = sheet_(SHEETS.messages);
  const headers = headers_(sh);
  const rows = sh.getLastRow() < 2
    ? []
    : sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getDisplayValues();

  const idx = {
    date: headers.indexOf('Data/hora'),
    messageId: headers.indexOf('ID missatge'),
    recipient: headers.indexOf('Destinatari'),
    recipientName: headers.indexOf('Nom destinatari'),
    message: headers.indexOf('Missatge'),
    active: headers.indexOf('Actiu')
  };

  if (Object.values(idx).some(v => v < 0)) {
    return {ok: false, error: 'messages-schema'};
  }

  const activeRows = rows.filter(r => {
    const raw = String(r[idx.active] || '').trim().toLowerCase();
    return raw === '' || raw === 'true' || raw === 'sí' || raw === 'si' || raw === '1';
  });

  if (auth.role === 'teacher') {
    const studentsSheet = sheet_(SHEETS.students);
    const studentRows = studentsSheet.getLastRow() < 2
      ? []
      : studentsSheet.getRange(2, 1, studentsSheet.getLastRow() - 1, 5).getValues();

    const recipients = studentRows
      .map(r => {
        const studentId = normalizeId_(r[1]);
        const roleRaw = String(r[4] || 'student').trim().toLowerCase();
        const active =
          r[3] === true ||
          String(r[3]).toLowerCase() === 'true' ||
          String(r[3]).toLowerCase() === 'sí' ||
          String(r[3]).toLowerCase() === 'si' ||
          String(r[3]) === '1';

        return {
          id: studentId,
          name: String(r[0] || '').trim(),
          active,
          role: roleRaw
        };
      })
      .filter(s => s.active && s.role === 'student' && /^\d{6}$/.test(s.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'ca'));

    const messages = activeRows
      .slice()
      .reverse()
      .slice(0, 100)
      .map(r => ({
        date: String(r[idx.date] || ''),
        id: String(r[idx.messageId] || ''),
        recipient: String(r[idx.recipient] || ''),
        recipientName: String(r[idx.recipientName] || ''),
        message: String(r[idx.message] || '')
      }));

    return {ok: true, role: 'teacher', recipients, messages};
  }

  const readIds = messageReadIds_(auth.id);
  const messages = activeRows
    .filter(r => {
      const recipient = String(r[idx.recipient] || '').trim();
      return recipient === 'TOTS' || normalizeId_(recipient) === auth.id;
    })
    .slice()
    .reverse()
    .map(r => {
      const messageId = String(r[idx.messageId] || '');
      return {
        date: String(r[idx.date] || ''),
        id: messageId,
        message: String(r[idx.message] || ''),
        read: readIds.has(messageId)
      };
    });

  return {
    ok: true,
    role: 'student',
    unreadCount: messages.filter(m => !m.read).length,
    messages
  };
}

function sendMessage_(payload, student) {
  if (!student || student.role !== 'teacher') {
    return {ok: false, error: 'unauthorized'};
  }

  const messageId = String(payload.messageId || '').trim();
  const recipientRaw = String(payload.recipient || '').trim();
  const message = String(payload.message || '').trim();

  if (!messageId || messageId.length > 160) {
    return {ok: false, error: 'invalid-message-id'};
  }
  if (!message || message.length > 2000) {
    return {ok: false, error: 'invalid-message'};
  }

  let recipient = recipientRaw;
  let recipientName = 'Tots els alumnes';

  if (recipientRaw !== 'TOTS') {
    recipient = normalizeId_(recipientRaw);
    if (!/^\d{6}$/.test(recipient)) {
      return {ok: false, error: 'invalid-recipient'};
    }

    const target = findStudent_(recipient);
    if (!target || !target.active || target.role !== 'student') {
      return {ok: false, error: 'invalid-recipient'};
    }
    recipientName = target.name;
  }

  if (messageExists_(messageId)) {
    return {ok: true, duplicate: true, messageId};
  }

  appendByHeaders_(SHEETS.messages, {
    'Data/hora': new Date(),
    'ID missatge': messageId,
    'Destinatari': recipient,
    'Nom destinatari': recipientName,
    'Missatge': message,
    'Actiu': true
  });

  return {ok: true, messageId};
}

function messageStatus_(code, messageId) {
  const result = operationStatus_('', code, 'message', messageId);
  return result.ok
    ? {ok: true, exists: result.exists === true, messageId: result.operationId}
    : result;
}

function authFromRequest_(token, code) {
  const tokenAuth = authFromToken_(token);
  if (tokenAuth) return tokenAuth;

  // Compatibilitat temporal durant la migració al token.
  const id = normalizeId_(code);
  if (!/^\d{6}$/.test(id)) return null;

  const user = findStudent_(id);
  if (!user || !user.active) return null;
  return {id: user.id, role: user.role};
}

function operationStatus_(token, code, kind, operationId) {
  const auth = authFromRequest_(token, code);
  if (!auth) return {ok: false, error: 'unauthorized'};

  const type = String(kind || '').trim().toLowerCase();
  const oid = String(operationId || '').trim();
  if (!oid) return {ok: false, error: 'invalid-operation-id'};

  let exists = false;

  if (type === 'submission') {
    if (auth.role !== 'student') return {ok: false, error: 'unauthorized'};
    exists = submissionExistsForStudent_(auth.id, oid);
  } else if (type === 'pdf') {
    if (auth.role !== 'student') return {ok: false, error: 'unauthorized'};
    exists = pdfExistsForStudent_(auth.id, oid);
  } else if (type === 'message') {
    if (auth.role !== 'teacher') return {ok: false, error: 'unauthorized'};
    exists = messageExists_(oid);
  } else if (type === 'message-read') {
    if (auth.role !== 'student') return {ok: false, error: 'unauthorized'};
    exists = messageReadExists_(auth.id, oid);
  } else {
    return {ok: false, error: 'unknown-operation-kind'};
  }

  return {
    ok: true,
    exists,
    kind: type,
    operationId: oid
  };
}

function submissionExistsForStudent_(studentId, submissionId) {
  const sh = sheet_(SHEETS.submissions);
  const headers = headers_(sh);
  const idCol = headers.indexOf('ID');
  const sidCol = headers.indexOf('ID entrega');

  if (idCol < 0 || sidCol < 0 || sh.getLastRow() < 2) return false;

  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getDisplayValues();
  return rows.some(r =>
    normalizeId_(r[idCol]) === normalizeId_(studentId) &&
    String(r[sidCol] || '').trim() === String(submissionId || '').trim()
  );
}

function pdfExistsForStudent_(studentId, submissionId) {
  const sh = sheet_(SHEETS.pdfUploads);
  const headers = headers_(sh);
  const idCol = headers.indexOf('ID');
  const sidCol = headers.indexOf('ID entrega');

  if (idCol < 0 || sidCol < 0 || sh.getLastRow() < 2) return false;

  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getDisplayValues();
  return rows.some(r =>
    normalizeId_(r[idCol]) === normalizeId_(studentId) &&
    String(r[sidCol] || '').trim() === String(submissionId || '').trim()
  );
}

function messageReadExists_(studentId, messageId) {
  const sh = sheet_(SHEETS.messageReads);
  const headers = headers_(sh);
  const midCol = headers.indexOf('ID missatge');
  const idCol = headers.indexOf('ID alumne');

  if (midCol < 0 || idCol < 0 || sh.getLastRow() < 2) return false;

  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getDisplayValues();
  return rows.some(r =>
    String(r[midCol] || '').trim() === String(messageId || '').trim() &&
    normalizeId_(r[idCol]) === normalizeId_(studentId)
  );
}

function markMessageRead_(payload, student) {
  if (!student || student.role !== 'student') {
    return {ok: false, error: 'unauthorized'};
  }

  const messageId = String(payload.messageId || '').trim();
  if (!messageId) return {ok: false, error: 'invalid-message-id'};
  if (!studentCanReadMessage_(student.id, messageId)) {
    return {ok: false, error: 'message-not-found'};
  }

  const sh = sheet_(SHEETS.messageReads);
  const headers = headers_(sh);
  const midCol = headers.indexOf('ID missatge');
  const idCol = headers.indexOf('ID alumne');

  if (midCol < 0 || idCol < 0) {
    return {ok: false, error: 'message-reads-schema'};
  }

  if (sh.getLastRow() >= 2) {
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getDisplayValues();
    const exists = rows.some(r =>
      String(r[midCol] || '').trim() === messageId &&
      normalizeId_(r[idCol]) === student.id
    );
    if (exists) return {ok: true, duplicate: true, messageId};
  }

  appendByHeaders_(SHEETS.messageReads, {
    'Data/hora': new Date(),
    'ID missatge': messageId,
    'ID alumne': idNumber_(student.id)
  });

  return {ok: true, messageId};
}

function messageReadIds_(studentId) {
  const sh = sheet_(SHEETS.messageReads);
  const headers = headers_(sh);
  const midCol = headers.indexOf('ID missatge');
  const idCol = headers.indexOf('ID alumne');
  const result = new Set();

  if (midCol < 0 || idCol < 0 || sh.getLastRow() < 2) return result;

  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getDisplayValues();
  rows.forEach(r => {
    if (normalizeId_(r[idCol]) === normalizeId_(studentId)) {
      const mid = String(r[midCol] || '').trim();
      if (mid) result.add(mid);
    }
  });

  return result;
}

function messageExists_(messageId) {
  const sh = sheet_(SHEETS.messages);
  const headers = headers_(sh);
  const idx = headers.indexOf('ID missatge');
  if (idx < 0 || sh.getLastRow() < 2) return false;

  return sh
    .getRange(2, idx + 1, sh.getLastRow() - 1, 1)
    .getDisplayValues()
    .flat()
    .some(v => String(v || '').trim() === String(messageId || '').trim());
}

function studentCanReadMessage_(studentId, messageId) {
  const sh = sheet_(SHEETS.messages);
  const headers = headers_(sh);
  const midCol = headers.indexOf('ID missatge');
  const recipientCol = headers.indexOf('Destinatari');
  const activeCol = headers.indexOf('Actiu');

  if (midCol < 0 || recipientCol < 0 || activeCol < 0 || sh.getLastRow() < 2) {
    return false;
  }

  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getDisplayValues();

  return rows.some(r => {
    if (String(r[midCol] || '').trim() !== String(messageId || '').trim()) return false;

    const activeRaw = String(r[activeCol] || '').trim().toLowerCase();
    const active = activeRaw === '' || activeRaw === 'true' || activeRaw === 'sí' || activeRaw === 'si' || activeRaw === '1';
    if (!active) return false;

    const recipient = String(r[recipientCol] || '').trim();
    return recipient === 'TOTS' || normalizeId_(recipient) === normalizeId_(studentId);
  });
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
