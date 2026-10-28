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
      {title:'Introducció', practices:[
        {id:'excel-zero', label:'Pràctica 0 · Primer contacte amb Excel'}
      ]},
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
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const n = Number(String(value).trim().replace(',','.'));
    return Number.isFinite(n) ? n : null;
  }

  function formatGrade(value) {
    return Number(value).toLocaleString('ca-ES',{minimumFractionDigits:2,maximumFractionDigits:2});
  }

  function studentView(notes) {
    // Bloqueig global temporal: cap qualificacio ni comentari visible per a alumnes.
    state.practiceId = '';
    $('notes-practices').classList.add('hidden');
    $('notes-area-mark').classList.add('hidden');
    $('notes-title').textContent = 'Les meves notes';
    $('notes-content').innerHTML = '<div class="notes-empty">Les qualificacions no estan disponibles temporalment.</div>';
    return;
  }

  // Vista preparada, pero NO accessible: studentView() continua bloquejant les notes.
  // No activar aquesta funcio sense autoritzacio expressa del professor.
  const studentTopics = {
    Economia: [
      {id:'eco1', title:'Tema 1 · FPP', ids:['fpp'], weights:[1]},
      {id:'eco2', title:'Tema 2 · Oferta i demanda',
       ids:['oferta','demanda','oferta-demanda-repas','equilibri','equilibri-exercicis','exercici-equilibri-mercat-v2'],
       weights:[.15,.15,.15,.15,.10,.30]},
      {id:'eco3', title:'Tema 3 · Elasticitat', ids:['elasticitat'], weights:[1]}
    ],
    Estadística: [
      {id:'est1', title:'Tema 1 · Estadística descriptiva unidimensional',
       ids:['excel-zero','freq-var','descriptiva-1d','descriptiva-1d-examen'],
       weights:[.10,.15,.25,.50]},
      {id:'est2', title:'Tema 2 · Estadística descriptiva bidimensional',
       ids:['descriptiva-2d','descriptiva-2d-aplicada','descriptiva-2d-examen'],
       weights:[1,1,1]},
      {id:'est3', title:'Tema 3 · Sèries temporals',
       ids:['series-temporals-3a','series-temporals-3b','series-temporals-3c'],
       weights:[1,1,1]}
    ]
  };
  let studentExpandedTopic = '';

  function topicGrade(topic, byId) {
    // Una nota pendent no es zero. No es calcula cap global provisional.
    const grades = topic.ids.map(id => byId.has(id) ? parseGrade(byId.get(id).grade) : null);
    if (grades.some(g => g === null)) return null;
    const weightSum = topic.weights.reduce((a,b) => a+b, 0);
    return grades.reduce((sum,g,i) => sum+g*topic.weights[i],0)/weightSum;
  }

  function studentViewWhenEnabled(notes) {
    const mark = $('notes-area-mark');
    const area = state.area;
    const byId = new Map(notes.filter(n => n.area === area).map(n => [String(n.practiceId),n]));
    const topics = studentTopics[area] || [];
    $('notes-practices').classList.add('hidden');
    mark.classList.remove('hidden');
    mark.textContent = area === 'Economia' ? 'E' : 'Σ';
    const other = area === 'Economia' ? 'Estadística' : 'Economia';
    mark.title = 'Canvia a ' + other;
    mark.setAttribute('aria-label','Canvia a ' + other);
    $('notes-title').textContent = 'Les meves notes';

    $('notes-content').innerHTML =
      '<div class="student-notes-subject"><div class="student-notes-subject-head">' +
        '<div><div class="student-notes-label">Assignatura</div>' +
        '<div class="student-notes-subject-title">' + esc(area) + '</div></div></div>' +
      topics.map(topic => {
        const grade = topicGrade(topic,byId);
        const expanded = studentExpandedTopic === topic.id;
        const entries = topic.ids.map(id => ({id, note:byId.get(id)}))
          .filter(x => x.note && parseGrade(x.note.grade) !== null);
        return '<section class="student-notes-topic">' +
          '<button type="button" class="student-notes-topic-toggle" data-topic="' + esc(topic.id) +
            '" aria-expanded="' + expanded + '">' +
            '<span class="student-notes-topic-chevron">' + (expanded ? '▾' : '▸') + '</span>' +
            '<span class="student-notes-topic-title">' + esc(topic.title) + '</span>' +
            '<span class="student-notes-topic-grade">' + (grade === null ? 'Pendent' : formatGrade(grade)) + '</span>' +
          '</button>' +
          (expanded ? '<div class="student-notes-topic-body">' +
            (entries.length ? entries.map(({note}) =>
              '<div class="student-notes-row"><div class="student-notes-practice-wrap">' +
              '<div class="student-notes-practice">' + esc(note.practice || note.practiceId) + '</div>' +
              (note.comment ? '<div class="student-notes-comment">' + esc(note.comment) + '</div>' : '') +
              '</div><div class="student-notes-grade">' + formatGrade(parseGrade(note.grade)) + '</div></div>'
            ).join('') : '<div class="notes-empty">Encara no hi ha qualificacions publicades.</div>') +
            '</div>' : '') + '</section>';
      }).join('') + '</div>';

    $('notes-content').querySelectorAll('[data-topic]').forEach(btn => {
      btn.addEventListener('click', () => {
        studentExpandedTopic = studentExpandedTopic === btn.dataset.topic ? '' : btn.dataset.topic;
        studentViewWhenEnabled(state.notes);
      });
    });
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
        <div><div class="teacher-note-name">${esc(n.student)}</div>${n.comment ? `<div class="teacher-note-comment">${esc(n.comment)}</div>` : ''}</div>
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

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function loadNotes({attempts = 2} = {}) {
    if (state.loaded) {
      render();
      return;
    }

    setLoading();
    let last = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        last = await tracker.apiGet('notes');
        if (last?.ok) {
          state.notes = Array.isArray(last.notes) ? last.notes : [];
          state.loaded = true;
          render();
          return;
        }

        // Una sessió no autoritzada no millorarà repetint la mateixa petició.
        if (last?.error === 'unauthorized') break;
      } catch (error) {
        last = {ok:false, error:String(error && error.message || error)};
      }

      if (attempt < attempts - 1) await sleep(450);
    }

    const unauthorized = last?.error === 'unauthorized';
    $('notes-content').innerHTML = unauthorized
      ? '<div class="notes-empty">No s’ha pogut validar l’accés a Notes. La sessió del portal continua activa.</div>'
      : '<div class="notes-empty">No s’han pogut carregar les notes. <button type="button" id="notes-retry">Torna-ho a provar</button></div>';

    $('notes-retry')?.addEventListener('click', () => {
      loadNotes().catch(() => {});
    });
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
