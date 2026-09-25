(() => {
  'use strict';

  const tracker = window.PracticeTracker;
  const fallbackPractiques = {
    versio: 2,
    arees: {
      economia: {
        nom: 'Economia', simbol: 'E', eyebrow: "Introducció a l'economia",
        titol: 'Pràctiques interactives',
        subtitol: 'Activitats del curs. Les noves pràctiques s’aniran incorporant aquí.',
        practiques: []
      },
      estadistica: {
        nom: 'Estadística', simbol: 'Σ', eyebrow: 'Estadística',
        titol: 'Pràctiques interactives',
        subtitol: 'Laboratoris de dades per calcular, visualitzar i interpretar estadístics amb suport d’Excel.',
        practiques: []
      }
    }
  };

  const fallbackApunts = {
    versio: 1,
    arees: {
      economia: {
        nom: 'Economia', simbol: 'E', eyebrow: "Introducció a l'economia",
        titol: 'Apunts',
        subtitol: 'Materials de teoria de l’assignatura. Els temes s’aniran incorporant progressivament.',
        apunts: []
      },
      estadistica: {
        nom: 'Estadística', simbol: 'Σ', eyebrow: 'Estadística',
        titol: 'Apunts',
        subtitol: 'Materials de teoria per preparar les pràctiques i repassar els conceptes del curs.',
        apunts: [{
          id: 'tema-1-descriptiva-unidimensional', ordre: 1, visible: true, disponible: true,
          codi: 'Tema 1', titol: 'Estadística descriptiva unidimensional',
          descripcio: 'Dades i freqüències, mesures de centre, dispersió, quartils, valors atípics, boxplot i interpretació conjunta d’una distribució.',
          fitxer: 'apunts/estadistica/tema-1-descriptiva-unidimensional.pdf'
        }]
      }
    }
  };

  function cachedConfig(key, fallback) {
    try {
      const cached = JSON.parse(localStorage.getItem(`aula-config-${key}`) || 'null');
      return cached?.arees ? cached : fallback;
    } catch (_) {
      return fallback;
    }
  }

  const configs = {
    practiques: cachedConfig('practiques', fallbackPractiques),
    apunts: cachedConfig('apunts', fallbackApunts)
  };
  const qs = new URLSearchParams(location.search);
  let area = qs.get('area') === 'estadistica' ? 'estadistica' : 'economia';
  let mode = qs.get('mode') === 'apunts' ? 'apunts' : 'practiques';
  let serverTimeOffsetMs = 0;
  const submittedPracticeKeys = new Set();

  const $ = id => document.getElementById(id);

  async function loadJsonConfig(path, key, {syncServerClock = false} = {}) {
    const response = await fetch(path, {cache: 'no-store'});
    if (!response.ok) throw new Error(key);

    if (syncServerClock) {
      const serverDate = response.headers.get('Date');
      if (serverDate) {
        const serverMs = Date.parse(serverDate);
        if (Number.isFinite(serverMs)) serverTimeOffsetMs = serverMs - Date.now();
      }
    }

    const config = await response.json();
    if (config?.arees) {
      configs[key] = config;
      try { localStorage.setItem(`aula-config-${key}`, JSON.stringify(config)); } catch (_) {}
    }
    return config;
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

  function setLoginStatus(kind, text) {
    const el = $('login-status');
    el.className = 'login-status ' + (kind || '');
    el.textContent = text || '';
  }

  function normalizeLoginInput() {
    const input = $('login-id');
    input.value = tracker.normalizeId(input.value);
    return input.value;
  }

  function saveState() {
    const u = new URL(location.href);
    u.searchParams.set('area', area);
    u.searchParams.set('mode', mode);
    u.searchParams.delete('next');
    history.replaceState(null, '', u);
  }

  function showPortal(session) {
    $('login-view').classList.add('hidden');
    $('hub-view').classList.remove('hidden');
    const teacher = session.role === 'teacher';
    $('session-role').textContent = teacher ? 'Professor' : 'Alumne ·';
    $('session-id').textContent = teacher ? '' : `••••${String(session.id).slice(-2)}`;
    $('session-id').hidden = teacher;
    $('teacher-tools').classList.toggle('hidden', !teacher);
    $('notes-button').classList.toggle('hidden', !teacher);
    $('messages-button').classList.remove('hidden');
    setMessagesBadge(0);
    render();
    refreshMessages().catch(() => {});
  }

  function showLogin() {
    $('hub-view').classList.add('hidden');
    $('login-view').classList.remove('hidden');
    $('login-id').focus();
  }

  async function handleLogin() {
    const id = normalizeLoginInput();
    $('login-button').disabled = true;
    setLoginStatus('checking', 'Comprovant codi…');

    const result = await tracker.login(id);
    $('login-button').disabled = false;

    if (!result.ok) {
      setLoginStatus(
        'bad',
        result.reason === 'format' ? 'El codi ha de tenir 6 dígits.' :
        result.reason === 'not-found' ? 'Aquest codi no correspon a cap alumne.' :
        'No s’ha pogut validar el codi. Torna-ho a provar.'
      );
      return;
    }

    setLoginStatus('ok', 'Codi correcte · entrant…');
    const next = qs.get('next');
    if (next && next.startsWith('/')) {
      setTimeout(() => { location.href = next; }, 180);
      return;
    }
    setTimeout(() => showPortal(result.session), 120);
  }

  let messagesData = null;

  function setMessagesBadge(count) {
    const badge = $('messages-badge');
    const n = Math.max(0, Number(count) || 0);
    badge.textContent = String(n);
    badge.classList.toggle('hidden', n === 0);
  }

  function renderMessagesPanel(result) {
    if (!result?.ok) return;

    const teacher = result.role === 'teacher';
    $('messages-title').textContent = teacher ? 'Missatges enviats' : 'Els meus missatges';
    $('messages-teacher-compose').classList.toggle('hidden', !teacher);

    if (teacher) {
      const box = $('messages-recipient-list');
      const current = new Set(
        Array.from(box.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value)
      );
      if (!current.size) current.add('TOTS');

      const recipients = [
        {id: 'TOTS', name: 'Tots els alumnes'},
        ...(result.recipients || [])
      ];

      box.innerHTML = recipients.map(r => {
        const checked = current.has(String(r.id)) ? ' checked' : '';
        return '<label class="messages-recipient-option">' +
          '<input type="checkbox" value="' + esc(r.id) + '"' + checked + '>' +
          '<span>' + esc(r.name) + '</span>' +
        '</label>';
      }).join('');

      const inputs = Array.from(box.querySelectorAll('input[type="checkbox"]'));
      const all = inputs.find(input => input.value === 'TOTS');

      inputs.forEach(input => {
        input.addEventListener('change', () => {
          if (input.value === 'TOTS' && input.checked) {
            inputs.forEach(other => {
              if (other !== input) other.checked = false;
            });
          } else if (input.checked && all) {
            all.checked = false;
          }

          if (!inputs.some(other => other.checked) && all) {
            all.checked = true;
          }
        });
      });
    }

    const list = $('messages-list');
    const messages = result.messages || [];

    if (!messages.length) {
      list.innerHTML = '<div class="messages-empty">No hi ha cap missatge.</div>';
      return;
    }

    list.innerHTML = messages.map(m => {
      const meta = teacher
        ? esc(m.date || '') + ' · ' + esc(m.recipientName || m.recipient || '')
        : esc(m.date || '');
      const unread = !teacher && m.read === false;
      return '<article class="message-item' + (unread ? ' unread' : '') + '">' +
        '<div class="message-meta">' + meta +
          (unread ? '<span class="message-new">Nou</span>' : '') +
        '</div>' +
        '<div class="message-text">' + esc(m.message || '') + '</div>' +
      '</article>';
    }).join('');
  }

  async function refreshMessages({renderPanel = false} = {}) {
    const result = await tracker.apiGet('messages');

    if (!result?.ok) {
      return result;
    }

    messagesData = result;

    if (result.role === 'student') {
      setMessagesBadge(result.unreadCount || 0);
    } else {
      setMessagesBadge(0);
    }

    if (renderPanel) renderMessagesPanel(result);
    return result;
  }

  async function openMessages() {
    $('notes-panel').classList.add('hidden');
    $('messages-panel').classList.remove('hidden');

    const result = await refreshMessages({renderPanel: true});
    if (!result?.ok || result.role !== 'student') return;

    const unread = (result.messages || []).filter(m => m.read === false && m.id);
    if (!unread.length) return;

    await Promise.all(unread.map(m =>
      tracker.apiPost({
        status: 'MissatgeLlegit',
        messageId: m.id
      }).catch(() => null)
    ));

    if (messagesData?.messages) {
      messagesData.messages = messagesData.messages.map(m => ({...m, read: true}));
      messagesData.unreadCount = 0;
      setMessagesBadge(0);
      renderMessagesPanel(messagesData);
    }
  }

  function selectedMessageRecipients() {
    return Array.from(
      document.querySelectorAll('#messages-recipient-list input[type="checkbox"]:checked')
    ).map(input => input.value);
  }

  function renderConfirmedSentMessages(sentMessages) {
    if (!messagesData?.ok || messagesData.role !== 'teacher') return;

    const names = new Map(
      (messagesData.recipients || []).map(r => [String(r.id), String(r.name || '')])
    );

    const existing = new Set((messagesData.messages || []).map(m => String(m.id || '')));
    const now = new Intl.DateTimeFormat('ca-ES', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Europe/Madrid'
    }).format(new Date());

    const additions = sentMessages
      .filter(item => !existing.has(String(item.messageId)))
      .map(item => ({
        id: item.messageId,
        date: now,
        recipient: item.recipient,
        recipientName: item.recipient === 'TOTS'
          ? 'Tots els alumnes'
          : (names.get(String(item.recipient)) || item.recipient),
        message: item.message
      }));

    if (!additions.length) return;

    messagesData = {
      ...messagesData,
      messages: [...additions.reverse(), ...(messagesData.messages || [])]
    };
    renderMessagesPanel(messagesData);
  }

  async function confirmMessagesSent(sentMessages) {
    const results = await Promise.all(
      sentMessages.map(item =>
        tracker.confirmOperation('message', item.messageId, {
          attempts: 4,
          delayMs: 300
        })
      )
    );

    const confirmedMessages = sentMessages.filter((_, index) => results[index]?.ok);
    const confirmed = confirmedMessages.length;

    if (confirmed) {
      renderConfirmedSentMessages(confirmedMessages);
    }

    // Refresca des del servidor sense bloquejar la resposta visual.
    refreshMessages({renderPanel: true}).catch(() => {});

    return {
      ok: confirmed === sentMessages.length,
      confirmed,
      pending: sentMessages.filter((_, index) => !results[index]?.ok)
    };
  }

  function sendTeacherMessage() {
    const session = tracker.getSession();
    if (!session || session.role !== 'teacher') return;

    let recipients = selectedMessageRecipients();
    const message = $('messages-text').value.trim();
    const button = $('messages-send');
    const status = $('messages-send-status');

    if (!recipients.length) {
      status.textContent = 'Selecciona almenys un destinatari.';
      status.className = 'messages-send-status bad';
      return;
    }

    if (recipients.includes('TOTS')) recipients = ['TOTS'];

    if (!message) {
      status.textContent = 'Escriu un missatge.';
      status.className = 'messages-send-status bad';
      return;
    }

    const sentMessages = recipients.map(recipient => ({
      messageId: tracker.makeSubmissionId('message', session.id),
      recipient,
      message
    }));

    // La resposta visual és immediata. L'escriptura i la confirmació
    // es fan després, sense bloquejar el botó ni el panell.
    renderConfirmedSentMessages(sentMessages);
    $('messages-text').value = '';
    status.textContent = recipients[0] === 'TOTS'
      ? 'Enviat a tots els alumnes. Confirmant…'
      : recipients.length === 1
        ? 'Enviat. Confirmant…'
        : `Enviat a ${recipients.length} alumnes. Confirmant…`;
    status.className = 'messages-send-status ok';
    button.disabled = false;

    (async () => {
      try {
        const postResults = await Promise.allSettled(
          sentMessages.map(item =>
            tracker.apiPost({
              status: 'MissatgeEnviar',
              messageId: item.messageId,
              recipient: item.recipient,
              message: item.message
            })
          )
        );

        const rejected = postResults.filter(r => r.status === 'rejected').length;
        if (rejected === sentMessages.length) {
          await refreshMessages({renderPanel: true}).catch(() => {});
          status.textContent = 'No s’ha pogut enviar el missatge.';
          status.className = 'messages-send-status bad';
          return;
        }

        const confirmation = await confirmMessagesSent(sentMessages);

        if (confirmation.ok) {
          status.textContent = recipients[0] === 'TOTS'
            ? 'Enviat a tots els alumnes.'
            : recipients.length === 1
              ? 'Enviat.'
              : `Enviat a ${recipients.length} alumnes.`;
          status.className = 'messages-send-status ok';
        } else {
          status.textContent = confirmation.confirmed
            ? `Confirmats ${confirmation.confirmed} de ${recipients.length}. Revisa la llista abans de tornar a enviar.`
            : 'No s’ha pogut confirmar l’enviament. Revisa la llista abans de tornar a enviar.';
          status.className = 'messages-send-status bad';
        }
      } catch (_) {
        await refreshMessages({renderPanel: true}).catch(() => {});
        status.textContent = 'No s’ha pogut confirmar l’enviament. Revisa la llista abans de tornar a enviar.';
        status.className = 'messages-send-status bad';
      }
    })();
  }

  function parseAccessTime(value) {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }

  function currentAccessTime() {
    return Date.now() + serverTimeOffsetMs;
  }

  function practiceAvailability(p) {
    const opensAt = parseAccessTime(p.obertura);
    const closesAt = parseAccessTime(p.tancament);
    const now = currentAccessTime();

    if (p.disponible !== true) return {open:false, state:'closed', opensAt, closesAt};
    if (opensAt !== null && now < opensAt) return {open:false, state:'upcoming', opensAt, closesAt};
    if (closesAt !== null && now >= closesAt) return {open:false, state:'closed', opensAt, closesAt};
    return {open:true, state:'open', opensAt, closesAt};
  }

  function formatAccessDate(ms) {
    if (!Number.isFinite(ms)) return '';
    return new Intl.DateTimeFormat('ca-ES', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Europe/Madrid'
    }).format(new Date(ms));
  }

  async function refreshSubmissionStates() {
    const session = tracker.getSession();
    if (!session || session.role !== 'student') return;

    const areas = Object.values(configs.practiques?.arees || {});
    const practices = areas
      .flatMap(a => a?.practiques || [])
      .filter(p => p && p.visible !== false && p.disponible === true);

    const checks = await Promise.all(practices.map(async p => {
      const key = String(p.fitxer || p.id || '');
      const result = await tracker.checkPracticeSubmitted(p);
      return {key, result};
    }));

    checks.forEach(({key, result}) => {
      if (!result?.ok) return;
      if (result.submitted) submittedPracticeKeys.add(key);
      else submittedPracticeKeys.delete(key);
    });
    render();
  }

  function render() {
    const session = tracker.getSession();
    if (!session) {
      showLogin();
      return;
    }

    const teacher = session.role === 'teacher';
    const isApunts = mode === 'apunts';
    const config = configs[mode] || (isApunts ? fallbackApunts : fallbackPractiques);
    const a = config.arees?.[area] || config.arees?.economia;
    if (!a) return;

    $('hub-eyebrow').textContent = a.eyebrow || a.nom || '';
    $('hub-title').textContent = a.titol || (isApunts ? 'Apunts' : 'Pràctiques interactives');
    $('hub-sub').textContent = a.subtitol || '';

    $('area-mark').textContent = a.simbol || (area === 'economia' ? 'E' : 'Σ');
    const otherArea = area === 'economia' ? 'Estadística' : 'Economia';
    $('area-mark').title = `Canvia a ${otherArea}`;
    $('area-mark').setAttribute('aria-label', `Canvia a ${otherArea}`);

    $('content-mark').textContent = isApunts ? 'A' : 'P';
    const otherMode = isApunts ? 'Pràctiques' : 'Apunts';
    $('content-mark').title = `Canvia a ${otherMode}`;
    $('content-mark').setAttribute('aria-label', `Canvia a ${otherMode}`);

    $('area-note').textContent = `${a.nom} · ${isApunts ? 'Apunts' : 'Pràctiques'} · ${a.simbol} canvia l’àrea · ${isApunts ? 'A' : 'P'} canvia Apunts/Pràctiques`;

    const source = isApunts ? (a.apunts || []) : (a.practiques || []);
    const list = source
      .filter(p => teacher || p.visible !== false)
      .sort((x, y) => (x.ordre || 0) - (y.ordre || 0));
    const grid = $('practice-grid');

    if (!list.length) {
      grid.innerHTML = `<div class="portal-empty">${isApunts ? 'Encara no hi ha apunts publicats en aquesta àrea.' : 'No hi ha pràctiques visibles en aquesta àrea.'}</div>`;
      return;
    }

    function cardHtml(p) {
      const availability = isApunts
        ? {open: p.disponible === true, state: p.disponible === true ? 'open' : 'upcoming', opensAt:null, closesAt:null}
        : practiceAvailability(p);
      const published = availability.open;
      const individuallySubmitted = !teacher && !isApunts &&
        submittedPracticeKeys.has(String(p.fitxer || p.id || ''));
      const canOpen = (published && !individuallySubmitted) || teacher;
      const preview = teacher && !published;
      const status = preview
        ? 'Professor'
        : availability.state === 'closed'
          ? 'Tancada'
          : individuallySubmitted
            ? 'Entregada'
            : published
              ? 'Disponible'
              : 'Properament';
      const timing = !isApunts
        ? availability.state === 'upcoming' && availability.opensAt
          ? ` · Obre ${formatAccessDate(availability.opensAt)}`
          : availability.state === 'open' && availability.closesAt
            ? ` · Fins ${formatAccessDate(availability.closesAt)}`
            : availability.state === 'closed' && availability.closesAt
              ? ` · Tancada ${formatAccessDate(availability.closesAt)}`
              : ''
        : '';

      let buttons = '';
      if (isApunts) {
        const resources = (Array.isArray(p.recursos) ? p.recursos : [])
          .filter(r => teacher || r.visible !== false);
        const resourceButtons = resources.map(r => {
          const resourceOpen = teacher || r.disponible !== false;
          return resourceOpen
            ? `<a class="pdf-btn portal-link" href="${esc(r.fitxer)}" target="_blank" rel="noopener">${esc(r.titol || 'Recurs')}</a>`
            : `<button class="pdf-btn" disabled>${esc(r.titol || 'Recurs')}</button>`;
        }).join('');
        buttons = (canOpen
          ? `<a class="open-btn portal-link material-link" data-title="${esc(p.titol)}" data-area="${esc(a.nom)}" href="${esc(p.fitxer)}" target="_blank" rel="noopener">Obrir apunts</a>`
          : '<button class="open-btn" disabled>Obrir apunts</button>') + resourceButtons;
      } else {
        const pdfBtn = p.pdf
          ? (canOpen
              ? `<a class="pdf-btn portal-link material-link" data-title="${esc(p.titol)} · PDF" data-area="${esc(a.nom)}" href="${esc(p.pdf)}" target="_blank" rel="noopener">Veure PDF</a>`
              : '<button class="pdf-btn" disabled>Veure PDF</button>')
          : '';
        const solutionBtn = teacher && p.solucionari
          ? `<a class="pdf-btn portal-link" href="${esc(p.solucionari)}" target="_blank" rel="noopener">${esc(p.solucionariTitol || 'Solucionari')}</a>`
          : '';
        const openBtn = canOpen
          ? `<a class="open-btn portal-link" href="${esc(p.fitxer)}">Obrir pràctica</a>`
          : '<button class="open-btn" disabled>Obrir pràctica</button>';
        buttons = pdfBtn + solutionBtn + openBtn;
      }

      return `<article class="practice-card ${canOpen ? 'active' : 'disabled'} ${preview ? 'teacher-preview' : ''}">
        <div>
          <div class="card-kicker">${esc(p.codi)} · ${status}${esc(timing)}</div>
          <div class="card-title">${esc(p.titol)}</div>
          <div class="card-desc">${esc(p.descripcio)}</div>
        </div>
        <div class="card-action">
          <span class="status-pill ${published ? 'available' : ''} ${preview ? 'teacher' : ''}">${status}</span>
          <div class="action-buttons">${buttons}</div>
        </div>
      </article>`;
    }

    if (!isApunts && area === 'estadistica') {
      const groups = new Map();
      list.forEach(p => {
        const tema = Number.isFinite(Number(p.tema)) ? Number(p.tema) : 99;
        if (!groups.has(tema)) groups.set(tema, []);
        groups.get(tema).push(p);
      });

      grid.classList.add('topic-layout');
      grid.innerHTML = [...groups.entries()]
        .sort((x, y) => x[0] - y[0])
        .map(([tema, items]) => {
          items.sort((x, y) => (x.ordre || 0) - (y.ordre || 0));
          if (tema === 0) {
            return `<section class="practice-topic intro-topic">
              <div class="topic-cards single-card">${items.map(cardHtml).join('')}</div>
            </section>`;
          }
          const heading = items[0]?.temaTitol || `Tema ${tema}`;
          return `<section class="practice-topic">
            <div class="topic-heading">${esc(heading)}</div>
            <div class="topic-cards">${items.map(cardHtml).join('')}</div>
          </section>`;
        }).join('');
    } else {
      grid.classList.remove('topic-layout');
      grid.innerHTML = list.map(cardHtml).join('');
    }

    grid.querySelectorAll('.material-link').forEach(link => {
      link.addEventListener('click', () => {
        tracker.logActivity('OPEN_MATERIAL', {
          practice: link.dataset.title || 'Material',
          area: link.dataset.area || a.nom,
          title: link.dataset.title || ''
        });
      });
    });
  }

  $('login-id').addEventListener('input', normalizeLoginInput);
  $('login-id').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleLogin();
    }
  });
  $('login-button').addEventListener('click', handleLogin);

  $('logout-button').addEventListener('click', () => {
    tracker.logout();
    location.href = 'index.html';
  });

  $('messages-button').addEventListener('click', openMessages);
  $('messages-close').addEventListener('click', () => {
    $('messages-panel').classList.add('hidden');
  });
  $('messages-send').addEventListener('click', sendTeacherMessage);
  $('notes-button').addEventListener('click', () => {
    $('messages-panel').classList.add('hidden');
  });

  $('area-mark').addEventListener('click', () => {
    area = area === 'economia' ? 'estadistica' : 'economia';
    saveState();
    render();
  });

  $('content-mark').addEventListener('click', () => {
    mode = mode === 'practiques' ? 'apunts' : 'practiques';
    saveState();
    render();
  });

  loadJsonConfig('practiques.json', 'practiques', {syncServerClock: true})
    .then(() => {
      render();
      refreshSubmissionStates();
    })
    .catch(() => render());

  loadJsonConfig('apunts.json', 'apunts')
    .then(render)
    .catch(() => render());

  const session = tracker.getSession();
  if (session) {
    showPortal(session);
    if (session.role === 'student') {
      tracker.logActivity('OPEN_PORTAL', {practice: 'Portal', area: 'Sistema', title: 'Aula Interactiva'});
    }
  } else {
    showLogin();
  }
})();
