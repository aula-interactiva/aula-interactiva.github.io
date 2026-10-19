(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const tracker = window.PracticeTracker;
  const idInput = $('student-id'), validateBtn = $('market-validate-id');
  const idStatus = $('market-id-status'), pdfInput = $('resolution-pdf');
  const uploadBtn = $('upload-pdf'), pdfStatus = $('pdf-status');
  let validatedId = '';
  function enable() {
    const ok = !!validatedId;
    pdfInput.disabled = !ok;
    uploadBtn.disabled = !ok || !pdfInput.files?.length;
  }
  async function validate() {
    const id = tracker.normalizeId(idInput.dataset.studentId || idInput.value);
    validatedId = '';
    enable();
    validateBtn.disabled = true;
    idStatus.textContent = 'Comprovant ID…';
    const result = await tracker.validateId(id);
    validateBtn.disabled = false;
    if (result.ok) {
      validatedId = result.id;
      idStatus.className = 'pilot-status ok';
      idStatus.textContent = 'ID correcte · ja pots pujar el PDF.';
      document.dispatchEvent(new CustomEvent('aula:student-validated', {detail:{id:validatedId}}));
    } else {
      idStatus.className = 'pilot-status bad';
      idStatus.textContent = result.reason === 'not-found' ? 'Aquest ID no és a la llista d’alumnes.' : 'No s’ha pogut validar l’ID.';
    }
    enable();
  }
  idInput.addEventListener('input', () => {
    idInput.dataset.studentId = '';
    validatedId = '';
    idStatus.textContent = 'Valida el teu ID per pujar el PDF.';
    idStatus.className = 'pilot-status';
    enable();
  });
  idInput.addEventListener('keydown', e => {if(e.key === 'Enter'){e.preventDefault();validate();}});
  validateBtn.addEventListener('click', validate);
  pdfInput.addEventListener('change', () => {
    pdfStatus.textContent = '';
    const file = pdfInput.files?.[0];
    if(file && !(/\.pdf$/i.test(file.name) || file.type === 'application/pdf')){
      pdfStatus.textContent = 'Selecciona un fitxer PDF.';
      pdfInput.value = '';
    }
    enable();
  });
  uploadBtn.addEventListener('click', async () => {
    const file = pdfInput.files?.[0];
    if (!validatedId || !file) return;
    if(file.size > 10*1024*1024){pdfStatus.textContent = 'El PDF supera els 10 MB.';return;}
    uploadBtn.disabled = true;
    pdfStatus.textContent = 'Pujant…';
    try {
      const result = await tracker.uploadPdf(file,{practice:"Pràctica 2e · Exercicis d'equilibri de mercat",area:'Economia'});
      pdfStatus.textContent = result.ok ? 'PDF enviat correctament.' : 'No s’ha pogut enviar el PDF.';
      pdfStatus.style.color = result.ok ? '#26713c' : '#a52a2a';
    } catch(error) {
      pdfStatus.textContent = 'No s’ha pogut enviar el PDF.';
      pdfStatus.style.color = '#a52a2a';
    }
    enable();
  });
  const session = tracker.getSession();
  if(session?.role === 'student' && /^\d{6}$/.test(tracker.normalizeId(session.id))){
    idInput.dataset.studentId = tracker.normalizeId(session.id);
    validate();
  } else {
    idStatus.textContent = 'Valida el teu ID per pujar el PDF.';
    enable();
  }
})();
