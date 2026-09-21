(() => {
  'use strict';

  if (window.PracticeTracker?.version === 'v5') return;

  const ENDPOINT = 'https://script.google.com/macros/s/AKfycbzwnq5YjykYa80K1RtK6aTWyc5iLqQJD0KEAcPvhHEKOE-pHxGKj_be-bXfCqs7R8R_/exec';
  const SESSION_KEY = 'aula-interactiva-session-v4';
  const LEGACY_SESSION_KEYS = ['aula-interactiva-session-v3', 'aula-interactiva-session-v2'];
  const AUTH_URL = '/student-auth.json?v=1';
  const LOCAL_SUBMISSION_PREFIX = 'aula-interactiva-submitted-v1:';
  let authConfigPromise = null;
  let jsonpSeq = 0;
  let practiceStartedAt = Date.now();
  let leaveLogged = false;
  let serverTimeOffsetMs = 0;
  let practiceClosesAt = null;
  let accessTimer = null;

  function normalizeId(value) {
    return String(value ?? '').replace(/\D/g, '').slice(0, 6);
  }

  function fnv1a(text) {
    let h = 2166136261;
    for (const ch of String(text)) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function isTeacherCode(id) {
    return fnv1a('aula-teacher-v3:' + String(id)) === 2813788514;
  }

  function bytesFromBase64(value) {
    const raw = atob(String(value || ''));
    return Uint8Array.from(raw, ch => ch.charCodeAt(0));
  }

  function textFromBytes(bytes) {
    return new TextDecoder().decode(bytes);
  }

  function equalBytes(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  async function loadAuthConfig() {
    if (!authConfigPromise) {
      authConfigPromise = fetch(AUTH_URL, {cache: 'no-store'})
        .then(response => {
          if (!response.ok) throw new Error('No s’ha pogut carregar el registre local');
          return response.json();
        })
        .then(config => {
          if (!config?.kdf?.salt || !Array.isArray(config.entries)) throw new Error('Registre local no vàlid');
          return config;
        })
        .catch(error => {
          authConfigPromise = null;
          throw error;
        });
    }
    return authConfigPromise;
  }

  async function localStudentIdentity(id) {
    if (!window.crypto?.subtle) return null;

    const config = await loadAuthConfig();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(String(id)),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const bits = new Uint8Array(await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      hash: config.kdf.hash || 'SHA-256',
      salt: bytesFromBase64(config.kdf.salt),
      iterations: Number(config.kdf.iterations) || 450000
    }, keyMaterial, 512));

    const verifier = bits.slice(0, 32);
    const aesBytes = bits.slice(32);
    const entry = config.entries.find(item => equalBytes(verifier, bytesFromBase64(item.v)));
    if (!entry) return null;

    const aesKey = await crypto.subtle.importKey('raw', aesBytes, 'AES-GCM', false, ['decrypt']);
    const clear = await crypto.subtle.decrypt(
      {name: 'AES-GCM', iv: bytesFromBase64(entry.iv)},
      aesKey,
      bytesFromBase64(entry.n)
    );
    const firstName = textFromBytes(new Uint8Array(clear)).trim();
    return firstName ? {id, role: 'student', firstName} : null;
  }

  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (!session || !/^\d{6}$/.test(String(session.id || ''))) return null;
      if (!['student', 'teacher'].includes(session.role)) return null;
      if (session.role === 'student' && !String(session.firstName || '').trim()) return null;
      return session;
    } catch (_) {
      return null;
    }
  }

  function saveSession(id, role, firstName = '') {
    const session = {
      id: normalizeId(id),
      role,
      firstName: role === 'student' ? String(firstName || '').trim() : '',
      loggedAt: Date.now()
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    LEGACY_SESSION_KEYS.forEach(key => sessionStorage.removeItem(key));
    return session;
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    LEGACY_SESSION_KEYS.forEach(key => sessionStorage.removeItem(key));
  }

  function jsonp(params, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const callback = `__practiceTrackerCb${Date.now()}_${jsonpSeq++}`;
      const script = document.createElement('script');
      const timer = setTimeout(() => cleanup(new Error('Temps d’espera exhaurit')), timeoutMs);

      function cleanup(err, data) {
        clearTimeout(timer);
        try { delete window[callback]; } catch (_) { window[callback] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
        err ? reject(err) : resolve(data);
      }

      window[callback] = data => cleanup(null, data);
      const url = new URL(ENDPOINT);
      Object.entries({...params, callback}).forEach(([k, v]) => url.searchParams.set(k, String(v)));
      script.onerror = () => cleanup(new Error('No s’ha pogut contactar amb el registre'));
      script.src = url.toString();
      document.head.appendChild(script);
    });
  }

  async function validateId(value) {
    const id = normalizeId(value);
    if (!/^\d{6}$/.test(id)) return {ok: false, id, reason: 'format'};

    if (isTeacherCode(id)) {
      return {ok: true, id, role: 'teacher', firstName: '', reason: ''};
    }

    try {
      const localIdentity = await localStudentIdentity(id);
      if (localIdentity) {
        return {ok: true, id, role: 'student', firstName: localIdentity.firstName, reason: ''};
      }
      return {ok: false, id, role: '', reason: 'not-found'};
    } catch (error) {
      return {ok: false, id, reason: 'network', error};
    }
  }

  async function login(value) {
    const result = await validateId(value);
    if (!result.ok) return result;
    const session = saveSession(result.id, result.role || 'student', result.firstName || '');
    if (session.role === 'student') {
      logActivity('LOGIN', {practice: 'Portal', area: 'Sistema', title: 'Aula Interactiva'});
    }
    return {...result, session};
  }

  function logout() {
    clearSession();
  }

  function isTeacher() {
    return getSession()?.role === 'teacher';
  }

  function makeSubmissionId(practice, id) {
    const random = (window.crypto && crypto.getRandomValues)
      ? Array.from(crypto.getRandomValues(new Uint32Array(2))).map(n => n.toString(36)).join('')
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    return `${practice}-${id}-${Date.now()}-${random}`;
  }

  async function confirmSubmission(submissionId, attempts = 7) {
    for (let i = 0; i < attempts; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 700 : 1200));
      try {
        const result = await jsonp({action: 'confirm', submissionId}, 8000);
        if (result && result.ok === true) return true;
      } catch (_) {}
    }
    return false;
  }

  function activityPayload(event, detail = {}) {
    const session = getSession();
    if (!session || session.role !== 'student') return null;

    return {
      submissionId: makeSubmissionId('activity', session.id),
      id: session.id,
      practice: detail.practice || 'Portal',
      area: detail.area || 'Sistema',
      status: 'Activitat',
      total: 0,
      correct: 0,
      attempts: 0,
      progress: Number.isFinite(detail.progress) ? Math.round(detail.progress) : '',
      minutes: Number.isFinite(detail.minutes) ? Math.max(0, Math.round(detail.minutes)) : '',
      version: 'activity-v1',
      detail: {
        event,
        page: detail.page || location.pathname,
        title: detail.title || document.title || '',
        ...(detail.extra || {})
      },
      justifications: []
    };
  }

  async function logActivity(event, detail = {}) {
    const payload = activityPayload(event, detail);
    if (!payload) return {ok: false, skipped: true};
    try {
      await fetch(ENDPOINT, {
        method: 'POST',
        mode: 'no-cors',
        credentials: 'omit',
        cache: 'no-store',
        body: new URLSearchParams({payload: JSON.stringify(payload)})
      });
      return {ok: true};
    } catch (error) {
      return {ok: false, error};
    }
  }

  function logActivityBeacon(event, detail = {}) {
    const payload = activityPayload(event, detail);
    if (!payload) return false;
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        mode: 'no-cors',
        credentials: 'omit',
        cache: 'no-store',
        keepalive: true,
        body: new URLSearchParams({payload: JSON.stringify(payload)})
      }).catch(() => {});
      return true;
    } catch (_) {
      return false;
    }
  }

  function stablePracticeSubmissionId(practicePath, id) {
    const path = normalizeRepoPath(practicePath || location.pathname).toLowerCase();
    const parts = path.split('/').filter(Boolean);
    const filename = parts.pop() || 'practice';
    const slug = filename.replace(/\.html?$/i, '') || 'practice';
    const area = parts.pop() || 'practice';
    const safe = (area + '-' + slug)
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90) || 'practice';
    return `final-${normalizeId(id)}-${safe}`;
  }

  function localSubmissionKey(practicePath, id) {
    return LOCAL_SUBMISSION_PREFIX + normalizeId(id) + ':' +
      normalizeRepoPath(practicePath || location.pathname).toLowerCase();
  }

  function hasLocalSubmission(practicePath, id) {
    try {
      return localStorage.getItem(localSubmissionKey(practicePath, id)) === '1';
    } catch (_) {
      return false;
    }
  }

  function rememberLocalSubmission(practicePath, id) {
    try {
      localStorage.setItem(localSubmissionKey(practicePath, id), '1');
    } catch (_) {}
  }

  async function checkPracticeSubmitted(practice) {
    const session = getSession();
    if (!session || session.role !== 'student') {
      return {ok: true, submitted: false, submissionId: ''};
    }

    const practicePath = practice?.fitxer || location.pathname;
    const submissionId = stablePracticeSubmissionId(practicePath, session.id);

    if (hasLocalSubmission(practicePath, session.id)) {
      return {ok: true, submitted: true, submissionId, source: 'local'};
    }

    try {
      const result = await jsonp({action: 'confirm', submissionId}, 8000);
      const submitted = result?.ok === true;
      if (submitted) rememberLocalSubmission(practicePath, session.id);
      return {ok: true, submitted, submissionId, source: 'server'};
    } catch (error) {
      return {ok: false, submitted: false, submissionId, error};
    }
  }

  async function submit(payload) {
    const session = getSession();
    if (session?.role === 'teacher') {
      return {ok: true, skipped: true, teacher: true};
    }

    const practiceKey = normalizeRepoPath(location.pathname);
    payload.practiceKey = practiceKey;
    payload.submissionId = stablePracticeSubmissionId(practiceKey, session.id);
    payload.detail = {...(payload.detail || {}), _practiceKey: practiceKey};

    const body = new URLSearchParams({payload: JSON.stringify(payload)});
    try {
      await fetch(ENDPOINT, {
        method: 'POST',
        mode: 'no-cors',
        credentials: 'omit',
        cache: 'no-store',
        body
      });
    } catch (error) {
      return {ok: false, error};
    }
    const confirmed = await confirmSubmission(payload.submissionId, 4);
    rememberLocalSubmission(practiceKey, session.id);
    return {ok: true, confirmed};
  }

  function practiceMeta() {
    const path = location.pathname.toLowerCase();
    const area = path.includes('/economia/') ? 'Economia' : path.includes('/estadistica/') ? 'Estadística' : 'Sistema';
    return {
      area,
      title: document.title || 'Pràctica',
      practice: document.title || 'Pràctica'
    };
  }

  function estimateProgress() {
    const fill = document.querySelector('#progress-fill, #progressfill');
    if (fill) {
      const n = parseFloat(fill.style.width || '');
      if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
    }

    const checks = Array.from(document.querySelectorAll('.q-check'));
    if (checks.length) {
      const done = checks.filter(x => x.classList.contains('correct')).length;
      return done / checks.length * 100;
    }

    const stages = Array.from(document.querySelectorAll('.stage'));
    if (stages.length) {
      const done = stages.filter(x => x.classList.contains('done')).length;
      return done / stages.length * 100;
    }

    const controls = Array.from(document.querySelectorAll('input,select,textarea'))
      .filter(x => !/student-id|login-id/.test(x.id || '') && x.type !== 'file');
    if (controls.length) {
      const done = controls.filter(x => String(x.value || '').trim()).length;
      return done / controls.length * 100;
    }

    return NaN;
  }

  function redirectToPortal() {
    const next = location.pathname + location.search;
    location.replace('../../index.html?next=' + encodeURIComponent(next));
  }

  function findLegacyIdControls() {
    const pairs = [
      ['student-id', 'validate-id'],
      ['student-id', 'market-validate-id'],
      ['ppc-student-id', 'ppc-validate-id'],
      ['supply-student-id', 'supply-validate-id'],
      ['demand-student-id', 'demand-validate-id'],
      ['elas-student-id', 'elas-validate-id']
    ];

    for (const [inputId, buttonId] of pairs) {
      const input = document.getElementById(inputId);
      const button = document.getElementById(buttonId);
      if (input && button) return {input, button};
    }
    return null;
  }

  function hydrateLegacyId(session) {
    const controls = findLegacyIdControls();
    if (!controls) return;
    const {input, button} = controls;
    const teacher = session.role === 'teacher';
    const displayName = teacher ? 'Professor' : (String(session.firstName || '').trim() || 'Alumne');
    const wrap = input.closest('label');

    input.value = session.id;
    input.readOnly = true;
    input.style.visibility = 'hidden';
    input.setAttribute('aria-hidden', 'true');
    button.style.visibility = 'hidden';
    document.querySelectorAll('#id-status,.idstatus').forEach(el => { el.hidden = true; });
    if (wrap?.firstChild) wrap.firstChild.textContent = displayName + ' ';

    setTimeout(() => {
      button.click();
      setTimeout(() => {
        input.readOnly = true;
        input.hidden = true;
        input.style.visibility = '';
        button.hidden = true;
        button.style.visibility = '';
        document.querySelectorAll('#id-status,.idstatus').forEach(el => { el.hidden = true; });
      }, 120);
    }, 40);
  }

  function normalizeRepoPath(value) {
    return String(value || '')
      .split('?')[0]
      .split('#')[0]
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
  }

  function parseAccessTime(value) {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }

  function currentAccessTime() {
    return Date.now() + serverTimeOffsetMs;
  }

  function accessState(practice, nowMs = currentAccessTime()) {
    if (!practice || practice.disponible !== true) {
      return {open: false, reason: 'unavailable', opensAt: null, closesAt: null};
    }

    const opensAt = parseAccessTime(practice.obertura);
    const closesAt = parseAccessTime(practice.tancament);

    if (opensAt !== null && nowMs < opensAt) {
      return {open: false, reason: 'not-open-yet', opensAt, closesAt};
    }
    if (closesAt !== null && nowMs >= closesAt) {
      return {open: false, reason: 'closed', opensAt, closesAt};
    }
    return {open: true, reason: '', opensAt, closesAt};
  }

  function formatAccessDate(ms) {
    if (!Number.isFinite(ms)) return '';
    return new Intl.DateTimeFormat('ca-ES', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Europe/Madrid'
    }).format(new Date(ms));
  }

  function showBlockedPractice(reason, whenMs = null) {
    if (accessTimer) {
      clearInterval(accessTimer);
      accessTimer = null;
    }

    const heading = reason === 'not-open-yet'
      ? 'Aquesta pràctica encara no està oberta'
      : reason === 'closed'
        ? 'Aquesta pràctica està tancada'
        : reason === 'submitted'
          ? 'Aquesta pràctica ja està entregada'
        : reason === 'verification'
          ? 'No s’ha pogut verificar l’accés'
          : 'Aquesta pràctica no està disponible';

    const detail = reason === 'not-open-yet' && whenMs
      ? `S’obrirà el ${formatAccessDate(whenMs)}.`
      : reason === 'closed' && whenMs
        ? `L’accés es va tancar el ${formatAccessDate(whenMs)}.`
        : reason === 'submitted'
          ? 'Ja has entregat aquesta pràctica. No es pot tornar a modificar ni tornar a entregar.'
        : reason === 'verification'
          ? 'Torna al portal i prova-ho de nou.'
          : 'Consulta el portal de l’assignatura per veure les pràctiques disponibles.';

    document.title = heading;
    document.body.innerHTML = `
      <main style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#f4f1eb;color:#202427;font-family:Inter,Segoe UI,Arial,sans-serif">
        <section style="width:min(560px,100%);background:#fbfaf7;border:1px solid #d8d4cc;border-radius:16px;padding:30px;box-shadow:0 12px 32px rgba(38,40,42,.08)">
          <div style="font-size:11px;letter-spacing:.09em;text-transform:uppercase;font-weight:800;color:#6f7478">Aula Interactiva</div>
          <h1 style="font-size:25px;line-height:1.15;margin:10px 0 10px">${heading}</h1>
          <p style="font-size:14px;line-height:1.55;color:#5b6065;margin:0 0 22px">${detail}</p>
          <a href="../../index.html" style="display:inline-block;background:#44484c;color:#fff;text-decoration:none;border-radius:9px;padding:10px 14px;font-weight:750;font-size:13px">Tornar al portal</a>
        </section>
      </main>`;
  }

  async function loadPracticeAccess() {
    try {
      const response = await fetch('../../practiques.json', {cache: 'no-store'});
      if (!response.ok) throw new Error('config');

      const serverDate = response.headers.get('Date');
      if (serverDate) {
        const serverMs = Date.parse(serverDate);
        if (Number.isFinite(serverMs)) serverTimeOffsetMs = serverMs - Date.now();
      }

      const config = await response.json();
      const current = normalizeRepoPath(location.pathname);
      const areas = Object.values(config?.arees || {});

      for (const area of areas) {
        const found = (area?.practiques || []).find(p => {
          const target = normalizeRepoPath(p.fitxer);
          return target && (current === target || current.endsWith('/' + target));
        });
        if (found) return found;
      }
      return null;
    } catch (_) {
      return undefined;
    }
  }

  function startPractice(session) {
    hydrateLegacyId(session);
    practiceStartedAt = Date.now();
    leaveLogged = false;
    const meta = practiceMeta();

    logActivity('OPEN_PRACTICE', {
      practice: meta.practice,
      area: meta.area,
      title: meta.title
    });

    window.addEventListener('pagehide', () => {
      if (leaveLogged) return;
      leaveLogged = true;
      logActivityBeacon('LEAVE_PRACTICE', {
        practice: meta.practice,
        area: meta.area,
        title: meta.title,
        minutes: (Date.now() - practiceStartedAt) / 60000,
        progress: estimateProgress()
      });
    }, {once: true});

    if (Number.isFinite(practiceClosesAt)) {
      accessTimer = setInterval(() => {
        if (currentAccessTime() >= practiceClosesAt) {
          if (!leaveLogged) {
            leaveLogged = true;
            logActivityBeacon('LEAVE_PRACTICE', {
              practice: meta.practice,
              area: meta.area,
              title: meta.title,
              minutes: (Date.now() - practiceStartedAt) / 60000,
              progress: estimateProgress(),
              extra: {reason: 'access-closed'}
            });
          }
          showBlockedPractice('closed', practiceClosesAt);
        }
      }, 15000);
    }
  }

  async function guardPractice() {
    if (!location.pathname.includes('/practiques/')) return;

    const session = getSession();
    if (!session) {
      redirectToPortal();
      return;
    }

    if (session.role === 'teacher') {
      startPractice(session);
      return;
    }

    const practice = await loadPracticeAccess();
    if (practice === undefined) {
      showBlockedPractice('verification');
      return;
    }
    if (!practice) {
      showBlockedPractice('unavailable');
      return;
    }

    const state = accessState(practice);
    if (!state.open) {
      showBlockedPractice(
        state.reason,
        state.reason === 'not-open-yet' ? state.opensAt : state.closesAt
      );
      return;
    }

    const submitted = await checkPracticeSubmitted(practice);
    if (submitted.ok && submitted.submitted) {
      showBlockedPractice('submitted');
      return;
    }

    practiceClosesAt = state.closesAt;
    startPractice(session);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', guardPractice);
  } else {
    setTimeout(guardPractice, 0);
  }

  window.PracticeTracker = Object.freeze({
    version: 'v5',
    endpoint: ENDPOINT,
    normalizeId,
    validateId,
    login,
    logout,
    getSession,
    isTeacher,
    makeSubmissionId,
    submit,
    checkPracticeSubmitted,
    stablePracticeSubmissionId,
    logActivity
  });
})();
