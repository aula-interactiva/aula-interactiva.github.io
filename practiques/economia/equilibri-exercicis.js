(() => {
  'use strict';

  const tracker = window.PracticeTracker;
  const input = document.getElementById('work-pdf');
  const button = document.getElementById('submit-pdf');
  const status = document.getElementById('pdf-status');
  if (!tracker || !input || !button || !status) return;

  const PRACTICE = "Pràctica 2e · Exercicis d'equilibri de mercat";
  const AREA = 'Economia';

  function setStatus(text, kind = '') {
    status.textContent = text;
    status.style.color = kind === 'ok' ? '#26713c' : kind === 'bad' ? '#a52a2a' : '';
  }

  function selectedPdf() {
    const file = input.files?.[0] || null;
    if (!file) return null;
    const nameOk = String(file.name || '').toLowerCase().endsWith('.pdf');
    const typeOk = !file.type || file.type === 'application/pdf';
    return nameOk && typeOk ? file : null;
  }

  input.addEventListener('change', () => {
    setStatus('');
    const file = input.files?.[0];
    if (!file) {
      button.disabled = true;
      return;
    }
    if (!selectedPdf()) {
      input.value = '';
      button.disabled = true;
      setStatus('Selecciona un fitxer PDF.', 'bad');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      input.value = '';
      button.disabled = true;
      setStatus('El PDF supera els 10 MB.', 'bad');
      return;
    }
    button.disabled = false;
  });

  button.addEventListener('click', async () => {
    const file = selectedPdf();
    if (!file) return;

    button.disabled = true;
    input.disabled = true;
    setStatus('Enviant el PDF…');

    try {
      const uploaded = await tracker.uploadPdf(file, {practice: PRACTICE, area: AREA});
      if (!uploaded?.ok) {
        setStatus('No s’ha pogut enviar el PDF. Torna-ho a provar.', 'bad');
        button.disabled = false;
        input.disabled = false;
        return;
      }

      const submitted = await tracker.submit({
        id: tracker.getSession()?.id || '',
        practice: PRACTICE,
        area: AREA,
        answers: [],
        attempts: [],
        justifications: [],
        detail: {
          tipusEntrega: 'pdf',
          documentTreballEscanejat: true
        },
        status: 'Entrega'
      });

      if (!submitted?.ok) {
        setStatus('El PDF s’ha pujat, però no s’ha pogut confirmar l’entrega. Torna-ho a provar.', 'bad');
        button.disabled = false;
        input.disabled = false;
        return;
      }

      setStatus('Pràctica entregada correctament.', 'ok');
    } catch (_) {
      setStatus('No s’ha pogut completar l’entrega. Torna-ho a provar.', 'bad');
      button.disabled = false;
      input.disabled = false;
    }
  });
})();
