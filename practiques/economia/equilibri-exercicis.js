(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const answers = {
    1:{t:'text',v:'Q1'},2:{t:'expr',v:'220-4p'},3:{t:'expr',v:'40+2p'},4:{t:'num',v:30},5:{t:'num',v:100},6:{t:'text',v:'Excés de demanda'},7:{t:'num',v:30},
    8:{t:'text',v:'Q1'},9:{t:'num',v:10},10:{t:'num',v:-12},11:{t:'num',v:100},12:{t:'text',v:'Excés de demanda'},13:{t:'num',v:48},14:{t:'text',v:'Segon grau'},
    15:{t:'num',v:30},16:{t:'num',v:150},17:{t:'expr',v:'276-5p'},18:{t:'num',v:-24},19:{t:'text',v:'Normal'},20:{t:'text',v:'Augmentaria'},
    21:{t:'num',v:40},22:{t:'num',v:200},23:{t:'expr',v:'392-4p'},24:{t:'num',v:32},25:{t:'text',v:'Substitutius'},26:{t:'text',v:'Complementaris'},
    27:{t:'expr',v:'5p-50'},28:{t:'num',v:55},29:{t:'num',v:225},30:{t:'expr',v:'480-5p'},31:{t:'text',v:'Inferior'},32:{t:'expr',v:'510-5p'},33:{t:'text',v:'Substitutius'},34:{t:'expr',v:'5p-90'},35:{t:'num',v:60},36:{t:'num',v:210},37:{t:'num',v:5},38:{t:'num',v:-15}
  };
  function num(v){const n=Number(String(v??'').trim().replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:NaN}
  function txt(v){return String(v??'').trim().toLocaleLowerCase('ca-ES').normalize('NFD').replace(/[\u0300-\u036f]/g,'')}
  function expr(v){return String(v??'').toLocaleLowerCase('ca-ES').replace(/\s+/g,'').replace(/,/g,'.').replace(/[−–—]/g,'-').replace(/[×·*]/g,'').replace(/^q[ds12]?=/,'').replace(/\^1/g,'')}
  function correct(n){
    const d=answers[n],el=$('answer-'+n); if(!d||!el)return false;
    if(d.t==='num'){const x=num(el.value);return Number.isFinite(x)&&Math.abs(x-d.v)<1e-6}
    if(d.t==='expr')return expr(el.value)===d.v;
    return txt(el.value)===txt(d.v);
  }
  function check(n){
    const box=$('check-'+n),el=$('answer-'+n); if(!box||!el)return;
    if(!String(el.value??'').trim()){box.className='q-check blank';box.textContent='·';return}
    const ok=correct(n); box.className='q-check '+(ok?'correct':'wrong'); box.textContent=ok?'✓':'✕';
  }
  Object.keys(answers).forEach(k=>{
    const n=Number(k),el=$('answer-'+n); if(!el)return;
    el.addEventListener('change',()=>check(n));
    if(el.tagName!=='SELECT'){el.addEventListener('blur',()=>check(n));el.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();el.blur()}})}
  });

  const pdfInput=$('resolution-pdf'),uploadBtn=$('upload-pdf'),pdfStatus=$('pdf-status'),idStatus=$('market-id-status');
  function updatePdfEnabled(){const ok=idStatus?.classList.contains('ok');pdfInput.disabled=!ok;uploadBtn.disabled=!ok||!pdfInput.files?.length}
  new MutationObserver(updatePdfEnabled).observe(idStatus,{attributes:true,childList:true,subtree:true});
  pdfInput.addEventListener('change',()=>{
    pdfStatus.textContent='';pdfStatus.style.color='';
    const file=pdfInput.files?.[0];
    if(file && file.type!=='application/pdf'){pdfStatus.textContent='Selecciona un fitxer PDF.';pdfInput.value=''}
    updatePdfEnabled();
  });
  uploadBtn.addEventListener('click',async()=>{
    const file=pdfInput.files?.[0]; if(!file)return;
    if(file.size>10*1024*1024){pdfStatus.textContent='El PDF supera els 10 MB.';return}
    uploadBtn.disabled=true;pdfStatus.textContent='Pujant…';pdfStatus.style.color='';
    const tracker=window.PracticeTracker;
    const result=await tracker.uploadPdf(file,{practice:"Pràctica 2d · Exercicis d'equilibri de mercat",area:'Economia'});
    if(result.ok){pdfStatus.textContent='PDF enviat correctament.';pdfStatus.style.color='#26713c'}
    else{pdfStatus.textContent='No s’ha pogut enviar el PDF.';pdfStatus.style.color='#a52a2a';uploadBtn.disabled=false}
  });
  updatePdfEnabled();
})();