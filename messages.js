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

  async function refreshMessages() {
    const result = await tracker.apiGet('messages');
    if (!result?.ok) return result;
    messagesData = result;
    renderMessages(result);
    return result;
  }

  async function markUnreadAsRead(result) {
    if (!result?.ok || result.role !== 'student') return;
    const unread = (result.messages || []).filter(m => m.read === false && m.id);
    if (!unread.length) return;

    await Promise.all(unread.map(m =>
      tracker.apiPost({status:'MissatgeLlegit', messageId:m.id}).catch(() => null)
    ));

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

  function sendTeacherMessage() {
    if (session.role !== 'teacher') return;

    let recipients = selectedRecipients();
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

    addOptimisticMessages(sentMessages);
    $('messages-text').value = '';
    button.disabled = true;
    status.textContent = 'Enviant…';
    status.className = 'messages-send-status';

    (async () => {
      try {
        const posts = await Promise.allSettled(sentMessages.map(item =>
          tracker.apiPost({
            status:'MissatgeEnviar',
            messageId:item.messageId,
            recipient:item.recipient,
            message:item.message
          })
        ));

        if (posts.every(r => r.status === 'rejected')) {
          status.textContent = 'No s’ha pogut enviar el missatge.';
          status.className = 'messages-send-status bad';
          await refreshMessages().catch(() => {});
          return;
        }

        const confirmations = await Promise.all(sentMessages.map(item =>
          tracker.confirmOperation('message', item.messageId, {attempts:4, delayMs:300})
        ));
        const confirmed = confirmations.filter(r => r?.ok).length;

        if (confirmed === sentMessages.length) {
          status.textContent = recipients[0] === 'TOTS'
            ? 'Enviat a tots els alumnes.'
            : recipients.length === 1 ? 'Enviat.' : 'Enviats.';
          status.className = 'messages-send-status ok';
        } else {
          status.textContent = confirmed
            ? 'Alguns enviaments no s’han pogut confirmar.'
            : 'No s’ha pogut confirmar l’enviament.';
          status.className = 'messages-send-status bad';
        }
        await refreshMessages().catch(() => {});
      } catch (_) {
        status.textContent = 'No s’ha pogut confirmar l’enviament.';
        status.className = 'messages-send-status bad';
      } finally {
        button.disabled = false;
      }
    })();
  }

  $('messages-send').addEventListener('click', sendTeacherMessage);

  (async () => {
    const result = await refreshMessages();
    await markUnreadAsRead(result);
  })();
})();