(() => {
  'use strict';
  const $ = id => document.getElementById(id);

  const answers = {
    1:{type:'text',value:'Q1'},
    2:{type:'expr',value:'220-4p'},
    3:{type:'expr',value:'40+2p'},
    4:{type:'num',value:30},
    5:{type:'num',value:100},
    6:{type:'text',value:'Excés de demanda'},
    7:{type:'num',value:30},
    8:{type:'text',value:'Q1'},
    9:{type:'num',value:10},
    10:{type:'num',value:-12},
    11:{type:'num',value:100},
    12:{type:'text',value:'Excés de demanda'},
    13:{type:'num',value:48},
    14:{type:'text',value:'Segon grau'},
    15:{type:'num',value:30},
    16:{type:'num',value:150},
    17:{type:'expr',value:'276-5p'},
    18:{type:'num',value:-24},
    19:{type:'text',value:'Normal'},
    20:{type:'text',value:'Augmentaria'},
    21:{type:'num',value:40},
    22:{type:'num',value:200},
    23:{type:'expr',value:'392-4p'},
    24:{type:'num',value:32},
    25:{type:'text',value:'Substitutius'},
    26:{type:'text',value:'Complementaris'},
    27:{type:'expr',value:'5p-50'},
    28:{type:'num',value:55},
    29:{type:'num',value:225},
    30:{type:'expr',value:'480-5p'},
    31:{type:'text',value:'Inferior'},
    32:{type:'expr',value:'510-5p'},
    33:{type:'text',value:'Substitutius'},
    34:{type:'expr',value:'5p-90'},
    35:{type:'num',value:60},
    36:{type:'num',value:210},
    37:{type:'num',value:5},
    38:{type:'num',value:-15}
  };

  function parseNumber(v){
    const s=String(v??'').trim().replace(/\s/g,'').replace(',','.');
    const n=Number(s);
    return Number.isFinite(n)?n:NaN;
  }

  function normalizeText(v){
    return String(v??'').trim().toLocaleLowerCase('ca-ES').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  }

  function normalizeExpr(v){
    return String(v??'')
      .toLocaleLowerCase('ca-ES')
      .replace(/\s+/g,'')
      .replace(/,/g,'.')
      .replace(/[−–—]/g,'-')
      .replace(/[×·*]/g,'')
      .replace(/^q[ds]?=/,'')
      .replace(/^q[12]=/,'')
      .replace(/\^1/g,'');
  }

  function isCorrect(n){
    const def=answers[n], el=$('answer-'+n);
    if(!def||!el) return false;
    if(def.type==='num'){
      const x=parseNumber(el.value);
      return Number.isFinite(x) && Math.abs(x-def.value)<1e-6;
    }
    if(def.type==='expr') return normalizeExpr(el.value)===def.value;
    return normalizeText(el.value)===normalizeText(def.value);
  }

  function check(n){
    const box=$('check-'+n);
    if(!box) return;
    const value=String($('answer-'+n)?.value??'').trim();
    if(!value){box.className='q-check blank';box.textContent='·';return;}
    if(isCorrect(n)){box.className='q-check correct';box.textContent='✓';}
    else{box.className='q-check wrong';box.textContent='✕';}
  }

  Object.keys(answers).forEach(k=>{
    const n=Number(k), el=$('answer-'+n);
    if(!el) return;
    el.addEventListener('change',()=>check(n));
    if(el.tagName!=='SELECT'){
      el.addEventListener('blur',()=>check(n));
      el.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();el.blur();}});
    }
  });

  const pdfInput=$('resolution-pdf');
  const uploadBtn=$('upload-pdf');
  const pdfStatus=$('pdf-status');
  const idStatus=$('market-id-status');

  function updatePdfEnabled(){
    const ok=idStatus?.classList.contains('ok');
    pdfInput.disabled=!ok;
    uploadBtn.disabled=!ok || !pdfInput.files?.length;
  }

  new MutationObserver(updatePdfEnabled).observe(idStatus,{attributes:true,childList:true,subtree:true});
  pdfInput.addEventListener('change',()=>{
    pdfStatus.textContent='';
    if(pdfInput.files?.[0] && pdfInput.files[0].type!=='application/pdf'){
      pdfStatus.textContent='Selecciona un PDF.';
      pdfInput.value='';
    }
    updatePdfEnabled();
  });

  uploadBtn.addEventListener('click',async()=>{
    const file=pdfInput.files?.[0];
    if(!file) return;
    if(file.size>10*1024*1024){pdfStatus.textContent='El PDF supera els 10 MB.';return;}
    uploadBtn.disabled=true;
    pdfStatus.textContent='Pujant…';
    const tracker=window.PracticeTracker;
    const result=await tracker.uploadPdf(file,{
      practice:'Pràctica 2c · Equilibri',
      area:'Economia',
      submissionId:tracker.stablePracticeSubmissionId('practiques/economia/equilibri.html',tracker.getSession()?.id||'')
    });
    if(result.ok){
      pdfStatus.textContent='PDF enviat correctament.';
      pdfStatus.style.color='#26713c';
    }else{
      pdfStatus.textContent='No s’ha pogut enviar el PDF.';
      pdfStatus.style.color='#a52a2a';
      uploadBtn.disabled=false;
    }
  });

  updatePdfEnabled();
})();