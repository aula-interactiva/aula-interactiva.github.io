(() => {
  'use strict';

  const cfg = window.EconomyPracticePilotConfig;
  const tracker = window.PracticeTracker;
  if (!cfg || !tracker) return;

  const $ = id => document.getElementById(id);
  const idInput = $(cfg.idInput);
  const validateBtn = $(cfg.validateButton);
  const idStatus = $(cfg.idStatus);
  const submitBtn = $(cfg.submitButton);
  const submitStatus = $(cfg.submitStatus);

  if (!idInput || !validateBtn || !idStatus || !submitBtn || !submitStatus) return;

  const NQ = Number(cfg.questionCount) || 0;
  const attempts = Array(NQ).fill(0);
  const lastChecked = Array(NQ).fill(null);
  let validatedId = '';
  let startedAt = null;
  let elapsedBeforeMs = 0;
  let submitted = false;

  const justifications = Array.isArray(cfg.justifications) ? cfg.justifications : [];

  function templated(template, n) {
    return String(template || '').replace('{n}', String(n));
  }

  function answerId(i) {
    const n = i + 1;
    if (cfg.answerTemplate) return templated(cfg.answerTemplate, n);
    return `${cfg.answerPrefix}-answer-${n}`;
  }

  function checkId(i) {
    const n = i + 1;
    if (cfg.checkTemplate) return templated(cfg.checkTemplate, n);
    return `${cfg.answerPrefix}-check-${n}`;
  }

  function answerControls() {
    return Array.from({length: NQ}, (_, i) => $(answerId(i))).filter(Boolean);
  }

  function setAnswersEnabled(enabled) {
    answerControls().forEach(el => el.disabled = !enabled);
    justifications.forEach(j => {
      const el = $(j.id);
      if (el) el.disabled = !enabled;
    });
    submitBtn.disabled = !enabled || submitted;
  }

  function setIdState(kind, text) {
    idStatus.className = `pilot-status ${kind || ''}`.trim();
    idStatus.textContent = text;
  }

  function setFinalReadOnly() {
    document.querySelectorAll('input,select,textarea,button').forEach(el => {
      if (el === idInput || el === validateBtn) return;
      if (el.closest('.app-topbar') && el.tagName === 'BUTTON') return;
      if (el.id === 'aula-save-exit') return;
      if (el.matches('.back-btn')) return;
      el.disabled = true;
    });
    const saveExit = document.getElementById('aula-save-exit');
    if (saveExit) saveExit.hidden = true;
  }

  async function restoreFinalSubmission() {
    if (!tracker.getPracticeSubmission) return false;

    const final = await tracker.getPracticeSubmission(location.pathname);

    // Si el backend antic encara només pot confirmar l'entrega però no retornar-ne
    // el contingut, no mostrem una còpia buida com si fos la pràctica original.
    if (!final?.ok || !final.submitted) {
      const status = await tracker.checkPracticeSubmitted({fitxer: location.pathname});
      if (!status?.ok || !status.submitted) return false;

      resetWork();
      submitted = true;
      startedAt = null;
      submitBtn.textContent = 'Entrega ja registrada';
      submitBtn.disabled = true;
      submitStatus.className = 'pilot-submit-status bad';
      submitStatus.textContent = 'Hi ha una entrega registrada, però no se n’ha pogut recuperar el contingut. Torna-ho a provar més tard.';
      return true;
    }

    resetWork();

    const savedQuestions = Array.isArray(final.detail?.questions)
      ? final.detail.questions
      : [];

    savedQuestions.forEach(item => {
      const n = Number(item?.question);
      if (!Number.isFinite(n) || n < 1 || n > NQ) return;

      const i = n - 1;
      const control = $(answerId(i));
      const box = $(checkId(i));
      const value = String(item?.answer ?? '');

      if (control) control.value = value;
      attempts[i] = Math.max(0, Number(item?.attempts) || 0);
      lastChecked[i] = value || null;

      if (box) {
        const ok = item?.correct === true || String(item?.correct).toLowerCase() === 'true';
        box.className = 'q-check ' + (ok ? 'correct' : 'wrong');
        box.textContent = ok ? 'Correcte' : 'Revisa-ho';
      }
    });

    const savedJustifications = Array.isArray(final.justifications)
      ? final.justifications
      : [];

    justifications.forEach((j, index) => {
      const el = $(j.id);
      if (!el) return;

      const byQuestion = savedJustifications.find(x =>
        String(x?.question || '').trim() === String(j.question || '').trim()
      );
      const item = byQuestion || savedJustifications[index];
      if (item) el.value = String(item.text ?? '');
    });

    elapsedBeforeMs = Math.max(0, Number(final.minutes) || 0) * 60000;
    submitted = false;
    startedAt = Date.now();
    setAnswersEnabled(true);

    submitBtn.textContent = 'Torna a entregar';
    submitBtn.disabled = false;
    submitStatus.className = 'pilot-submit-status ok';
    submitStatus.textContent = 'Hem carregat l’última entrega registrada. Pots modificar-la i tornar-la a entregar mentre la pràctica continuï oberta.';

    // L'entrega del servidor és el punt de partida autoritatiu: substitueix qualsevol
    // esborrany local antic perquè no reaparegui una còpia diferent en recarregar.
    tracker.saveDraftNow?.();

    return true;
  }

  function resetWork() {
    answerControls().forEach((el, i) => {
      el.value = '';
      attempts[i] = 0;
      lastChecked[i] = null;
      const box = $(checkId(i));
      if (box) {
        box.className = 'q-check blank';
        box.textContent = '·';
      }
    });

    justifications.forEach(j => {
      const el = $(j.id);
      if (el) el.value = '';
    });

    elapsedBeforeMs = 0;
    submitted = false;
    submitBtn.textContent = 'Entrega la pràctica';
    submitStatus.className = 'pilot-submit-status';
    submitStatus.textContent = '';
  }

  function invalidateId() {
    if (!validatedId && !startedAt) {
      setAnswersEnabled(false);
      setIdState('', 'Valida el teu ID de 6 dígits per començar.');
      return;
    }

    validatedId = '';
    startedAt = null;
    resetWork();
    setAnswersEnabled(false);
    setIdState('', 'Valida el teu ID de 6 dígits per començar.');
  }

  async function validateStudent() {
    const id = tracker.normalizeId(idInput.value);
    idInput.value = id;
    validateBtn.disabled = true;
    setIdState('checking', 'Comprovant ID…');

    const result = await tracker.validateId(id);
    validateBtn.disabled = false;

    if (result.ok) {
      validatedId = result.id;
      startedAt = Date.now();

      setIdState('checking', 'Comprovant si ja hi ha una entrega registrada…');
      if (await restoreFinalSubmission()) {
        setIdState('ok', 'ID correcte · mostrant l’entrega registrada.');
        return;
      }

      resetWork();
      setAnswersEnabled(true);
      setIdState('ok', 'ID correcte · ja pots començar.');
      answerControls()[0]?.focus();
      return;
    }

    validatedId = '';
    startedAt = null;
    setAnswersEnabled(false);
    if (result.reason === 'format') setIdState('bad', 'L’ID ha de tenir 6 dígits.');
    else if (result.reason === 'not-found') setIdState('bad', 'Aquest ID no és a la llista d’alumnes.');
    else setIdState('bad', 'No s’ha pogut validar l’ID. Torna-ho a provar.');
  }

  function recordAttempt(i) {
    if (!validatedId) return false;
    const control = $(answerId(i));
    if (!control) return false;
    const value = String(control.value ?? '').trim();
    if (!value || value === lastChecked[i]) return false;
    lastChecked[i] = value;
    attempts[i] += 1;
    return true;
  }

  function logProgressUpdate() {
    if (!validatedId || submitted) return;
    const results = currentResults();
    tracker.logActivity('PROGRESS_UPDATE', {
      practice: cfg.practice,
      area: cfg.area || 'Economia',
      title: document.title,
      progress: NQ ? results.correct / NQ * 100 : 0
    });
  }

  function currentResults() {
    const detail = [];
    let answered = 0;
    let correct = 0;

    for (let i = 0; i < NQ; i++) {
      const control = $(answerId(i));
      const box = $(checkId(i));
      const value = String(control?.value ?? '').trim();
      const isCorrect = !!box?.classList.contains('correct');

      if (value) answered += 1;
      if (isCorrect) correct += 1;

      detail.push({
        question: i + 1,
        answer: value,
        correct: isCorrect,
        attempts: attempts[i]
      });
    }

    return {detail, answered, correct};
  }

  function getJustifications() {
    return justifications.map(j => ({
      question: j.question,
      text: String($(j.id)?.value ?? '').trim()
    }));
  }

  async function submitPractice() {
    if (!validatedId) {
      setIdState('bad', 'Primer has de validar l’ID.');
      return;
    }

    const results = currentResults();

    if (results.answered < NQ) {
      submitStatus.className = 'pilot-submit-status bad';
      submitStatus.textContent = `Encara falten ${NQ - results.answered} respostes.`;
      return;
    }

    if (results.correct < NQ) {
      submitStatus.className = 'pilot-submit-status bad';
      submitStatus.textContent = `Revisa les respostes: n’hi ha ${NQ - results.correct} que encara no són correctes.`;
      return;
    }

    const justs = getJustifications();
    const minChars = Number(cfg.minJustificationChars) || 40;
    const short = justs.filter(j => j.text.length < minChars);

    if (short.length) {
      submitStatus.className = 'pilot-submit-status bad';
      submitStatus.textContent = `Completa les ${justifications.length} justificacions (mínim orientatiu: ${minChars} caràcters cadascuna).`;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviant…';
    submitStatus.className = 'pilot-submit-status';
    submitStatus.textContent = 'Guardant l’entrega al registre…';

    const submissionId = tracker.makeSubmissionId(cfg.slug, validatedId);
    const totalAttempts = attempts.reduce((a, b) => a + b, 0);
    const elapsedMs = elapsedBeforeMs + (startedAt ? Math.max(0, Date.now() - startedAt) : 0);
    const minutes = elapsedMs ? Math.max(1, Math.round(elapsedMs / 60000)) : '';

    const payload = {
      submissionId,
      id: validatedId,
      practice: cfg.practice,
      area: cfg.area || 'Economia',
      status: 'Entregada',
      total: NQ,
      correct: results.correct,
      attempts: totalAttempts,
      progress: Math.round(results.correct / NQ * 100),
      minutes,
      version: cfg.version || 'pilot-2',
      detail: {questions: results.detail},
      justifications: justs
    };

    const result = await tracker.submit(payload);

    if (result.ok) {
      submitted = true;
      submitBtn.textContent = 'Pràctica entregada';
      submitBtn.disabled = true;
      submitStatus.className = 'pilot-submit-status ok';
      submitStatus.textContent = 'Entrega registrada correctament.';
      answerControls().forEach(el => el.disabled = true);
      justifications.forEach(j => {
        const el = $(j.id);
        if (el) el.disabled = true;
      });
    } else {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Entrega la pràctica';
      submitStatus.className = 'pilot-submit-status bad';
      submitStatus.textContent = 'No s’ha pogut confirmar l’entrega. No es donarà per entregada; torna-ho a provar.';
    }
  }

  function wireAttempts() {
    for (let i = 0; i < NQ; i++) {
      const c = $(answerId(i));
      if (!c) continue;
      const handler = event => {
        if (!event.isTrusted) return;
        setTimeout(() => {
          if (recordAttempt(i)) logProgressUpdate();
        }, 0);
      };
      c.addEventListener('change', handler);
      if (c.tagName !== 'SELECT') c.addEventListener('blur', handler);
    }
  }

  // Persist practice-local counters alongside the generic field draft.
  // This keeps attempts and elapsed time coherent across "Desa i surt" / reopen.
  window.AulaDraftState = {
    get() {
      return {
        pilot: {
          attempts: attempts.slice(),
          lastChecked: lastChecked.slice(),
          elapsedMs: elapsedBeforeMs + (startedAt ? Math.max(0, Date.now() - startedAt) : 0)
        }
      };
    },
    restore(state) {
      const pilot = state && state.pilot;
      if (!pilot) return true;

      if (Array.isArray(pilot.attempts)) {
        for (let i = 0; i < NQ; i++) attempts[i] = Math.max(0, Number(pilot.attempts[i]) || 0);
      }
      if (Array.isArray(pilot.lastChecked)) {
        for (let i = 0; i < NQ; i++) lastChecked[i] = pilot.lastChecked[i] == null ? null : String(pilot.lastChecked[i]);
      }

      elapsedBeforeMs = Math.max(0, Number(pilot.elapsedMs) || 0);
      if (validatedId) startedAt = Date.now();
      return true;
    }
  };

  document.addEventListener('aula:draft-restored', () => {
    setTimeout(() => {
      answerControls().forEach(control => {
        if (String(control.value ?? '').trim()) {
          control.dispatchEvent(new Event('change', {bubbles: true}));
        }
      });
    }, 120);
  });

  idInput.maxLength = 6;
  idInput.value = '';
  idInput.placeholder = '6 dígits';

  idInput.addEventListener('input', () => {
    const normalized = tracker.normalizeId(idInput.value);
    if (idInput.value !== normalized) idInput.value = normalized;
    invalidateId();
  });

  idInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      validateStudent();
    }
  });

  validateBtn.addEventListener('click', validateStudent);
  submitBtn.addEventListener('click', submitPractice);

  wireAttempts();
  resetWork();
  setAnswersEnabled(false);
  setIdState('', 'Valida el teu ID de 6 dígits per començar.');
})();
