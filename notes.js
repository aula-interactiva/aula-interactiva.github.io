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
    document.querySelector('.hub-hero')?.classList.add('hidden');
    document.querySelector('.session-bar')?.classList.add('hidden');
    $('notes-panel').classList.remove('hidden');
    $('practice-grid').classList.add('hidden');
    loadNotes();
  }

  function closePanel() {
    state.practiceId = '';
    $('notes-panel').classList.add('hidden');
    $('practice-grid').classList.remove('hidden');
    document.querySelector('.hub-hero')?.classList.remove('hidden');
    document.querySelector('.session-bar')?.classList.remove('hidden');
  }

  function setLoading() {
    $('notes-practices').classList.remove('hidden');
    $('notes-practices').innerHTML = '';
    $('notes-content').innerHTML = '<div class="notes-empty">Carregant notes…</div>';
  }

  const studentStructure = {
    Economia: [
      {title:'Tema 1 · FPP', practices:[
        {id:'fpp', label:'Pràctica 1 · FPP'}
      ]},
      {title:'Tema 2 · Oferta i demanda', practices:[
        {id:'oferta', label:'Pràctica 2a · Oferta'},
        {id:'demanda', label:'Pràctica 2b · Demanda'},
        {id:'equilibri', label:'Pràctica 2c · Equilibri'},
        {id:'equilibri-exercicis', label:'Pràctica 2d · Exercicis'}
      ]},
      {title:'Tema 3 · Elasticitat', practices:[
        {id:'elasticitat', label:'Pràctica 3 · Elasticitat'}
      ]}
    ],
    Estadística: [
      {title:'Tema 1 · Estadística descriptiva unidimensional', practices:[
        {id:'freq-var', label:'Pràctica 1a · Taules de freqüències i dispersió'},
        {id:'descriptiva-1d', label:'Pràctica 1b'},
        {id:'descriptiva-1d-examen', label:'Pràctica 1c'}
      ]},
      {title:'Tema 2 · Estadística descriptiva bidimensional', practices:[
        {id:'descriptiva-2d', label:'Pràctica 2a'},
        {id:'descriptiva-2d-aplicada', label:'Pràctica 2b'},
        {id:'descriptiva-2d-examen', label:'Pràctica 2c'}
      ]},
      {title:'Tema 3 · Sèries temporals', practices:[
        {id:'series-temporals-1', label:'Pràctica 3a'},
        {id:'series-temporals-2', label:'Pràctica 3b'},
        {id:'series-temporals-3', label:'Pràctica 3c'}
      ]}
    ]
  };

  function parseGrade(value) {
    const n = Number(String(value ?? '').trim().replace(',','.'));
    return Number.isFinite(n) ? n : null;
  }

  function formatGrade(value) {
    return Number(value).toLocaleString('ca-ES',{minimumFractionDigits:2,maximumFractionDigits:2});
  }

  function studentView(notes) {
    const mark = $('notes-area-mark');
    state.practiceId = '';
    $('notes-practices').classList.add('hidden');
    mark.classList.remove('hidden');
    $('notes-title').textContent = 'Les meves notes';
    mark.textContent = state.area === 'Economia' ? 'E' : 'Σ';
    const other = state.area === 'Economia' ? 'Estadística' : 'Economia';
    mark.title = 'Canvia a ' + other;
    mark.setAttribute('aria-label', 'Canvia a ' + other);

    const areaNotes = notes.filter(n => n.area === state.area);
    const byId = new Map(areaNotes.map(n => [String(n.practiceId), n]));
    const topics = studentStructure[state.area] || [];

    if (!topics.length) {
      $('notes-content').innerHTML = '<div class="notes-empty">Encara no hi ha estructura de notes per aquesta assignatura.</div>';
      return;
    }

    $('notes-content').innerHTML = '<div class="student-notes-subject">' +
      '<div class="student-notes-subject-head">' +
        '<div><div class="student-notes-label">Assignatura</div><div class="student-notes-subject-title">' + esc(state.area) + '</div></div>' +
      '</div>' +
      topics.map(topic => {
        const rows = topic.practices.map(p => {
          const note = byId.get(p.id);
          const grade = note ? parseGrade(note.grade) : null;
          return {
            ...p,
            label: note?.practice || p.label,
            grade
          };
        });
        const complete = rows.length > 0 && rows.every(r => r.grade !== null);
        const topicGrade = complete
          ? rows.reduce((sum,r)=>sum+r.grade,0) / rows.length
          : null;

        return '<section class="student-notes-topic">' +
          '<div class="student-notes-topic-head">' +
            '<div class="student-notes-topic-title">' + esc(topic.title) + '</div>' +
            '<div class="student-notes-topic-grade ' + (topicGrade===null?'pending':'') + '">' +
              (topicGrade===null ? '—' : formatGrade(topicGrade)) +
            '</div>' +
          '</div>' +
          '<div class="student-notes-topic-body">' +
            rows.map(r =>
              '<div class="student-notes-row">' +
                '<div class="student-notes-practice">' + esc(r.label) + '</div>' +
                '<div class="student-notes-grade ' + (r.grade===null?'pending':'') + '">' +
                  (r.grade===null ? 'Pendent' : formatGrade(r.grade)) +
                '</div>' +
              '</div>'
            ).join('') +
          '</div>' +
        '</section>';
      }).join('') +
    '</div>';
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

    $('notes-practices').innerHTML = buttons.map(([id, label]) => `
      <button class="notes-practice-btn ${id === state.practiceId ? 'active' : ''}" type="button" data-practice-id="${esc(id)}">${esc(label)}</button>
    `).join('');

    $('notes-practices').querySelectorAll('.notes-practice-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.practiceId = btn.dataset.practiceId || '';
        renderTeacher();
      });
    });

    if (!state.practiceId) {
      $('notes-content').innerHTML = '';
      return;
    }

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
        <div class="teacher-note-name">${esc(n.student)}</div>
        <div class="note-grade">${esc(n.grade)}</div>
      </div>
    `).join('');
  }

  function renderTeacher() {
    const mark = $('notes-area-mark');
    $('notes-practices').classList.toggle('hidden', Boolean(state.practiceId));
    mark.classList.toggle('hidden', Boolean(state.practiceId));
    $('notes-title').textContent = state.practiceId ? '' : 'Notes';
    mark.textContent = state.area === 'Economia' ? 'E' : 'Σ';
    const other = state.area === 'Economia' ? 'Estadística' : 'Economia';
    mark.title = 'Canvia a ' + other;
    mark.setAttribute('aria-label', 'Canvia a ' + other);
    teacherPracticeButtons(state.notes);
    if (state.practiceId) {
      const selected = state.notes.find(n => n.area === state.area && n.practiceId === state.practiceId);
      $('notes-title').textContent = selected?.practice || 'Notes';
    }
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
          ? '<div class="notes-empty">No s’ha pogut validar l’accés a Notes. La sessió del portal continua activa.</div>'
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
  $('notes-close')?.addEventListener('click', () => {
    if (state.practiceId) {
      state.practiceId = '';
      render();
      return;
    }
    closePanel();
  });
  $('notes-area-mark')?.addEventListener('click', () => {
    state.area = state.area === 'Economia' ? 'Estadística' : 'Economia';
    state.practiceId = '';
    render();
  });

  document.addEventListener('aula:notes-refresh', () => {
    state.loaded = false;
    if (!$('notes-panel').classList.contains('hidden')) loadNotes();
  });
})();
