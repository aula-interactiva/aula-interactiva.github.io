(() => {
  'use strict';

  const tracker = window.PracticeTracker;
  if (!tracker) return;

  const $ = id => document.getElementById(id);
  const state = {
    loaded: false,
    notes: [],
    area: 'Economia',
    practiceId: ''
  };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  function session() {
    return tracker.getSession();
  }

  function showPanel() {
    $('notes-panel').classList.remove('hidden');
    $('practice-grid').classList.add('hidden');
    loadNotes();
  }

  function closePanel() {
    $('notes-panel').classList.add('hidden');
    $('practice-grid').classList.remove('hidden');
  }

  function setLoading() {
    $('notes-practices').innerHTML = '';
    $('notes-content').innerHTML = '<div class="notes-empty">Carregant notes…</div>';
  }

  function studentView(notes) {
    $('notes-title').textContent = 'Les meves notes';
    $('notes-area-mark').classList.add('hidden');
    $('notes-practices').innerHTML = '';

    if (!notes.length) {
      $('notes-content').innerHTML = '<div class="notes-empty">Encara no tens cap pràctica qualificada.</div>';
      return;
    }

    const sorted = [...notes].sort((a, b) =>
      String(a.area).localeCompare(String(b.area), 'ca') ||
      String(a.practice).localeCompare(String(b.practice), 'ca')
    );

    $('notes-content').innerHTML = '<div class="student-notes">' + sorted.map(n => `
      <div class="student-note-row">
        <div>
          <div class="note-practice">${esc(n.practice)}</div>
          <div class="note-area">${esc(n.area)}</div>
        </div>
        <div class="note-grade">${esc(n.grade)}</div>
      </div>`).join('') + '</div>';
  }

  function teacherPracticeButtons(notes) {
    const areaNotes = notes.filter(n => n.area === state.area);
    const practices = new Map();
    areaNotes.forEach(n => {
      if (!practices.has(n.practiceId)) practices.set(n.practiceId, n.practice);
    });

    const buttons = [...practices.entries()];
    if (!buttons.length) {
      state.practiceId = '';
      $('notes-practices').innerHTML = '';
      $('notes-content').innerHTML = '<div class="notes-empty">Encara no hi ha notes publicades en aquesta àrea.</div>';
      return;
    }

    if (!buttons.some(([id]) => id === state.practiceId)) state.practiceId = buttons[0][0];

    $('notes-practices').innerHTML = buttons.map(([id, label]) => `
      <button class="notes-practice-btn ${id === state.practiceId ? 'active' : ''}" type="button" data-practice-id="${esc(id)}">${esc(label)}</button>
    `).join('');

    $('notes-practices').querySelectorAll('.notes-practice-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.practiceId = btn.dataset.practiceId || '';
        renderTeacher();
      });
    });

    renderTeacherRows();
  }

  function renderTeacherRows() {
    const rows = state.notes
      .filter(n => n.area === state.area && n.practiceId === state.practiceId)
      .sort((a, b) => String(a.student).localeCompare(String(b.student), 'ca'));

    if (!rows.length) {
      $('notes-content').innerHTML = '<div class="notes-empty">No hi ha notes per aquesta pràctica.</div>';
      return;
    }

    $('notes-content').innerHTML = rows.map(n => `
      <div class="teacher-note-row">
        <div>
          <div class="teacher-note-name">${esc(n.student)}</div>
          <div class="teacher-note-id">${esc(n.studentId)}</div>
        </div>
        <div class="note-grade">${esc(n.grade)}</div>
      </div>
    `).join('');
  }

  function renderTeacher() {
    $('notes-title').textContent = 'Notes';
    const mark = $('notes-area-mark');
    mark.classList.remove('hidden');
    mark.textContent = state.area === 'Economia' ? 'E' : 'Σ';
    const other = state.area === 'Economia' ? 'Estadística' : 'Economia';
    mark.title = 'Canvia a ' + other;
    mark.setAttribute('aria-label', 'Canvia a ' + other);
    teacherPracticeButtons(state.notes);
  }

  function render() {
    const s = session();
    if (!s) {
      closePanel();
      return;
    }
    if (s.role === 'teacher') renderTeacher();
    else studentView(state.notes);
  }

  async function loadNotes() {
    if (state.loaded) {
      render();
      return;
    }

    setLoading();
    try {
      const result = await tracker.apiGet('notes');
      if (!result?.ok) {
        $('notes-content').innerHTML = result?.error === 'unauthorized'
          ? '<div class="notes-empty">La sessió ha caducat. Torna a entrar al portal.</div>'
          : '<div class="notes-empty">No s’han pogut carregar les notes.</div>';
        return;
      }
      state.notes = Array.isArray(result.notes) ? result.notes : [];
      state.loaded = true;
      render();
    } catch (_) {
      $('notes-content').innerHTML = '<div class="notes-empty">No s’han pogut carregar les notes.</div>';
    }
  }

  $('notes-button')?.addEventListener('click', showPanel);
  $('notes-close')?.addEventListener('click', closePanel);
  $('notes-area-mark')?.addEventListener('click', () => {
    state.area = state.area === 'Economia' ? 'Estadística' : 'Economia';
    state.practiceId = '';
    renderTeacher();
  });

  document.addEventListener('aula:notes-refresh', () => {
    state.loaded = false;
    if (!$('notes-panel').classList.contains('hidden')) loadNotes();
  });
})();
