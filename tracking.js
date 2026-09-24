(() => {
  'use strict';

  if (window.PracticeTracker?.version === 'v6') return;

  if (!document.querySelector('link[data-aula-theme]')) {
    const theme = document.createElement('link');
    theme.rel = 'stylesheet';
    theme.dataset.aulaTheme = '1';
    theme.href = new URL('theme.css?v=5', document.currentScript?.src || window.location.href).href;
    document.head.appendChild(theme);
  }


  const ENDPOINT = 'https://script.google.com/macros/s/AKfycbxq88klu15RnDmp39XjfwuVhtZ36KrQWm-nbLh_v1aaFL-2tfxwl9HK5H5sKFqXyBzw/exec';
  const SESSION_KEY = 'aula-interactiva-session-v3';
  const STUDENT_CODE_HASHES = new Set([
    "48db4bb79104a07f5f6b31b2108080b7a5f623bba1d31df7b4495ce3dbe8d831",
    "158fe307495a73ba00d2948566bee085914a9186f4455fd14733d6bc9aaa652d",
    "f14bec4b1fb9ec0f53c1afa59d5822dd9b3182c4981efbbc7967504fbc90a874",
    "c860430562a0371a7edfd441c42ae8cff48bbd48640c5f52a650bf8f61e30feb",
    "3750ed2a7a82f760c10ec07482f512870967de3711a949fc90906201d950412a",
    "e4715c4e7730ae01e959862c2fb75ba141f711004c11e392fc8c8d025629ed76",
    "806326232c8129066b24c2e2e8d3bbd9e5ae09badd3d95a23db93f1d0c0f1678",
    "0b1841a0b50461576daaa4cdd32e8f705fb8995eb0d52c3888089a1e35373882",
    "20a7be8746c9d5e57afa3b419c046f46a53de41d0ee896b6a1b7f44e0257b83a",
    "c38c2c129089a762802c251ba6560ae5caeda57e592b4506d3d15cb7625623d3",
    "32f33cf75e59c020419f03cdd267d12e551a2115510eed8ca9ba8a52506050f6",
    "0b894eeaf3c532ecedb245ca30eb15a970bb5f6325a92c01a974cde11ebab1fd",
    "21eaca4fca2af0b0f9e8e84ae57396b45b9bad0a7d59ff975b56c874664fb6bb",
    "878af48e79f6affeb88d34fdcdd544e0574d939b3e0b5e3282e8352fe23cfb65",
    "3830554b4ca09371a6ccd59c5d6c94371028ed249dded5471debbfd681ee9942",
    "7ea0c5f1c1bb56bf959a1b9a76df205c9039a85d2f394c85926b6203bc10e489",
    "24d33f767fac408225261c878829daf800bbe48331bebc2ad5c1bede12d44d1d",
    "0a7a0a7d62ef45c44f411126120f38fe8de9c8153b0cad5ee57a4ffb719727cb",
    "dad3eea75e4692d65d2ea08eb265baa812e7d28fca312b9e3f6b40511adef934",
    "ec80b6e7f0feb7ee6d7afd223f10576da6e052d2bd64be9fe28fd4b14ed4ce5c",
    "9c7d9e9d08a714f65dd8b5167cd85205fad6f321d254c807e742267ed91e4275",
    "2686429e53e8680e1269111aaeb4f87a9aa9a52347e24cb962508e724ea6b7a6",
    "d8d841fc795fd86ab79abc171560c34c8fa693c7201c40bf9afeee6d969fdda7",
    "fd541b0d6a8988cbf136ee1be6a758b3e0e398669663c21772f8eb3702b9fba5",
    "eb9d85092e63d4550914bcb4a2f63d91a833b296a34409d36698f1551f359b1a"
]);
  const LOCAL_SUBMISSION_PREFIX = 'aula-interactiva-submitted-v1:';
  const LOCAL_DRAFT_PREFIX = 'aula-interactiva-draft-v1:';
  let practiceStartedAt = Date.now();
  let leaveLogged = false;
  let serverTimeOffsetMs = 0;
  let practiceClosesAt = null;
  let accessTimer = null;

  // Session tracking: additive only. It does not affect answers, drafts or submissions.
  const ACTIVE_IDLE_MS = 3 * 60 * 1000;
  const ACTIVE_SAMPLE_MS = 5000;
  const SESSION_PULSE_MS = 5 * 60 * 1000;
  let practiceSessionId = '';
  let practiceActiveMs = 0;
  let practiceInitialProgress = null;
  let practiceInitialProgressLocked = false;
  let lastInteractionAt = Date.now();
  let lastActiveTickAt = Date.now();
  let activeSampleTimer = null;
  let sessionPulseTimer = null;

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

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(String(text));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  }

  async function isKnownStudentCode(id) {
    try {
      return STUDENT_CODE_HASHES.has(await sha256Hex('aula-student-v1:' + String(id)));
    } catch (_) {
      return false;
    }
  }

  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (!session || !/^\d{6}$/.test(String(session.id || ''))) return null;
      if (!['student', 'teacher'].includes(session.role)) return null;
      return session;
    } catch (_) {
      return null;
    }
  }

  function saveSession(id, role) {
    const session = {id: normalizeId(id), role, loggedAt: Date.now()};
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  async function validateId(value) {
    const id = normalizeId(value);
    if (!/^\d{6}$/.test(id)) return {ok: false, id, reason: 'format'};

    if (isTeacherCode(id)) {
      return {ok: true, id, role: 'teacher', reason: ''};
    }

    if (await isKnownStudentCode(id)) {
      return {ok: true, id, role: 'student', reason: ''};
    }

    // Student login is intentionally independent of Google Apps Script.
    // Roster changes must be bundled into STUDENT_CODE_HASHES before they can log in.
    return {ok: false, id, role: '', reason: 'not-found'};
  }

  async function login(value) {
    const result = await validateId(value);
    if (!result.ok) return result;
    const session = saveSession(result.id, result.role || 'student');
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

  function jsonp(params = {}) {
    return new Promise((resolve, reject) => {
      const callback = '__aulaJsonp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('backend-timeout'));
      }, 20000);

      function cleanup() {
        clearTimeout(timer);
        script.remove();
        try { delete window[callback]; } catch (_) { window[callback] = undefined; }
      }

      window[callback] = data => {
        cleanup();
        resolve(data);
      };

      const url = new URL(ENDPOINT);
      Object.entries({...params, callback, _: Date.now()}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
      });
      script.src = url.toString();
      script.onerror = () => {
        cleanup();
        reject(new Error('backend-unavailable'));
      };
      document.head.appendChild(script);
    });
  }

  function makeSubmissionId(practice, id) {
    const random = (window.crypto && crypto.getRandomValues)
      ? Array.from(crypto.getRandomValues(new Uint32Array(2))).map(n => n.toString(36)).join('')
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    return `${practice}-${id}-${Date.now()}-${random}`;
  }

  async function postPayload(payload, {keepalive = false} = {}) {
    const body = new URLSearchParams({payload: JSON.stringify(payload)});
    return fetch(ENDPOINT, {
      method: 'POST',
      mode: 'no-cors',
      credentials: 'omit',
      cache: 'no-store',
      keepalive,
      body
    });
  }

  function sampleActiveTime() {
    if (!practiceSessionId) return;
    const now = Date.now();
    const elapsed = Math.max(0, now - lastActiveTickAt);

    if (
      document.visibilityState === 'visible' &&
      now - lastInteractionAt <= ACTIVE_IDLE_MS
    ) {
      // The cap avoids counting a long browser-throttled interval as active time.
      practiceActiveMs += Math.min(elapsed, ACTIVE_SAMPLE_MS * 2);
    }

    lastActiveTickAt = now;
  }

  function sessionExtra() {
    if (!practiceSessionId) return {};
    sampleActiveTime();
    return {
      sessionId: practiceSessionId,
      activeMinutes: Math.round((practiceActiveMs / 60000) * 10) / 10,
      initialProgress: Number.isFinite(practiceInitialProgress)
        ? Math.round(practiceInitialProgress)
        : ''
    };
  }

  function activityPayload(event, detail = {}) {
    const session = getSession();
    if (!session || session.role !== 'student') return null;
    if (normalizeId(session.id) === '142858') return null;

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
      minutes: Number.isFinite(detail.minutes)
        ? Math.max(0, Math.round(detail.minutes * 10) / 10)
        : '',
      version: 'activity-v2',
      detail: {
        event,
        page: detail.page || location.pathname,
        title: detail.title || document.title || '',
        ...sessionExtra(),
        ...(detail.extra || {})
      },
      justifications: []
    };
  }

  async function logActivity(event, detail = {}) {
    const payload = activityPayload(event, detail);
    if (!payload) return {ok: false, skipped: true};
    try {
      await postPayload(payload);
      return {ok: true};
    } catch (error) {
      return {ok: false, error};
    }
  }

  function logActivityBeacon(event, detail = {}) {
    const payload = activityPayload(event, detail);
    if (!payload) return false;
    try {
      postPayload(payload, {keepalive: true}).catch(() => {});
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


  function draftKey(practicePath, id) {
    return LOCAL_DRAFT_PREFIX + normalizeId(id) + ':' +
      normalizeRepoPath(practicePath || location.pathname).toLowerCase();
  }

  function isDraftControl(el) {
    const id = String(el.id || '');
    const type = String(el.type || '').toLowerCase();
    if (/student-id|login-id/.test(id)) return false;
    return !['file', 'button', 'submit', 'reset'].includes(type);
  }

  function draftControls() {
    return Array.from(document.querySelectorAll('input,select,textarea'))
      .filter(isDraftControl);
  }

  function controlKey(el, index) {
    return el.id ? 'id:' + el.id
      : el.name ? 'name:' + el.name + ':' + index
      : 'idx:' + index;
  }

  function snapshotDraft(previous = null) {
    const controls = draftControls();
    const currentValues = controls.map((el, index) => {
      const type = String(el.type || '').toLowerCase();
      return {
        key: controlKey(el, index),
        type,
        value: (type === 'checkbox' || type === 'radio') ? '' : String(el.value ?? ''),
        checked: (type === 'checkbox' || type === 'radio') ? !!el.checked : null
      };
    });

    // Preserve controls that are temporarily not in the DOM (e.g. previous blocks).
    const merged = new Map();
    if (previous?.values && Array.isArray(previous.values)) {
      previous.values.forEach(item => merged.set(item.key, item));
    }
    currentValues.forEach(item => merged.set(item.key, item));

    let customState = previous?.customState ?? null;
    try {
      const adapter = window.AulaDraftState;
      if (adapter && typeof adapter.get === 'function') customState = adapter.get();
    } catch (_) {}

    return {
      savedAt: Date.now(),
      path: normalizeRepoPath(location.pathname),
      values: Array.from(merged.values()),
      customState
    };
  }

  function saveDraftNow() {
    const session = getSession();
    if (!session || session.role !== 'student' || !location.pathname.includes('/practiques/')) return false;
    try {
      const key = draftKey(location.pathname, session.id);
      let previous = null;
      try {
        const raw = localStorage.getItem(key);
        previous = raw ? JSON.parse(raw) : null;
      } catch (_) {}
      localStorage.setItem(key, JSON.stringify(snapshotDraft(previous)));
      document.dispatchEvent(new CustomEvent('aula:draft-saved', {detail: {savedAt: Date.now()}}));
      return true;
    } catch (_) {
      return false;
    }
  }

  function loadDraft() {
    const session = getSession();
    if (!session || session.role !== 'student') return null;
    try {
      const raw = localStorage.getItem(draftKey(location.pathname, session.id));
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function controlsWithin(root = document) {
    const out = [];
    if (root && root.matches && root.matches('input,select,textarea')) out.push(root);
    if (root && root.querySelectorAll) out.push(...root.querySelectorAll('input,select,textarea'));
    return out.filter(isDraftControl);
  }

  function applyDraftValues(draft, root = document) {
    if (!draft || !Array.isArray(draft.values)) return 0;
    const controls = controlsWithin(root);
    const allControls = draftControls();
    const allIndex = new Map(allControls.map((el, index) => [el, index]));
    const byKey = new Map();
    controls.forEach(el => byKey.set(controlKey(el, allIndex.get(el) ?? 0), el));

    let restored = 0;
    for (const item of draft.values) {
      const el = byKey.get(item.key);
      if (!el) continue;
      const type = String(el.type || '').toLowerCase();
      const same = (type === 'checkbox' || type === 'radio')
        ? el.checked === !!item.checked
        : String(el.value ?? '') === String(item.value ?? '');
      if (same) continue;

      if (type === 'checkbox' || type === 'radio') el.checked = !!item.checked;
      else el.value = item.value ?? '';

      el.dispatchEvent(new Event('input', {bubbles: true}));
      el.dispatchEvent(new Event('change', {bubbles: true}));
      restored++;
    }
    return restored;
  }

  function restoreCustomState(draft, attempt = 0) {
    if (!draft || draft.customState == null) return true;
    try {
      const adapter = window.AulaDraftState;
      if (!adapter || typeof adapter.restore !== 'function') return true;
      const result = adapter.restore(draft.customState);
      if (result === false && attempt < 4) {
        setTimeout(() => restoreCustomState(draft, attempt + 1), 250 * (attempt + 1));
        return false;
      }
      return true;
    } catch (_) {
      if (attempt < 4) setTimeout(() => restoreCustomState(draft, attempt + 1), 250 * (attempt + 1));
      return false;
    }
  }

  function restoreDraft() {
    const draft = loadDraft();
    if (!draft || !Array.isArray(draft.values)) return false;

    restoreCustomState(draft);

    const restored = applyDraftValues(draft, document);

    if (restored) {
      document.dispatchEvent(new CustomEvent('aula:draft-restored', {detail: {savedAt: draft.savedAt || null}}));
    }
    return restored > 0;
  }

  function clearDraft(practicePath, id) {
    try {
      localStorage.removeItem(draftKey(practicePath || location.pathname, id));
    } catch (_) {}
  }

  function installDraftAutosave() {
    const session = getSession();
    if (!session || session.role !== 'student') return;

    let timer = null;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(saveDraftNow, 350);
    };

    document.addEventListener('input', schedule, true);
    document.addEventListener('change', schedule, true);
    window.addEventListener('pagehide', saveDraftNow);

    setTimeout(restoreDraft, 120);

    // Dynamic practices often replace their fields when changing block.
    // Re-apply saved values to newly rendered controls without discarding older blocks.
    let applying = false;
    const observer = new MutationObserver(records => {
      if (applying) return;
      const draft = loadDraft();
      if (!draft) return;
      applying = true;
      try {
        for (const record of records) {
          for (const node of record.addedNodes || []) {
            if (node && node.nodeType === 1) applyDraftValues(draft, node);
          }
        }
      } finally {
        applying = false;
      }
    });
    observer.observe(document.body, {childList: true, subtree: true});
  }


  function installSaveAndExitButton() {
    const session = getSession();
    if (!session || session.role !== 'student' || document.getElementById('aula-save-exit')) return;

    const button = document.createElement('button');
    button.id = 'aula-save-exit';
    button.type = 'button';
    button.textContent = 'Desa i surt';
    button.setAttribute('aria-label', 'Desa la pràctica i torna al portal');
    Object.assign(button.style, {
      position: 'fixed',
      right: '14px',
      bottom: '14px',
      zIndex: '9999',
      border: '1px solid #bdbdbd',
      borderRadius: '7px',
      background: '#242424',
      color: '#fff',
      padding: '7px 10px',
      fontSize: '11px',
      fontWeight: '750',
      cursor: 'pointer',
      boxShadow: '0 4px 14px rgba(0,0,0,.12)'
    });

    button.addEventListener('click', () => {
      const ok = saveDraftNow();
      button.textContent = ok ? 'Desat ✓' : 'No s’ha pogut desar';
      setTimeout(() => {
        location.href = '../../index.html';
      }, 250);
    });

    document.body.appendChild(button);
  }

  async function checkPracticeSubmitted(practice) {
    const session = getSession();
    if (!session || session.role !== 'student') {
      return {ok: true, submitted: false, submissionId: ''};
    }

    const practicePath = practice?.fitxer || location.pathname;
    const submissionId = stablePracticeSubmissionId(practicePath, session.id);
    return {
      ok: true,
      submitted: hasLocalSubmission(practicePath, session.id),
      submissionId
    };
  }

  async function uploadPdf(file, {practice = 'Pràctica', area = 'Sistema', submissionId = ''} = {}) {
    const session = getSession();
    if (!session || session.role !== 'student') return {ok: false, error: 'no-student-session'};
    if (normalizeId(session.id) === '142858') return {ok: true, skipped: true, test: true};
    if (!file || file.type !== 'application/pdf') return {ok: false, error: 'pdf-only'};
    if (file.size > 10 * 1024 * 1024) return {ok: false, error: 'file-too-large'};

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }

    const payload = {
      submissionId: submissionId || stablePracticeSubmissionId(normalizeRepoPath(location.pathname), session.id),
      id: session.id,
      practice,
      area,
      status: 'Fitxer',
      mimeType: 'application/pdf',
      fileName: file.name || 'resolucions.pdf',
      size: file.size,
      fileBase64: btoa(binary)
    };

    try {
      await postPayload(payload);
      return {ok: true, confirmed: false};
    } catch (error) {
      return {ok: false, error};
    }
  }

  async function submit(payload) {
    const session = getSession();
    if (session?.role === 'teacher') {
      return {ok: true, skipped: true, teacher: true};
    }
    if (normalizeId(session?.id) === '142858') {
      const practiceKey = normalizeRepoPath(location.pathname);
      rememberLocalSubmission(practiceKey, session.id);
      clearDraft(practiceKey, session.id);
      return {ok: true, skipped: true, test: true};
    }

    const practiceKey = normalizeRepoPath(location.pathname);
    payload.practiceKey = practiceKey;
    payload.submissionId = stablePracticeSubmissionId(practiceKey, session.id);
    payload.detail = {...(payload.detail || {}), _practiceKey: practiceKey};

    try {
      await postPayload(payload);
    } catch (error) {
      return {ok: false, error};
    }
    rememberLocalSubmission(practiceKey, session.id);
    clearDraft(practiceKey, session.id);

    // Confirmation through GET/JSONP is intentionally not required here:
    // Apps Script web apps have a documented multi-account routing problem.
    // The POST uses credentials:'omit', and the deterministic submission ID
    // keeps duplicate writes idempotent on the backend.
    return {ok: true, confirmed: false};
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
    input.value = session.id;
    input.dataset.studentId = session.id;
    input.readOnly = true;

    if (teacher) {
      input.style.visibility = 'hidden';
      input.setAttribute('aria-hidden', 'true');
      document.querySelectorAll('#id-status,.idstatus').forEach(el => { el.hidden = true; });
    }

    setTimeout(() => {
      button.click();
      setTimeout(() => {
        input.readOnly = true;
        if (!teacher) input.value = `••••${String(session.id).slice(-2)}`;
        button.hidden = true;
        const wrap = input.closest('label');
        if (teacher) {
          input.hidden = true;
          input.style.visibility = '';
          if (wrap?.firstChild) wrap.firstChild.textContent = 'Professor ';
          document.querySelectorAll('#id-status,.idstatus').forEach(el => {
            el.textContent = String(el.textContent || '').replaceAll(session.id, 'Professor');
          });
        } else if (wrap?.firstChild) {
          wrap.firstChild.textContent = 'ID alumne ';
        }
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
    practiceSessionId = makeSubmissionId('session', session.id);
    practiceActiveMs = 0;
    practiceInitialProgress = estimateProgress();
    practiceInitialProgressLocked = false;
    lastInteractionAt = Date.now();
    lastActiveTickAt = Date.now();
    leaveLogged = false;

    // Draft restoration may change the starting progress. Capture it before the
    // student begins working, without changing the existing draft behaviour.
    document.addEventListener('aula:draft-restored', () => {
      if (!practiceInitialProgressLocked) {
        practiceInitialProgress = estimateProgress();
      }
    }, {once: true});

    installDraftAutosave();
    installSaveAndExitButton();

    const lockInitialProgress = () => {
      if (!practiceInitialProgressLocked) {
        practiceInitialProgress = estimateProgress();
        practiceInitialProgressLocked = true;
      }
    };

    const markInteraction = () => {
      sampleActiveTime();
      lockInitialProgress();
      lastInteractionAt = Date.now();
    };

    ['pointerdown', 'keydown', 'input', 'change', 'scroll', 'touchstart'].forEach(type => {
      document.addEventListener(type, markInteraction, {capture: true, passive: true});
    });

    document.addEventListener('visibilitychange', () => {
      sampleActiveTime();
      lastActiveTickAt = Date.now();
      if (document.visibilityState === 'visible') {
        lastInteractionAt = Date.now();
      }
    });

    setTimeout(lockInitialProgress, 900);
    activeSampleTimer = setInterval(sampleActiveTime, ACTIVE_SAMPLE_MS);

    const meta = practiceMeta();

    logActivity('OPEN_PRACTICE', {
      practice: meta.practice,
      area: meta.area,
      title: meta.title
    });

    // Safety pulse: preserves recent progress and active-time estimates even if
    // the final pagehide request is lost. These remain technical rows in Activitat.
    sessionPulseTimer = setInterval(() => {
      if (leaveLogged) return;
      logActivity('SESSION_PULSE', {
        practice: meta.practice,
        area: meta.area,
        title: meta.title,
        minutes: (Date.now() - practiceStartedAt) / 60000,
        progress: estimateProgress()
      });
    }, SESSION_PULSE_MS);

    const finishPracticeSession = (extra = {}) => {
      if (leaveLogged) return;
      leaveLogged = true;
      lockInitialProgress();
      sampleActiveTime();
      if (activeSampleTimer) clearInterval(activeSampleTimer);
      if (sessionPulseTimer) clearInterval(sessionPulseTimer);

      logActivityBeacon('LEAVE_PRACTICE', {
        practice: meta.practice,
        area: meta.area,
        title: meta.title,
        minutes: (Date.now() - practiceStartedAt) / 60000,
        progress: estimateProgress(),
        extra
      });
    };

    window.addEventListener('pagehide', () => finishPracticeSession(), {once: true});

    if (Number.isFinite(practiceClosesAt)) {
      accessTimer = setInterval(() => {
        if (currentAccessTime() >= practiceClosesAt) {
          finishPracticeSession({reason: 'access-closed'});
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
    version: 'v7',
    endpoint: ENDPOINT,
    normalizeId,
    validateId,
    login,
    logout,
    getSession,
    isTeacher,
    makeSubmissionId,
    submit,
    uploadPdf,
    checkPracticeSubmitted,
    stablePracticeSubmissionId,
    logActivity,
    saveDraftNow,
    restoreDraft,
    async apiGet(action, params = {}) {
      const session = getSession();
      if (!session) return {ok: false, error: 'no-session'};

      if (action === 'notes') {
        const auth = await jsonp({action: 'login', code: session.id});
        if (!auth?.ok || !auth.token) return {ok: false, error: auth?.error || 'unauthorized'};
        return jsonp({action: 'notes', token: auth.token, ...params});
      }

      return jsonp({action, ...params});
    }
  });
})();
