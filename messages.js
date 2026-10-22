(() => {
  'use strict';

  const tracker = window.PracticeTracker;
  const $ = id => document.getElementById(id);
  const esc = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  if (!tracker) return;

  const session = tracker.getSession();
  if (!session) {
    location.href = 'index.html?next=/messages.html';
    return;
  }

  let messagesData = null;

  function renderMessages(result) {
    if (!result?.ok) return;

    const teacher = result.role === 'teacher';
    $('page-title').textContent = teacher ? 'Missatges enviats' : 'Els meus missatges';
    $('messages-teacher-compose').classList.toggle('hidden', !teacher);

    if (teacher) {
      const box = $('messages-recipient-list');
      const current = new Set(
        Array.from(box.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value)
      );
      if (!current.size) current.add('TOTS');

      const recipients = [{id:'TOTS',name:'Tots els alumnes'}, ...(result.recipients || [])];
      box.innerHTML = recipients.map(r => {
        const checked = current.has(String(r.id)) ? ' checked' : '';
        return '<label class="messages-recipient-option">' +
          '<input type="checkbox" value="' + esc(r.id) + '"' + checked + '>' +
          '<span>' + esc(r.name) + '</span></label>';
      }).join('');

      const inputs = Array.from(box.querySelectorAll('input[type="checkbox"]'));
      const all = inputs.find(input => input.value === 'TOTS');
      inputs.forEach(input => input.addEventListener('change', () => {
        if (input.value === 'TOTS' && input.checked) {
          inputs.forEach(other => { if (other !== input) other.checked = false; });
        } else if (input.checked && all) {
          all.checked = false;
        }
        if (!inputs.some(other => other.checked) && all) all.checked = true;
      }));
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
        '</div><div class="message-text">' + esc(m.message || '') + '</div></article>';
    }).join('');
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function refreshMessages({attempts = 2} = {}) {
    const list = $('messages-list');
    list.innerHTML = '<div class="messages-empty">Carregant missatges…</div>';

    let last = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        last = await tracker.apiGet('messages');
        if (last?.ok) {
          messagesData = last;
          renderMessages(last);
          return last;
        }
      } catch (error) {
        last = {ok:false, error:String(error && error.message || error)};
      }
      if (attempt < attempts - 1) await sleep(450);
    }

    list.innerHTML =
      '<div class="messages-empty">No s’han pogut carregar els missatges. ' +
      '<button type="button" id="messages-retry">Torna-ho a provar</button></div>';
    $('messages-retry')?.addEventListener('click', () => {
      refreshMessages().then(markUnreadAsRead).catch(() => {});
    });
    return last || {ok:false, error:'messages-unavailable'};
  }

  async function markUnreadAsRead(result) {
    if (!result?.ok || result.role !== 'student') return;
    const unread = (result.messages || []).filter(m => m.read === false && m.id);
    if (!unread.length) return;

    try {
      await tracker.apiPost({
        status:'MissatgesLlegits',
        messageIds:unread.map(m => m.id)
      });
    } catch (_) {
      return;
    }

    if (messagesData?.messages) {
      messagesData.messages = messagesData.messages.map(m => ({...m, read:true}));
      messagesData.unreadCount = 0;
      renderMessages(messagesData);
    }
  }

  function selectedRecipients() {
    return Array.from(
      document.querySelectorAll('#messages-recipient-list input[type="checkbox"]:checked')
    ).map(input => input.value);
  }

  function addOptimisticMessages(sentMessages) {
    if (!messagesData?.ok || messagesData.role !== 'teacher') return;

    const names = new Map((messagesData.recipients || []).map(r => [String(r.id), String(r.name || '')]));
    const existing = new Set((messagesData.messages || []).map(m => String(m.id || '')));
    const now = new Intl.DateTimeFormat('ca-ES', {
      dateStyle:'short', timeStyle:'short', timeZone:'Europe/Madrid'
    }).format(new Date());

    const additions = sentMessages
      .filter(item => !existing.has(String(item.messageId)))
      .map(item => ({
        id:item.messageId,
        date:now,
        recipient:item.recipient,
        recipientName:item.recipient === 'TOTS'
          ? 'Tots els alumnes'
          : (names.get(String(item.recipient)) || item.recipient),
        message:item.message
      }));

    if (!additions.length) return;
    messagesData = {...messagesData, messages:[...additions.reverse(), ...(messagesData.messages || [])]};
    renderMessages(messagesData);
  }

  function showSendDetails(items, states) {
    const details = $('messages-send-details');
    const pending = items.filter((_, i) => states[i] === 'unconfirmed');
    if (!pending.length) {
      details.hidden = true;
      details.replaceChildren();
      return;
    }
    const names = new Map((messagesData?.recipients || []).map(r => [String(r.id), String(r.name || '')]));
    details.hidden = false;
    const heading = document.createElement('strong');
    heading.textContent = 'Destinataris sense confirmació (pot ser que el missatge s’hagi enviat):';
    const list = document.createElement('ul');
    pending.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item.recipient === 'TOTS'
        ? 'Enviament general (no es pot identificar individualment des d’aquesta confirmació)'
        : (names.get(String(item.recipient)) || 'Alumne sense nom disponible');
      list.appendChild(li);
    });
    details.replaceChildren(heading, list);
  }

  async function sendTeacherMessage() {
    if (session.role !== 'teacher') return;
    let recipients = selectedRecipients();
    const message = $('messages-text').value.trim();
    const button = $('messages-send');
    const status = $('messages-send-status');
    if (!recipients.length || !message) {
      status.textContent = !recipients.length ? 'Selecciona almenys un destinatari.' : 'Escriu un missatge.';
      status.className = 'messages-send-status bad';
      return;
    }
    if (recipients.includes('TOTS')) recipients = ['TOTS'];
    const items = recipients.map(recipient => ({
      messageId:tracker.makeSubmissionId('message', session.id), recipient, message
    }));
    const states = items.map(() => 'sending');
    button.disabled = true;
    $('messages-send-details').hidden = true;
    $('messages-send-details').replaceChildren();
    status.textContent = 'Enviant i comprovant cada destinatari…';
    status.className = 'messages-send-status';

    try {
      const posts = await Promise.allSettled(items.map(item => tracker.apiPost({
        status:'MissatgeEnviar', messageId:item.messageId, recipient:item.recipient, message:item.message
      })));
      const confirmations = await Promise.all(items.map(async item => {
        try { return await tracker.confirmOperation('message', item.messageId, {attempts:4, delayMs:300}); }
        catch (_) { return {ok:false}; }
      }));
      // Una resposta POST sense confirmació no demostra que el missatge no s'hagi enviat.
      confirmations.forEach((result, i) => { states[i] = result?.ok ? 'confirmed' : 'unconfirmed'; });
      // Comprovació addicional contra la llista real del servidor, sense considerar
      // com a confirmats els registres optimistes.
      try {
        const result = await tracker.apiGet('messages');
        if (result?.ok) {
          const ids = new Set((result.messages || []).map(m => String(m.id || '')));
          items.forEach((item, i) => { if (ids.has(String(item.messageId))) states[i] = 'confirmed'; });
          messagesData = result;
          renderMessages(result);
        }
      } catch (_) {}
      showSendDetails(items, states);
      const confirmed = states.filter(x => x === 'confirmed').length;
      const unconfirmed = items.length - confirmed;
      status.textContent = unconfirmed
        ? confirmed + ' de ' + items.length + ' confirmats. ' + unconfirmed + ' sense confirmar; no els reenviïs sense comprovar-ho.'
        : (items.length === 1 ? 'Enviament confirmat.' : items.length + ' enviaments confirmats.');
      status.className = 'messages-send-status ' + (unconfirmed ? 'bad' : 'ok');
      if (!unconfirmed) $('messages-text').value = '';
      // Si n'hi ha de pendents, conservar el text, però no reenviar automàticament.
    } catch (_) {
      states.fill('unconfirmed');
      showSendDetails(items, states);
      status.textContent = 'No s’han pogut verificar els enviaments. No els reenviïs sense comprovar-ho.';
      status.className = 'messages-send-status bad';
    } finally {
      button.disabled = false;
    }
  }

  $('messages-send').addEventListener('click', sendTeacherMessage);

  (async () => {
    const result = await refreshMessages();
    await markUnreadAsRead(result);
  })();
})();