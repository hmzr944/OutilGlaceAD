import { useState, useEffect, useCallback, useRef } from "react";
import { storage, history as historyAPI } from "./storage";

/* ═══════════════════════════
   DONNÉES
═══════════════════════════ */
const RECIPES = [
  { id:"fraises",   name:"Fraises Garriguettes",    type:"Sorbet", rate:1.25 },
  { id:"mangue",    name:"Mangue Passion Coriandre", type:"Sorbet", rate:1.25 },
  { id:"praline",   name:"Praliné Noisette",         type:"Glace",  rate:1.25 },
  { id:"coco",      name:"Coco & Citron Vert",       type:"Sorbet", rate:1.00 },
  { id:"choc_mad",  name:"Chocolat Madagascar",      type:"Sorbet", rate:0.75 },
  { id:"cafe",      name:"Café",                     type:"Glace",  rate:0.75 },
  { id:"pampl",     name:"Pamplemousse & Vermouth",  type:"Sorbet", rate:0.50 },
  { id:"stracc",    name:"Stracciatella",             type:"Glace",  rate:0.50 },
  { id:"cerise",    name:"Cerise Orgeat",             type:"Sorbet", rate:0.50 },
  { id:"citron",    name:"Citron",                   type:"Sorbet", rate:0.30 },
  { id:"pistache",  name:"Pistache",                 type:"Glace",  rate:0.30 },
  { id:"choc_peru", name:"Chocolat Pérou",           type:"Glace",  rate:0.30 },
  { id:"herbes",    name:"Herbes Fraîches",           type:"Sorbet", rate:0.20 },
  { id:"amande",    name:"Amande & Vanille",          type:"Sorbet", rate:0.15 },
  { id:"vanille",   name:"Trois Vanilles",            type:"Glace",  rate:0.15 },
];

const ZONES    = [
  { id:"reserve",  label:"Réserve",  sub:"Stockage froid −18°C" },
  { id:"taxi",     label:"Taxi",     sub:"Transit grand froid"  },
  { id:"boutique", label:"Boutique", sub:"Pozzetti — vente"     },
];
const JOURS    = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
/* C8 — Coefficients saisonniers par semaine ISO (1-52) */
const SEASONAL_BY_WEEK = {
   1:0.55, 2:0.55, 3:0.60, 4:0.60, 5:0.65, 6:0.65,
   7:0.70, 8:0.70, 9:0.75,10:0.80,11:0.85,12:0.90,
  13:0.95,14:1.00,15:1.05,16:1.10,17:1.15,18:1.20,
  19:1.30,20:1.40,21:1.55,22:1.70,23:1.85,24:2.00,
  25:2.20,26:2.40,27:2.60,28:2.70,29:2.70,30:2.65,
  31:2.60,32:2.50,33:2.35,34:2.15,35:1.95,36:1.75,
  37:1.55,38:1.35,39:1.20,40:1.10,41:1.00,42:0.90,
  43:0.85,44:0.80,45:0.75,46:0.70,47:0.65,48:0.65,
  49:0.60,50:0.58,51:0.55,52:0.55,
};

/* Numéro de semaine ISO d'une date */
const getISOWeek = date => {
  const d = new Date(date);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const y = new Date(d.getFullYear(),0,1);
  return Math.ceil((((d-y)/86400000)+1)/7);
};

/* C1 — BASE_DATE = lundi de la semaine courante (dynamique) */
const getThisMonday = () => {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0,0,0,0);
  return d;
};
const BASE_DATE = getThisMonday();

const DEBOUNCE  = 600;
const REFRESH   = 5*60*1000;

/* Helpers state */
const emptyZone  = () => ({ demi:0, pleine:0 });
const emptyDel   = () => ({ demi:0, pleine:0, temp:null }); // temp = température °C
const emptyItem  = () => Object.fromEntries(ZONES.map(z=>[z.id, emptyZone()]));
const emptyInv   = () => Object.fromEntries(RECIPES.map(r=>[r.id, emptyItem()]));

const zoneDemi = (item,z) => { const v=item?.[z]; return (v?.demi??0)+(v?.pleine??0)*2; };
const totalZ   = item => ZONES.reduce((s,z)=>s+zoneDemi(item,z.id),0);
/* Période double commande : 18 mai → 10 juillet 2026
   C1 : passer le dimanche, livraison le mardi (3 jours)
   C2 : passer le mardi,    livraison le jeudi  (4 jours) */
const DOUBLE_START = new Date(2026, 4, 18); // 18 mai 2026
const DOUBLE_END   = new Date(2026, 6, 10); // 10 juillet 2026
const isDouble = weekOffset => {
  const ws = weekStart(weekOffset);
  const we = new Date(ws); we.setDate(ws.getDate()+6);
  return ws <= DOUBLE_END && we >= DOUBLE_START;
};

/* Météo */
const wLabel = c => c>=95?"Orageux":c>=80?"Averses":c>=61?"Pluvieux":c>=51?"Bruine":c>=3?"Nuageux":"Dégagé";
const wShort = c => c>=95?"ORG":c>=80?"AVE":c>=61?"PLU":c>=51?"BRU":c>=3?"NUA":"DEG";
const wColor = c => c>=95?"#7A4A8A":c>=80?"#3A6A9A":c>=61?"#4A80B4":c>=51?"#6A8A7A":c>=3?"#8A8A6A":"#C4A052";
const dayCoeff = (code,tMax) => {
  const b=code>=95?.35:code>=80?.50:code>=61?.62:code>=51?.75:code>=3?.90:1.05;
  const t=tMax>=28?1.7:tMax>=24?1.4:tMax>=20?1.1:tMax>=16?.90:tMax>=12?.70:.55;
  return +(b*t).toFixed(2);
};
const weekCoeff = days => {
  if(!days?.length) return 1.0;
  const w  = days.reduce((s,d)=>{ const dow=new Date(d.date).getDay(); return s+d.coeff*(dow===0||dow===6?1.4:dow===5?1.2:1.0); },0);
  const tw = days.reduce((s,d)=>{ const dow=new Date(d.date).getDay(); return s+(dow===0||dow===6?1.4:dow===5?1.2:1.0); },0);
  return +(w/tw).toFixed(2);
};

/* Dates */
const weekStart = o => { const d=new Date(BASE_DATE); d.setDate(BASE_DATE.getDate()+o*7); return d; };
const weekRange = o => { const s=weekStart(o); const e=new Date(s); e.setDate(s.getDate()+6); return {s,e}; };
const weekLabel = o => {
  const {s,e}=weekRange(o);
  const f=d=>d.toLocaleDateString("fr-FR",{day:"numeric",month:"long"});
  return `${f(s)} — ${f(e)}`;
};
const todayFull = () => new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
const todayISO  = () => new Date().toISOString().split("T")[0];
const addDays   = (iso,n) => { if(!iso) return null; const d=new Date(iso); d.setDate(d.getDate()+n); return d.toISOString().split("T")[0]; };
const fmtDate   = iso => { if(!iso) return "—"; const[y,m,d]=iso.split("-"); return `${d}/${m}/${y}`; };
const dlcDays   = iso => { if(!iso) return null; return Math.ceil((new Date(iso)-new Date())/86400000); };

/* C8 — Coefficient saisonnier selon la semaine ISO réelle */
const getSeason = weekOffset => {
  const w = getISOWeek(weekStart(weekOffset));
  return SEASONAL_BY_WEEK[w] ?? 1.0;
};

/* C2 — Contexte du jour selon la période (simple ou double commande) */
const getDayContext = () => {
  const dow   = new Date().getDay(); // 0=dim … 6=sam
  const dbl   = isDouble(0);         // semaine courante
  if(dbl){
    if(dow===0) return {txt:"Dimanche — Passer la commande 1 (livraison mardi)",  tab:"commande",   color:"#1E5E32"};
    if(dow===1) return {txt:"Lundi — Préparez la réception de mardi",             tab:"livraison",  color:"#523624"};
    if(dow===2) return {txt:"Mardi — Réception C1 + Passer la commande 2 (livraison jeudi)", tab:"commande", color:"#8C3C10"};
    if(dow===3) return {txt:"Mercredi — Vérifiez le stock pozzetti",              tab:"boutique",   color:"#523624"};
    if(dow===4) return {txt:"Jeudi — Réception de la commande 2",                 tab:"livraison",  color:"#8C3C10"};
    if(dow===5) return {txt:"Vendredi — Stock week-end à vérifier",               tab:"boutique",   color:"#945208"};
    if(dow===6) return {txt:"Samedi — Forte demande, surveiller les pozzetti",    tab:"boutique",   color:"#7A1008"};
  } else {
    if(dow===0) return {txt:"Dimanche — Préparez la commande de la semaine",      tab:"commande",   color:"#523624"};
    if(dow===1) return {txt:"Lundi — Passez la commande (livraison mercredi)",    tab:"commande",   color:"#1E5E32"};
    if(dow===2) return {txt:"Mardi — Vérifiez les stocks avant livraison",        tab:"inventaire", color:"#523624"};
    if(dow===3) return {txt:"Mercredi — Réception de livraison + mise en stock",  tab:"livraison",  color:"#8C3C10"};
    if(dow===4) return {txt:"Jeudi — Traçabilité mise en pozzetti",               tab:"tracabilite",color:"#1A3A6A"};
    if(dow===5) return {txt:"Vendredi — Stock week-end à vérifier",               tab:"boutique",   color:"#945208"};
    if(dow===6) return {txt:"Samedi — Forte demande, surveiller les pozzetti",    tab:"boutique",   color:"#7A1008"};
  }
  return null;
};

/* Commande */
const smartOrder = (recipe,inventory,eco,wCoeff,season,days) => {
  const stock = totalZ(inventory[recipe.id]||emptyItem());
  let rate = recipe.rate;
  if(eco?.[recipe.id]?.ratePerDay>0 && eco[recipe.id].days>=1)
    rate = eco[recipe.id].ratePerDay*0.7 + recipe.rate*0.3;
  const dem = Math.max(0, Math.ceil(rate*wCoeff*season*days - stock));
  return { demi:dem%2, pleine:Math.floor(dem/2), totalEq:dem, usedRate:+rate.toFixed(2) };
};

const computeEco = (snapshot,inventory) => {
  if(!snapshot?.data || !snapshot?.deliveredAt) return null;
  const days = Math.max(0.25, (Date.now()-snapshot.deliveredAt)/86400000);
  return Object.fromEntries(RECIPES.map(r => {
    const was  = totalZ(snapshot.data[r.id]||emptyItem());
    const now  = totalZ(inventory[r.id]||emptyItem());
    const sold = Math.max(0, was-now);
    return [r.id, {was,now,sold,ratePerDay:sold/days,days:+days.toFixed(1)}];
  }));
};

/* Validation température */
const tempOk   = t => t!==null && t!=="" && !isNaN(t) && Number(t)>=-30 && Number(t)<=5;
const tempWarn = t => t!==null && t!=="" && !isNaN(t) && Number(t)>-18; // au-dessus de -18°C = alerte

/* ═══════════════════════════
   HOOK SAUVEGARDE DEBOUNCÉE
═══════════════════════════ */
function useDebouncedSave(key, data, ready) {
  const [status,  setStatus]  = useState("idle");
  const timerRef  = useRef(null);
  const isFirstRef= useRef(true);

  useEffect(()=>{
    if(isFirstRef.current){ isFirstRef.current=false; return; }
    if(!ready) return;
    setStatus("saving");
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async()=>{
      try {
        await storage.set(key, JSON.stringify(data));
        setStatus("saved");
        setTimeout(()=>setStatus("idle"), 2000);
      } catch {
        setStatus("error");
        setTimeout(()=>setStatus("idle"), 3000);
      }
    }, DEBOUNCE);
    return () => clearTimeout(timerRef.current);
  }, [data]);

  return status;
}

/* ═══════════════════════════
   OCR ÉTIQUETTE — Claude Vision (claude-sonnet-4-6, vision activée)
   Lit le texte imprimé sur la carapine (lot, DLC, date fab, parfum, réf)
═══════════════════════════ */
const analyzeLabel = async (b64, mediaType) => {
  const resp = await fetch("/api/anthropic", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      model: "claude-sonnet-4-6",          // Vision activée sur ce modèle
      max_tokens: 280,
      messages: [{
        role: "user",
        content: [
          { type:"image", source:{ type:"base64", media_type:mediaType, data:b64 } },
          { type:"text", text:`Tu lis une étiquette de carapine glacée Alain Ducasse.
Cherche dans l'image ces informations (peu importe l'ordre) :
• Numéro de lot : après "Lot :", "L :", "LOT" — souvent 7 chiffres (ex: 6218161)
• DLC ou DLUO : date limite, format JJ/MM/AAAA ou JJ/MM/AA
• Date de fabrication : après "Fabriqué le :", "Fab :", "Prod" — même format
• Nom du parfum / saveur (ex: "Fraises Garriguettes", "Praliné Noisette", "Chocolat Madagascar")
• Référence : après "Réf :" ou "Ref :" — 5 chiffres
Convertis les dates au format ISO YYYY-MM-DD.
Réponds UNIQUEMENT avec ce JSON exact (null si non visible) :
{"lot":null,"dlc":null,"fabrique":null,"nom":null,"ref":null}` }
        ]
      }]
    })
  });
  if(!resp.ok){
    const errBody = await resp.json().catch(()=>({}));
    throw new Error(`Erreur API ${resp.status}: ${errBody?.error?.message||"Vérifiez la clé Anthropic sur Render"}`);
  }
  const d = await resp.json();
  if(d.error) throw new Error(d.error.message||"Erreur API Anthropic");
  const raw = (d.content?.[0]?.text||"").replace(/```json\n?|```/g,"").trim();
  // Extrait le JSON même si Claude ajoute du texte autour
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if(!jsonMatch) throw new Error(`Réponse non JSON: "${raw.slice(0,80)}"`);
  return JSON.parse(jsonMatch[0]);
};

/* ═══════════════════════════
   OCR GRATUIT — Tesseract.js
   Moteur OCR open-source, 100% navigateur, sans API, sans coût
═══════════════════════════ */

/** Charge Tesseract.js depuis CDN une seule fois */
const loadTesseract = () => new Promise((res, rej) => {
  if (window.Tesseract) { res(window.Tesseract); return; }
  const s = document.createElement('script');
  s.src = 'https://unpkg.com/tesseract.js@4.1.1/dist/tesseract.min.js';
  s.onload  = () => window.Tesseract ? res(window.Tesseract) : rej(new Error('Tesseract manquant'));
  s.onerror = () => rej(new Error('Impossible de charger Tesseract.js'));
  document.head.appendChild(s);
});

/** Extrait lot / DLC / date fab d'un texte OCR brut — version robuste */
const parseOCRText = (raw) => {
  if(!raw) return { lot:null, dlc:null, fabrique:null, nom:null };

  /* toISO corrige aussi les artefacts OCR dans la date elle-même */
  const toISO = s => {
    if(!s) return null;
    const clean = String(s)
      .replace(/[oOqQ]/g,'0')   // O,o,q,Q → 0 (fréquent dans les dates)
      .replace(/[lI|]/g,'1')    // l,I,| → 1
      .replace(/\s+/g,'')       // enlève les espaces (08 / 06 → 08/06)
      .replace(/,/g,'.');       // virgule → point séparateur
    const m = clean.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
    if(!m) return null;
    const [,d,mo,y] = m;
    const year = y.length===2 ? (parseInt(y)>50?'19':'20')+y : y;
    if(+mo<1||+mo>12||+d<1||+d>31) return null;
    return `${year}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
  };

  /* Extrait toutes les dates valides d'une chaîne */
  const allDatesIn = s => {
    const found = [];
    // Cherche dd[sep]mm[sep](yy)yy avec séparateur / - . ou espace
    for(const m of s.matchAll(/(\d{1,2}[\s\/\-\.]+\d{1,2}[\s\/\-\.]+\d{2,4})/g)){
      const iso = toISO(m[1]);
      if(iso) found.push(iso);
    }
    return found;
  };

  /* Normalise le texte brut */
  const txt = raw
    .replace(/[|]{2,}/g,' ')
    .replace(/[lI](?=\d)/g,'1')   // l/I précédant un chiffre → 1
    .replace(/[oO](?=\d)/g,'0');  // o/O précédant un chiffre → 0

  const lines = txt.split('\n').map(l=>l.trim()).filter(l=>l.length>0);
  const full  = lines.join(' ');

  let lot=null, dlc=null, fabrique=null, nom=null;

  /* ── Lot ──────────────────────────────────────────────── */
  const lotM =
    full.match(/(?:lot|n[o°]\s*lot|num[eé]ro?\s*lot)\s*[:\-]?\s*([A-Z0-9]{4,12})/i) ||
    full.match(/\bL\s*[:\-]\s*([A-Z0-9]{4,12})/i) ||
    full.match(/\b(\d{7})\b/);
  if(lotM) lot = lotM[1].trim();

  /* ── DLC — cherche ligne par ligne, puis fallback global ── */
  // Tentative 1 : ligne contenant DLC/DLUO + une date
  for(const line of lines){
    if(/d[\s\-\.]*l[\s\-\.]*[co0]/i.test(line)||/dluo/i.test(line)||/consomm/i.test(line)||/best.before/i.test(line)){
      const dates = allDatesIn(line);
      if(dates.length){ dlc=dates[0]; break; }
      // Date peut être sur la ligne suivante (DLC\n08/06/2026)
      const idx = lines.indexOf(line);
      if(idx<lines.length-1){ const d2=allDatesIn(lines[idx+1]); if(d2.length){ dlc=d2[0]; break; } }
    }
  }
  // Tentative 2 : pattern global avec keyword
  if(!dlc){
    const m = full.match(/d[\s\-\.]*l[\s\-\.]*[co0]\s*[:\-]?\s*(\d[\d\s\/\-\.,oOlI]{4,14})/i);
    if(m) dlc = toISO(m[1]);
  }
  // Tentative 3 : on a le lot, on prend la date la plus récente = DLC
  if(!dlc && lot){
    const allDates = allDatesIn(full).sort();
    if(allDates.length) dlc = allDates[allDates.length-1];
  }

  /* ── Date de fabrication ───────────────────────────────── */
  for(const line of lines){
    if(/fabri[qc]/i.test(line)||/prod\S*/i.test(line)){
      const dates = allDatesIn(line);
      const d = dates.find(d=>d!==dlc);
      if(d){ fabrique=d; break; }
    }
  }
  if(!fabrique){
    const m = full.match(/(?:fabri[qc]\S+\s+le|fabri[qc]\S*)\s*[:\-]?\s*(\d[\d\s\/\-\.,]{4,14})/i);
    if(m){ const iso=toISO(m[1]); if(iso&&iso!==dlc) fabrique=iso; }
  }

  /* ── Nom du parfum ─────────────────────────────────────── */
  const nomM = full.match(/(?:carapine|sorbet|glace)\s+([A-ZÀ-Ÿa-zà-ÿ][A-ZÀ-Ÿa-zà-ÿ\s&]{3,40}?)(?:\s*[\-–—\d]|$)/i);
  if(nomM) nom = nomM[1].trim();

  return { lot, dlc, fabrique, nom };
};

/** Worker Tesseract cached — créé une seule fois et réutilisé */
let _tessWorker = null;
let _tessLogger = null;

const loadTessWorker = async () => {
  if (_tessWorker) return _tessWorker;
  const Tess = await loadTesseract();
  // Chemins CDN explicites : évite que le worker cherche ses fichiers sur notre serveur
  const p = await Tess.createWorker('fra', 1, {
    workerPath:    'https://cdn.jsdelivr.net/npm/tesseract.js@4.1.1/dist/worker.min.js',
    langPath:      'https://tessdata.projectnaptha.com/4.0.0',
    corePath:      'https://cdn.jsdelivr.net/npm/tesseract.js-core@3.0.3/tesseract-core.wasm.js',
    workerBlobURL: false,
    logger: m => _tessLogger && _tessLogger(m),
  });
  _tessWorker = p;
  return _tessWorker;
};

/** Lance la reconnaissance OCR sur une dataURL JPEG/PNG */
const runTesseract = async (dataURL, onProgress) => {
  _tessLogger = m => {
    if (!onProgress) return;
    if      (m.status==='loading tesseract core')        onProgress(5  + Math.round(m.progress*20));
    else if (m.status==='loading language traineddata')  onProgress(25 + Math.round(m.progress*20));
    else if (m.status==='initializing tesseract')        onProgress(45 + Math.round(m.progress*5));
    else if (m.status==='recognizing text')              onProgress(50 + Math.round(m.progress*50));
  };
  try {
    const worker = await loadTessWorker();
    const { data: { text } } = await worker.recognize(dataURL);
    _tessLogger = null;
    return { text, parsed: parseOCRText(text) };
  } catch(e) {
    _tessWorker = null; // reset pour réessayer la prochaine fois
    _tessLogger = null;
    throw e;
  }
};

/* ═══════════════════════════
   PDF HELPERS
═══════════════════════════ */
const loadJsPDF = () => new Promise((res,rej) => {
  if(window.jspdf){ res(window.jspdf); return; }
  const s=document.createElement("script");
  s.src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
  s.onload=()=>res(window.jspdf); s.onerror=()=>rej(new Error("jsPDF indisponible"));
  document.head.appendChild(s);
});

const sharePDF = async (blob, title) => {
  const fn = `${title.toLowerCase().replace(/[^a-z0-9]/g,"-")}.pdf`;
  const f  = new File([blob], fn, {type:"application/pdf"});
  if(navigator.share && navigator.canShare && navigator.canShare({files:[f]})){
    try{ await navigator.share({files:[f], title}); }
    catch(e){ if(e.name!=="AbortError") throw e; }
  } else {
    const url = URL.createObjectURL(blob);
    const a   = Object.assign(document.createElement("a"), {href:url, download:fn});
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }
};

/* PDF Livraison — Bon de réception avec temp / lot / DLC bien lisibles */
const buildDeliveryPDF = async (delivery, lots, zoneLabel, weekLbl, returnBlob=false) => {
  const {jsPDF} = await loadJsPDF();
  const doc = new jsPDF({unit:"mm", format:"a4"});
  const M=12, R=198; let y=0;

  const T   = (fo,sz,rgb,tx,x,yp,o={}) => { doc.setFont(...fo); doc.setFontSize(sz); doc.setTextColor(...rgb); doc.text(String(tx),x,yp,o); };
  const BG  = (x,yp,w,h,rgb) => { doc.setFillColor(...rgb); doc.rect(x,yp,w,h,"F"); };
  const HR  = (rgb=[200,180,155],lw=0.3,x1=M,x2=R) => { doc.setDrawColor(...rgb); doc.setLineWidth(lw); doc.line(x1,y,x2,y); };

  /* ── En-tête bandeau ── */
  BG(0,0,210,30,[248,242,234]);
  T(["helvetica","bold"],7,[168,82,46],"ALAIN DUCASSE — MANUFACTURE DE GLACE",M,9);
  T(["times","normal"],22,[26,20,16],"Bon de Réception",M,21);
  T(["helvetica","bold"],9,[168,82,46],zoneLabel.toUpperCase(),R,12,{align:"right"});
  T(["helvetica","normal"],8,[100,70,40],weekLbl,R,19,{align:"right"});
  T(["helvetica","normal"],7,[150,120,90],todayFull().toUpperCase(),R,26,{align:"right"});
  y=34;

  const items = RECIPES.filter(r=>{ const i=delivery[r.id]; return i&&(i.demi>0||i.pleine>0); });

  if(!items.length){
    T(["helvetica","normal"],11,[150,120,90],"Aucune quantité saisie.",M,y+10);
  } else {

    /* ── En-tête colonnes ── */
    /* Colonnes : Recette(large) | Qté | Temp°C | N° Lot | DLC | Fabriqué */
    const CX = { nom:M, qty:112, temp:132, lot:150, dlc:174, fab:R };
    BG(M,y,R-M,8,[235,222,205]);
    T(["helvetica","bold"],6.5,[80,48,20],"RECETTE / TYPE",   CX.nom, y+5.5);
    T(["helvetica","bold"],6.5,[80,48,20],"QTÉ",             CX.qty, y+5.5);
    T(["helvetica","bold"],6.5,[80,48,20],"TEMP°C",          CX.temp,y+5.5);
    T(["helvetica","bold"],6.5,[80,48,20],"N° LOT",          CX.lot, y+5.5);
    T(["helvetica","bold"],6.5,[80,48,20],"DLC",             CX.dlc, y+5.5);
    T(["helvetica","bold"],6.5,[80,48,20],"FABRIQUÉ",        CX.fab, y+5.5,{align:"right"});
    y+=10; HR([190,168,140],0.5); y+=1;

    let tD=0, tP=0;
    items.forEach((r,idx)=>{
      if(y>268){ doc.addPage(); y=16; }
      const rowH=11;
      if(idx%2===0) BG(M,y,R-M,rowH,[251,247,243]);
      const item=delivery[r.id]||{demi:0,pleine:0,temp:null};
      const lot=lots?.[r.id];
      const tw=tempWarn(item.temp);
      const dj=dlcDays(lot?.dlc);

      /* Nom + type */
      T(["times","normal"],12,[26,20,16],r.name,           CX.nom, y+7.5);
      T(["helvetica","normal"],7,[140,110,80],r.type.toUpperCase(), CX.nom, y+rowH-1.5);

      /* Quantité : "2D + 1P" */
      const qtyStr=`${item.demi}D${item.pleine>0?` + ${item.pleine}P`:""}`;
      T(["times","bold"],12,[26,20,16],qtyStr, CX.qty, y+7.5);

      /* Température — vert ok / rouge alerte */
      const tempStr=item.temp!==null&&item.temp!==""?`${item.temp}°C`:"—";
      T(["helvetica","bold"],10,tw?[180,30,20]:[34,110,60],tempStr, CX.temp, y+7.5);
      if(tw) T(["helvetica","bold"],6,[180,30,20],"!",CX.temp+14,y+7.5);

      /* Lot */
      T(["helvetica","normal"],9,[60,46,32],lot?.lot||"—", CX.lot, y+7.5);

      /* DLC — orange si <30j, rouge si <7j */
      const dlcColor=dj!==null&&dj<7?[180,30,20]:dj!==null&&dj<30?[168,80,20]:[60,46,32];
      T(["helvetica","bold"],9,dlcColor,fmtDate(lot?.dlc)||"—", CX.dlc, y+7.5);
      if(dj!==null&&dj<30) T(["helvetica","normal"],7,dlcColor,`${dj}j`, CX.dlc, y+rowH-1.5);

      /* Fabriqué */
      T(["helvetica","normal"],8,[100,80,60],fmtDate(lot?.fabrique)||"—", CX.fab, y+7.5,{align:"right"});

      tD+=item.demi; tP+=item.pleine;
      y+=rowH; HR([220,205,188],0.12);
    });

    /* ── Total ── */
    y+=3;
    BG(M,y,R-M,12,[240,228,212]);
    T(["helvetica","bold"],9,[80,48,20],"TOTAL",              M+2, y+8);
    T(["times","bold"],13,[168,82,46],`${tD}D + ${tP}P`,     R,   y+8,{align:"right"});
    T(["helvetica","normal"],8,[120,90,60],`Volume : ${tD*2.5+tP*5} L`, 120,y+8);
    y+=16;

    /* ── Zone signature ── */
    HR([200,180,155],0.3); y+=8;
    T(["helvetica","normal"],8,[120,90,60],"Réceptionné par :", M, y);
    T(["helvetica","normal"],8,[120,90,60],"Signature :", 110, y);
    y+=14;
    HR([200,180,155],0.25,M,80); HR([200,180,155],0.25,110,180);

    /* ── Alerte chaîne du froid ── */
    const alertes=items.filter(r=>tempWarn(delivery[r.id]?.temp));
    if(alertes.length){
      y+=10;
      BG(M,y,R-M,8,[255,235,230]);
      doc.setDrawColor(180,30,20); doc.setLineWidth(0.8);
      doc.rect(M,y,R-M,8+(alertes.length*7),"S");
      T(["helvetica","bold"],7.5,[180,30,20],"ALERTE CHAÎNE DU FROID — Températures > -18°C :",M+3,y+5.5);
      y+=10;
      alertes.forEach(r=>{
        T(["helvetica","normal"],9,[180,30,20],`• ${r.name} : ${delivery[r.id].temp}°C`,M+4,y);
        y+=7;
      });
    }
  }

  /* ── Pied de page ── */
  T(["helvetica","normal"],7,[180,160,140],todayFull().toUpperCase(),M,287);
  T(["helvetica","normal"],7,[180,160,140],"Manufacture de Glace Alain Ducasse — Paris",R,287,{align:"right"});
  const _blivr = doc.output("blob");
  if(returnBlob) return _blivr;
  await sharePDF(_blivr,`Réception-${zoneLabel}`);
};

/* PDF Inventaire */
const buildInventoryPDF = async (inventory, subtitle, returnBlob=false) => {
  const {jsPDF} = await loadJsPDF();
  const doc = new jsPDF({unit:"mm", format:"a4"});
  const M=14, R=196; let y=20;
  const T  = (fo,sz,rgb,tx,x,yp,o) => { doc.setFont(...fo); doc.setFontSize(sz); doc.setTextColor(...rgb); doc.text(tx,x,yp,o); };
  const BG = (x,yp,w,h,rgb) => { doc.setFillColor(...rgb); doc.rect(x,yp,w,h,"F"); };
  const RL = (rgb,lw) => { doc.setDrawColor(...rgb); doc.setLineWidth(lw); doc.line(M,y,R,y); };

  BG(0,0,210,26,[248,242,234]);
  T(["helvetica","bold"],7,[168,82,46],"ALAIN DUCASSE — MANUFACTURE DE GLACE",M,10);
  T(["times","normal"],  19,[26,20,16],"État des Stocks",M,20);
  T(["helvetica","normal"],8,[120,90,60],subtitle.toUpperCase(),R,10,{align:"right"});
  T(["helvetica","normal"],7,[150,120,90],todayFull().toUpperCase(),R,20,{align:"right"});
  y=30;

  const ZX = [102,122,142];
  BG(M,y,R-M,7,[240,230,218]);
  T(["helvetica","bold"],7,[100,60,30],"RECETTE",M,y+5);
  T(["helvetica","bold"],7,[100,60,30],"TYPE",78,y+5);
  ZONES.forEach((z,i)=>T(["helvetica","bold"],6,[100,60,30],z.label.toUpperCase(),ZX[i],y+5));
  T(["helvetica","bold"],7,[100,60,30],"TOTAL",R,y+5,{align:"right"});
  y+=9; RL([200,180,155],0.4); y+=2;

  ["Sorbet","Glace"].forEach(type=>{
    BG(M,y,R-M,6,[250,246,242]);
    T(["helvetica","bold"],8,[168,82,46],type.toUpperCase()+"S",M+2,y+4.5);
    y+=8; RL([220,205,185],0.2); y+=2;
    RECIPES.filter(r=>r.type===type).forEach((r,idx)=>{
      if(y>262){ doc.addPage(); y=20; }
      const item=inventory[r.id]||emptyItem(); const tot=totalZ(item);
      if(idx%2===0) BG(M,y-1,R-M,9,[252,248,244]);
      T(["times","normal"],11,[tot===0?160:26,tot===0?90:20,16],r.name,M+2,y+6);
      T(["helvetica","normal"],7,[120,90,60],type.toUpperCase(),78,y+6);
      ZONES.forEach((z,i)=>{ const v=item[z.id]||emptyZone(); T(["helvetica","normal"],8,[60,50,40],`${v.demi}D ${v.pleine}P`,ZX[i],y+6); });
      T(["times","bold"],12,[tot===0?180:168,tot===0?80:82,46],String(tot),R,y+6,{align:"right"});
      y+=9; RL([220,205,185],0.12);
    });
    y+=4;
  });

  const tD=ZONES.reduce((s,z)=>s+RECIPES.reduce((r2,r)=>r2+(inventory[r.id]?.[z.id]?.demi||0),0),0);
  const tP=ZONES.reduce((s,z)=>s+RECIPES.reduce((r2,r)=>r2+(inventory[r.id]?.[z.id]?.pleine||0),0),0);
  y+=2; BG(M,y,R-M,10,[240,230,218]);
  T(["helvetica","bold"],9,[100,60,30],"TOTAL GÉNÉRAL",M+2,y+7);
  T(["times","bold"],    13,[168,82,46],`${tD}D + ${tP}P — ${tD*2.5+tP*5} L`,R,y+7,{align:"right"});
  T(["helvetica","normal"],7,[180,160,140],todayFull().toUpperCase(),M,285);
  T(["helvetica","normal"],7,[180,160,140],"Manufacture de Glace Alain Ducasse — Paris",R,285,{align:"right"});
  const _binv=doc.output("blob"); if(returnBlob) return _binv; await sharePDF(_binv,"Inventaire complet");
};

/* PDF Traçabilité */
const buildTracabilityPDF = async (records, returnBlob=false) => {
  const {jsPDF} = await loadJsPDF();
  const doc = new jsPDF({unit:"mm", format:"a4"});
  const M=14, R=196; let y=20;
  const T  = (fo,sz,rgb,tx,x,yp,o) => { doc.setFont(...fo); doc.setFontSize(sz); doc.setTextColor(...rgb); doc.text(tx,x,yp,o); };
  const BG = (x,yp,w,h,rgb) => { doc.setFillColor(...rgb); doc.rect(x,yp,w,h,"F"); };
  const RL = (rgb,lw) => { doc.setDrawColor(...rgb); doc.setLineWidth(lw); doc.line(M,y,R,y); };

  BG(0,0,210,26,[248,242,234]);
  T(["helvetica","bold"],7,[168,82,46],"ALAIN DUCASSE — MANUFACTURE DE GLACE",M,10);
  T(["times","normal"],  19,[26,20,16],"Fiche de Traçabilité",M,20);
  T(["helvetica","normal"],7,[150,120,90],todayFull().toUpperCase(),R,18,{align:"right"});
  y=30;

  BG(M,y,R-M,7,[240,230,218]);
  T(["helvetica","bold"],7,[100,60,30],"RECETTE",  M,   y+5);
  T(["helvetica","bold"],7,[100,60,30],"LOT",      72,  y+5);
  T(["helvetica","bold"],7,[100,60,30],"ZONE",     102, y+5);
  T(["helvetica","bold"],7,[100,60,30],"MISE EN PLACE",120,y+5);
  T(["helvetica","bold"],7,[100,60,30],"DLC J+14", 152, y+5);
  T(["helvetica","bold"],7,[100,60,30],"PAR",      R,   y+5,{align:"right"});
  y+=9; RL([200,180,155],0.4); y+=2;

  records.forEach((rec,idx)=>{
    if(y>262){ doc.addPage(); y=20; }
    if(idx%2===0) BG(M,y-1,R-M,9,[252,248,244]);
    const dj=dlcDays(rec.dlcJ14); const exp=dj!==null&&dj<=0;
    T(["times","normal"],  11,[26,20,16],         rec.name,                    M,   y+6);
    T(["helvetica","normal"],9,[60,50,40],          rec.lot||"—",               72,  y+6);
    T(["helvetica","normal"],8,[120,90,60],          ZONES.find(z=>z.id===rec.zone)?.label||"—",102,y+6);
    T(["helvetica","normal"],9,[60,50,40],          fmtDate(rec.miseEnPlace),   120, y+6);
    doc.setTextColor(...(exp?[180,40,20]:dj!==null&&dj<=2?[168,104,32]:[40,100,60]));
    doc.setFont("helvetica","bold"); doc.setFontSize(9);
    doc.text(fmtDate(rec.dlcJ14), 152, y+6);
    T(["helvetica","normal"],8,[120,90,60], rec.author||"—", R,y+6,{align:"right"});
    y+=9; RL([220,205,185],0.12);
  });

  T(["helvetica","normal"],7,[180,160,140],todayFull().toUpperCase(),M,285);
  T(["helvetica","normal"],7,[180,160,140],"Manufacture de Glace Alain Ducasse — Paris",R,285,{align:"right"});
  const _btra=doc.output("blob"); if(returnBlob) return _btra; await sharePDF(_btra,"Tracabilite");
};

/* PDF Commande */
const buildOrderPDF = async (order, weekLbl, label, returnBlob=false) => {
  const {jsPDF} = await loadJsPDF();
  const doc = new jsPDF({unit:"mm", format:"a4"});
  const M=14, R=196; let y=20;
  const T  = (fo,sz,rgb,tx,x,yp,o) => { doc.setFont(...fo); doc.setFontSize(sz); doc.setTextColor(...rgb); doc.text(tx,x,yp,o); };
  const BG = (x,yp,w,h,rgb) => { doc.setFillColor(...rgb); doc.rect(x,yp,w,h,"F"); };
  const RL = (rgb,lw) => { doc.setDrawColor(...rgb); doc.setLineWidth(lw); doc.line(M,y,R,y); };

  BG(0,0,210,26,[248,242,234]);
  T(["helvetica","bold"],7,[168,82,46],"ALAIN DUCASSE — MANUFACTURE DE GLACE",M,10);
  T(["times","normal"],  19,[26,20,16],"Bon de Commande",M,20);
  T(["helvetica","normal"],8,[120,90,60], label.toUpperCase(),  R,10,{align:"right"});
  T(["helvetica","normal"],8,[120,90,60], weekLbl,              R,16,{align:"right"});
  T(["helvetica","normal"],7,[150,120,90],todayFull().toUpperCase(),R,22,{align:"right"});
  y=30;

  BG(M,y,R-M,7,[240,230,218]);
  T(["helvetica","bold"],7,[100,60,30],"RECETTE",M,   y+5);
  T(["helvetica","bold"],7,[100,60,30],"TYPE",   90,  y+5);
  T(["helvetica","bold"],7,[100,60,30],"DEMI (2.5L)", 140,y+5,{align:"right"});
  T(["helvetica","bold"],7,[100,60,30],"PLEINE (5L)", R, y+5,{align:"right"});
  y+=9; RL([200,180,155],0.4); y+=2;

  const items = RECIPES.filter(r=>order[r.id]?.demi>0||order[r.id]?.pleine>0);
  let tD=0, tP=0;
  items.forEach((r,idx)=>{
    if(y>262){ doc.addPage(); y=20; }
    if(idx%2===0) BG(M,y-1,R-M,9,[252,248,244]);
    const q=order[r.id]||{demi:0,pleine:0};
    T(["times","normal"],  12,[26,20,16],  r.name,       M,   y+6);
    T(["helvetica","normal"],7,[120,90,60], r.type.toUpperCase(),90,y+6);
    T(["times","normal"],  14,[26,20,16],  String(q.demi),  140,y+6,{align:"right"});
    T(["times","normal"],  14,[26,20,16],  String(q.pleine),R,  y+6,{align:"right"});
    tD+=q.demi; tP+=q.pleine; y+=9; RL([225,210,190],0.12);
  });

  if(!items.length){ T(["helvetica","normal"],10,[150,120,90],"Aucune recette commandée.",M,y+8); y+=16; }
  else {
    y+=4; BG(M,y,R-M,10,[240,230,218]);
    T(["helvetica","bold"],9,[100,60,30],"TOTAL",M,y+7);
    T(["times","bold"],13,[168,82,46],String(tD),140,y+7,{align:"right"});
    T(["times","bold"],13,[168,82,46],String(tP),R,  y+7,{align:"right"});
    y+=14;
    T(["helvetica","normal"],8,[120,90,60],`Volume : ${tD*2.5+tP*5} L`,M,y);
  }

  T(["helvetica","normal"],7,[180,160,140],todayFull().toUpperCase(),M,285);
  T(["helvetica","normal"],7,[180,160,140],"Manufacture de Glace Alain Ducasse — Paris",R,285,{align:"right"});
  const _bord=doc.output("blob"); if(returnBlob) return _bord; await sharePDF(_bord,label);
};

/* ═══════════════════════════
   DESIGN TOKENS
═══════════════════════════ */
const G = {
  bg:      "linear-gradient(148deg,#FAF4ED 0%,#F0E6D8 45%,#F5EDE3 100%)",
  glass:   "rgba(255,251,246,0.84)",
  glassS:  "rgba(255,251,246,0.96)",
  blur:    "blur(28px)",
  border:  "rgba(148,88,32,0.12)",
  borderS: "rgba(148,88,32,0.26)",
  shadow:  "0 2px 14px rgba(70,32,8,0.06),0 1px 3px rgba(70,32,8,0.04)",
  shadowM: "0 4px 24px rgba(70,32,8,0.09),0 2px 6px rgba(70,32,8,0.05)",
  shadowL: "0 10px 48px rgba(70,32,8,0.13),0 3px 10px rgba(70,32,8,0.07)",
  copper:  "#8C3C10",
  copperL: "#BA5C28",
  dark:    "#160E06",
  mid:     "#523624",
  light:   "#8C6848",
  faint:   "rgba(140,60,16,0.05)",
  warn:    "#945208",
  danger:  "#7A1008",
  ok:      "#1E5E32",
  okBg:    "rgba(30,94,50,0.08)",
  warnBg:  "rgba(148,82,8,0.08)",
  dangerBg:"rgba(122,16,8,0.07)",
};

/* ─── CAISSE — Produits et tarifs ─────────────────── */
// TVA : glaces à emporter 5,5% | boissons consommées sur place 10%
const CAISSE_ITEMS=[
  {id:"cornet",    cat:"Format",  name:"Cornet",      price:7,   tva:5.5},
  {id:"petit_pot", cat:"Format",  name:"Petit pot",   price:7,   tva:5.5},
  {id:"gros_pot",  cat:"Format",  name:"Gros pot",    price:9,   tva:5.5},
  {id:"bento_sm",  cat:"Format",  name:"Bento 600ml", price:22,  tva:5.5},
  {id:"bento_lg",  cat:"Format",  name:"Bento 1.2L",  price:42,  tva:5.5},
  {id:"expresso",  cat:"Boisson", name:"Expresso",    price:3.5, tva:10 },
  {id:"cappuccino",cat:"Boisson", name:"Cappuccino",  price:6,   tva:10 },
  {id:"affogato",  cat:"Boisson", name:"Affogato",    price:10,  tva:10 },
  {id:"perrier",   cat:"Boisson", name:"Perrier",     price:3,   tva:10 },
  {id:"eau",       cat:"Boisson", name:"Eau",         price:3,   tva:10 },
  {id:"jus",       cat:"Boisson", name:"Jus",         price:6,   tva:10 },
];

// Ventilation TVA à partir d'une liste de transactions
// Les prix sont TTC — TVA = TTC * taux / (100 + taux)
const computeTVA=txs=>{
  const map={};
  txs.forEach(tx=>{
    (tx.items||[]).forEach(item=>{
      const prod=CAISSE_ITEMS.find(p=>p.id===item.id);
      const rate=prod?.tva??10;
      const ttc=+(item.price*item.qty).toFixed(2);
      const tva=+(ttc*rate/(100+rate)).toFixed(2);
      const ht =+(ttc-tva).toFixed(2);
      if(!map[rate])map[rate]={ht:0,tva:0,ttc:0};
      map[rate].ht =+(map[rate].ht +ht ).toFixed(2);
      map[rate].tva=+(map[rate].tva+tva).toFixed(2);
      map[rate].ttc=+(map[rate].ttc+ttc).toFixed(2);
    });
  });
  return map; // {5.5:{ht,tva,ttc}, 10:{ht,tva,ttc}}
};

const buildCaissePDF=async(transactions,dateStr)=>{
  const{jsPDF}=await loadJsPDF();
  const doc=new jsPDF({orientation:"portrait",unit:"mm",format:"a4"});
  const M=14,R=196;let y=10;
  const T=(font,size,color,text,x,yy,opt={})=>{doc.setFont(...font);doc.setFontSize(size);doc.setTextColor(...color);doc.text(text,x,yy,opt);};
  const BG=(x,yy,w,h,c)=>{doc.setFillColor(...c);doc.rect(x,yy,w,h,"F");};
  const HR=(c,lw=0.3)=>{doc.setDrawColor(...c);doc.setLineWidth(lw);doc.line(M,y,R,y);};

  BG(0,0,210,26,[248,242,234]);
  T(["helvetica","bold"],7,[168,82,46],"ALAIN DUCASSE — MANUFACTURE DE GLACE",M,10);
  T(["times","normal"],19,[26,20,16],"Récapitulatif Caisse",M,20);
  T(["helvetica","normal"],8,[120,90,60],dateStr,R,10,{align:"right"});
  y=34;

  const vCB =transactions.filter(t=>t.payment==="CB");
  const vAM =transactions.filter(t=>t.payment==="AMEX");
  const vES =transactions.filter(t=>t.payment==="Especes");
  const totCB =vCB.reduce((s,t)=>s+t.total,0);
  const totAMEX=vAM.reduce((s,t)=>s+t.total,0);
  const totEsp =vES.reduce((s,t)=>s+t.total,0);
  const totAll =+(totCB+totAMEX+totEsp).toFixed(2);
  const tva    =computeTVA(transactions);
  const fE=v=>`${v.toFixed(2)} EUR`;

  // Modes de règlement — alignés sur le format clôture Gourmet ERP
  const modes=[
    {l:"Carte bancaire (CB)",nb:vCB.length,v:totCB,c:[26,58,106]},
    {l:"American Express",   nb:vAM.length,v:totAMEX,c:[30,94,50]},
    {l:"Especes",            nb:vES.length,v:totEsp, c:[148,82,8]},
  ];
  BG(M,y,R-M,8,[235,222,205]);
  T(["helvetica","bold"],7,[80,48,20],"MODE DE REGLEMENT",M+2,y+5.5);
  T(["helvetica","bold"],7,[80,48,20],"NB",M+110,y+5.5,{align:"right"});
  T(["helvetica","bold"],7,[80,48,20],"MONTANT REEL",R-2,y+5.5,{align:"right"});
  y+=10;
  modes.forEach((m,i)=>{
    if(i%2===0)BG(M,y-2,R-M,8,[250,248,244]);
    T(["helvetica","normal"],8,[40,30,20],m.l,M+2,y+3.5);
    T(["helvetica","normal"],8,[80,60,40],String(m.nb),M+110,y+3.5,{align:"right"});
    T(["helvetica","bold"],9,m.c,fE(m.v),R-2,y+3.5,{align:"right"});
    y+=9;
  });
  y+=2;HR([190,168,140],0.5);y+=5;
  T(["helvetica","bold"],10,[168,82,46],`TOTAL DE LA CAISSE   ${fE(totAll)}`,R-2,y,{align:"right"});
  y+=12;

  // Détail TVA (format Gourmet ERP : Base TVA / Taux / Montant TVA)
  if(Object.keys(tva).length>0){
    T(["helvetica","bold"],8,[100,70,40],"DETAIL T.V.A.",M,y);
    y+=6;HR([190,168,140],0.5);y+=4;
    BG(M,y,R-M,8,[235,222,205]);
    T(["helvetica","bold"],6.5,[80,48,20],"TAUX",M+2,y+5.5);
    T(["helvetica","bold"],6.5,[80,48,20],"BASE H.T.",M+60,y+5.5,{align:"right"});
    T(["helvetica","bold"],6.5,[80,48,20],"MONTANT TVA",M+118,y+5.5,{align:"right"});
    T(["helvetica","bold"],6.5,[80,48,20],"TOTAL TTC",R-2,y+5.5,{align:"right"});
    y+=10;
    let totHT=0,totTVA=0;
    Object.entries(tva).sort(([a],[b])=>+a-+b).forEach(([rate,vals],i)=>{
      if(i%2===0)BG(M,y-2,R-M,8,[250,248,244]);
      T(["helvetica","normal"],8,[60,50,40],`${rate} %`,M+2,y+3.5);
      T(["helvetica","normal"],8,[60,50,40],fE(vals.ht),  M+60, y+3.5,{align:"right"});
      T(["helvetica","normal"],8,[60,50,40],fE(vals.tva), M+118,y+3.5,{align:"right"});
      T(["helvetica","bold"],  8,[60,50,40],fE(vals.ttc), R-2,  y+3.5,{align:"right"});
      totHT+=vals.ht;totTVA+=vals.tva;y+=9;
    });
    HR([190,168,140],0.5);y+=5;
    T(["helvetica","bold"],8,[168,82,46],`Total HT : ${fE(totHT)}   TVA : ${fE(totTVA)}   TTC : ${fE(totAll)}`,R-2,y,{align:"right"});
    y+=12;
  }

  // Détail des transactions
  T(["helvetica","bold"],8,[100,70,40],"DETAIL DES TRANSACTIONS",M,y);
  y+=6;HR([190,168,140],0.5);y+=4;
  BG(M,y,R-M,8,[235,222,205]);
  T(["helvetica","bold"],6.5,[80,48,20],"HEURE",M+2,y+5.5);
  T(["helvetica","bold"],6.5,[80,48,20],"ARTICLES",M+18,y+5.5);
  T(["helvetica","bold"],6.5,[80,48,20],"PAIEMENT",M+130,y+5.5);
  T(["helvetica","bold"],6.5,[80,48,20],"TTC",R-2,y+5.5,{align:"right"});
  y+=10;

  transactions.forEach((tx,i)=>{
    if(y>272){doc.addPage();y=20;}
    if(i%2===0)BG(M,y-2,R-M,8,[250,248,244]);
    const items=tx.items.map(it=>`${it.name}${it.qty>1?` x${it.qty}`:""}`).join(", ");
    const ch=tx.change>0?` (rendu ${fE(tx.change)})`:"";
    T(["helvetica","normal"],7,[60,50,40],tx.time,M+2,y+3.5);
    T(["helvetica","normal"],7,[60,50,40],items.substring(0,58),M+18,y+3.5);
    T(["helvetica","normal"],7,[60,50,40],tx.payment+ch,M+130,y+3.5);
    T(["helvetica","bold"],8,[168,82,46],fE(tx.total),R-2,y+3.5,{align:"right"});
    y+=8;
  });
  y+=4;HR([190,168,140],0.5);y+=6;
  T(["helvetica","bold"],10,[168,82,46],`TOTAL JOURNEE : ${fE(totAll)}`,R-2,y,{align:"right"});
  doc.save(`Caisse_${dateStr.replace(/[^0-9]/g,"-").replace(/-+/g,"-")}.pdf`);
};

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html{-webkit-text-size-adjust:100%;height:100%;scroll-behavior:smooth}
  body{background:${G.bg};background-attachment:fixed;min-height:100vh;font-family:'Inter',sans-serif;color:${G.dark};-webkit-font-smoothing:antialiased;letter-spacing:.01em}
  select option{background:#FFF8F0;color:#160E06}
  ::-webkit-scrollbar{width:3px}
  ::-webkit-scrollbar-thumb{background:rgba(140,60,16,0.14);border-radius:3px}
  .nav-scroll::-webkit-scrollbar{display:none}

  /* ── Animations ── */
  @keyframes shimmer    {from{left:-100%}to{left:110%}}
  @keyframes fadein     {from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  @keyframes slideup    {from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
  @keyframes slidein    {from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:none}}
  @keyframes appear     {from{opacity:0;transform:scale(.98)}to{opacity:1;transform:scale(1)}}
  @keyframes pulse      {0%,100%{opacity:.3}50%{opacity:1}}
  @keyframes breathe    {0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
  @keyframes bounce     {0%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}70%{transform:translateY(-2px)}}
  @keyframes glow       {0%,100%{box-shadow:0 0 0 0 rgba(140,60,16,0)}50%{box-shadow:0 0 12px 2px rgba(140,60,16,0.15)}}
  @keyframes scanbeam   {0%{top:-2px;opacity:.9}100%{top:100%;opacity:0}}
  @keyframes dotping    {0%{transform:scale(1);opacity:1}70%{transform:scale(2.2);opacity:0}100%{transform:scale(1);opacity:0}}
  @keyframes drawerUp   {from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)}}
  @keyframes fabIn      {from{opacity:0;transform:translateY(10px) scale(.9)}to{opacity:1;transform:none}}

  /* ── Interactions globales ── */
  button,input,select,textarea{font-family:inherit;-webkit-font-smoothing:antialiased}
  button{min-height:44px;transition:all .2s cubic-bezier(.4,0,.2,1)}
  button:not(:disabled):active{transform:scale(.97)!important;transition:transform .06s!important}
  input:focus,select:focus{
    outline:none;
    border-color:rgba(140,60,16,0.32)!important;
    box-shadow:0 0 0 3px rgba(140,60,16,0.08),0 1px 2px rgba(70,32,8,0.04)!important;
    transition:box-shadow .2s,border-color .2s;
  }
  textarea:focus{outline:none}

  /* ── Cards ── */
  .card-hover{transition:transform .22s ease,box-shadow .22s ease!important}
  .card-hover:hover{transform:translateY(-2px)!important;box-shadow:0 12px 40px rgba(70,32,8,0.10),0 3px 8px rgba(70,32,8,0.06)!important}
  .card-hover:active{transform:translateY(0)!important}

  /* ── Tabs ── */
  .tabs-scroll::-webkit-scrollbar{display:none}
  .tab-btn{position:relative;overflow:hidden;letter-spacing:.02em}
  .tab-btn::after{content:'';position:absolute;bottom:0;left:50%;right:50%;height:1.5px;background:rgba(255,255,255,0.4);transition:left .25s ease,right .25s ease}
  .tab-btn.active::after{left:20%;right:20%}

  /* ── Ligne de séparation éditoriale ── */
  .rule{height:1px;background:linear-gradient(90deg,transparent,${G.border} 30%,${G.border} 70%,transparent);border:none;margin:20px 0}

  /* ── Stagger entrée ── */
  .s1{animation:fadein .3s ease both .04s}
  .s2{animation:fadein .3s ease both .09s}
  .s3{animation:fadein .3s ease both .14s}
  .s4{animation:fadein .3s ease both .19s}
  .s5{animation:fadein .3s ease both .24s}

  input[type=number]::-webkit-inner-spin-button{opacity:1}
`;

const Card = ({children, style={}, onClick}) => (
  <div
    onClick={onClick}
    className={onClick?"card-hover":""}
    style={{
      background: G.glass,
      backdropFilter: G.blur,
      WebkitBackdropFilter: G.blur,
      border: `1px solid ${G.border}`,
      borderRadius: 18,
      boxShadow: G.shadow,
      cursor: onClick ? "pointer" : "default",
      transition: "box-shadow .2s, transform .18s",
      ...style
    }}>
    {children}
  </div>
);

/* ═══════════════════════════
   APP
═══════════════════════════ */
export default function App(){
  const [tab,          setTab]          = useState("accueil");
  const [weekOffset,   setWeekOffset]   = useState(0);
  const [activeZone,   setActiveZone]   = useState("reserve");
  const [delivZone,    setDelivZone]    = useState("reserve");
  /* delivery : { [recipeId]: { demi, pleine, temp } } */
  const [delivery,     setDelivery]     = useState(() => Object.fromEntries(RECIPES.map(r=>[r.id,emptyDel()])));
  const [deliveryLots, setDeliveryLots] = useState({});
  const [inventory,    setInventory]    = useState(emptyInv);
  const [snapshot,     setSnapshot]     = useState(null);
  const [loaded,       setLoaded]       = useState(false);
  const [weather,      setWeather]      = useState({coeff:1.0,label:"",tMin:null,tMax:null,days:[],loading:false,err:false,updatedAt:null});
  const [scanTarget,   setScanTarget]   = useState(null); // {id, mode:"livraison"|"tracabilite"}
  const [suggestion,   setSuggestion]   = useState(null);
  const [aiText,       setAiText]       = useState("");
  const [aiLoading,    setAiLoading]    = useState(false);
  const [pdfLoading,   setPdfLoading]   = useState(false);
  const [toast,        setToast]        = useState("");
  const [histEntries,    setHistEntries]   = useState([]);
  const [histLoading,    setHistLoading]   = useState(false);
  const [histFilterType, setHistFilterType]= useState("all");
  const [histFilterAuth, setHistFilterAuth]= useState("");
  /* ── Auth ── */
  const [user,         setUser]         = useState(null);
  const [authChecked,  setAuthChecked]  = useState(false);
  const [author,       setAuthor]       = useState(() => localStorage.getItem("gl_author")||"");
  const [avatarColor,  setAvatarColor]  = useState(() => localStorage.getItem("gl_avatar_color")||"#8C3C10");
  const [avatarShape,  setAvatarShape]  = useState(() => localStorage.getItem("gl_avatar_shape")||"circle");
  const [avatarAnim,   setAvatarAnim]   = useState(() => localStorage.getItem("gl_avatar_anim")||"breathe");
  const [showOnboarding,setShowOnboarding]=useState(false);
  const [manualOrder,  setManualOrder]  = useState(() => Object.fromEntries(RECIPES.map(r=>[r.id,{demi:0,pleine:0}])));
  const [manualOrder2, setManualOrder2] = useState(() => Object.fromEntries(RECIPES.map(r=>[r.id,{demi:0,pleine:0}])));
  const [cmdMode,      setCmdMode]      = useState("manual");
  const [tracaRecords, setTracaRecords] = useState([]);
  const [tracaZone,    setTracaZone]    = useState("boutique");
  const emptyTracaNew = ()=>({ recipeId:"", lot:"", dlc:"", miseEnPlace:todayISO(), retrait:addDays(todayISO(),14), format:"demi" });
  const [tracaNew,     setTracaNew]     = useState(emptyTracaNew);
  /* Contrôle température réception */
  const emptyTempForm = ()=>({ nom:"", format:"pleine", lot:"", temp:"" });
  const [tempRecs,     setTempRecs]     = useState([]);
  const [tempForm,     setTempForm]     = useState(emptyTempForm);
  const [savedFlash,   setSavedFlash]   = useState(false);
  const [configs,      setConfigs]      = useState([]);
  const [configsLoading,setConfigsLoading]=useState(false);
  const [configName,   setConfigName]   = useState("");
  const [storageWarning,setStorageWarning]=useState(false);
  const [sendDocPending,setSendDocPending]=useState(null); // {buildFn,docType,title,weekLbl}
  const [lastSync,      setLastSync]      = useState(null);
  const [plusOpen,      setPlusOpen]      = useState(false);
  const [fabOpen,       setFabOpen]       = useState(false);
  const [livWizardStep, setLivWizardStep] = useState(1); // 1=qté+temp, 2=scan, 3=récap
  const [dashSubTab,    setDashSubTab]    = useState("apercu"); // apercu|alertes|zones|recettes

  /* ── Helper envoi PDF vers Documents ── */
  const sendToDropbox=useCallback(async(buildFn,docType,title,weekLbl,destination="responsable")=>{
    setPdfLoading(true);
    // 1. Génération du PDF
    let blob;
    try{ blob=await buildFn(); }
    catch(e){ console.error("PDF generation error:",e); showToast("Erreur génération PDF"); setPdfLoading(false); return; }
    if(!blob){ showToast("Erreur génération PDF"); setPdfLoading(false); return; }
    // 2. Conversion base64
    let b64;
    try{
      const ab=await blob.arrayBuffer();
      const bytes=new Uint8Array(ab);
      let bin="";
      for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
      b64=btoa(bin);
    }catch(e){ console.error("Base64 conversion error:",e); showToast("Erreur conversion PDF"); setPdfLoading(false); return; }
    // 3. Envoi au serveur
    try{
      const r=await fetch("/api/dropbox",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({title,docType,week:weekLbl,pdfBase64:b64,destination}),
      });
      if(r.ok){
        showToast(destination==="adjoint"?"Envoyé à l'espace Production":"Envoyé à l'espace Responsable");
        const typeLabels={livraison:"Bon de réception",inventaire:"État des stocks",tracabilite:"Fiche traçabilité",commande:"Bon de commande"};
        const destLabel=destination==="adjoint"?"Espace Production":"Espace Responsable";
        const he=await historyAPI.push({type:"document",label:`Document envoyé → ${destLabel}`,data:{title,docType,typeLabel:typeLabels[docType]||docType,week:weekLbl,destination}});
        if(he) setHistEntries(prev=>[he,...prev]);
      } else {
        const err=await r.json().catch(()=>({}));
        console.error("Dropbox upload failed:",r.status,err);
        if(r.status===401) showToast("Session expirée — reconnectez-vous");
        else showToast(err.error||`Erreur serveur (${r.status})`);
      }
    }catch(e){
      console.error("Dropbox fetch error:",e);
      showToast("Serveur inaccessible — relancez l'application");
    }
    setPdfLoading(false);
  },[]);

  const toastRef      = useRef(null);
  const weatherRef    = useRef(null);
  const lastInvEditRef= useRef(0); // timestamp dernier edit local inventory
  const season    = getSeason(weekOffset);
  const eco       = computeEco(snapshot, inventory);
  const invStatus    = useDebouncedSave("ad9_inv",     inventory,    loaded);
  const tracaStatus  = useDebouncedSave("ad9_traca",   tracaRecords, loaded);
  const tempRecStatus= useDebouncedSave("ad9_temprec", tempRecs,     loaded);

  /* ── Chargement initial — vérifie la session puis charge les données ── */
  useEffect(()=>{
    (async()=>{
      /* 1. Vérifier la session */
      try{
        const r=await fetch("/api/me");
        if(r.ok){ const d=await r.json(); setUser(d.user); if(d.user?.role==="responsable")setTab("boutique"); }
      }catch{}
      setAuthChecked(true);

      /* 2. Charger les données (seulement si session valide) */
      try{const r=await storage.get("ad9_inv");       if(r)setInventory(JSON.parse(r.value));}catch{}
      try{const r=await storage.get("ad9_snap");      if(r)setSnapshot(JSON.parse(r.value));}catch{}
      try{const r=await storage.get("ad9_sug");       if(r){const p=JSON.parse(r.value);setSuggestion(p.s);setAiText(p.t||"");}}catch{}
      try{const r=await storage.get("ad9_traca",true);if(r)setTracaRecords(JSON.parse(r.value));}catch{}
      try{const r=await storage.get("ad9_temprec");if(r)setTempRecs(JSON.parse(r.value));}catch{}
      try{const s=await fetch("/api/status");const d=await s.json();if(d.storage==="file")setStorageWarning(true);}catch{}
      setLoaded(true);
    })();
  },[]);

  /* ── Météo ── */
  const fetchWeather = useCallback(async()=>{
    setWeather(w=>({...w,loading:true,err:false}));
    try{
      const{s,e}=weekRange(weekOffset);
      const fmt=d=>d.toISOString().split("T")[0];
      const url=`https://api.open-meteo.com/v1/forecast?latitude=48.8566&longitude=2.3522&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_sum,windspeed_10m_max&start_date=${fmt(s)}&end_date=${fmt(e)}&timezone=Europe%2FParis`;
      const res=await fetch(url);
      if(!res.ok)throw new Error(`HTTP ${res.status}`);
      const data=await res.json();
      if(!data.daily?.time)throw new Error("No data");
      const{time,temperature_2m_max:maxs,temperature_2m_min:mins,weathercode:codes,precipitation_sum:rains}=data.daily;
      const days=time.map((date,i)=>({date,dow:JOURS[new Date(date).getDay()],tMax:Math.round(maxs[i]??18),tMin:Math.round(mins[i]??10),code:codes[i]??3,label:wLabel(codes[i]??3),short:wShort(codes[i]??3),color:wColor(codes[i]??3),rain:+(rains[i]||0).toFixed(1),coeff:dayCoeff(codes[i]??3,maxs[i]??18)}));
      setWeather({coeff:weekCoeff(days),label:wLabel(Math.max(...codes)),tMin:Math.round(Math.min(...mins)),tMax:Math.round(Math.max(...maxs)),days,loading:false,err:false,updatedAt:new Date()});
    }catch(err){
      console.error("Météo:",err.message);
      setWeather(w=>({...w,loading:false,err:true}));
    }
  },[weekOffset]);

  useEffect(()=>{
    fetchWeather();
    clearInterval(weatherRef.current);
    if(weekOffset===0) weatherRef.current=setInterval(fetchWeather, REFRESH);
    return ()=>clearInterval(weatherRef.current);
  },[weekOffset]);

  /* ── Toast ── */
  const showToast = msg => {
    setToast(msg);
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(()=>setToast(""), 2500);
  };

  /* ── Updates ── */
  const updateInv = useCallback((id,zoneId,field,v) =>{
    lastInvEditRef.current=Date.now();
    setInventory(prev=>({...prev,[id]:{...prev[id],[zoneId]:{...(prev[id]?.[zoneId]||emptyZone()),[field]:Math.max(0,v)}}}));
  },[]);
  const updateDel = useCallback((id,field,v) =>
    setDelivery(prev=>({...prev,[id]:{...prev[id],[field]:field==="temp"?v:Math.max(0,+v)}})),[]);

  /* ── Confirmer livraison ── */
  const confirmDelivery = useCallback(async()=>{
    const zoneName=ZONES.find(z=>z.id===delivZone)?.label;
    lastInvEditRef.current=Date.now();
    // Calculer le nouvel inventaire hors du setter pour l'enregistrer immédiatement
    let newInv;
    setInventory(prev=>{
      const next=JSON.parse(JSON.stringify(prev));
      RECIPES.forEach(r=>{
        const cur=next[r.id]?.[delivZone]||emptyZone();
        const del=delivery[r.id]||emptyDel();
        next[r.id][delivZone]={demi:cur.demi+del.demi, pleine:cur.pleine+del.pleine};
      });
      const snap={deliveredAt:Date.now(),zone:delivZone,delivery:JSON.parse(JSON.stringify(delivery)),lots:JSON.parse(JSON.stringify(deliveryLots)),data:next};
      setSnapshot(snap);
      storage.set("ad9_snap",JSON.stringify(snap)).catch(()=>{});
      newInv=next;
      return next;
    });
    // Sauvegarde immédiate (pas de debounce) pour éviter la race avec syncNow
    setTimeout(()=>{ if(newInv) storage.set("ad9_inv",JSON.stringify(newInv)).catch(()=>{}); },50);
    const entry=await historyAPI.push({type:"livraison",label:`Livraison — ${zoneName}`,author:user?.name||"Équipe",
      data:{zone:delivZone,delivery:Object.fromEntries(RECIPES.map(r=>[r.id,delivery[r.id]])),lots:deliveryLots}});
    if(entry) setHistEntries(prev=>[entry,...prev]);
    setDelivery(Object.fromEntries(RECIPES.map(r=>[r.id,emptyDel()])));
    setDeliveryLots({});
    showToast(`Livraison confirmée — ${zoneName}`);
  },[delivery,delivZone,deliveryLots,author]);

  /* ── Génération IA ── */
  const generateOrder = async()=>{
    setAiLoading(true); setSuggestion(null); setAiText("");
    let liveInv=inventory;
    try{const r=await storage.get("ad9_inv");if(r?.value){const v=JSON.parse(r.value);liveInv=v;setInventory(cur=>JSON.stringify(cur)===JSON.stringify(v)?cur:v);}}catch{}
    const liveEco=computeEco(snapshot,liveInv);
    const dbl=isDouble(weekOffset);
    const c1=Object.fromEntries(RECIPES.map(r=>[r.id,smartOrder(r,liveInv,liveEco,weather.coeff,season,dbl?3:7)]));
    const c2=dbl?Object.fromEntries(RECIPES.map(r=>{
      const consumed=r.rate*weather.coeff*season*2;
      const atC2=Math.max(0,totalZ(liveInv[r.id])-consumed+c1[r.id].totalEq);
      return[r.id,smartOrder(r,{[r.id]:{reserve:{demi:atC2,pleine:0},taxi:emptyZone(),boutique:emptyZone()}},liveEco,weather.coeff,season,4)];
    })):null;
    const invL =RECIPES.map(r=>{const i=liveInv[r.id];return `${r.name}: R(${i.reserve.demi}D+${i.reserve.pleine}P) T(${i.taxi.demi}D+${i.taxi.pleine}P) B(${i.boutique.demi}D+${i.boutique.pleine}P)`;}).join("\n");
    const ecoL =liveEco?RECIPES.filter(r=>liveEco[r.id]?.sold>0).map(r=>`${r.name}: ${liveEco[r.id].sold} vendus en ${liveEco[r.id].days}j`).join("\n"):"Pas de données.";
    const metL =weather.days.map(d=>`${d.dow} ${d.tMax}°C ${d.label} x${d.coeff}`).join(" | ");
    const fmtC =cmd=>RECIPES.filter(r=>cmd[r.id].totalEq>0).map(r=>`${r.name}: ${cmd[r.id].demi}D+${cmd[r.id].pleine}P`).join("\n")||"Aucune";
    try{
      const res=await fetch("/api/anthropic",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:900,messages:[{role:"user",content:
`Glacerie Alain Ducasse Paris. Semaine ${weekLabel(weekOffset)}.
Météo: ${metL} | Coeff x${weather.coeff} | Saison x${season.toFixed(1)}
${dbl?"Double commande: C1 dimanche (3j jusqu'au mardi), C2 mardi (4j jusqu'au jeudi).":"Commande unique lundi (livraison mercredi, 3j)."}
Zones: Réserve, Taxi (grand froid), Boutique. Demi=2.5L, Pleine=5L.
Stock:\n${invL}\nEcoulement:\n${ecoL}
Suggestion C1: ${fmtC(c1)}${c2?`\nSuggestion C2: ${fmtC(c2)}`:""}
3 blocs, 160 mots max, sans markdown:
STOCK — alertes critiques
${dbl?"COMMANDE 1 — recette: X demi + Y pleine\nCOMMANDE 2 — recette: X demi + Y pleine":"COMMANDE — recette: X demi + Y pleine"}
AJUSTEMENTS — raisons`
        }]})});
      const d=await res.json(); const text=d.content?.[0]?.text||"";
      const sg={c1,c2,week:weekOffset};
      setSuggestion(sg); setAiText(text);
      setManualOrder(Object.fromEntries(RECIPES.map(r=>[r.id,{demi:c1[r.id].demi,pleine:c1[r.id].pleine}])));
      if(c2)setManualOrder2(Object.fromEntries(RECIPES.map(r=>[r.id,{demi:c2[r.id].demi,pleine:c2[r.id].pleine}])));
      historyAPI.push({type:"commande",label:`Commande IA — ${weekLabel(weekOffset)}`,author:user?.name||"Équipe",data:{week:weekOffset,coeff:weather.coeff,c1,c2,aiText:text}}).then(e=>{if(e)setHistEntries(prev=>[e,...prev]);});
      try{await storage.set("ad9_sug",JSON.stringify({s:sg,t:text}));}catch{}
    }catch{
      const sg={c1,c2,week:weekOffset};
      setSuggestion(sg); setAiText("Suggestions calculées automatiquement.");
      setManualOrder(Object.fromEntries(RECIPES.map(r=>[r.id,{demi:c1[r.id].demi,pleine:c1[r.id].pleine}])));
      if(c2)setManualOrder2(Object.fromEntries(RECIPES.map(r=>[r.id,{demi:c2[r.id].demi,pleine:c2[r.id].pleine}])));
    }
    setAiLoading(false); setCmdMode("manual");
  };

  /* ── Traçabilité ── */
  const saveTraca = async recs => {
    setTracaRecords(recs);
    try{await storage.set("ad9_traca",JSON.stringify(recs),true);}catch{}
  };
  const addTracaRecord = (recipeId,lotInfo) => {
    const today=todayISO();
    const rec={id:Date.now(),recipeId,name:RECIPES.find(r=>r.id===recipeId)?.name||"",zone:tracaZone,
      lot:lotInfo?.lot||null,miseEnPlace:today,dlcJ14:addDays(today,14),
      createdAt:new Date().toISOString(),author:user?.name||"Équipe"};
    saveTraca([rec,...tracaRecords]);
    showToast("Traçabilité enregistrée");
  };

  /* ── Configs ── */
  const loadConfigs = async()=>{
    setConfigsLoading(true);
    try{
      const keys=await storage.listKeys("config_")||[];
      const all=[];
      for(const key of keys){
        try{const r=await storage.get(key,true);if(r)all.push({key,...JSON.parse(r.value)});}catch{}
      }
      setConfigs(all.sort((a,b)=>new Date(b.savedAt)-new Date(a.savedAt)));
    }catch{setConfigs([]);}
    setConfigsLoading(false);
  };
  const saveConfig = async()=>{
    if(!configName.trim()) return;
    const key=`config_${Date.now()}`;
    const cfg={name:configName.trim(),author:user?.name||"Équipe",savedAt:new Date().toISOString(),
      inventory:JSON.parse(JSON.stringify(inventory)),totalEq:RECIPES.reduce((s,r)=>s+totalZ(inventory[r.id]),0)};
    try{await storage.set(key,JSON.stringify(cfg),true);setConfigName("");showToast(`"${cfg.name}" sauvegardée`);loadConfigs();}
    catch{showToast("Erreur de sauvegarde");}
  };

  useEffect(()=>{if(tab==="configs")loadConfigs();},[tab]);
  const loadHistory=async()=>{setHistLoading(true);setHistEntries(await historyAPI.get());setHistLoading(false);};
  useEffect(()=>{if(tab==="historique")loadHistory();},[tab]);

  /* ── Sync temps réel — SSE + fallback polling 30s ── */
  const syncNow = useCallback(async()=>{
    try{
      const r=await fetch("/api/snapshot");
      if(!r.ok) return;
      const{inv,traca,temprec}=await r.json();
      // Ne pas écraser l'inventaire local si un edit a eu lieu dans les 2 dernières secondes
      // (évite la race condition entre debounce 600ms et le push SSE)
      const invRecentlyEdited = Date.now()-lastInvEditRef.current < 2000;
      if(inv&&!invRecentlyEdited) setInventory(cur=>{try{const v=JSON.parse(inv);return JSON.stringify(cur)===JSON.stringify(v)?cur:v;}catch{return cur;}});
      if(traca)  setTracaRecords(cur=>{try{const v=JSON.parse(traca); return JSON.stringify(cur)===JSON.stringify(v)?cur:v;}catch{return cur;}});
      if(temprec)setTempRecs(    cur=>{try{const v=JSON.parse(temprec);return JSON.stringify(cur)===JSON.stringify(v)?cur:v;}catch{return cur;}});
      setLastSync(new Date());
    }catch{}
    try{
      const h=await historyAPI.get();
      setHistEntries(cur=>JSON.stringify(cur)===JSON.stringify(h)?cur:h);
    }catch{}
  },[]);
  useEffect(()=>{
    if(!loaded) return;
    syncNow(); // sync immédiat au chargement

    // SSE — push instantané depuis le serveur à chaque écriture
    let es;
    try{
      es=new EventSource("/api/events");
      es.addEventListener("update",()=>syncNow());
      // en cas d'erreur, EventSource se reconnecte automatiquement
    }catch{ es=null; }

    // Fallback polling toutes les 30s (si SSE indisponible / réseau instable)
    const t=setInterval(syncNow,30_000);
    return()=>{ if(es) es.close(); clearInterval(t); };
  },[loaded,syncNow]);

  /* ── Données dérivées ── */
  const sorbets  = RECIPES.filter(r=>r.type==="Sorbet");
  const glaces   = RECIPES.filter(r=>r.type==="Glace");
  const zoneStats= ZONES.map(z=>({...z,demi:RECIPES.reduce((s,r)=>s+(inventory[r.id]?.[z.id]?.demi||0),0),pleine:RECIPES.reduce((s,r)=>s+(inventory[r.id]?.[z.id]?.pleine||0),0),eq:RECIPES.reduce((s,r)=>s+zoneDemi(inventory[r.id],z.id),0)}));
  const epuises  = RECIPES.filter(r=>totalZ(inventory[r.id])===0).length;
  const bas      = RECIPES.filter(r=>{const t=totalZ(inventory[r.id]);return t>0&&t<=2;}).length;
  const totalGl  = RECIPES.reduce((s,r)=>s+totalZ(inventory[r.id]),0);

  /* ── Prévisions météo ── */
  const WeatherForecast=()=>{
    if(weather.loading) return <Card style={{padding:"14px",textAlign:"center"}}><span style={{fontSize:10,color:G.light,animation:"pulse 1.4s infinite"}}>Chargement météo…</span></Card>;
    if(weather.err)     return <Card style={{padding:"12px"}}><div style={{fontSize:11,color:G.warn}}>Météo indisponible. <button onClick={fetchWeather} style={{background:"none",border:"none",color:G.copper,cursor:"pointer",textDecoration:"underline",fontSize:11,minHeight:"auto",padding:0}}>Réessayer</button></div></Card>;
    if(!weather.days.length&&!weather.loading&&!weather.err) return(
      <Card style={{padding:"12px 16px",marginBottom:16,border:`1px solid rgba(148,82,8,0.35)`,background:"rgba(148,82,8,0.06)"}}>
        <div style={{fontSize:11,color:G.warn,lineHeight:1.6}}>
          Météo indisponible — coefficient ×1.0 par défaut. Les suggestions de commande peuvent être sous-estimées par temps chaud.
        </div>
        <button onClick={fetchWeather} style={{marginTop:8,background:"none",border:`1px solid ${G.borderS}`,color:G.copper,fontSize:10,padding:"5px 12px",borderRadius:8,cursor:"pointer",minHeight:"auto"}}>
          Réessayer
        </button>
      </Card>
    );
    return(
      <Card style={{padding:"14px",marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:12}}>
          <span style={{fontSize:9,letterSpacing:4,color:G.copper,textTransform:"uppercase"}}>Prévisions semaine</span>
          <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:15,color:G.copper}}>moy. ×{weather.coeff}</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
          {weather.days.map((d,i)=>{
            const isToday=new Date().toDateString()===new Date(d.date).toDateString();
            return(
              <div key={i} style={{textAlign:"center",padding:"7px 2px",background:isToday?"rgba(168,82,46,0.10)":"rgba(255,255,255,0.35)",backdropFilter:"blur(8px)",borderRadius:8,border:`1px solid ${isToday?G.borderS:G.border}`}}>
                <div style={{fontSize:7,color:G.light,letterSpacing:1}}>{d.dow}</div>
                <div style={{height:3,borderRadius:2,background:d.color,margin:"4px auto",width:"65%"}}/>
                <div style={{fontSize:8,letterSpacing:1,color:d.color,fontWeight:600,marginBottom:2}}>{d.short}</div>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:13,color:G.dark}}>{d.tMax}°</div>
                <div style={{fontSize:7,color:G.light}}>{d.tMin}°</div>
                {d.rain>0&&<div style={{fontSize:7,color:"#3A6A9A"}}>{d.rain}mm</div>}
                <div style={{fontSize:8,fontWeight:700,marginTop:3,color:d.coeff>=1.2?G.ok:d.coeff<=0.6?G.danger:G.mid}}>×{d.coeff}</div>
              </div>
            );
          })}
        </div>
      </Card>
    );
  };

  /* ── Libellés des rôles ── */
  const roleLabel = r=>r==="responsable"?"Responsable boutique":r==="adjoint"?"Adjoint production":"Équipier";

  /* ── Déconnexion ── */
  const logout = async()=>{
    await fetch("/api/logout",{method:"POST"});
    setUser(null);
  };

  /* ── Accès par rôle ── */
  const TAB_ACCESS = {
    accueil:    ["equipier","adjoint","responsable"],
    boutique:   ["equipier","responsable"],
    livraison:  ["equipier"],
    inventaire: ["equipier"],
    commande:   ["equipier"],
    tracabilite:["equipier"],
    caisse:     ["equipier"],
    documents:  ["adjoint","responsable"],
    configs:    ["responsable"],
    historique: ["equipier","responsable"],
  };
  const canAccess = id => !user || (TAB_ACCESS[id]||[]).includes(user.role);

  /* ══════════════════ RENDER ══════════════════ */

  /* Écran de chargement initial */
  if(!authChecked) return(
    <div style={{minHeight:"100vh",background:G.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <style>{CSS}</style>
      <div style={{textAlign:"center"}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:300,color:G.dark,marginBottom:8,animation:"pulse 1.4s infinite"}}>Chargement…</div>
        <div style={{fontSize:9,color:G.light}}>Manufacture de Glace</div>
      </div>
    </div>
  );

  /* Écran de connexion */
  if(!user) return(
    <>
      <style>{CSS}</style>
      <LoginScreen onLogin={u=>{setUser(u); setAuthor(u.name); localStorage.setItem("gl_author",u.name); if(u.role==="responsable")setTab("boutique");}}/>
    </>
  );

  return(
    <div style={{minHeight:"100vh",background:G.bg,backgroundAttachment:"fixed",fontFamily:"'Inter',sans-serif",color:G.dark}}>
      <style>{CSS}</style>

      {/* BADGE SYNC — coin supérieur droit fixe */}
      {user&&(()=>{
        const syncing=[invStatus,tracaStatus,tempRecStatus].some(s=>s==="saving");
        const offline=storageWarning;
        const state=offline?"offline":syncing?"syncing":"synced";
        const cfg={
          syncing:{l:"Synchro…", c:G.warn,   bg:G.warnBg,   icon:"⏳"},
          synced: {l:"À jour",   c:G.ok,     bg:G.okBg,     icon:"✓"},
          offline:{l:"Hors ligne",c:G.danger, bg:G.dangerBg, icon:"⚠"},
        }[state];
        return(
          <div style={{
            position:"fixed",top:12,right:12,zIndex:910,
            padding:"4px 10px",borderRadius:20,
            background:cfg.bg,border:`1px solid ${cfg.c}30`,
            display:"flex",alignItems:"center",gap:5,
            fontSize:9,fontWeight:600,color:cfg.c,
            pointerEvents:"none",
          }}>
            <span style={{animation:state==="syncing"?"pulse 1s infinite":undefined}}>{cfg.icon}</span>
            {cfg.l}
          </div>
        );
      })()}

      {/* TOAST */}
      {toast&&(
        <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",
          background:"rgba(22,14,6,0.92)",backdropFilter:"blur(20px)",
          color:"#fff",padding:"12px 22px",borderRadius:28,
          fontSize:11,letterSpacing:.5,zIndex:999,
          animation:"slideup .2s ease",whiteSpace:"nowrap",
          boxShadow:"0 8px 32px rgba(0,0,0,0.22)",
          border:"1px solid rgba(255,255,255,0.08)"}}>
          {toast}
        </div>
      )}

      {/* Modal choix destination document */}
      {sendDocPending&&(
        <SendDocModal
          docType={sendDocPending.docType}
          onSend={async(dest)=>{
            const p=sendDocPending;
            setSendDocPending(null);
            await sendToDropbox(p.buildFn,p.docType,p.title,p.weekLbl,dest);
          }}
          onCancel={()=>setSendDocPending(null)}
        />
      )}

      {/* ── FAB — Bouton flottant actions rapides — équipier uniquement ── */}
      {user&&user.role==="equipier"&&(
        <div style={{position:"fixed",bottom:24,right:20,zIndex:990,display:"flex",flexDirection:"column-reverse",alignItems:"flex-end",gap:10}}>
          {fabOpen&&(
            <>
              <div onClick={()=>setFabOpen(false)} style={{position:"fixed",inset:0,zIndex:-1}}/>
              {[
                {label:"Réception rapide",  action:()=>{setTab("livraison");setFabOpen(false);setLivWizardStep(1);}},
                {label:"Scanner étiquette", action:()=>{setTab("livraison");setLivWizardStep(2);setScanTarget({id:RECIPES[0].id,mode:"livraison"});setFabOpen(false);}},
                {label:"Traçabilité",       action:()=>{setTab("tracabilite");setFabOpen(false);}},
                {label:"Commande IA",       action:()=>{setTab("commande");setFabOpen(false);}},
              ].map((a,i)=>(
                <button key={i} onClick={a.action} style={{
                  display:"flex",alignItems:"center",gap:10,
                  padding:"10px 18px",borderRadius:28,
                  background:G.glassS,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",
                  border:`1px solid ${G.border}`,
                  boxShadow:"0 4px 20px rgba(70,32,8,0.15)",
                  fontSize:12,color:G.dark,cursor:"pointer",
                  minHeight:"auto",whiteSpace:"nowrap",
                  animation:`fabIn .18s ease both ${i*.06}s`,
                }}>
                  <span style={{fontWeight:500}}>{a.label}</span>
                </button>
              ))}
            </>
          )}
          <button onClick={()=>setFabOpen(p=>!p)} style={{
            width:56,height:56,borderRadius:"50%",
            background:`linear-gradient(135deg,${G.copperL},${G.copper})`,
            border:"none",color:"#fff",fontSize:26,cursor:"pointer",
            boxShadow:"0 6px 24px rgba(140,60,16,0.5)",
            display:"flex",alignItems:"center",justifyContent:"center",
            transform:fabOpen?"rotate(45deg)":"rotate(0deg)",
            transition:"transform .25s cubic-bezier(.4,0,.2,1)",
            minHeight:"auto",
          }}>+</button>
        </div>
      )}

      {showOnboarding&&(
        <OnboardingModal
          initName={author} initColor={avatarColor} initShape={avatarShape} initAnim={avatarAnim}
          onDone={({name,color,shape,anim})=>{
          setAuthor(name); setAvatarColor(color); setAvatarShape(shape); setAvatarAnim(anim);
          localStorage.setItem("gl_author",name);
          localStorage.setItem("gl_avatar_color",color);
          localStorage.setItem("gl_avatar_shape",shape);
          localStorage.setItem("gl_avatar_anim",anim);
          localStorage.setItem(`gl_avatar_color_${name}`,color);
          localStorage.setItem(`gl_avatar_shape_${name}`,shape);
          localStorage.setItem(`gl_avatar_anim_${name}`,anim);
          setShowOnboarding(false);
        }}/>
      )}

      {/* C4 — Bannière stockage non persistant */}
      {storageWarning&&(
        <div style={{background:"rgba(122,16,8,0.92)",backdropFilter:"blur(8px)",color:"#fff",
          padding:"10px 20px",fontSize:11,textAlign:"center",letterSpacing:.5,zIndex:60,
          lineHeight:1.5}}>
          Stockage local actif — les données seront perdues au prochain redéploiement.
          Configurez Upstash Redis dans les variables d'environnement Render.
        </div>
      )}

      {/* HEADER */}
      <div style={{
        background:"rgba(250,244,236,0.91)",
        backdropFilter:"blur(36px)",WebkitBackdropFilter:"blur(36px)",
        borderBottom:`1px solid ${G.border}`,
        position:"sticky",top:0,zIndex:50,
      }}>
        <div style={{maxWidth:640,margin:"0 auto",padding:"0 20px"}}>

          {/* Brand row */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 0 10px",gap:12}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                {/* Avatar — personnalisation */}
                <AvatarDisplay
                  name={user.name} color={avatarColor} shape={avatarShape} anim={avatarAnim}
                  size={40} onClick={()=>setShowOnboarding(true)}
                  style={{border:"2px solid rgba(255,255,255,0.55)",cursor:"pointer",flexShrink:0}}/>
                <div>
                  <div style={{fontSize:7,letterSpacing:6,color:G.copper,textTransform:"uppercase",fontWeight:600}}>Alain Ducasse</div>
                  <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,fontWeight:300,color:G.dark,letterSpacing:.3}}>Manufacture de Glace</div>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginTop:2,flexWrap:"wrap"}}>
                    <span style={{fontSize:10,fontWeight:600,color:G.dark}}>{user.name}</span>
                    <span style={{fontSize:9,color:"#fff",background:user.role==="responsable"?G.copper:user.role==="adjoint"?"#1A3A6A":"#1E5E32",padding:"1px 8px",borderRadius:10,fontWeight:500}}>
                      {roleLabel(user.role)}
                    </span>
                    <button onClick={logout}
                      style={{fontSize:9,color:G.light,background:"none",border:`1px solid ${G.border}`,borderRadius:8,padding:"2px 8px",cursor:"pointer",minHeight:"auto",fontWeight:400}}>
                      Déconnexion
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
              {/* Sélecteur semaine */}
              <div style={{display:"flex",alignItems:"center",background:G.glass,border:`1px solid ${G.border}`,borderRadius:10,overflow:"hidden",boxShadow:G.shadow}}>
                <button onClick={()=>setWeekOffset(w=>w-1)} style={{background:"none",border:"none",borderRight:`1px solid ${G.border}`,color:G.copper,cursor:"pointer",fontSize:14,padding:"5px 11px",minHeight:34,lineHeight:1}}>‹</button>
                <span style={{fontSize:9,letterSpacing:.5,color:G.mid,padding:"5px 10px",minWidth:90,textAlign:"center",fontWeight:500}}>
                  {weekStart(weekOffset).toLocaleDateString("fr-FR",{day:"numeric",month:"short"})} — {weekRange(weekOffset).e.toLocaleDateString("fr-FR",{day:"numeric",month:"short"})}
                </span>
                <button onClick={()=>setWeekOffset(w=>w+1)} style={{background:"none",border:"none",borderLeft:`1px solid ${G.border}`,color:G.copper,cursor:"pointer",fontSize:14,padding:"5px 11px",minHeight:34,lineHeight:1}}>›</button>
              </div>
              {/* Météo + save */}
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{fontSize:9,color:G.light,display:"flex",alignItems:"center",gap:5}}>
                  {weather.loading
                    ?<span style={{animation:"pulse 1.4s infinite"}}>Météo…</span>
                    :weather.err
                      ?<button onClick={fetchWeather} style={{background:"none",border:"none",color:G.warn,cursor:"pointer",fontSize:9,minHeight:"auto",padding:0}}>
                          <span style={{fontWeight:600}}>Météo hors ligne — ×1.0 par défaut</span>
                        </button>
                      :weather.tMin!==null&&<>
                          <span style={{color:G.mid}}>{weather.label}</span>
                          <span style={{fontWeight:600,color:G.dark}}>{weather.tMin}–{weather.tMax}°C</span>
                          <button onClick={fetchWeather} style={{background:G.faint,border:`1px solid ${G.border}`,color:G.copper,fontSize:8,padding:"2px 9px",borderRadius:12,cursor:"pointer",minHeight:"auto",fontWeight:500}}>×{weather.coeff}</button>
                        </>
                  }
                </div>
                <SaveIndicator status={invStatus}/>
              </div>
            </div>
          </div>

          {/* Navigation — barre scrollable unique, filtrée par rôle */}
          {(()=>{
            const ALL_NAV=[
              {id:"boutique",   l:"Boutique"},
              {id:"livraison",  l:"Réception"},
              {id:"commande",   l:"Commande"},
              {id:"tracabilite",l:"Traçabilité"},
              {id:"inventaire", l:"Stock"},
              {id:"caisse",     l:"Caisse"},
              {id:"historique", l:"Journal"},
              {id:"documents",  l:"Documents"},
              {id:"configs",    l:"Paramètres"},
              {id:"accueil",    l:"Accueil"},
            ].filter(t=>canAccess(t.id));
            return(
              <div className="nav-scroll" style={{
                display:"flex",gap:6,paddingBottom:12,
                overflowX:"auto",msOverflowStyle:"none",scrollbarWidth:"none",
                WebkitOverflowScrolling:"touch",
              }}>
                {ALL_NAV.map(t=>(
                  <button key={t.id} onClick={()=>setTab(t.id)} style={{
                    flexShrink:0,padding:"8px 14px",borderRadius:20,cursor:"pointer",
                    background:tab===t.id?`linear-gradient(135deg,${G.copperL},${G.copper})`:"rgba(140,60,16,0.055)",
                    border:`1px solid ${tab===t.id?G.copper:"transparent"}`,
                    color:tab===t.id?"#fff":G.light,fontSize:11,fontWeight:tab===t.id?600:400,
                    minHeight:"auto",whiteSpace:"nowrap",
                    boxShadow:tab===t.id?"0 4px 16px rgba(140,60,16,0.35)":"none",
                    transition:"all .22s cubic-bezier(.4,0,.2,1)",
                    transform:tab===t.id?"translateY(-1px)":"none",
                  }}>{t.l}</button>
                ))}
              </div>
            );
          })()}
        </div>
      </div>

      {/* BODY */}
      <div style={{padding:"24px 20px 80px",maxWidth:640,margin:"0 auto"}}>

        {/* ── Bannière de contexte du jour ── */}
        {(()=>{
          const ctx=getDayContext();
          if(!ctx||!user||!canAccess(ctx.tab)) return null;
          return(
            <div style={{
              marginBottom:16,padding:"10px 14px",borderRadius:12,
              background:`${ctx.color}12`,border:`1px solid ${ctx.color}25`,
              display:"flex",alignItems:"center",gap:10,
            }}>
              <div style={{flex:1,minWidth:0,fontSize:11,color:ctx.color,fontWeight:600,lineHeight:1.5}}>
                {ctx.txt}
              </div>
              {tab!==ctx.tab&&canAccess(ctx.tab)&&(
                <button onClick={()=>setTab(ctx.tab)} style={{
                  background:ctx.color,border:"none",color:"#fff",
                  padding:"6px 12px",borderRadius:8,fontSize:10,fontWeight:600,
                  cursor:"pointer",whiteSpace:"nowrap",minHeight:"auto",flexShrink:0,
                }}>
                  Y aller →
                </button>
              )}
            </div>
          );
        })()}

        {/* ══ ACCUEIL ══ */}
        {tab==="accueil"&&(
          <div style={{animation:"fadein .28s ease"}}>
            {/* Greeting */}
            <div style={{marginBottom:20}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,fontWeight:300,color:G.dark,marginBottom:4}}>
                Bonjour{user?.name?`, ${user.name}`:""}
              </div>
              <div style={{fontSize:12,color:G.mid,marginTop:2}}>
                <span style={{fontWeight:600,color:G.copper,textTransform:"capitalize"}}>
                  {new Date().toLocaleDateString("fr-FR",{weekday:"long"})}
                </span>
                <span style={{color:G.light,marginLeft:6}}>
                  {new Date().toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"})}
                </span>
              </div>
            </div>

            {/* À faire aujourd'hui */}
            {(()=>{
              const tasks=[];
              /* C2 — Contexte du jour en tête de liste */
              const dayCtx=getDayContext();
              if(dayCtx) tasks.unshift({txt:dayCtx.txt,tab:dayCtx.tab,color:dayCtx.color,bg:`${dayCtx.color}15`,ping:false});
              if(tempRecs.filter(r=>r.date===todayISO()).length===0)
                tasks.push({txt:"Contrôler les températures à la réception",tab:"livraison",color:G.warn,bg:G.warnBg,ping:true});
              const dlcUrgent=tracaRecords.filter(r=>dlcDays(r.dlcJ14)!==null&&dlcDays(r.dlcJ14)<=2).length;
              if(dlcUrgent>0)
                tasks.push({txt:`${dlcUrgent} produit${dlcUrgent>1?"s":""} à retirer (J+14)`,tab:"tracabilite",color:G.danger,bg:G.dangerBg,ping:true});
              if(epuises>0)
                tasks.push({txt:`${epuises} saveur${epuises>1?"s":""} épuisée${epuises>1?"s":""}`,tab:"commande",color:G.danger,bg:G.dangerBg});
              if(bas>0)
                tasks.push({txt:`${bas} saveur${bas>1?"s":""} en stock bas`,tab:"commande",color:G.warn,bg:G.warnBg});
              if(tasks.length===0)
                tasks.push({txt:"Tout est en ordre — bonne journée",tab:null,color:G.ok,bg:G.okBg});
              return(
                <Card style={{padding:"18px 20px",marginBottom:18}}>
                  <div style={{fontSize:10,color:G.light,letterSpacing:.5,fontWeight:600,textTransform:"uppercase",marginBottom:14}}>
                    Aujourd'hui
                  </div>
                  {tasks.map((t,i)=>(
                    <div key={i} onClick={t.tab?()=>setTab(t.tab):undefined}
                      className={`s${i+1}`}
                      style={{display:"flex",alignItems:"center",gap:12,
                        padding:"11px 14px",
                        background:t.bg,
                        borderRadius:12,
                        marginBottom:i<tasks.length-1?8:0,
                        cursor:t.tab?"pointer":"default",
                        border:`1px solid ${t.color}20`,
                        borderLeft:`3px solid ${t.color}`,
                        transition:"transform .15s,opacity .15s"}}>
                      {/* Dot indicateur — pulse si urgent */}
                      <div style={{position:"relative",flexShrink:0}}>
                        <div style={{width:8,height:8,borderRadius:"50%",background:t.color}}/>
                        {t.ping&&<div style={{position:"absolute",inset:-4,borderRadius:"50%",
                          border:`2px solid ${t.color}`,animation:"dotping 1.8s infinite",opacity:.6}}/>}
                      </div>
                      <span style={{fontSize:12,color:t.color,fontWeight:500,flex:1,lineHeight:1.4}}>{t.txt}</span>
                      {t.tab&&<span style={{fontSize:18,color:t.color,opacity:.45,fontWeight:300,lineHeight:1}}>›</span>}
                    </div>
                  ))}
                </Card>
              );
            })()}

            {/* Alertes stock */}
            {(epuises>0||bas>0)&&(
              <Card style={{padding:"16px 18px",marginBottom:14,border:`1px solid ${G.borderS}`,background:"rgba(140,60,16,0.04)"}}>
                <div style={{fontSize:11,fontWeight:600,color:G.copper,marginBottom:12}}>Stock</div>
                {RECIPES.filter(r=>totalZ(inventory[r.id])===0).map(r=>(
                  <div key={r.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:`1px solid ${G.border}`}}>
                    <span style={{fontSize:12,color:G.mid}}>{r.name}</span>
                    <span style={{fontSize:8,fontWeight:700,color:G.danger,letterSpacing:2,textTransform:"uppercase",background:G.dangerBg,padding:"3px 8px",borderRadius:12}}>Épuisé</span>
                  </div>
                ))}
                {RECIPES.filter(r=>{const t=totalZ(inventory[r.id]);return t>0&&t<=2;}).map(r=>(
                  <div key={r.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:`1px solid ${G.border}`}}>
                    <span style={{fontSize:12,color:G.mid}}>{r.name}</span>
                    <span style={{fontSize:8,fontWeight:600,color:G.warn,background:G.warnBg,padding:"3px 8px",borderRadius:12}}>{totalZ(inventory[r.id])} restant</span>
                  </div>
                ))}
              </Card>
            )}

            {/* Alertes traçabilité */}
            {tracaRecords.filter(r=>dlcDays(r.dlcJ14)!==null&&dlcDays(r.dlcJ14)<=2).length>0&&(
              <Card style={{padding:"16px 18px",marginBottom:14,border:`1px solid rgba(122,16,8,0.3)`,background:G.dangerBg}}>
                <div style={{fontSize:8,letterSpacing:3,color:G.danger,textTransform:"uppercase",marginBottom:10,fontWeight:600}}>J+14 — Action requise</div>
                {tracaRecords.filter(r=>dlcDays(r.dlcJ14)!==null&&dlcDays(r.dlcJ14)<=2).map(r=>(
                  <div key={r.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:`1px solid ${G.border}`}}>
                    <span style={{fontSize:11,color:G.mid}}>{r.name} — Lot {r.lot||"—"}</span>
                    <span style={{fontSize:9,color:G.danger,fontWeight:700}}>{dlcDays(r.dlcJ14)<=0?"Expiré":`${dlcDays(r.dlcJ14)}j`}</span>
                  </div>
                ))}
              </Card>
            )}

            {/* Zones stock */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
              {zoneStats.map(z=>(
                <Card key={z.id} style={{padding:"16px 10px",textAlign:"center"}}>
                  <div style={{fontSize:7,letterSpacing:3,color:G.copper,textTransform:"uppercase",marginBottom:8,fontWeight:600}}>{z.label}</div>
                  <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:30,fontWeight:300,color:G.dark,lineHeight:1}}>{z.eq}</div>
                  <div style={{fontSize:8,color:G.light,marginTop:6}}>{z.demi}D · {z.pleine}P</div>
                </Card>
              ))}
            </div>

            <WeatherForecast/>

            {/* Actions rapides */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
              {[
                {l:"Boutique",    d:"Voir les pozzetti en temps réel",t:"boutique"},
                {l:"Livraison",   d:"Réception & températures",       t:"livraison"},
                {l:"Stock global",d:"Modifier les quantités",         t:"inventaire"},
                {l:"Commande",    d:isDouble(0)?"2 commandes cette semaine":"Commande hebdomadaire",t:"commande"},
              ].map((item,i)=>(
                <Card key={item.t} onClick={()=>setTab(item.t)}
                  style={{padding:"18px 16px",cursor:"pointer",
                    transition:"all .22s cubic-bezier(.4,0,.2,1)",
                    animation:`appear .3s ease both ${i*0.07}s`}}>
                  {/* Accent line */}
                  <div style={{width:28,height:3,borderRadius:2,background:`linear-gradient(90deg,${G.copperL},${G.copper})`,marginBottom:12}}/>
                  <div style={{fontSize:12,fontWeight:700,color:G.dark,marginBottom:4}}>{item.l}</div>
                  <div style={{fontSize:10,color:G.light,lineHeight:1.4}}>{item.d}</div>
                </Card>
              ))}
            </div>
            {eco&&RECIPES.some(r=>eco[r.id]?.sold>0)&&(
              <Card style={{padding:"14px 16px",marginBottom:16}}>
                <div style={{fontSize:8,letterSpacing:3,color:G.copper,textTransform:"uppercase",marginBottom:12}}>Rotation en cours</div>
                {RECIPES.filter(r=>eco[r.id]?.sold>0).sort((a,b)=>eco[b.id].ratePerDay-eco[a.id].ratePerDay).slice(0,6).map(r=>(
                  <div key={r.id} style={{display:"flex",alignItems:"center",padding:"5px 0",borderBottom:`1px solid ${G.border}`,gap:8}}>
                    <span style={{flex:1,fontSize:11}}>{r.name}</span>
                    <span style={{fontSize:10,color:G.mid}}>{eco[r.id].sold} vendus</span>
                    <span style={{fontSize:9,color:G.copper,minWidth:52,textAlign:"right"}}>{eco[r.id].ratePerDay.toFixed(2)}/j</span>
                  </div>
                ))}
                {snapshot?.deliveredAt&&<div style={{fontSize:9,color:G.light,marginTop:8}}>Depuis le {new Date(snapshot.deliveredAt).toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"})}</div>}
              </Card>
            )}
            {/* Plus de "Mon prénom" — l'identité vient du compte connecté */}
          </div>
        )}

        {/* ══ DASHBOARD STOCK (responsable) ══ */}
        {tab==="boutique"&&user?.role==="responsable"&&(
          <div style={{animation:"fadein .28s ease"}}>

            {/* ── En-tête dashboard ── */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
              <div>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:300,color:G.dark}}>Dashboard stock</div>
                <div style={{fontSize:10,color:G.light,marginTop:2}}>
                  {lastSync
                    ? `Actualisé à ${lastSync.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}`
                    : "Chargement…"}
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{display:"flex",alignItems:"center",gap:5,padding:"5px 11px",borderRadius:20,
                  background:"rgba(30,94,50,0.08)",border:"1px solid rgba(30,94,50,0.2)"}}>
                  <div style={{position:"relative",width:7,height:7,flexShrink:0}}>
                    <div style={{width:7,height:7,borderRadius:"50%",background:G.ok,position:"absolute"}}/>
                    <div style={{width:7,height:7,borderRadius:"50%",background:G.ok,position:"absolute",
                      animation:"dotping 2.4s ease-out infinite"}}/>
                  </div>
                  <span style={{fontSize:8,color:G.ok,fontWeight:700,letterSpacing:.5}}>LIVE</span>
                </div>
                <GBtn small label="↺" onClick={syncNow}/>
              </div>
            </div>

            {/* ── Sous-navigation dashboard ── */}
            <div style={{display:"flex",gap:0,marginBottom:16,borderRadius:10,overflow:"hidden",border:`1px solid ${G.border}`}}>
              {[
                {id:"apercu",    l:"Aperçu"},
                {id:"alertes",   l:"Alertes"},
                {id:"zones",     l:"Par zone"},
                {id:"recettes",  l:"Recettes"},
              ].map((s,i,arr)=>(
                <button key={s.id} onClick={()=>setDashSubTab(s.id)} style={{
                  flex:1,padding:"9px 4px",
                  background:dashSubTab===s.id?G.copper:"rgba(255,255,255,0.45)",
                  backdropFilter:"blur(8px)",
                  border:"none",borderRight:i<arr.length-1?`1px solid ${G.border}`:"none",
                  color:dashSubTab===s.id?"#fff":G.mid,
                  fontSize:10,fontWeight:dashSubTab===s.id?600:400,
                  cursor:"pointer",transition:"all .15s",minHeight:"auto",
                }}>
                  {s.l}
                </button>
              ))}
            </div>

            {/* ══ VUE APERÇU ══ */}
            {dashSubTab==="apercu"&&(<>

            {/* ── Alertes ── */}
            {(()=>{
              const ep = RECIPES.filter(r=>totalZ(inventory[r.id])===0);
              const lo = RECIPES.filter(r=>{const t=totalZ(inventory[r.id]);return t>0&&t<=3;});
              if(!ep.length&&!lo.length) return(
                <div style={{padding:"10px 16px",borderRadius:12,marginBottom:16,
                  background:"rgba(30,94,50,0.07)",border:"1px solid rgba(30,94,50,0.18)",
                  display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:16}}>✓</span>
                  <span style={{fontSize:11,color:G.ok,fontWeight:500}}>Tous les stocks sont opérationnels</span>
                </div>
              );
              return(
                <div style={{marginBottom:16,display:"flex",flexDirection:"column",gap:8}}>
                  {ep.length>0&&(
                    <div style={{padding:"10px 16px",borderRadius:12,
                      background:G.dangerBg,border:`1px solid rgba(122,16,8,0.22)`}}>
                      <div style={{fontSize:8,fontWeight:700,color:G.danger,letterSpacing:1.5,
                        textTransform:"uppercase",marginBottom:5}}>
                        Épuisés — {ep.length} recette{ep.length>1?"s":""}
                      </div>
                      <div style={{fontSize:11,color:G.danger,lineHeight:1.6}}>
                        {ep.map(r=>r.name).join(" · ")}
                      </div>
                    </div>
                  )}
                  {lo.length>0&&(
                    <div style={{padding:"10px 16px",borderRadius:12,
                      background:G.warnBg,border:`1px solid rgba(148,82,8,0.22)`}}>
                      <div style={{fontSize:8,fontWeight:700,color:G.warn,letterSpacing:1.5,
                        textTransform:"uppercase",marginBottom:5}}>
                        Stock bas — {lo.length} recette{lo.length>1?"s":""}
                      </div>
                      <div style={{fontSize:11,color:G.warn,lineHeight:1.6}}>
                        {lo.map(r=>r.name).join(" · ")}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Résumé 3 zones ── */}
            {(()=>{
              const totals = ZONES.map(z=>({
                ...z,
                total: RECIPES.reduce((s,r)=>s+zoneDemi(inventory[r.id],z.id),0),
                vide:  RECIPES.filter(r=>zoneDemi(inventory[r.id],z.id)===0).length,
                low:   RECIPES.filter(r=>{const q=zoneDemi(inventory[r.id],z.id);return q>0&&q<=2;}).length,
                ok:    RECIPES.filter(r=>zoneDemi(inventory[r.id],z.id)>2).length,
              }));
              return(
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:20}}>
                  {totals.map(z=>(
                    <Card key={z.id} style={{padding:"14px 10px",textAlign:"center"}}>
                      <div style={{fontSize:8,fontWeight:700,color:G.copper,textTransform:"uppercase",
                        letterSpacing:.5,marginBottom:6}}>{z.label}</div>
                      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:30,fontWeight:300,
                        color:z.vide>4?G.danger:z.low>4?G.warn:G.dark,lineHeight:1}}>{z.total}</div>
                      <div style={{fontSize:8,color:G.light,marginTop:3}}>demi-eq</div>
                      <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:3}}>
                        {z.vide>0&&<div style={{fontSize:8,color:G.danger,fontWeight:600}}>{z.vide} épuisé{z.vide>1?"s":""}</div>}
                        {z.low>0&&<div style={{fontSize:8,color:G.warn,fontWeight:600}}>{z.low} bas</div>}
                        {z.ok>0&&<div style={{fontSize:8,color:G.ok}}>{z.ok} OK</div>}
                      </div>
                    </Card>
                  ))}
                </div>
              );
            })()}

            {/* ── Détail recettes ── */}
            {["Sorbet","Glace"].map(type=>(
              <div key={type} style={{marginBottom:24}}>
                <div style={{fontSize:10,fontWeight:700,color:G.copper,textTransform:"uppercase",
                  letterSpacing:1,marginBottom:10,paddingBottom:8,borderBottom:`1px solid ${G.border}`}}>
                  {type}s
                </div>
                {RECIPES.filter(r=>r.type===type).map(r=>{
                  const zones    = ZONES.map(z=>({...z,qty:zoneDemi(inventory[r.id],z.id)}));
                  const totalQty = zones.reduce((s,z)=>s+z.qty,0);
                  const alertColor = totalQty===0?G.danger:totalQty<=3?G.warn:G.ok;
                  const pct      = Math.min(1, totalQty/12);
                  return(
                    <div key={r.id} style={{padding:"12px 14px",borderRadius:12,marginBottom:8,
                      background:"rgba(255,251,246,0.7)",border:`1px solid ${G.border}`,
                      borderLeft:`4px solid ${alertColor}`}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                        <div style={{fontSize:12,fontWeight:600,color:G.dark}}>{r.name}</div>
                        <span style={{fontSize:11,fontWeight:700,color:alertColor}}>{totalQty} demi-eq</span>
                      </div>
                      {/* Barre de stock globale */}
                      <div style={{height:3,background:"rgba(0,0,0,0.07)",borderRadius:2,overflow:"hidden",marginBottom:10}}>
                        <div style={{height:"100%",borderRadius:2,background:alertColor,
                          width:`${Math.max(pct*100,totalQty>0?4:0)}%`,transition:"width .5s ease"}}/>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
                        {zones.map(z=>(
                          <div key={z.id} style={{textAlign:"center",padding:"7px 4px",borderRadius:8,
                            background:z.qty===0?"rgba(122,16,8,0.06)":z.qty<=2?"rgba(148,82,8,0.05)":"rgba(140,60,16,0.03)"}}>
                            <div style={{fontSize:8,color:G.light,marginBottom:3}}>{z.label}</div>
                            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,fontWeight:300,
                              color:z.qty===0?G.danger:z.qty<=1?G.warn:G.dark,lineHeight:1}}>{z.qty}</div>
                            <div style={{fontSize:7,color:G.light,marginTop:2}}>
                              {inventory[r.id]?.[z.id]?.demi>0&&`${inventory[r.id][z.id].demi}D`}
                              {inventory[r.id]?.[z.id]?.demi>0&&inventory[r.id]?.[z.id]?.pleine>0&&" "}
                              {inventory[r.id]?.[z.id]?.pleine>0&&`${inventory[r.id][z.id].pleine}P`}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* ── Journal récent ── */}
            {histEntries.length>0&&(
              <div style={{marginTop:4}}>
                <div style={{fontSize:10,fontWeight:700,color:G.copper,textTransform:"uppercase",
                  letterSpacing:1,marginBottom:12,paddingBottom:8,borderBottom:`1px solid ${G.border}`,
                  display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span>Journal récent</span>
                  <button onClick={()=>setTab("historique")} style={{background:"none",border:"none",
                    color:G.copper,fontSize:9,cursor:"pointer",textDecoration:"underline",minHeight:"auto",padding:0}}>
                    Voir tout →
                  </button>
                </div>
                {histEntries.slice(0,5).map(e=>{
                  const typeColor = e.type==="livraison"?G.ok:e.type==="inventaire"?"#2A508E":e.type==="document"?"#6B3FA0":G.copper;
                  const typeBg   = e.type==="livraison"?"rgba(30,94,50,0.09)":e.type==="inventaire"?"rgba(42,80,142,0.09)":e.type==="document"?"rgba(107,63,160,0.09)":"rgba(140,60,16,0.07)";
                  return(
                    <div key={e.id} style={{padding:"10px 14px",borderRadius:10,marginBottom:8,
                      background:"rgba(255,251,246,0.7)",border:`1px solid ${G.border}`,
                      display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:11,fontWeight:600,color:G.dark,
                          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.label}</div>
                        <div style={{fontSize:9,color:G.light,marginTop:2}}>
                          {e.author&&`${e.author} · `}
                          {new Date(e.createdAt).toLocaleDateString("fr-FR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}
                        </div>
                      </div>
                      <div style={{padding:"3px 8px",borderRadius:10,fontSize:8,fontWeight:700,
                        flexShrink:0,background:typeBg,color:typeColor,whiteSpace:"nowrap"}}>
                        {e.type}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            </>)} {/* fin apercu */}

            {/* ══ VUE ALERTES ══ */}
            {dashSubTab==="alertes"&&(<>
              {(()=>{
                const ep=RECIPES.filter(r=>totalZ(inventory[r.id])===0);
                const lo=RECIPES.filter(r=>{const t=totalZ(inventory[r.id]);return t>0&&t<=3;});
                const tempWarnRecs=tempRecs.filter(r=>r.temp!==null&&r.temp>-18);
                if(!ep.length&&!lo.length&&!tempWarnRecs.length) return(
                  <div style={{textAlign:"center",padding:"48px 0",fontFamily:"'Cormorant Garamond',serif",
                    fontSize:18,color:G.ok,fontWeight:300}}>
                    ✓ Aucune alerte active
                  </div>
                );
                return(<>
                  {ep.length>0&&(<>
                    <div style={{fontSize:9,fontWeight:700,color:G.danger,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>
                      Épuisés — {ep.length}
                    </div>
                    {ep.map(r=>(
                      <div key={r.id} style={{padding:"12px 16px",borderRadius:12,marginBottom:8,
                        background:G.dangerBg,border:`1px solid rgba(122,16,8,0.2)`,
                        display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <div style={{fontSize:12,fontWeight:600,color:G.danger}}>{r.name}</div>
                        <div style={{fontSize:9,color:G.danger}}>0 demi-eq</div>
                      </div>
                    ))}
                  </>)}
                  {lo.length>0&&(<>
                    <div style={{fontSize:9,fontWeight:700,color:G.warn,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10,marginTop:ep.length>0?16:0}}>
                      Stock bas — {lo.length}
                    </div>
                    {lo.map(r=>(
                      <div key={r.id} style={{padding:"12px 16px",borderRadius:12,marginBottom:8,
                        background:G.warnBg,border:`1px solid rgba(148,82,8,0.2)`,
                        display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <div style={{fontSize:12,fontWeight:600,color:G.warn}}>{r.name}</div>
                        <div style={{fontSize:9,color:G.warn}}>{totalZ(inventory[r.id])} demi-eq</div>
                      </div>
                    ))}
                  </>)}
                  {tempWarnRecs.length>0&&(<>
                    <div style={{fontSize:9,fontWeight:700,color:G.danger,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10,marginTop:16}}>
                      Températures hors norme — {tempWarnRecs.length}
                    </div>
                    {tempWarnRecs.slice(0,5).map(r=>(
                      <div key={r.id} style={{padding:"12px 16px",borderRadius:12,marginBottom:8,
                        background:G.dangerBg,border:`1px solid rgba(122,16,8,0.2)`,
                        display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <div style={{fontSize:12,fontWeight:600,color:G.danger}}>{r.nom||"—"}</div>
                        <div style={{fontSize:11,fontWeight:700,color:G.danger}}>{r.temp}°C {r.heure}</div>
                      </div>
                    ))}
                  </>)}
                </>);
              })()}
            </>)}

            {/* ══ VUE PAR ZONE ══ */}
            {dashSubTab==="zones"&&(<>
              {ZONES.map(z=>{
                const recs=RECIPES.map(r=>({...r,qty:zoneDemi(inventory[r.id],z.id)}))
                  .sort((a,b)=>a.qty-b.qty);
                const total=recs.reduce((s,r)=>s+r.qty,0);
                const vide=recs.filter(r=>r.qty===0).length;
                return(
                  <div key={z.id} style={{marginBottom:28}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",
                      marginBottom:12,paddingBottom:8,borderBottom:`2px solid ${G.border}`}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:700,color:G.copper}}>{z.label}</div>
                        <div style={{fontSize:10,color:G.light}}>{z.sub}</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:300,color:G.dark}}>{total}</div>
                        <div style={{fontSize:8,color:G.light}}>demi-eq</div>
                        {vide>0&&<div style={{fontSize:8,color:G.danger,fontWeight:600}}>{vide} épuisé{vide>1?"s":""}</div>}
                      </div>
                    </div>
                    {recs.map(r=>{
                      const pct=Math.min(1,r.qty/8);
                      const c=r.qty===0?G.danger:r.qty<=2?G.warn:G.ok;
                      return(
                        <div key={r.id} style={{display:"flex",alignItems:"center",gap:10,
                          padding:"8px 0",borderBottom:`1px solid ${G.border}`}}>
                          <div style={{width:3,height:36,borderRadius:2,background:c,flexShrink:0}}/>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:11,fontWeight:600,color:r.qty===0?G.danger:G.dark,
                              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</div>
                            <div style={{height:3,background:"rgba(0,0,0,0.06)",borderRadius:2,overflow:"hidden",marginTop:5}}>
                              <div style={{height:"100%",borderRadius:2,background:c,
                                width:`${Math.max(pct*100,r.qty>0?4:0)}%`,transition:"width .4s ease"}}/>
                            </div>
                          </div>
                          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,fontWeight:300,
                            color:c,flexShrink:0,width:32,textAlign:"right"}}>{r.qty}</div>
                          <div style={{fontSize:8,color:G.light,flexShrink:0}}>
                            {inventory[r.id]?.[z.id]?.demi>0&&`${inventory[r.id][z.id].demi}D`}
                            {inventory[r.id]?.[z.id]?.pleine>0&&` ${inventory[r.id][z.id].pleine}P`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </>)}

            {/* ══ VUE PAR RECETTE (triée par stock total croissant) ══ */}
            {dashSubTab==="recettes"&&(<>
              <div style={{fontSize:10,color:G.light,marginBottom:14}}>
                {RECIPES.length} recettes · triées par stock total croissant
              </div>
              {[...RECIPES].sort((a,b)=>totalZ(inventory[a.id])-totalZ(inventory[b.id])).map(r=>{
                const zones=ZONES.map(z=>({...z,qty:zoneDemi(inventory[r.id],z.id)}));
                const tot=zones.reduce((s,z)=>s+z.qty,0);
                const c=tot===0?G.danger:tot<=3?G.warn:G.ok;
                const pct=Math.min(1,tot/12);
                return(
                  <div key={r.id} style={{padding:"12px 14px",borderRadius:12,marginBottom:8,
                    background:"rgba(255,251,246,0.7)",border:`1px solid ${G.border}`,
                    borderLeft:`4px solid ${c}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                      <div>
                        <div style={{fontSize:12,fontWeight:600,color:G.dark}}>{r.name}</div>
                        <div style={{fontSize:9,color:G.light}}>{r.type}</div>
                      </div>
                      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,fontWeight:300,color:c}}>{tot}</div>
                    </div>
                    <div style={{height:3,background:"rgba(0,0,0,0.06)",borderRadius:2,overflow:"hidden",marginBottom:8}}>
                      <div style={{height:"100%",borderRadius:2,background:c,
                        width:`${Math.max(pct*100,tot>0?3:0)}%`,transition:"width .4s ease"}}/>
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      {zones.map(z=>(
                        <div key={z.id} style={{flex:1,textAlign:"center",padding:"5px 4px",borderRadius:6,
                          background:z.qty===0?"rgba(122,16,8,0.05)":"rgba(140,60,16,0.03)"}}>
                          <div style={{fontSize:7,color:G.light,marginBottom:2}}>{z.label}</div>
                          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:16,fontWeight:300,
                            color:z.qty===0?G.danger:z.qty<=1?G.warn:G.dark}}>{z.qty}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </>)}

          </div>
        )}

        {tab==="boutique"&&user?.role!=="responsable"&&(
          <div style={{animation:"fadein .28s ease"}}>
            <div style={{marginBottom:20}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:G.dark,marginBottom:3}}>Boutique — Pozzetti en cours</div>
                  <div style={{fontSize:10,color:G.light}}>
                    {lastSync
                      ? `Actualisé à ${lastSync.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}`
                      : "Synchronisation en cours…"}
                  </div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:20,
                    background:"rgba(30,94,50,0.08)",border:"1px solid rgba(30,94,50,0.2)"}}>
                    <div style={{position:"relative",width:6,height:6,flexShrink:0}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:G.ok,position:"absolute"}}/>
                      <div style={{width:6,height:6,borderRadius:"50%",background:G.ok,position:"absolute",
                        animation:"dotping 2.4s ease-out infinite"}}/>
                    </div>
                    <span style={{fontSize:8,color:G.ok,fontWeight:700}}>LIVE</span>
                  </div>
                  <GBtn small label="↺" onClick={syncNow}/>
                </div>
              </div>
            </div>

            {/* Résumé rapide */}
            {(()=>{
              const boutiqRecs = RECIPES.map(r=>({...r, qty:zoneDemi(inventory[r.id],"boutique"), demi:inventory[r.id]?.boutique?.demi||0, pleine:inventory[r.id]?.boutique?.pleine||0}));
              const dispo  = boutiqRecs.filter(r=>r.qty>2).length;
              const bas    = boutiqRecs.filter(r=>r.qty>0&&r.qty<=2).length;
              const vide   = boutiqRecs.filter(r=>r.qty===0).length;
              const total  = boutiqRecs.reduce((s,r)=>s+r.qty,0);
              return(
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:20}}>
                  {[
                    {l:"Disponibles",v:dispo, c:G.ok,     bg:G.okBg},
                    {l:"Stock bas",  v:bas,   c:G.warn,   bg:G.warnBg},
                    {l:"Épuisés",    v:vide,  c:G.danger, bg:G.dangerBg},
                    {l:"Total demi-eq",v:total,c:G.dark,  bg:"rgba(255,251,246,0.7)"},
                  ].map(s=>(
                    <Card key={s.l} style={{padding:"14px 8px",textAlign:"center",background:s.bg,border:`1px solid ${s.c}20`}}>
                      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:26,fontWeight:300,color:s.c,lineHeight:1}}>{s.v}</div>
                      <div style={{fontSize:8,color:s.c,marginTop:5,fontWeight:600,letterSpacing:.5}}>{s.l}</div>
                    </Card>
                  ))}
                </div>
              );
            })()}

            {/* Grille par type */}
            {["Sorbet","Glace"].map(type=>{
              const recs = RECIPES.filter(r=>r.type===type).map(r=>({
                ...r,
                qty:   zoneDemi(inventory[r.id],"boutique"),
                demi:  inventory[r.id]?.boutique?.demi  || 0,
                pleine:inventory[r.id]?.boutique?.pleine|| 0,
              })).sort((a,b)=>a.qty-b.qty); // épuisés en premier pour alerter
              return(
                <div key={type} style={{marginBottom:24}}>
                  <div style={{fontSize:10,fontWeight:700,color:G.copper,textTransform:"uppercase",
                    letterSpacing:1,marginBottom:12,paddingBottom:8,borderBottom:`1px solid ${G.border}`,
                    display:"flex",justifyContent:"space-between"}}>
                    <span>{type}s</span>
                    <span style={{fontWeight:400,color:G.light,fontSize:9}}>
                      {recs.filter(r=>r.qty>0).length}/{recs.length} disponibles
                    </span>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {recs.map(r=>{
                      const pct = Math.min(1, r.qty / 6); // 6 demi-eq = plein
                      const stColor = r.qty===0?G.danger:r.qty<=2?G.warn:G.ok;
                      const stLabel = r.qty===0?"Épuisé":r.qty<=2?"Stock bas":"Disponible";
                      const stBg    = r.qty===0?G.dangerBg:r.qty<=2?G.warnBg:G.okBg;
                      return(
                        <div key={r.id} style={{
                          display:"flex",alignItems:"center",gap:14,
                          padding:"14px 16px",borderRadius:14,
                          background:r.qty===0?"rgba(122,16,8,0.04)":G.glass,
                          border:`1px solid ${r.qty===0?"rgba(122,16,8,0.2)":r.qty<=2?"rgba(148,82,8,0.2)":G.border}`,
                          borderLeft:`4px solid ${stColor}`,
                          transition:"all .2s",
                          opacity:r.qty===0?0.7:1,
                        }}>
                          {/* Indicateur quantité */}
                          <div style={{width:42,textAlign:"center",flexShrink:0}}>
                            <div style={{fontFamily:"'Cormorant Garamond',serif",
                              fontSize:28,fontWeight:300,
                              color:stColor,lineHeight:1}}>
                              {r.qty}
                            </div>
                            <div style={{fontSize:7,color:G.light,marginTop:2}}>demi-eq</div>
                          </div>
                          {/* Nom + barre de stock */}
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:13,fontWeight:600,color:G.dark,
                              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                              marginBottom:6}}>
                              {r.name}
                            </div>
                            {/* Barre de progression */}
                            <div style={{height:4,background:"rgba(0,0,0,0.06)",borderRadius:2,overflow:"hidden"}}>
                              <div style={{height:"100%",borderRadius:2,
                                background:stColor,
                                width:`${Math.max(pct*100,r.qty>0?8:0)}%`,
                                transition:"width .4s ease"}}/>
                            </div>
                            {/* D / P */}
                            <div style={{fontSize:9,color:G.light,marginTop:4}}>
                              {r.demi > 0 && <span style={{marginRight:8}}>{r.demi} demi (2.5L)</span>}
                              {r.pleine > 0 && <span>{r.pleine} pleine (5L)</span>}
                              {r.demi===0&&r.pleine===0&&<span style={{color:G.danger,fontWeight:600}}>Rien en boutique</span>}
                            </div>
                          </div>
                          {/* Badge statut */}
                          <div style={{padding:"4px 10px",borderRadius:12,background:stBg,
                            fontSize:9,fontWeight:600,color:stColor,flexShrink:0,whiteSpace:"nowrap"}}>
                            {stLabel}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Lien vers la mise à jour */}
            <Card style={{padding:"14px 16px",marginTop:8}}>
              <div style={{fontSize:11,color:G.mid,marginBottom:10,lineHeight:1.6}}>
                Pour mettre à jour le stock boutique, allez dans <strong>Stock global</strong> et sélectionnez la zone <strong>Boutique</strong>.
              </div>
              <GBtn primary label="Mettre à jour le stock" onClick={()=>setTab("inventaire")}/>
            </Card>
          </div>
        )}

        {/* ══ LIVRAISON ══ */}
        {tab==="livraison"&&(
          <div style={{animation:"fadein .25s ease"}}>
            <PageIntro title="Livraison" desc="Contrôle température — Saisie des quantités par saveur."/>
            <FormatLegend/>

            {/* ── CONTRÔLE TEMPÉRATURE DE RÉCEPTION ── */}
            <Card style={{padding:"18px 20px",marginBottom:22}}>
              {/* En-tête avec date auto */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:700,color:G.dark}}>Contrôle température</div>
                <div style={{fontSize:11,color:G.mid,fontWeight:500}}>
                  {new Date().toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"})}
                </div>
              </div>

              {/* Scan modal pour tempRec */}
              {scanTarget?.mode==="tempRec"&&(
                <ScanModal
                  recipeName="Étiquette carapine"
                  onResult={parsed=>{
                    setTempForm(p=>({...p, nom:parsed.nom||p.nom, lot:parsed.lot||p.lot}));
                    setScanTarget(null);
                    showToast("Produit et lot récupérés !");
                  }}
                  onClose={()=>setScanTarget(null)}
                />
              )}

              {/*  Produit — Parfum + Format + N° lot */}
              <div style={{display:"flex",gap:12,alignItems:"flex-start",marginBottom:16}}>
                <div style={{width:30,height:30,borderRadius:"50%",background:G.copper,color:"#fff",
                  fontSize:13,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",
                  flexShrink:0,marginTop:2,boxShadow:"0 2px 8px rgba(140,60,16,0.3)"}}>1</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:600,color:G.dark,marginBottom:10}}>
                    Parfum, format &amp; lot
                  </div>

                  {/* Scan auto */}
                  <button onClick={()=>setScanTarget({id:"tempRec",mode:"tempRec"})}
                    style={{width:"100%",background:"rgba(140,60,16,0.07)",border:`1px solid ${G.borderS}`,
                      borderRadius:10,padding:"11px",fontSize:12,color:G.copper,cursor:"pointer",
                      fontWeight:600,minHeight:"auto",display:"flex",alignItems:"center",justifyContent:"center",
                      gap:8,marginBottom:12}}>
                    Scanner l'étiquette → Parfum + Lot
                  </button>

                  {/* Parfum */}
                  <div style={{marginBottom:10}}>
                    <div style={{fontSize:10,color:G.light,fontWeight:600,marginBottom:4}}>Parfum</div>
                    <input value={tempForm.nom}
                      onChange={e=>setTempForm(p=>({...p,nom:e.target.value}))}
                      placeholder="Ex : Fraises Garriguettes"
                      style={{width:"100%",padding:"10px 12px",
                        border:`1px solid ${tempForm.nom?G.borderS:G.border}`,borderRadius:8,
                        fontSize:13,background:tempForm.nom?"rgba(255,251,246,0.95)":"rgba(255,251,246,0.5)",
                        color:G.dark,minHeight:"auto"}}/>
                  </div>

                  {/* Format — pleine ou demi */}
                  <div style={{marginBottom:10}}>
                    <div style={{fontSize:10,color:G.light,fontWeight:600,marginBottom:4}}>Format</div>
                    <div style={{display:"flex",gap:8}}>
                      {[{v:"pleine",l:"Pleine 5L"},{v:"demi",l:"Demi 2.5L"}].map(f=>(
                        <button key={f.v} onClick={()=>setTempForm(p=>({...p,format:f.v}))}
                          style={{flex:1,padding:"10px 8px",
                            border:`1.5px solid ${tempForm.format===f.v?G.copper:G.border}`,
                            background:tempForm.format===f.v?G.copper:"rgba(255,251,246,0.6)",
                            color:tempForm.format===f.v?"#fff":G.mid,
                            borderRadius:8,fontSize:12,fontWeight:tempForm.format===f.v?600:400,
                            cursor:"pointer",minHeight:"auto",transition:"all .15s",
                            boxShadow:tempForm.format===f.v?"0 2px 8px rgba(140,60,16,0.25)":"none"}}>
                          {f.l}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* N° de lot */}
                  <div>
                    <div style={{fontSize:10,color:G.light,fontWeight:600,marginBottom:4}}>N° de lot</div>
                    <input value={tempForm.lot}
                      onChange={e=>setTempForm(p=>({...p,lot:e.target.value}))}
                      placeholder="Ex : 6218161"
                      style={{width:"100%",padding:"10px 12px",
                        border:`1px solid ${tempForm.lot?G.borderS:G.border}`,borderRadius:8,
                        fontSize:15,fontWeight:600,
                        background:tempForm.lot?"rgba(255,251,246,0.95)":"rgba(255,251,246,0.5)",
                        color:G.dark,minHeight:"auto"}}/>
                  </div>
                </div>
              </div>

              {/*  Température */}
              <div style={{display:"flex",gap:12,alignItems:"flex-start",marginBottom:16}}>
                <div style={{width:30,height:30,borderRadius:"50%",
                  background:tempForm.temp!==""?(Number(tempForm.temp)>-18?G.danger:G.ok):"rgba(140,60,16,0.15)",
                  color:tempForm.temp!==""?"#fff":G.copper,
                  fontSize:13,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",
                  flexShrink:0,marginTop:2,transition:"background .3s"}}>2</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:600,color:G.dark,marginBottom:8}}>
                    Saisir la température
                    {tempForm.temp!==""&&Number(tempForm.temp)>-18&&(
                      <span style={{marginLeft:8,fontSize:11,color:G.danger,fontWeight:700}}>Hors norme</span>
                    )}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <input type="number" min="-35" max="10" step="0.1"
                      value={tempForm.temp} onChange={e=>setTempForm(p=>({...p,temp:e.target.value}))}
                      placeholder="—"
                      style={{flex:1,padding:"12px 14px",
                        border:`2px solid ${tempForm.temp!==""&&Number(tempForm.temp)>-18?"rgba(180,30,20,0.7)":tempForm.temp!==""?"rgba(30,94,50,0.5)":G.border}`,
                        borderRadius:8,fontSize:24,fontWeight:700,textAlign:"center",
                        background:tempForm.temp!==""&&Number(tempForm.temp)>-18?"rgba(180,30,20,0.07)":tempForm.temp!==""?"rgba(30,94,50,0.06)":"rgba(255,251,246,0.5)",
                        color:tempForm.temp!==""&&Number(tempForm.temp)>-18?G.danger:tempForm.temp!==""?G.ok:G.dark,
                        minHeight:"auto"}}/>
                    <span style={{fontSize:20,color:G.light,fontWeight:300}}>°C</span>
                  </div>
                  <div style={{fontSize:10,color:G.light,marginTop:5}}>
                    Norme : −18°C ou moins 
                  </div>
                </div>
              </div>

              {/*  Enregistrer */}
              <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                <div style={{width:30,height:30,borderRadius:"50%",
                  background:(!tempForm.nom&&!tempForm.lot)?"rgba(140,60,16,0.15)":G.copper,
                  color:(!tempForm.nom&&!tempForm.lot)?G.copper:"#fff",
                  fontSize:13,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",
                  flexShrink:0,marginTop:2,transition:"background .3s"}}>3</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:600,color:G.dark,marginBottom:8}}>Enregistrer</div>
                  <button
                    onClick={()=>{
                      const rec={id:Date.now(),
                        nom:tempForm.nom.trim()||null,
                        format:tempForm.format||"pleine",
                        lot:tempForm.lot.trim()||null,
                        temp:tempForm.temp!==""?parseFloat(tempForm.temp):null,
                        date:todayISO(),
                        heure:new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}),
                        author:user?.name||"Équipe"};
                      const next=[rec,...tempRecs];
                      setTempRecs(next);
                      storage.set("ad9_temprec",JSON.stringify(next)).catch(()=>{});
                      historyAPI.push({type:"temperature",label:`Réception — ${rec.nom||"—"}${rec.format?" ("+rec.format+")":""}`,author:user?.name||"Équipe",data:{nom:rec.nom,format:rec.format,lot:rec.lot,temp:rec.temp,heure:rec.heure,alert:rec.temp!==null&&rec.temp>-18}}).then(e=>{if(e)setHistEntries(prev=>[e,...prev]);});
                      setTempForm(emptyTempForm());
                      setSavedFlash(true); setTimeout(()=>setSavedFlash(false),2000);
                      showToast("Température enregistrée");
                    }}
                    disabled={!tempForm.nom&&!tempForm.lot}
                    style={{width:"100%",
                      background:(!tempForm.nom&&!tempForm.lot)?G.faint:G.copper,
                      border:"none",
                      color:(!tempForm.nom&&!tempForm.lot)?G.light:"#fff",
                      borderRadius:10,padding:"13px",fontSize:12,fontWeight:600,
                      minHeight:"auto",
                      cursor:(!tempForm.nom&&!tempForm.lot)?"not-allowed":"pointer",
                      boxShadow:(!tempForm.nom&&!tempForm.lot)?"none":"0 2px 14px rgba(140,60,16,0.3)"}}>
                     Enregistrer ce relevé (immédiat)
                  </button>
                  {savedFlash&&(
                    <div style={{fontSize:10,color:G.ok,textAlign:"center",marginTop:6,animation:"fadein .2s ease"}}>
                      Relevé sauvegardé 
                    </div>
                  )}
                </div>{/* flex:1 */}
              </div>{/* flex row étape 3 */}
            </Card>

            {/* ── Historique températures ── */}
            {tempRecs.length>0&&(
              <div style={{marginBottom:22}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div style={{fontSize:8,letterSpacing:3,color:G.copper,textTransform:"uppercase",fontWeight:600}}>
                    Réceptions enregistrées
                  </div>
                  <GBtn small label="Tout effacer" onClick={()=>{if(window.confirm("Effacer tous les relevés ?")){ setTempRecs([]); storage.set("ad9_temprec","[]").catch(()=>{}); }}}/>
                </div>
                {/* Grouper par date */}
                {(()=>{
                  const byDate={};
                  tempRecs.forEach(r=>{ if(!byDate[r.date])byDate[r.date]=[]; byDate[r.date].push(r); });
                  return Object.entries(byDate).sort(([a],[b])=>b.localeCompare(a)).map(([date,recs])=>(
                    <div key={date} style={{marginBottom:14}}>
                      <div style={{fontSize:9,color:G.light,letterSpacing:1,marginBottom:6,paddingBottom:4,borderBottom:`1px solid ${G.border}`}}>
                        {new Date(date).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}
                        {date===todayISO()&&<span style={{color:G.copper,fontWeight:600,marginLeft:6}}>— Aujourd'hui</span>}
                      </div>
                      {recs.map(r=>{
                        const alert=r.temp!==null&&r.temp>-18;
                        return(
                          <Card key={r.id} style={{padding:"12px 14px",marginBottom:6,
                            border:`1px solid ${alert?"rgba(180,30,20,0.35)":G.border}`,
                            background:alert?"rgba(180,30,20,0.04)":G.glass}}>
                            <div style={{display:"flex",alignItems:"center",gap:10}}>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:13,fontWeight:600,color:G.dark,
                                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                  {r.nom||"—"}
                                </div>
                                <div style={{display:"flex",alignItems:"center",gap:6,marginTop:3,flexWrap:"wrap"}}>
                                  {r.format&&(
                                    <span style={{fontSize:10,background:G.faint,color:G.copper,
                                      padding:"2px 8px",borderRadius:10,fontWeight:600}}>
                                      {r.format==="pleine"?"Pleine 5L":"Demi 2.5L"}
                                    </span>
                                  )}
                                  {r.lot&&<span style={{fontSize:10,color:G.mid}}>Lot {r.lot}</span>}
                                </div>
                                <div style={{fontSize:9,color:G.light,marginTop:2}}>
                                  {r.heure}
                                  {r.author&&<span style={{marginLeft:8}}>{r.author}</span>}
                                </div>
                              </div>
                              <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                                <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:300,
                                  color:alert?G.danger:r.temp!==null?G.ok:G.light}}>
                                  {r.temp!==null?`${r.temp}°C`:"—"}
                                </span>
                                {alert&&<span style={{fontSize:8,color:G.danger,fontWeight:700}}></span>}
                              </div>
                              <button onClick={()=>{const n=tempRecs.filter(x=>x.id!==r.id);setTempRecs(n);storage.set("ad9_temprec",JSON.stringify(n)).catch(()=>{});}}
                                style={{background:"none",border:`1px solid ${G.border}`,color:G.danger,
                                  padding:"4px 8px",fontSize:12,borderRadius:6,cursor:"pointer",minHeight:"auto",minWidth:"auto",flexShrink:0}}>×</button>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  ));
                })()}
              </div>
            )}

            {/* ── Wizard réception — étapes ── */}
            {/* Barre de progression */}
            <div style={{display:"flex",alignItems:"center",gap:0,marginBottom:20,borderRadius:12,overflow:"hidden",border:`1px solid ${G.border}`}}>
              {[{n:1,l:"Quantités"},{n:2,l:"Lots / Scan"},{n:3,l:"Validation"}].map((s,i)=>(
                <div key={s.n} style={{flex:1,padding:"10px 6px",textAlign:"center",
                  background:livWizardStep===s.n?G.copper:livWizardStep>s.n?"rgba(30,94,50,0.12)":"rgba(255,255,255,0.4)",
                  borderRight:i<2?`1px solid ${G.border}`:"none",
                  cursor:livWizardStep>s.n?"pointer":"default",transition:"background .2s",
                }} onClick={()=>livWizardStep>s.n&&setLivWizardStep(s.n)}>
                  <div style={{fontSize:10,fontWeight:700,
                    color:livWizardStep===s.n?"#fff":livWizardStep>s.n?G.ok:G.light}}>
                    {livWizardStep>s.n?"✓ ":""}{s.n}. {s.l}
                  </div>
                </div>
              ))}
            </div>

            {/* ÉTAPE 1 — Zone + Quantités + Températures */}
            {livWizardStep===1&&(<>
              <div style={{marginBottom:20}}>
                <SLabel>Zone de destination</SLabel>
                <div style={{display:"flex",gap:8,marginTop:8}}>
                  {ZONES.map(z=>(
                    <button key={z.id} onClick={()=>setDelivZone(z.id)} style={{flex:1,padding:"10px 6px",border:`1px solid ${delivZone===z.id?G.copper:G.border}`,background:delivZone===z.id?G.copper:"rgba(255,255,255,0.5)",backdropFilter:"blur(8px)",color:delivZone===z.id?"#fff":G.mid,borderRadius:10,cursor:"pointer",transition:"all .15s",fontSize:10,letterSpacing:1.5,textTransform:"uppercase",minHeight:"auto"}}>
                      <div style={{fontWeight:500}}>{z.label}</div><div style={{fontSize:8,opacity:.7,marginTop:1}}>{z.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Liste recettes — saisie quantités + temp */}
              {["Sorbet","Glace"].map(type=>(
                <div key={type} style={{marginBottom:24}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",paddingBottom:10,borderBottom:`1px solid ${G.border}`}}>
                    <span style={{fontSize:8,letterSpacing:5,color:G.copper,textTransform:"uppercase"}}>{type}s</span>
                    <div style={{display:"flex",gap:12}}>
                      <span style={{fontSize:7,letterSpacing:2,color:G.light}}>Demi 2.5L</span>
                      <span style={{fontSize:7,letterSpacing:2,color:G.light}}>Pleine 5L</span>
                    </div>
                  </div>
                  {RECIPES.filter(r=>r.type===type).map(r=>{
                    const item=delivery[r.id]||emptyDel();
                    const tw=tempWarn(item.temp);
                    const hasQty=(item.demi>0||item.pleine>0);
                    return(
                      <div key={r.id} style={{padding:"14px 0",borderBottom:`1px solid ${G.border}`,opacity:hasQty?1:0.6}}>
                        <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:16,color:G.dark,display:"block",marginBottom:10}}>{r.name}</span>
                        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                          <div style={{display:"flex",alignItems:"center",gap:6,flex:1}}>
                            <span style={{fontSize:8,color:G.light,letterSpacing:1,textTransform:"uppercase",whiteSpace:"nowrap",width:26}}>Demi</span>
                            <QtyCtrl val={item.demi} onChange={v=>updateDel(r.id,"demi",v)}/>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:6,flex:1}}>
                            <span style={{fontSize:8,color:G.light,letterSpacing:1,textTransform:"uppercase",whiteSpace:"nowrap",width:32}}>Pleine</span>
                            <QtyCtrl val={item.pleine} onChange={v=>updateDel(r.id,"pleine",v)}/>
                          </div>
                          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2,flexShrink:0}}>
                            <span style={{fontSize:7,color:tw?G.danger:G.light,letterSpacing:1,textTransform:"uppercase",fontWeight:tw?700:400}}>Temp.</span>
                            <div style={{display:"flex",alignItems:"center",gap:3}}>
                              <input type="number" min="-30" max="5" step="0.1"
                                value={item.temp??""} placeholder="—"
                                onChange={e=>updateDel(r.id,"temp",e.target.value===""?null:e.target.value)}
                                style={{width:60,border:`2px solid ${tw?"rgba(180,30,20,0.7)":tempOk(item.temp)?"rgba(34,110,60,0.5)":"rgba(168,120,70,0.3)"}`,
                                  borderRadius:8,background:tw?"rgba(180,30,20,0.07)":tempOk(item.temp)?"rgba(34,110,60,0.06)":"rgba(255,255,255,0.6)",
                                  color:tw?G.danger:tempOk(item.temp)?G.ok:G.dark,
                                  padding:"8px 6px",fontSize:14,fontWeight:600,outline:"none",minHeight:"auto",textAlign:"center"}}/>
                              <span style={{fontSize:10,color:G.light}}>°C</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              <BtnRow>
                <GBtn primary label="Étape suivante : Scanner les lots →" onClick={()=>{
                  const withQty=RECIPES.filter(r=>delivery[r.id]?.demi>0||delivery[r.id]?.pleine>0);
                  if(!withQty.length){showToast("Saisissez au moins une quantité");return;}
                  setLivWizardStep(2);
                }}/>
              </BtnRow>
            </>)}

            {/* ÉTAPE 2 — Scan des lots */}
            {livWizardStep===2&&(<>
              {scanTarget?.mode==="livraison"&&(
                <ScanModal
                  recipeName={RECIPES.find(r=>r.id===scanTarget.id)?.name}
                  onResult={parsed=>{setDeliveryLots(prev=>({...prev,[scanTarget.id]:{...parsed,_scanned:true}}));setScanTarget(null);showToast(`Lot ${parsed.lot||"—"} — DLC ${fmtDate(parsed.dlc)}`);}}
                  onClose={()=>setScanTarget(null)}
                />
              )}
              {(()=>{
                const withQty=RECIPES.filter(r=>delivery[r.id]?.demi>0||delivery[r.id]?.pleine>0);
                const scanned=withQty.filter(r=>deliveryLots[r.id]?.lot).length;
                return(
                  <>
                    <div style={{marginBottom:14,padding:"10px 14px",borderRadius:10,
                      background:"rgba(140,60,16,0.05)",border:`1px solid ${G.border}`,
                      display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{fontSize:11,color:G.dark,fontWeight:600}}>
                        {scanned}/{withQty.length} lots scannés
                      </div>
                      <div style={{height:6,flex:1,mx:12,background:"rgba(0,0,0,0.06)",borderRadius:3,overflow:"hidden",margin:"0 12px"}}>
                        <div style={{height:"100%",borderRadius:3,background:scanned===withQty.length?G.ok:G.copper,
                          width:`${withQty.length>0?Math.round(scanned/withQty.length*100):0}%`,transition:"width .4s ease"}}/>
                      </div>
                    </div>
                    {withQty.map(r=>{
                      const lot=deliveryLots[r.id];
                      const dj=dlcDays(lot?.dlc);
                      return(
                        <Card key={r.id} style={{padding:"14px 16px",marginBottom:10,
                          border:`1px solid ${lot?._scanned?G.ok+"40":G.border}`}}>
                          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:lot?._scanned?8:0}}>
                            <div style={{flex:1}}>
                              <div style={{fontSize:13,fontWeight:600,color:G.dark}}>{r.name}</div>
                              <div style={{fontSize:10,color:G.light,marginTop:2}}>
                                {delivery[r.id].demi>0&&`${delivery[r.id].demi} demi `}
                                {delivery[r.id].pleine>0&&`${delivery[r.id].pleine} pleine`}
                              </div>
                            </div>
                            {lot?._scanned
                              ?<div style={{display:"flex",alignItems:"center",gap:6,fontSize:9,color:G.ok,fontWeight:600}}>
                                  ✓ Scanné
                                  <button onClick={()=>setDeliveryLots(p=>{const n={...p};delete n[r.id];return n;})}
                                    style={{background:"none",border:`1px solid ${G.border}`,color:G.light,fontSize:11,
                                      padding:"2px 7px",borderRadius:6,cursor:"pointer",minHeight:"auto"}}>×</button>
                                </div>
                              :<button onClick={()=>setScanTarget({id:r.id,mode:"livraison"})}
                                style={{background:"rgba(140,60,16,0.08)",border:`1px solid ${G.copper}`,
                                  color:G.copper,padding:"8px 14px",borderRadius:20,
                                  fontSize:10,fontWeight:600,cursor:"pointer",minHeight:"auto",whiteSpace:"nowrap"}}>
                                📷 Scanner
                              </button>
                            }
                          </div>
                          {lot?._scanned&&(
                            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                              {lot.lot&&<GTag>{`Lot ${lot.lot}`}</GTag>}
                              {lot.dlc&&<GTag warn={dj!==null&&dj<30}>{`DLC ${fmtDate(lot.dlc)}${dj!==null?` — ${dj}j`:""}`}</GTag>}
                              {lot.fabrique&&<GTag>{`Fab. ${fmtDate(lot.fabrique)}`}</GTag>}
                            </div>
                          )}
                          {!lot?._scanned&&(
                            <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
                              <input placeholder="N° lot" value={deliveryLots[r.id]?.lot||""}
                                onChange={e=>setDeliveryLots(p=>({...p,[r.id]:{...p[r.id],lot:e.target.value}}))}
                                style={{flex:1,padding:"7px 10px",borderRadius:8,border:`1px solid ${G.border}`,
                                  fontSize:12,minHeight:"auto",background:"rgba(255,251,246,0.6)"}}/>
                              <input placeholder="DLC (YYYY-MM-DD)" value={deliveryLots[r.id]?.dlc||""}
                                onChange={e=>setDeliveryLots(p=>({...p,[r.id]:{...p[r.id],dlc:e.target.value}}))}
                                style={{flex:1,padding:"7px 10px",borderRadius:8,border:`1px solid ${G.border}`,
                                  fontSize:12,minHeight:"auto",background:"rgba(255,251,246,0.6)"}}/>
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </>
                );
              })()}
              <BtnRow>
                <GBtn label="← Retour" onClick={()=>setLivWizardStep(1)}/>
                <GBtn primary label="Valider la réception →" onClick={()=>setLivWizardStep(3)}/>
              </BtnRow>
            </>)}

            {/* ÉTAPE 3 — Récapitulatif & Confirmation */}
            {livWizardStep===3&&(<>
              {(()=>{
                const withQty=RECIPES.filter(r=>delivery[r.id]?.demi>0||delivery[r.id]?.pleine>0);
                const tempAlerts=withQty.filter(r=>tempWarn(delivery[r.id]?.temp));
                const lotMissing=withQty.filter(r=>!deliveryLots[r.id]?.lot);
                const dlcAlerts=withQty.filter(r=>dlcDays(deliveryLots[r.id]?.dlc)!==null&&dlcDays(deliveryLots[r.id]?.dlc)<30);
                return(
                  <>
                    {(tempAlerts.length>0||dlcAlerts.length>0)&&(
                      <div style={{marginBottom:14,padding:"10px 14px",borderRadius:10,
                        background:G.dangerBg,border:`1px solid rgba(122,16,8,0.2)`}}>
                        <div style={{fontSize:9,fontWeight:700,color:G.danger,letterSpacing:1,textTransform:"uppercase",marginBottom:6}}>
                          Alertes à vérifier
                        </div>
                        {tempAlerts.map(r=><div key={r.id} style={{fontSize:11,color:G.danger}}>⚠ {r.name} — Température hors norme ({delivery[r.id].temp}°C)</div>)}
                        {dlcAlerts.map(r=><div key={r.id} style={{fontSize:11,color:G.warn}}>⚠ {r.name} — DLC &lt; 30 jours ({dlcDays(deliveryLots[r.id]?.dlc)}j)</div>)}
                      </div>
                    )}
                    {lotMissing.length>0&&(
                      <div style={{marginBottom:14,padding:"10px 14px",borderRadius:10,
                        background:"rgba(140,140,140,0.07)",border:`1px solid rgba(140,140,140,0.2)`}}>
                        <div style={{fontSize:9,color:G.light}}>
                          {lotMissing.length} recette{lotMissing.length>1?"s":""} sans lot scanné : {lotMissing.map(r=>r.name).join(", ")}
                        </div>
                      </div>
                    )}
                    <div style={{marginBottom:16}}>
                      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",gap:6,
                        padding:"6px 10px",borderRadius:8,background:"rgba(140,60,16,0.06)",
                        fontSize:8,fontWeight:700,color:G.copper,letterSpacing:.5,textTransform:"uppercase",marginBottom:4}}>
                        <div>Recette</div><div style={{textAlign:"center"}}>Qté</div>
                        <div style={{textAlign:"center"}}>Temp.</div><div style={{textAlign:"center"}}>Lot</div>
                      </div>
                      {withQty.map(r=>{
                        const item=delivery[r.id];
                        const lot=deliveryLots[r.id];
                        const tw=tempWarn(item.temp);
                        return(
                          <div key={r.id} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",gap:6,
                            padding:"10px 10px",borderRadius:8,marginBottom:4,
                            background:"rgba(255,251,246,0.7)",border:`1px solid ${tw||dlcDays(lot?.dlc)<30?G.danger+"30":G.border}`,
                            borderLeft:`3px solid ${tw?G.danger:G.ok}`,alignItems:"center"}}>
                            <div style={{fontSize:11,fontWeight:600,color:G.dark,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</div>
                            <div style={{textAlign:"center",fontSize:11,color:G.mid}}>
                              {item.demi>0&&`${item.demi}D `}{item.pleine>0&&`${item.pleine}P`}
                            </div>
                            <div style={{textAlign:"center",fontSize:11,fontWeight:600,color:tw?G.danger:item.temp!==null?G.ok:G.light}}>
                              {item.temp!==null?`${item.temp}°C`:"—"}
                              {tw&&" ⚠"}
                            </div>
                            <div style={{textAlign:"center",fontSize:10,color:lot?.lot?G.mid:G.light}}>
                              {lot?.lot||"—"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <BtnRow>
                      <GBtn label="← Retour" onClick={()=>setLivWizardStep(2)}/>
                      <GBtn primary label="✓ Confirmer la réception" onClick={async()=>{
                        await confirmDelivery();
                        // Créer automatiquement les enregistrements de traçabilité
                        const withQtyNow=RECIPES.filter(r=>delivery[r.id]?.demi>0||delivery[r.id]?.pleine>0);
                        const newTraca=withQtyNow.map(r=>({
                          id:Date.now()+Math.random(),
                          recipeId:r.id,name:r.name,zone:delivZone,
                          lot:deliveryLots[r.id]?.lot||null,
                          miseEnPlace:todayISO(),
                          dlcJ14:addDays(todayISO(),14),
                          createdAt:new Date().toISOString(),
                          author:user?.name||"Équipe",
                        }));
                        if(newTraca.length>0) await saveTraca([...newTraca,...tracaRecords]);
                        setLivWizardStep(1);
                        showToast("✓ Réception confirmée — Traçabilité mise à jour");
                        // Proposer l'envoi du PDF
                        setSendDocPending({
                          buildFn:()=>buildDeliveryPDF(delivery,deliveryLots,ZONES.find(z=>z.id===delivZone)?.label,weekLabel(weekOffset),true),
                          docType:"livraison",title:`Bon de réception — ${ZONES.find(z=>z.id===delivZone)?.label}`,weekLbl:weekLabel(weekOffset)
                        });
                      }}/>
                      <GBtn label={pdfLoading?"PDF…":"Exporter PDF"} disabled={pdfLoading} onClick={async()=>{
                        setPdfLoading(true);
                        try{await buildDeliveryPDF(delivery,deliveryLots,ZONES.find(z=>z.id===delivZone)?.label,weekLabel(weekOffset));}
                        catch{showToast("Erreur PDF");}
                        setPdfLoading(false);
                      }}/>
                    </BtnRow>
                  </>
                );
              })()}
            </>)}
          </div>
        )}

        {/* ══ INVENTAIRE ══ */}
        {tab==="inventaire"&&(
          <div style={{animation:"fadein .25s ease"}}>
            <PageIntro title="Stock global — toutes zones" desc="Ajustez les quantités dans les trois zones : Réserve (−18°C), Taxi (transit) et Boutique (pozzetti). La vue Boutique en temps réel est dans l'onglet Boutique."/>
            <FormatLegend/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16}}>
              {[{l:"Épuisés",v:epuises,c:epuises>0?G.danger:G.light},{l:"Stock bas",v:bas,c:bas>0?G.warn:G.light},{l:"Total",v:totalGl,c:G.dark}].map(s=>(
                <Card key={s.l} style={{padding:"12px 8px",textAlign:"center"}}>
                  <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:300,color:s.c}}>{s.v}</div>
                  <div style={{fontSize:8,letterSpacing:2,color:G.light,textTransform:"uppercase",marginTop:3}}>{s.l}</div>
                </Card>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16}}>
              {zoneStats.map(z=>(
                <Card key={z.id} style={{padding:"10px 8px",textAlign:"center"}}>
                  <div style={{fontSize:8,letterSpacing:2,color:G.copper,textTransform:"uppercase",marginBottom:4}}>{z.label}</div>
                  <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,fontWeight:300,color:G.dark}}>{z.eq}</div>
                  <div style={{fontSize:8,color:G.light,marginTop:2}}>{z.demi}D · {z.pleine}P</div>
                </Card>
              ))}
            </div>
            <div style={{display:"flex",gap:0,marginBottom:16,borderRadius:10,overflow:"hidden",border:`1px solid ${G.border}`}}>
              {ZONES.map((z,i)=>(
                <button key={z.id} onClick={()=>setActiveZone(z.id)} style={{flex:1,background:activeZone===z.id?G.copper:"rgba(255,255,255,0.45)",backdropFilter:"blur(8px)",border:"none",borderRight:i<ZONES.length-1?`1px solid ${G.border}`:"none",color:activeZone===z.id?"#fff":G.mid,padding:"10px 6px",cursor:"pointer",transition:"all .15s",fontSize:10,letterSpacing:1.5,textTransform:"uppercase",minHeight:"auto"}}>
                  <div style={{fontWeight:500}}>{z.label}</div><div style={{fontSize:8,opacity:.7,marginTop:1}}>{z.sub}</div>
                </button>
              ))}
            </div>
            {["Sorbet","Glace"].map(type=>(
              <div key={type} style={{marginBottom:24}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",paddingBottom:10,borderBottom:`1px solid ${G.border}`}}>
                  <span style={{fontSize:8,letterSpacing:5,color:G.copper,textTransform:"uppercase"}}>{type}s</span>
                  <div style={{display:"flex",gap:14}}><span style={{fontSize:7,letterSpacing:2,color:G.light}}>Demi 2.5L</span><span style={{fontSize:7,letterSpacing:2,color:G.light}}>Pleine 5L</span></div>
                </div>
                {RECIPES.filter(r=>r.type===type).map(r=>{
                  const zone=inventory[r.id]?.[activeZone]||emptyZone();const tot=totalZ(inventory[r.id]);const ecoR=eco?.[r.id];
                  return(
                    <div key={r.id} style={{padding:"12px 0",borderBottom:`1px solid ${G.border}`}}>
                      <div style={{display:"flex",alignItems:"center",marginBottom:8,gap:6,flexWrap:"wrap"}}>
                        <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:15,color:tot===0?G.light:G.dark,flex:1}}>{r.name}</span>
                        {tot===0&&<GChip color={G.danger}>Épuisé</GChip>}
                        {tot>0&&tot<=2&&<GChip color={G.warn}>Bas</GChip>}
                        <span style={{fontSize:8,color:G.light}}>R:{zoneDemi(inventory[r.id],"reserve")} T:{zoneDemi(inventory[r.id],"taxi")} B:{zoneDemi(inventory[r.id],"boutique")}</span>
                        {ecoR?.sold>0&&<span style={{fontSize:8,color:G.copper}}>{ecoR.sold} vendus</span>}
                      </div>
                      <div style={{display:"flex",gap:12,justifyContent:"flex-end"}}>
                        <QtyCtrl val={zone.demi}   onChange={v=>updateInv(r.id,activeZone,"demi",v)}/>
                        <QtyCtrl val={zone.pleine} onChange={v=>updateInv(r.id,activeZone,"pleine",v)}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            <BtnRow>
              <GBtn label={pdfLoading?"PDF…":"Exporter PDF"} disabled={pdfLoading} onClick={async()=>{
                setPdfLoading(true);
                try{await buildInventoryPDF(inventory,todayFull());}
                catch{showToast("Erreur PDF");}
                setPdfLoading(false);
              }}/>
              <GBtn small label="Envoyer aux docs" disabled={pdfLoading} onClick={()=>setSendDocPending({
                buildFn:()=>buildInventoryPDF(inventory,todayFull(),true),
                docType:"inventaire",title:`État des stocks — ${new Date().toLocaleDateString("fr-FR")}`,weekLbl:weekLabel(weekOffset)
              })}/>
              <GBtn primary label="Enregistrer dans le journal" onClick={async()=>{
                // Sauvegarde immédiate du stock sur le serveur (pour la boutique + suggestions IA)
                try { await storage.set("ad9_inv", JSON.stringify(inventory)); } catch {}
                const summary=RECIPES.filter(r=>totalZ(inventory[r.id])>0)
                  .map(r=>({name:r.name,total:totalZ(inventory[r.id]),demi:ZONES.reduce((s,z)=>s+(inventory[r.id]?.[z.id]?.demi||0),0),pleine:ZONES.reduce((s,z)=>s+(inventory[r.id]?.[z.id]?.pleine||0),0)}));
                const entry=await historyAPI.push({type:"inventaire",label:`Mise à jour stock — ${new Date().toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"})}`,author:user?.name||"Équipe",data:{totalGl,summary}});
                if(entry){
                  setHistEntries(prev=>[entry,...prev]);
                  showToast("Stock enregistré ✓");
                  syncNow();
                } else {
                  showToast("Erreur journal — reconnectez-vous");
                }
              }}/>
            </BtnRow>
          </div>
        )}

        {/* ══ COMMANDE ══ */}
        {tab==="commande"&&(
          <div style={{animation:"fadein .25s ease"}}>
            <div style={{marginBottom:16,paddingBottom:14,borderBottom:`1px solid ${G.border}`,display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,flexWrap:"wrap"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <button onClick={()=>setWeekOffset(w=>w-1)}
                  style={{background:"none",border:`1px solid ${G.border}`,color:G.mid,
                    width:28,height:28,borderRadius:"50%",fontSize:16,cursor:"pointer",
                    display:"flex",alignItems:"center",justifyContent:"center",minHeight:"auto",flexShrink:0}}>
                  ‹
                </button>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                    <div style={{fontSize:8,letterSpacing:4,color:G.copper,textTransform:"uppercase"}}>{weekLabel(weekOffset)}</div>
                    {weekOffset!==0&&(
                      <button onClick={()=>setWeekOffset(0)}
                        style={{background:`${G.copper}12`,border:`1px solid ${G.copper}30`,color:G.copper,
                          fontSize:8,padding:"2px 7px",borderRadius:6,cursor:"pointer",minHeight:"auto",letterSpacing:.5}}>
                        Aujourd'hui
                      </button>
                    )}
                  </div>
                  <div style={{fontSize:11,color:G.mid}}>{isDouble(weekOffset)?"C1 : dimanche → mardi  ·  C2 : mardi → jeudi":"Commande lundi, livraison mercredi"}</div>
                </div>
                <button onClick={()=>setWeekOffset(w=>w+1)}
                  style={{background:"none",border:`1px solid ${G.border}`,color:G.mid,
                    width:28,height:28,borderRadius:"50%",fontSize:16,cursor:"pointer",
                    display:"flex",alignItems:"center",justifyContent:"center",minHeight:"auto",flexShrink:0}}>
                  ›
                </button>
              </div>
              {!weather.loading&&weather.tMin!==null&&<div style={{textAlign:"right"}}><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:16,fontWeight:300,color:G.dark}}>{weather.tMin}–{weather.tMax}°C</div><div style={{fontSize:8,letterSpacing:2,color:G.light,textTransform:"uppercase"}}>{weather.label}</div></div>}
            </div>
            <div style={{display:"flex",gap:0,marginBottom:16,border:`1px solid ${G.border}`,borderRadius:10,overflow:"hidden"}}>
              {[{id:"manual",l:"Saisie manuelle"},{id:"ia",l:"Suggestion IA"}].map((m,i)=>(
                <button key={m.id} onClick={()=>setCmdMode(m.id)} style={{flex:1,background:cmdMode===m.id?G.copper:"rgba(255,255,255,0.45)",backdropFilter:"blur(8px)",border:"none",borderRight:i===0?`1px solid ${G.border}`:"none",color:cmdMode===m.id?"#fff":G.mid,padding:"10px",fontSize:10,letterSpacing:2,textTransform:"uppercase",cursor:"pointer",transition:"all .15s",minHeight:"auto"}}>
                  {m.l}
                </button>
              ))}
            </div>
            {cmdMode==="ia"&&(
              <div>
                <WeatherForecast/>
                {eco&&<Card style={{padding:"10px 14px",marginBottom:14,border:`1px solid rgba(42,106,66,0.25)`}}><div style={{fontSize:10,color:G.ok}}>{RECIPES.filter(r=>eco[r.id]?.sold>0).length} recettes analysées — taux d'écoulement réel intégré</div></Card>}
                <GBtn primary label={aiLoading?"Génération…":"Générer une suggestion"} disabled={aiLoading} onClick={generateOrder}/>
                {aiLoading&&<div style={{height:1,background:G.border,position:"relative",overflow:"hidden",margin:"14px 0"}}><div style={{position:"absolute",top:0,left:"-70%",width:"70%",height:"100%",background:`linear-gradient(90deg,transparent,${G.copper},transparent)`,animation:"shimmer 1.3s infinite linear"}}/></div>}
                {aiText&&!aiLoading&&<Card style={{padding:"14px 16px",marginTop:14}}><div style={{fontSize:8,letterSpacing:4,color:G.copper,textTransform:"uppercase",marginBottom:10,paddingBottom:8,borderBottom:`1px solid ${G.border}`}}>Analyse</div><div style={{fontSize:11,lineHeight:1.85,color:G.mid,whiteSpace:"pre-wrap"}}>{aiText}</div></Card>}
                {suggestion&&!aiLoading&&<div style={{marginTop:8,padding:"10px 14px",background:"rgba(42,106,66,0.08)",borderRadius:8,fontSize:10,color:G.ok}}>Suggestion chargée dans la saisie manuelle.</div>}
              </div>
            )}
            {cmdMode==="manual"&&(
              <div>
                <FormatLegend/>
                {[
                  {label:isDouble(weekOffset)?"Commande 1 — passer dimanche, livraison mardi":"Commande — passer lundi, livraison mercredi",order:manualOrder,setOrder:setManualOrder,days:isDouble(weekOffset)?3:7,key:"c1"},
                  ...(isDouble(weekOffset)?[{label:"Commande 2 — passer mardi, livraison jeudi",order:manualOrder2,setOrder:setManualOrder2,days:4,key:"c2"}]:[]),
                ].map(cmd=>(
                  <div key={cmd.key} style={{marginBottom:28}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",paddingBottom:10,borderBottom:`1px solid ${G.border}`,marginBottom:0}}>
                      <span style={{fontSize:9,letterSpacing:3,color:G.copper,textTransform:"uppercase"}}>{cmd.label}</span>
                      <span style={{fontSize:8,letterSpacing:2,color:G.light}}>{cmd.days}j</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"flex-end",gap:22,padding:"5px 0",borderBottom:`1px solid ${G.border}`}}>
                      <span style={{fontSize:7,letterSpacing:2,color:G.light,textTransform:"uppercase",width:34,textAlign:"center"}}>Demi</span>
                      <span style={{fontSize:7,letterSpacing:2,color:G.light,textTransform:"uppercase",width:34,textAlign:"center"}}>Pleine</span>
                    </div>
                    {RECIPES.map(r=>{
                      const q=cmd.order[r.id]||{demi:0,pleine:0};
                      return(
                        <div key={r.id} style={{display:"flex",alignItems:"center",padding:"9px 0",borderBottom:`1px solid ${G.border}`,gap:8}}>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:14,color:G.dark,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</div>
                            <div style={{fontSize:7,color:G.light,textTransform:"uppercase",letterSpacing:1.5,marginTop:1}}>{r.type}</div>
                          </div>
                          <div style={{display:"flex",gap:12,flexShrink:0}}>
                            <QtyCtrl val={q.demi}   onChange={v=>cmd.setOrder(prev=>({...prev,[r.id]:{...prev[r.id],demi:Math.max(0,v)}}))}/>
                            <QtyCtrl val={q.pleine} onChange={v=>cmd.setOrder(prev=>({...prev,[r.id]:{...prev[r.id],pleine:Math.max(0,v)}}))}/>
                          </div>
                        </div>
                      );
                    })}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:12}}>
                      <span style={{fontSize:9,letterSpacing:3,color:G.light,textTransform:"uppercase"}}>Total</span>
                      <div style={{display:"flex",gap:16}}>
                        {[{v:RECIPES.reduce((s,r)=>s+(cmd.order[r.id]?.demi||0),0),l:"demi"},{v:RECIPES.reduce((s,r)=>s+(cmd.order[r.id]?.pleine||0),0),l:"pleine"}].map(x=>(
                          <div key={x.l} style={{width:34,textAlign:"center"}}>
                            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:300,color:G.copper}}>{x.v}</div>
                            <div style={{fontSize:7,letterSpacing:1.5,color:G.light,textTransform:"uppercase"}}>{x.l}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
                <BtnRow>
                  <GBtn primary label={pdfLoading?"PDF…":"Exporter C1"} disabled={pdfLoading} onClick={async()=>{
                    setPdfLoading(true);
                    try{
                      await buildOrderPDF(manualOrder,weekLabel(weekOffset),isDouble(weekOffset)?"Commande 1 — Mardi":"Commande — Mercredi");
                      const items=RECIPES.filter(r=>manualOrder[r.id]?.demi>0||manualOrder[r.id]?.pleine>0);
                      if(items.length) historyAPI.push({type:"commande",label:`Commande${isDouble(weekOffset)?" 1":""}  — ${weekLabel(weekOffset)}`,author:user?.name||"Équipe",data:{week:weekOffset,c1:Object.fromEntries(items.map(r=>[r.id,{...manualOrder[r.id],totalEq:(manualOrder[r.id].demi||0)+(manualOrder[r.id].pleine||0)*2}])),manual:true}}).then(e=>{if(e)setHistEntries(prev=>[e,...prev]);});
                    }catch{showToast("Erreur PDF");}
                    setPdfLoading(false);
                  }}/>
                  {isDouble(weekOffset)&&<GBtn label={pdfLoading?"PDF…":"Exporter C2"} disabled={pdfLoading} onClick={async()=>{
                    setPdfLoading(true);
                    try{
                      await buildOrderPDF(manualOrder2,weekLabel(weekOffset),"Commande 2 — Jeudi");
                      const items=RECIPES.filter(r=>manualOrder2[r.id]?.demi>0||manualOrder2[r.id]?.pleine>0);
                      if(items.length) historyAPI.push({type:"commande",label:`Commande 2 — ${weekLabel(weekOffset)}`,author:user?.name||"Équipe",data:{week:weekOffset,c1:Object.fromEntries(items.map(r=>[r.id,{...manualOrder2[r.id],totalEq:(manualOrder2[r.id].demi||0)+(manualOrder2[r.id].pleine||0)*2}])),manual:true}}).then(e=>{if(e)setHistEntries(prev=>[e,...prev]);});
                    }catch{showToast("Erreur PDF");}
                    setPdfLoading(false);
                  }}/>}
                  <GBtn label="Réinitialiser" onClick={()=>{setManualOrder(Object.fromEntries(RECIPES.map(r=>[r.id,{demi:0,pleine:0}])));setManualOrder2(Object.fromEntries(RECIPES.map(r=>[r.id,{demi:0,pleine:0}])));}}/>
                </BtnRow>
              </div>
            )}
          </div>
        )}

        {/* ══ TRAÇABILITÉ ══ */}
        {tab==="tracabilite"&&(
          <div style={{animation:"fadein .28s ease"}}>
            <PageIntro title="Traçabilité — Mise en pozzetti" desc="Scannez l'étiquette pour remplir lot + DLC automatiquement. Indiquez la date de mise en place pour calculer la date de retrait (+14j)."/>

            {/* Modal scan pour traçabilité */}
            {scanTarget?.mode==="tracabilite"&&(
              <ScanModal
                recipeName={RECIPES.find(r=>r.id===scanTarget.id)?.name||tracaNew.recipeId&&RECIPES.find(r=>r.id===tracaNew.recipeId)?.name}
                onResult={parsed=>{
                  setTracaNew(p=>({
                    ...p,
                    lot: parsed.lot||p.lot,
                    dlc: parsed.dlc||p.dlc,
                  }));
                  setScanTarget(null);
                  showToast("Lot et DLC récupérés !");
                }}
                onClose={()=>setScanTarget(null)}
              />
            )}

            {/* Formulaire 4 étapes */}
            <Card style={{padding:"20px",marginBottom:20}}>
              <div style={{fontSize:12,fontWeight:700,color:G.dark,marginBottom:18}}>Nouvelle mise en place</div>

              {/* Étape 1 — Zone + Format carapine */}
              <StepRow num={1} title="Zone de destination">
                <div style={{display:"flex",gap:6,marginBottom:10}}>
                  {ZONES.map(z=>(
                    <button key={z.id} onClick={()=>setTracaZone(z.id)}
                      style={{flex:1,padding:"9px 6px",border:`1px solid ${tracaZone===z.id?G.copper:G.border}`,
                        background:tracaZone===z.id?G.copper:"rgba(255,251,246,0.6)",
                        color:tracaZone===z.id?"#fff":G.mid,borderRadius:10,cursor:"pointer",
                        fontSize:9,letterSpacing:1.5,textTransform:"uppercase",fontWeight:tracaZone===z.id?600:400,
                        minHeight:"auto",transition:"all .15s",
                        boxShadow:tracaZone===z.id?"0 2px 10px rgba(140,60,16,0.3)":"none"}}>
                      <div style={{fontWeight:500}}>{z.label}</div>
                      <div style={{fontSize:7,opacity:.7,marginTop:1}}>{z.sub}</div>
                    </button>
                  ))}
                </div>
                {/* Format carapine */}
                <div>
                  <div style={{fontSize:8,letterSpacing:2,color:G.light,textTransform:"uppercase",fontWeight:500,marginBottom:6}}>Format carapine (déduit du stock Réserve)</div>
                  <div style={{display:"flex",gap:6}}>
                    {[{v:"demi",label:"Demi-bac",sub:"½ bac"},{v:"pleine",label:"Pleine bac",sub:"1 bac"}].map(f=>(
                      <button key={f.v} onClick={()=>setTracaNew(p=>({...p,format:f.v}))}
                        style={{flex:1,padding:"9px 8px",border:`1px solid ${tracaNew.format===f.v?G.copper:G.border}`,
                          background:tracaNew.format===f.v?"rgba(140,60,16,0.10)":"rgba(255,251,246,0.5)",
                          color:tracaNew.format===f.v?G.copper:G.mid,borderRadius:10,cursor:"pointer",
                          fontSize:10,fontWeight:tracaNew.format===f.v?700:400,minHeight:"auto",transition:"all .15s"}}>
                        <div>{f.label}</div>
                        <div style={{fontSize:8,opacity:.6,marginTop:2}}>{f.sub}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </StepRow>

              {/* Étape 2 — Recette */}
              <StepRow num={2} title="Choisir le parfum">
                <select value={tracaNew.recipeId}
                  onChange={e=>setTracaNew(p=>({...p,recipeId:e.target.value}))}
                  style={{width:"100%",padding:"11px 14px",border:`1px solid ${tracaNew.recipeId?G.borderS:G.border}`,
                    borderRadius:10,fontSize:13,background:"rgba(255,251,246,0.7)",color:G.dark,
                    cursor:"pointer",minHeight:"auto"}}>
                  <option value="">— Choisir un parfum —</option>
                  {["Sorbet","Glace"].map(type=>(
                    <optgroup key={type} label={type+"s"}>
                      {RECIPES.filter(r=>r.type===type).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </StepRow>

              {/* Étape 3 — Lot + DLC */}
              <StepRow num={3} title="Lot + DLC (scan ou saisie)">
                <button onClick={()=>setScanTarget({id:tracaNew.recipeId||"scan",mode:"tracabilite"})}
                  style={{width:"100%",background:"rgba(140,60,16,0.07)",border:`1px solid ${G.borderS}`,
                    borderRadius:10,padding:"12px 16px",fontSize:11,color:G.copper,
                    cursor:"pointer",fontWeight:600,marginBottom:12,minHeight:"auto",
                    display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                  Scanner l'étiquette → Lot + DLC
                </button>
                <div style={{marginBottom:10}}>
                  <SLabel>N° de lot</SLabel>
                  <input value={tracaNew.lot} placeholder="Ex : 6218161"
                    onChange={e=>setTracaNew(p=>({...p,lot:e.target.value}))}
                    style={{width:"100%",marginTop:5,padding:"11px 14px",
                      border:`1px solid ${tracaNew.lot?G.borderS:G.border}`,borderRadius:8,
                      fontSize:16,fontWeight:600,letterSpacing:.5,
                      background:tracaNew.lot?"rgba(255,251,246,0.95)":"rgba(255,251,246,0.5)",
                      color:G.dark,minHeight:"auto"}}/>
                </div>
                <div>
                  <SLabel>DLC</SLabel>
                  <input type="date" value={tracaNew.dlc}
                    onChange={e=>setTracaNew(p=>({...p,dlc:e.target.value}))}
                    style={{width:"100%",marginTop:5,padding:"9px 10px",
                      border:`1px solid ${tracaNew.dlc?G.borderS:G.border}`,borderRadius:8,fontSize:14,
                      background:tracaNew.dlc?"rgba(255,251,246,0.9)":"rgba(255,251,246,0.5)",
                      color:G.dark,minHeight:"auto"}}/>
                </div>
              </StepRow>

              {/* Étape 4 — Date mise en pozzetti */}
              <StepRow num={4} title="Date de mise en pozzetti">
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10}}>
                  <div>
                    <SLabel>Mise en pozzetti</SLabel>
                    <input type="date" value={tracaNew.miseEnPlace}
                      onChange={e=>{const d=e.target.value;setTracaNew(p=>({...p,miseEnPlace:d,retrait:addDays(d,14)}));}}
                      style={{width:"100%",marginTop:5,padding:"9px 10px",border:`1px solid ${G.borderS}`,
                        borderRadius:8,fontSize:13,background:"rgba(255,251,246,0.8)",color:G.dark,minHeight:"auto"}}/>
                  </div>
                  <div>
                    <SLabel>Retrait <span style={{color:G.ok,fontWeight:600}}>+14j auto</span></SLabel>
                    <input type="date" value={tracaNew.retrait} readOnly
                      style={{width:"100%",marginTop:5,padding:"9px 10px",
                        border:`1px solid rgba(30,94,50,0.28)`,borderRadius:8,fontSize:13,
                        background:"rgba(30,94,50,0.06)",color:G.ok,fontWeight:500,minHeight:"auto",cursor:"default"}}/>
                  </div>
                </div>
              </StepRow>

              <GBtn primary label="Ajouter au registre" disabled={!tracaNew.recipeId}
                onClick={()=>{
                  const fmt=tracaNew.format||"demi";
                  const rec={id:Date.now(),
                    recipeId:tracaNew.recipeId,
                    name:RECIPES.find(r=>r.id===tracaNew.recipeId)?.name||"",
                    zone:tracaZone,
                    format:fmt,
                    lot:tracaNew.lot||null,
                    dlc:tracaNew.dlc||null,
                    miseEnPlace:tracaNew.miseEnPlace,
                    dlcJ14:tracaNew.retrait,
                    createdAt:new Date().toISOString(),
                    author:user?.name||"Équipe"};
                  saveTraca([rec,...tracaRecords]);

                  /* ── Déduction automatique du stock ── */
                  let deductedFrom=null;
                  setInventory(prev=>{
                    const next=JSON.parse(JSON.stringify(prev));
                    if(!next[tracaNew.recipeId]) next[tracaNew.recipeId]=emptyItem();
                    // Déduit de Réserve en priorité, puis Taxi si épuisé
                    for(const z of["reserve","taxi"]){
                      if((next[tracaNew.recipeId][z]?.[fmt]||0)>0){
                        next[tracaNew.recipeId][z][fmt]=Math.max(0,next[tracaNew.recipeId][z][fmt]-1);
                        deductedFrom=z;
                        break;
                      }
                    }
                    if(deductedFrom){
                      lastInvEditRef.current=Date.now();
                      setTimeout(()=>storage.set("ad9_inv",JSON.stringify(next)).catch(()=>{}),50);
                    }
                    return deductedFrom?next:prev;
                  });

                  historyAPI.push({type:"tracabilite",label:`Mise en place — ${rec.name}`,author:user?.name||"Équipe",data:{name:rec.name,zone:tracaZone,format:fmt,lot:rec.lot,dlc:rec.dlc,miseEnPlace:rec.miseEnPlace,retrait:rec.dlcJ14}}).then(e=>{if(e)setHistEntries(prev=>[e,...prev]);});
                  setTracaNew(emptyTracaNew());
                  const zoneSrc=deductedFrom?ZONES.find(z=>z.id===deductedFrom)?.label:"aucune source";
                  showToast(deductedFrom?`Mise en place + 1 ${fmt}-bac déduit (${zoneSrc})`:"Mise en place enregistrée — stock Réserve/Taxi = 0");
                }}/>
            </Card>
            {/* ── Registre organisé par jour puis par parfum ── */}
            {tracaRecords.length>0?(()=>{
              /* Grouper par date de mise en place, trier par date desc + parfum asc */
              const byDay={};
              [...tracaRecords].forEach(r=>{
                const day=r.miseEnPlace||r.createdAt?.split("T")[0]||todayISO();
                if(!byDay[day]) byDay[day]=[];
                byDay[day].push(r);
              });
              const sortedDays=Object.entries(byDay)
                .sort(([a],[b])=>b.localeCompare(a)); // plus récent en premier
              sortedDays.forEach(([,recs])=>recs.sort((a,b)=>a.name.localeCompare(b.name,"fr"))); // A→Z

              return(
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <div style={{fontSize:13,fontWeight:700,color:G.dark}}>Registre <span style={{fontSize:11,color:G.light,fontWeight:400}}>({tracaRecords.length} entrée{tracaRecords.length>1?"s":""})</span></div>
                    <GBtn small label={pdfLoading?"PDF…":"Exporter PDF"} disabled={pdfLoading} onClick={async()=>{setPdfLoading(true);try{await buildTracabilityPDF(tracaRecords);}catch{showToast("Erreur PDF");}setPdfLoading(false);}}/>
                  </div>

                  {sortedDays.map(([day,recs])=>{
                    const isToday=day===todayISO();
                    const hasAlert=recs.some(r=>{ const d=dlcDays(r.dlcJ14); return d!==null&&d<=2; });
                    return(
                      <div key={day} style={{marginBottom:18}}>
                        {/* Entête du jour */}
                        <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",
                          background:isToday?"rgba(140,60,16,0.08)":hasAlert?"rgba(122,16,8,0.05)":"rgba(255,251,246,0.6)",
                          borderRadius:10,marginBottom:8,
                          border:`1px solid ${isToday?G.borderS:hasAlert?"rgba(122,16,8,0.2)":G.border}`}}>
                          <div style={{width:10,height:10,borderRadius:"50%",
                            background:isToday?G.copper:hasAlert?G.danger:"rgba(140,60,16,0.3)",
                            flexShrink:0,
                            animation:isToday||hasAlert?"breathe 2.4s ease infinite":"none"}}/>

                          <span style={{fontSize:12,fontWeight:600,color:G.dark,flex:1}}>
                            {new Date(day+"T12:00:00").toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}
                            {isToday&&<span style={{marginLeft:8,fontSize:10,color:G.copper,fontWeight:500}}>— Aujourd'hui</span>}
                          </span>
                          <span style={{fontSize:10,color:G.light}}>{recs.length} parfum{recs.length>1?"s":""}</span>
                        </div>

                        {/* Cartes du jour triées par parfum */}
                        {recs.map(rec=>{
                          const dj=dlcDays(rec.dlcJ14);
                          const exp=dj!==null&&dj<=0;
                          const urg=dj!==null&&dj>0&&dj<=2;
                          return(
                            <Card key={rec.id} style={{padding:"12px 14px",marginBottom:6,
                              border:`1px solid ${exp?G.danger:urg?"rgba(148,82,8,0.35)":G.border}`,
                              background:exp?G.dangerBg:urg?G.warnBg:G.glass}}>
                              <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                                <div style={{flex:1,minWidth:0}}>
                                  {/* Nom du parfum — prominent */}
                                  <div style={{fontSize:14,fontWeight:600,color:G.dark,marginBottom:3}}>
                                    {rec.name}
                                  </div>
                                  {/* Infos secondaires */}
                                  <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:6}}>
                                    <span style={{fontSize:10,color:G.mid,background:"rgba(90,54,36,0.06)",
                                      padding:"2px 8px",borderRadius:8}}>
                                      {ZONES.find(z=>z.id===rec.zone)?.label||rec.zone}
                                    </span>
                                    {rec.lot&&<span style={{fontSize:10,color:G.mid}}>Lot {rec.lot}</span>}
                                    {rec.dlc&&<span style={{fontSize:10,color:G.mid}}>DLC {fmtDate(rec.dlc)}</span>}
                                  </div>
                                  {/* Dates clés */}
                                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                                    <GTag>
                                      En place le {fmtDate(rec.miseEnPlace)}
                                    </GTag>
                                    <GTag warn={exp||urg}>
                                      Retrait {fmtDate(rec.dlcJ14)}
                                      {dj!==null&&<span style={{fontWeight:700}}>
                                        {exp?" — Expiré !":urg?` — ${dj}j !`:` — ${dj}j`}
                                      </span>}
                                    </GTag>
                                  </div>
                                  {rec.author&&<div style={{fontSize:9,color:G.light,marginTop:4}}>{rec.author}</div>}
                                </div>
                                <button onClick={()=>saveTraca(tracaRecords.filter(r=>r.id!==rec.id))}
                                  style={{background:"none",border:`1px solid ${G.border}`,color:G.danger,
                                    padding:"4px 8px",fontSize:12,borderRadius:6,cursor:"pointer",
                                    minHeight:"auto",minWidth:"auto",flexShrink:0}}>×</button>
                              </div>
                            </Card>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })()
            :(
              <div style={{textAlign:"center",padding:"32px 0",color:G.light,fontStyle:"italic",
                fontFamily:"'Cormorant Garamond',serif",fontSize:16}}>
                Aucune mise en place enregistrée
              </div>
            )}
          </div>
        )}

        {/* ══ CAISSE ══ */}
        {tab==="caisse"&&<CaisseTab showToast={showToast}/>}

        {/* ══ DOCUMENTS ══ */}
        {tab==="documents"&&<DropboxTab user={user} showToast={showToast}/>}

        {/* ══ CONFIGS ══ */}
        {tab==="configs"&&(
          <div style={{animation:"fadein .25s ease"}}>
            <PageIntro title="Configurations" desc="Sauvegardez et retrouvez les snapshots de stock de l'équipe."/>
            <Card style={{padding:"14px 16px",marginBottom:20}}>
              <div style={{fontSize:8,letterSpacing:3,color:G.copper,textTransform:"uppercase",marginBottom:12}}>Sauvegarder la config actuelle</div>
              <SLabel>Nom de la configuration</SLabel>
              <input value={configName} onChange={e=>setConfigName(e.target.value)} placeholder={`Config du ${new Date().toLocaleDateString("fr-FR")}`} maxLength={60}
                style={{width:"100%",marginTop:6,marginBottom:12,border:`1px solid ${G.border}`,background:"rgba(255,255,255,0.6)",color:G.dark,padding:"10px 12px",fontSize:13,borderRadius:8,outline:"none",minHeight:"auto"}}/>
              <div style={{fontSize:10,color:G.light,marginBottom:12}}>Stock actuel : {totalGl} demi-eq. · Par : {author||"Équipe"}</div>
              <GBtn primary label="Sauvegarder" onClick={saveConfig} disabled={!configName.trim()}/>
            </Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:12}}>
              <div style={{fontSize:8,letterSpacing:4,color:G.copper,textTransform:"uppercase"}}>Toutes les configs ({configs.length})</div>
              <GBtn label={configsLoading?"Chargement…":"Actualiser"} disabled={configsLoading} onClick={loadConfigs}/>
            </div>
            {configsLoading&&<div style={{textAlign:"center",padding:"32px 0",fontSize:10,color:G.light,letterSpacing:2,textTransform:"uppercase",animation:"pulse 1.4s infinite"}}>Chargement…</div>}
            {!configsLoading&&configs.length===0&&<div style={{textAlign:"center",padding:"32px 0",color:G.light,fontStyle:"italic",fontFamily:"'Cormorant Garamond',serif",fontSize:16}}>Aucune config sauvegardée</div>}
            {/*  ConfigCard est un composant séparé — hooks hors de .map() */}
            {!configsLoading&&configs.map(cfg=>(
              <ConfigCard key={cfg.key} cfg={cfg} myAuthor={author} onRestore={()=>{setInventory(JSON.parse(JSON.stringify(cfg.inventory)));showToast("Config restaurée");}}/>
            ))}
          </div>
        )}

        {/* ══ HISTORIQUE ══ */}
        {tab==="historique"&&(
          <div style={{animation:"fadein .25s ease"}}>
            <PageIntro title="Journal de l'équipe" desc="Toutes les actions enregistrées — commandes, livraisons, traçabilité, températures."/>

            {/* Résumé par collègue */}
            {!histLoading&&histEntries.length>0&&(()=>{
              const byAuth={};
              histEntries.forEach(e=>{ const a=e.author||"Équipe"; if(!byAuth[a])byAuth[a]={}; byAuth[a][e.type]=(byAuth[a][e.type]||0)+1; });
              const authors=Object.entries(byAuth).sort(([,a],[,b])=>Object.values(b).reduce((s,v)=>s+v,0)-Object.values(a).reduce((s,v)=>s+v,0));
              return(
                <div style={{marginBottom:18}}>
                  <div style={{fontSize:10,fontWeight:600,color:G.light,marginBottom:10}}>Activité de l'équipe</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    {authors.map(([name,types])=>{
                      const total=Object.values(types).reduce((s,v)=>s+v,0);
                      const ap=getAvatarProfile(name);
                      const isMe=name===(author||"Équipe");
                      return(
                        <button key={name} onClick={()=>setHistFilterAuth(histFilterAuth===name?"":name)}
                          style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",
                            background:histFilterAuth===name?`${ap.color}15`:"rgba(255,251,246,0.7)",
                            border:`1.5px solid ${histFilterAuth===name?ap.color:G.border}`,
                            borderRadius:12,cursor:"pointer",minHeight:"auto",transition:"all .18s"}}>
                          <AvatarDisplay name={name} color={ap.color} shape={ap.shape} anim={histFilterAuth===name?ap.anim:"none"} size={30}/>
                          <div style={{textAlign:"left"}}>
                            <div style={{fontSize:11,fontWeight:600,color:G.dark}}>{name}{isMe?" (moi)":""}</div>
                            <div style={{fontSize:9,color:G.light}}>{total} action{total>1?"s":""}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Filtres par type */}
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
              {[
                {id:"all",        l:"Tout"},
                {id:"livraison",  l:"Livraisons"},
                {id:"commande",   l:"Commandes"},
                {id:"tracabilite",l:"Traçabilité"},
                {id:"temperature",l:"Températures"},
                {id:"inventaire", l:"Stock"},
                {id:"document",   l:"Documents"},
              ].map(f=>(
                <button key={f.id} onClick={()=>setHistFilterType(f.id)}
                  style={{padding:"6px 14px",borderRadius:20,border:`1px solid ${histFilterType===f.id?G.copper:"transparent"}`,
                    background:histFilterType===f.id?G.copper:"rgba(140,60,16,0.06)",
                    color:histFilterType===f.id?"#fff":G.light,fontSize:10,fontWeight:histFilterType===f.id?600:400,
                    cursor:"pointer",minHeight:"auto",transition:"all .18s",
                    boxShadow:histFilterType===f.id?"0 2px 10px rgba(140,60,16,0.28)":"none"}}>
                  {f.l}
                </button>
              ))}
              {(histFilterType!=="all"||histFilterAuth)&&(
                <button onClick={()=>{setHistFilterType("all");setHistFilterAuth("");}}
                  style={{padding:"6px 12px",borderRadius:20,border:`1px solid ${G.border}`,background:"transparent",
                    color:G.light,fontSize:10,cursor:"pointer",minHeight:"auto"}}>
                  Effacer filtres
                </button>
              )}
            </div>

            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:10}}>
              <GBtn small label={histLoading?"Chargement…":"Actualiser"} disabled={histLoading} onClick={loadHistory}/>
            </div>

            {histLoading&&<div style={{textAlign:"center",padding:"40px 0",fontSize:10,color:G.light,animation:"pulse 1.4s infinite"}}>Chargement…</div>}
            {!histLoading&&(()=>{
              const filtered=histEntries.filter(e=>
                (histFilterType==="all"||e.type===histFilterType) &&
                (!histFilterAuth||e.author===histFilterAuth)
              );
              if(!filtered.length) return(
                <div style={{textAlign:"center",padding:"48px 0",fontFamily:"'Cormorant Garamond',serif",fontSize:16,color:G.light,fontStyle:"italic"}}>
                  {histEntries.length===0?"Aucune action enregistrée":"Aucun résultat pour ces filtres"}
                </div>
              );
              return filtered.map(entry=>{
                const wlFromEntry=typeof entry.data?.week==="number"
                  ?weekLabel(entry.data.week)
                  :new Date(entry.createdAt).toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"});

                const handleDownload=["commande","livraison"].includes(entry.type)?async()=>{
                  if(entry.type==="commande"){
                    const order=Object.fromEntries(RECIPES.map(r=>[r.id,{demi:entry.data?.c1?.[r.id]?.demi||0,pleine:entry.data?.c1?.[r.id]?.pleine||0}]));
                    await buildOrderPDF(order,wlFromEntry,"Commande");
                    if(entry.data?.c2){
                      const order2=Object.fromEntries(RECIPES.map(r=>[r.id,{demi:entry.data.c2?.[r.id]?.demi||0,pleine:entry.data.c2?.[r.id]?.pleine||0}]));
                      await buildOrderPDF(order2,wlFromEntry,"Commande 2");
                    }
                  } else if(entry.type==="livraison"){
                    const zone=entry.label.includes("—")?entry.label.split("—").pop().trim():"Zone";
                    await buildDeliveryPDF(entry.data?.delivery||{},entry.data?.lots||{},zone,wlFromEntry);
                  }
                }:undefined;

                const handleSend=["commande","livraison"].includes(entry.type)?()=>{
                  if(entry.type==="commande"){
                    const order=Object.fromEntries(RECIPES.map(r=>[r.id,{demi:entry.data?.c1?.[r.id]?.demi||0,pleine:entry.data?.c1?.[r.id]?.pleine||0}]));
                    setSendDocPending({
                      buildFn:()=>buildOrderPDF(order,wlFromEntry,"Commande",true),
                      docType:"commande",title:`Bon de commande — ${wlFromEntry}`,weekLbl:wlFromEntry,
                    });
                  } else if(entry.type==="livraison"){
                    const zone=entry.label.includes("—")?entry.label.split("—").pop().trim():"Zone";
                    setSendDocPending({
                      buildFn:()=>buildDeliveryPDF(entry.data?.delivery||{},entry.data?.lots||{},zone,wlFromEntry,true),
                      docType:"livraison",title:`Bon de réception — ${zone}`,weekLbl:wlFromEntry,
                    });
                  }
                }:undefined;

                return(
                  <HistoryEntry key={entry.id} entry={entry}
                    onDelete={async()=>{await historyAPI.remove(entry.id);setHistEntries(prev=>prev.filter(e=>e.id!==entry.id));}}
                    onDownload={handleDownload}
                    onSend={handleSend}
                  />
                );
              });
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════
   COMPOSANTS — hooks autorisés car fonctions React propres
═══════════════════════════ */
function SaveIndicator({status}){
  const m={idle:{c:"transparent",l:""},saving:{c:G.light,l:"Sauvegarde…"},saved:{c:G.ok,l:"Sauvegardé"},error:{c:G.danger,l:"Erreur"}};
  const{c,l}=m[status]||m.idle;
  if(!l) return null;
  return(
    <div style={{display:"flex",alignItems:"center",gap:4}}>
      <div style={{width:5,height:5,borderRadius:"50%",background:c,animation:status==="saving"?"pulse 1s infinite":"none"}}/>
      <span style={{fontSize:8,letterSpacing:2,color:c,textTransform:"uppercase"}}>{l}</span>
    </div>
  );
}

/* ═══════════════════════════
   ConfigCard — useState ICI, pas dans .map()
═══════════════════════════ */
function ConfigCard({cfg, myAuthor, onRestore}){
  const [showDetail, setShowDetail] = useState(false);
  const isMe = cfg.author === (myAuthor||"Équipe");
  return(
    <div style={{background:"rgba(255,255,255,0.58)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",border:`1px solid ${isMe?"rgba(168,120,70,0.35)":"rgba(168,120,70,0.18)"}`,borderRadius:14,marginBottom:10,overflow:"hidden"}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:10,padding:"14px 16px"}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
            <span style={{fontSize:12,fontWeight:500,color:G.dark}}>{cfg.name}</span>
            {isMe&&<span style={{background:"rgba(154,72,32,0.1)",color:G.copper,fontSize:7,letterSpacing:2,textTransform:"uppercase",padding:"2px 8px",borderRadius:20}}>Ma config</span>}
          </div>
          <div style={{fontSize:9,color:G.light}}>{cfg.author} · {new Date(cfg.savedAt).toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</div>
          <div style={{fontSize:10,color:G.mid,marginTop:4}}>{cfg.totalEq} demi-eq. au total</div>
        </div>
        <div style={{display:"flex",gap:6,flexShrink:0}}>
          <button onClick={()=>setShowDetail(v=>!v)} style={{background:"rgba(255,255,255,0.5)",border:`1px solid ${G.border}`,color:G.mid,padding:"5px 10px",fontSize:11,borderRadius:6,cursor:"pointer",minHeight:"auto",minWidth:"auto"}}>{showDetail?"−":"+"}</button>
          <button onClick={onRestore} style={{background:"none",border:`1px solid ${G.border}`,color:G.copper,padding:"5px 10px",fontSize:9,letterSpacing:1.5,textTransform:"uppercase",borderRadius:6,cursor:"pointer",minHeight:"auto",minWidth:"auto"}}>Restaurer</button>
        </div>
      </div>
      {showDetail&&(
        <div style={{padding:"0 16px 14px",borderTop:`1px solid ${G.border}`}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,marginTop:10}}>
            {RECIPES.filter(r=>totalZ(cfg.inventory?.[r.id]||emptyItem())>0).map(r=>(
              <div key={r.id} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:10,borderBottom:`1px solid ${G.border}`,gap:4}}>
                <span style={{color:G.mid,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{r.name}</span>
                <span style={{color:G.dark,fontWeight:500,flexShrink:0}}>{totalZ(cfg.inventory[r.id]||emptyItem())}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════
   SCAN MODAL — Redesigné v2
   Tesseract OCR local + preprocessing image (grayscale + contrast)
   Dark immersif, viewfinder cuivré, résultat slide-up
═══════════════════════════ */

/** Prétraitement canvas : grayscale + boost contraste × 1.6 pour Tesseract */
function preprocessForOCR(canvas){
  const ctx=canvas.getContext("2d");
  const img=ctx.getImageData(0,0,canvas.width,canvas.height);
  const d=img.data;
  const k=1.6, b=128*(1-k);
  for(let i=0;i<d.length;i+=4){
    const g=Math.round(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]);
    const v=Math.min(255,Math.max(0,g*k+b));
    d[i]=d[i+1]=d[i+2]=v;
  }
  ctx.putImageData(img,0,0);
}

function ScanModal({recipeName, onResult, onClose}){
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  /* mode: start | camera | processing | review | manual | error */
  const [mode,       setMode]      = useState("start");
  const [progress,   setProgress]  = useState(0);
  const [camLoading, setCamLoading]= useState(false);
  const [captured,   setCaptured]  = useState(null);
  const [ocrText,    setOcrText]   = useState("");
  const [fields,     setFields]    = useState({lot:"", dlc:"", fabrique:"", nom:""});
  const [errMsg,     setErrMsg]    = useState("");

  const stopCamera = useCallback(()=>{
    if(streamRef.current){ streamRef.current.getTracks().forEach(t=>t.stop()); streamRef.current=null; }
    const v=videoRef.current; if(v){ v.srcObject=null; }
  },[]);

  /* Cleanup au démontage */
  useEffect(()=>()=>stopCamera(),[]);

  /* ── Démarrage caméra ── */
  const startCamera = async()=>{
    setCamLoading(true);
    try{
      const constraints={video:{
        facingMode:{ideal:"environment"},
        width:{ideal:3840},height:{ideal:2160},
        advanced:[{focusMode:"continuous"},{exposureMode:"continuous"},{whiteBalanceMode:"continuous"}],
      }};
      const stream=await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current=stream;
      const v=videoRef.current;
      v.srcObject=stream;
      await new Promise((res,rej)=>{ v.onloadedmetadata=res; setTimeout(rej,8000,new Error("Timeout caméra")); });
      await v.play();
      setMode("camera");
    }catch(err){
      let msg="Caméra inaccessible. Utilisez la saisie manuelle.";
      if(err.name==="NotAllowedError"||err.name==="PermissionDeniedError") msg="Accès caméra refusé — autorisez dans les réglages du navigateur.";
      else if(err.name==="NotFoundError") msg="Aucune caméra détectée sur cet appareil.";
      setErrMsg(msg); setMode("error");
    }finally{ setCamLoading(false); }
  };

  /* ── Capture + preprocessing + Tesseract OCR ── */
  const capture = useCallback(async()=>{
    const v=videoRef.current; const c=canvasRef.current;
    if(!v?.srcObject||v.videoWidth===0||v.readyState<2) return;
    const scale=Math.min(1,2000/Math.max(v.videoWidth,v.videoHeight,1));
    c.width=Math.round(v.videoWidth*scale);
    c.height=Math.round(v.videoHeight*scale);
    c.getContext("2d").drawImage(v,0,0,c.width,c.height);
    preprocessForOCR(c); // grayscale + boost contraste
    const dataURL=c.toDataURL("image/jpeg",0.95);
    stopCamera(); setCaptured(dataURL); setMode("processing"); setProgress(0);
    let ocrText_="", ocrParsed={};
    try{
      const res=await runTesseract(dataURL,p=>setProgress(p));
      ocrText_=res.text||"";
      ocrParsed=res.parsed||{};
    }catch(err){
      // OCR a échoué → on reste en mode review avec champs vides pour saisie manuelle
      setErrMsg("OCR indisponible ("+err.message+") — remplissez les champs.");
    }
    setOcrText(ocrText_);
    setFields({lot:ocrParsed.lot||"",dlc:ocrParsed.dlc||"",fabrique:ocrParsed.fabrique||"",nom:ocrParsed.nom||""});
    setMode("review");
  },[stopCamera]);

  const confirm=()=>onResult({lot:fields.lot.trim()||null,dlc:fields.dlc||null,fabrique:fields.fabrique||null,nom:fields.nom.trim()||null,ref:null});

  const reset=()=>{
    stopCamera();
    setCaptured(null); setOcrText(""); setFields({lot:"",dlc:"",fabrique:"",nom:""});
    setProgress(0); setErrMsg(""); setMode("start");
  };

  // Design tokens dark — scan immersif
  const D={
    bg:"rgba(8,4,2,0.97)",card:"rgba(18,10,4,0.96)",
    border:"rgba(140,60,16,0.28)",borderActive:"rgba(140,60,16,0.65)",
    copper:G.copper,copperL:G.copperL,
    text:"rgba(250,244,236,0.92)",muted:"rgba(200,170,140,0.52)",
    ok:"#3DAD6A",danger:"#D94040",
  };
  const DField=({label,value,onChange,type="text",placeholder=""})=>(
    <div style={{marginBottom:14}}>
      <div style={{fontSize:8,letterSpacing:2.5,color:D.muted,textTransform:"uppercase",fontWeight:600,marginBottom:6}}>{label}</div>
      <input type={type} value={value} onChange={e=>onChange&&onChange(e.target.value)} placeholder={placeholder}
        style={{width:"100%",padding:"13px 14px",border:`1px solid ${value?D.borderActive:D.border}`,borderRadius:10,
          fontSize:15,fontWeight:value?600:400,background:value?"rgba(255,255,255,0.09)":"rgba(255,255,255,0.05)",
          color:D.text,letterSpacing:.3,minHeight:"auto",transition:"all .18s",outline:"none"}}/>
    </div>
  );

  return(
    <div style={{position:"fixed",inset:0,background:D.bg,zIndex:200,display:"flex",flexDirection:"column"}}>
      {/* canvas + video TOUJOURS dans le DOM */}
      <canvas ref={canvasRef} style={{display:"none"}}/>
      <video ref={videoRef} playsInline muted
        style={{display:mode==="camera"?"block":"none",position:"absolute",top:0,left:0,
          width:"100%",height:"100%",objectFit:"cover",zIndex:0}}/>

      {/* Header */}
      <div style={{position:"relative",zIndex:10,flexShrink:0,
        background:mode==="camera"?"rgba(8,4,2,0.72)":D.card,backdropFilter:"blur(20px)",
        borderBottom:`1px solid ${mode==="camera"?"rgba(140,60,16,0.18)":D.border}`,
        padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:7,letterSpacing:4,color:D.copper,textTransform:"uppercase",marginBottom:3,fontWeight:700}}>OCR · Lecture étiquette</div>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:17,color:D.text,letterSpacing:.2}}>{recipeName||"Carapine"}</div>
        </div>
        <button onClick={()=>{stopCamera();onClose();}}
          style={{background:"rgba(255,255,255,0.07)",border:`1px solid ${D.border}`,color:D.muted,
            padding:"7px 16px",borderRadius:10,cursor:"pointer",fontSize:9,letterSpacing:2,minHeight:"auto",fontWeight:500}}>
          Fermer
        </button>
      </div>

      {/* Contenu */}
      <div style={{flex:1,position:"relative",overflow:"hidden"}}>

        {/* START */}
        {mode==="start"&&(
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
            height:"100%",padding:"32px 24px",gap:22,animation:"fadein .3s ease"}}>
            <div style={{width:76,height:52,border:"2px solid rgba(140,60,16,0.40)",borderRadius:8,position:"relative",flexShrink:0}}>
              {[{top:-2,left:-2,borderTop:`2.5px solid ${D.copper}`,borderLeft:`2.5px solid ${D.copper}`},
                {top:-2,right:-2,borderTop:`2.5px solid ${D.copper}`,borderRight:`2.5px solid ${D.copper}`},
                {bottom:-2,left:-2,borderBottom:`2.5px solid ${D.copper}`,borderLeft:`2.5px solid ${D.copper}`},
                {bottom:-2,right:-2,borderBottom:`2.5px solid ${D.copper}`,borderRight:`2.5px solid ${D.copper}`},
              ].map((s,i)=><div key={i} style={{position:"absolute",width:16,height:16,borderRadius:2,...s}}/>)}
              <div style={{position:"absolute",top:"35%",left:4,right:4,height:2,
                background:`linear-gradient(90deg,transparent,${D.copper},transparent)`,
                animation:"scanbeam 2.2s ease-in-out infinite"}}/>
            </div>
            <div style={{textAlign:"center"}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:300,color:D.text,marginBottom:8}}>Lire l'étiquette carapine</div>
              <div style={{fontSize:11,color:D.muted,lineHeight:1.8,maxWidth:280}}>Pointez la caméra sur l'étiquette — le lot et la DLC sont extraits automatiquement.</div>
            </div>
            <button onClick={startCamera} disabled={camLoading}
              style={{width:"100%",maxWidth:300,
                background:camLoading?"rgba(140,60,16,0.22)":`linear-gradient(135deg,${D.copperL},${D.copper})`,
                border:"none",color:"#fff",borderRadius:14,padding:"17px",
                fontSize:11,fontWeight:700,cursor:camLoading?"wait":"pointer",
                letterSpacing:2.5,textTransform:"uppercase",minHeight:"auto",
                boxShadow:camLoading?"none":"0 8px 28px rgba(140,60,16,0.45)",transition:"all .22s"}}>
              {camLoading?"Démarrage…":"Activer la caméra"}
            </button>
            <button onClick={()=>setMode("manual")}
              style={{background:"none",border:"none",color:D.muted,fontSize:9,letterSpacing:2,
                textTransform:"uppercase",cursor:"pointer",textDecoration:"underline",minHeight:"auto",padding:"4px 0"}}>
              Saisie manuelle
            </button>
          </div>
        )}

        {/* CAMERA */}
        {mode==="camera"&&(
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",zIndex:1}}>
            <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
              <div style={{width:"80%",maxWidth:300,aspectRatio:"5/3",position:"relative"}}>
                <div style={{position:"fixed",inset:0,zIndex:-1,boxShadow:"inset 0 0 0 2000px rgba(0,0,0,0.55)",pointerEvents:"none"}}/>
                <div style={{position:"absolute",inset:0,border:"1.5px solid rgba(140,60,16,0.38)",borderRadius:8}}/>
                {[{top:-2,left:-2,borderTop:`3px solid ${D.copper}`,borderLeft:`3px solid ${D.copper}`},
                  {top:-2,right:-2,borderTop:`3px solid ${D.copper}`,borderRight:`3px solid ${D.copper}`},
                  {bottom:-2,left:-2,borderBottom:`3px solid ${D.copper}`,borderLeft:`3px solid ${D.copper}`},
                  {bottom:-2,right:-2,borderBottom:`3px solid ${D.copper}`,borderRight:`3px solid ${D.copper}`},
                ].map((s,i)=><div key={i} style={{position:"absolute",width:18,height:18,borderRadius:2,...s}}/>)}
                <div style={{position:"absolute",left:4,right:4,height:2,
                  background:`linear-gradient(90deg,transparent,${D.copper},transparent)`,
                  animation:"scanbeam 2.4s ease-in-out infinite",top:0}}/>
                <div style={{position:"absolute",bottom:-34,left:"50%",transform:"translateX(-50%)",
                  whiteSpace:"nowrap",background:"rgba(0,0,0,0.68)",borderRadius:20,padding:"5px 14px"}}>
                  <span style={{fontSize:10,color:"rgba(250,244,236,0.80)",letterSpacing:.5}}>Alignez le texte dans le cadre</span>
                </div>
              </div>
            </div>
            <div style={{flexShrink:0,paddingBottom:36,paddingTop:16,
              background:"linear-gradient(to top,rgba(8,4,2,0.92) 55%,transparent)",
              display:"flex",flexDirection:"column",alignItems:"center",gap:14}}>
              <button onClick={capture}
                style={{width:70,height:70,borderRadius:"50%",background:D.copper,
                  border:"4px solid rgba(255,255,255,0.20)",
                  boxShadow:`0 0 0 2px rgba(140,60,16,0.45), 0 8px 28px rgba(140,60,16,0.55)`,
                  cursor:"pointer",minHeight:"auto",transition:"transform .12s",
                  display:"flex",alignItems:"center",justifyContent:"center"}}
                onMouseDown={e=>{e.currentTarget.style.transform="scale(0.91)";}}
                onMouseUp={e=>{e.currentTarget.style.transform="";}}
                onTouchStart={e=>{e.currentTarget.style.transform="scale(0.91)";}}
                onTouchEnd={e=>{e.currentTarget.style.transform="";capture();}}>
                <div style={{width:26,height:26,borderRadius:"50%",background:"rgba(255,255,255,0.92)"}}/>
              </button>
              <button onClick={()=>{stopCamera();setMode("manual");}}
                style={{background:"none",border:"none",color:"rgba(200,170,140,0.52)",
                  fontSize:9,letterSpacing:2,textTransform:"uppercase",
                  cursor:"pointer",textDecoration:"underline",minHeight:"auto",padding:"4px 0"}}>
                Saisie manuelle
              </button>
            </div>
          </div>
        )}

        {/* PROCESSING */}
        {mode==="processing"&&(
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
            height:"100%",padding:"24px",animation:"fadein .2s ease"}}>
            {captured&&(
              <div style={{width:"100%",maxWidth:300,borderRadius:12,overflow:"hidden",
                border:`1px solid ${D.border}`,marginBottom:24,boxShadow:"0 4px 24px rgba(0,0,0,0.45)"}}>
                <img src={captured} alt="" style={{width:"100%",maxHeight:130,objectFit:"contain",display:"block"}}/>
              </div>
            )}
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,fontWeight:300,color:D.text,marginBottom:4,textAlign:"center"}}>Lecture en cours…</div>
            <div style={{fontSize:9,color:D.muted,letterSpacing:2,textTransform:"uppercase",marginBottom:20,textAlign:"center"}}>OCR local — sans réseau</div>
            <div style={{width:"100%",maxWidth:300,height:3,background:"rgba(140,60,16,0.14)",borderRadius:4,overflow:"hidden",marginBottom:10}}>
              <div style={{height:"100%",borderRadius:4,
                background:`linear-gradient(90deg,${D.copper},${D.copperL})`,
                transition:"width .35s ease",width:`${Math.max(3,progress)}%`,
                boxShadow:"0 0 6px rgba(140,60,16,0.55)"}}/>
            </div>
            <div style={{fontSize:10,color:D.muted,textAlign:"center"}}>
              {progress<10?"Chargement du moteur… (1ère utilisation : ~10s)":progress<90?`${progress}% — Analyse…`:"Finalisation…"}
            </div>
          </div>
        )}

        {/* REVIEW */}
        {mode==="review"&&(
          <div style={{display:"flex",flexDirection:"column",height:"100%",animation:"drawerUp .28s cubic-bezier(.22,1,.36,1)"}}>
            <div style={{flexShrink:0,padding:"12px 20px 10px",borderBottom:`1px solid ${D.border}`,
              display:"flex",alignItems:"center",gap:12}}>
              {captured&&<img src={captured} alt=""
                style={{width:50,height:34,objectFit:"cover",borderRadius:6,border:`1px solid ${D.border}`,flexShrink:0}}/>}
              <div>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:errMsg?D.danger:(fields.lot||fields.dlc)?D.ok:"#555"}}/>
                  <span style={{fontSize:8,letterSpacing:2.5,textTransform:"uppercase",fontWeight:700,
                    color:errMsg?D.danger:(fields.lot||fields.dlc)?D.ok:D.muted}}>
                    {errMsg?"OCR indisponible":(fields.lot||fields.dlc)?"Lu avec succès":"Aucun champ détecté"}
                  </span>
                </div>
                <div style={{fontSize:9,color:D.muted}}>{errMsg?"Remplissez les champs manuellement":"Vérifiez et corrigez si besoin"}</div>
              </div>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"18px 20px 0"}}>
              <DField label="N° de lot" value={fields.lot} onChange={v=>setFields(f=>({...f,lot:v}))} placeholder="Ex : 6218161"/>
              <DField label="DLC" value={fields.dlc} onChange={v=>setFields(f=>({...f,dlc:v}))} type="date"/>
              <DField label="Parfum" value={fields.nom} onChange={v=>setFields(f=>({...f,nom:v}))} placeholder="Ex : Fraises Garriguettes"/>
              {ocrText&&(
                <details style={{marginBottom:14}}>
                  <summary style={{fontSize:8,color:"rgba(200,170,140,0.36)",cursor:"pointer",letterSpacing:1}}>Texte OCR brut</summary>
                  <pre style={{fontSize:8,color:"rgba(200,170,140,0.36)",whiteSpace:"pre-wrap",marginTop:6,maxHeight:70,overflow:"auto",lineHeight:1.4}}>{ocrText}</pre>
                </details>
              )}
            </div>
            <div style={{flexShrink:0,padding:"14px 20px 28px",borderTop:`1px solid ${D.border}`,display:"flex",flexDirection:"column",gap:8}}>
              <button onClick={confirm} disabled={!fields.lot&&!fields.dlc}
                style={{width:"100%",
                  background:(!fields.lot&&!fields.dlc)?"rgba(140,60,16,0.16)":`linear-gradient(135deg,${D.copperL},${D.copper})`,
                  border:"none",color:(!fields.lot&&!fields.dlc)?"rgba(200,170,140,0.28)":"#fff",
                  borderRadius:12,padding:"15px",fontSize:10,letterSpacing:2.5,textTransform:"uppercase",fontWeight:700,
                  minHeight:"auto",cursor:(!fields.lot&&!fields.dlc)?"not-allowed":"pointer",
                  boxShadow:(!fields.lot&&!fields.dlc)?"none":"0 4px 20px rgba(140,60,16,0.45)",transition:"all .18s"}}>
                Confirmer
              </button>
              <button onClick={reset}
                style={{width:"100%",background:"transparent",border:`1px solid ${D.border}`,
                  color:D.muted,borderRadius:12,padding:"12px",fontSize:9,letterSpacing:2,
                  textTransform:"uppercase",fontWeight:500,minHeight:"auto",cursor:"pointer"}}>
                Rescanner
              </button>
            </div>
          </div>
        )}

        {/* ERROR */}
        {mode==="error"&&(
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
            height:"100%",padding:"32px 24px",gap:18,animation:"fadein .25s ease"}}>
            <div style={{width:48,height:48,borderRadius:"50%",background:"rgba(217,64,64,0.10)",
              border:"1px solid rgba(217,64,64,0.30)",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{fontSize:22,color:D.danger,fontWeight:700}}>!</span>
            </div>
            <div style={{fontSize:12,color:D.danger,lineHeight:1.8,textAlign:"center",maxWidth:280}}>{errMsg}</div>
            <div style={{display:"flex",flexDirection:"column",gap:8,width:"100%",maxWidth:300}}>
              <button onClick={reset}
                style={{width:"100%",background:`linear-gradient(135deg,${D.copperL},${D.copper})`,
                  border:"none",color:"#fff",borderRadius:12,padding:"15px",
                  fontSize:10,letterSpacing:2,textTransform:"uppercase",fontWeight:700,minHeight:"auto",cursor:"pointer"}}>
                Réessayer
              </button>
              <button onClick={()=>setMode("manual")}
                style={{width:"100%",background:"transparent",border:`1px solid ${D.border}`,
                  color:D.muted,borderRadius:12,padding:"12px",fontSize:9,letterSpacing:2,
                  textTransform:"uppercase",fontWeight:500,minHeight:"auto",cursor:"pointer"}}>
                Saisie manuelle
              </button>
            </div>
          </div>
        )}

        {/* MANUAL */}
        {mode==="manual"&&(
          <div style={{display:"flex",flexDirection:"column",height:"100%",animation:"fadein .25s ease"}}>
            <div style={{flexShrink:0,padding:"18px 20px 10px",borderBottom:`1px solid ${D.border}`}}>
              <div style={{fontSize:8,letterSpacing:3,color:D.copper,textTransform:"uppercase",fontWeight:700}}>Saisie manuelle</div>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"18px 20px 0"}}>
              <DField label="N° de lot" value={fields.lot} onChange={v=>setFields(f=>({...f,lot:v}))} placeholder="Ex : 6218161"/>
              <DField label="DLC" value={fields.dlc} onChange={v=>setFields(f=>({...f,dlc:v}))} type="date"/>
            </div>
            <div style={{flexShrink:0,padding:"14px 20px 28px",borderTop:`1px solid ${D.border}`,display:"flex",flexDirection:"column",gap:8}}>
              <button onClick={()=>onResult({lot:fields.lot||null,dlc:fields.dlc||null,fabrique:null,nom:null,ref:null})}
                disabled={!fields.lot&&!fields.dlc}
                style={{width:"100%",
                  background:(!fields.lot&&!fields.dlc)?"rgba(140,60,16,0.16)":`linear-gradient(135deg,${D.copperL},${D.copper})`,
                  border:"none",color:(!fields.lot&&!fields.dlc)?"rgba(200,170,140,0.28)":"#fff",
                  borderRadius:12,padding:"15px",fontSize:10,letterSpacing:2.5,textTransform:"uppercase",fontWeight:700,
                  minHeight:"auto",cursor:(!fields.lot&&!fields.dlc)?"not-allowed":"pointer",
                  boxShadow:(!fields.lot&&!fields.dlc)?"none":"0 4px 20px rgba(140,60,16,0.45)"}}>
                Valider
              </button>
              {!captured&&(
                <button onClick={reset}
                  style={{width:"100%",background:"transparent",border:`1px solid ${D.border}`,
                    color:D.muted,borderRadius:12,padding:"12px",fontSize:9,letterSpacing:2,
                    textTransform:"uppercase",fontWeight:500,minHeight:"auto",cursor:"pointer"}}>
                  Ouvrir la caméra
                </button>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function QtyCtrl({val,onChange}){
  const btnStyle={
    width:36,height:36,background:"rgba(255,255,255,0.55)",
    backdropFilter:"blur(8px)",border:`1px solid ${G.border}`,
    color:G.mid,cursor:"pointer",fontSize:20,
    display:"flex",alignItems:"center",justifyContent:"center",
    borderRadius:8,flexShrink:0,minHeight:"auto",minWidth:"auto",
    transition:"all .15s",lineHeight:1,
  };
  return(
    <div style={{display:"flex",alignItems:"center",gap:4}}>
      <button onClick={()=>onChange(val-1)} style={btnStyle}
        onMouseEnter={e=>{e.currentTarget.style.borderColor=G.copper;e.currentTarget.style.color=G.copper;}}
        onMouseLeave={e=>{e.currentTarget.style.borderColor=G.border;e.currentTarget.style.color=G.mid;}}>−</button>
      <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:300,
        color:val===0?"rgba(168,120,70,0.35)":G.dark,width:32,textAlign:"center",userSelect:"none"}}>
        {val}
      </span>
      <button onClick={()=>onChange(val+1)} style={btnStyle}
        onMouseEnter={e=>{e.currentTarget.style.borderColor=G.copper;e.currentTarget.style.color=G.copper;}}
        onMouseLeave={e=>{e.currentTarget.style.borderColor=G.border;e.currentTarget.style.color=G.mid;}}>+</button>
    </div>
  );
}

function HistoryEntry({entry,onDelete,onDownload,onSend}){
  const[exp,setExp]=useState(false);
  const[pdfBusy,setPdfBusy]=useState(false);
  const tC={
    livraison:  {c:"#1E5E32",bg:"rgba(30,94,50,0.08)",  l:"Livraison"},
    commande:   {c:G.copper, bg:"rgba(140,60,16,0.08)", l:"Commande"},
    tracabilite:{c:"#1A3A6A",bg:"rgba(26,58,106,0.08)", l:"Traçabilité"},
    temperature:{c:"#945208",bg:"rgba(148,82,8,0.08)",  l:"Température"},
    inventaire: {c:"#3A3A4A",bg:"rgba(58,58,74,0.07)",  l:"Stock"},
    document:   {c:"#6B3FA0",bg:"rgba(107,63,160,0.08)",l:"Document"},
  };
  const conf=tC[entry.type]||{c:G.mid,bg:"rgba(90,74,56,0.06)",l:entry.type};
  const dateStr=new Date(entry.createdAt).toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
  /* Lignes de détail selon le type */
  const details=[];
  if(entry.type==="livraison"&&entry.data?.delivery)
    RECIPES.filter(r=>{const i=entry.data.delivery[r.id];return i&&(i.demi>0||i.pleine>0);}).forEach(r=>{
      const i=entry.data.delivery[r.id]; const l=entry.data?.lots?.[r.id];
      details.push(`${r.name}: ${i.demi}D${i.pleine>0?` + ${i.pleine}P`:""}${i.temp!=null?` · ${i.temp}°C`:""}${l?.lot?` — Lot ${l.lot}`:""}${l?.dlc?` — DLC ${fmtDate(l.dlc)}`:""}`)});
  if(entry.type==="commande"&&entry.data?.c1)
    RECIPES.filter(r=>entry.data.c1[r.id]?.totalEq>0).forEach(r=>
      details.push(`${r.name}: ${entry.data.c1[r.id].demi}D + ${entry.data.c1[r.id].pleine}P`));
  if(entry.type==="tracabilite"&&entry.data){
    const d=entry.data;
    details.push(`Parfum : ${d.name||"—"}`);
    if(d.zone) details.push(`Zone : ${ZONES.find(z=>z.id===d.zone)?.label||d.zone}`);
    if(d.lot)  details.push(`Lot : ${d.lot}`);
    if(d.dlc)  details.push(`DLC : ${fmtDate(d.dlc)}`);
    if(d.miseEnPlace) details.push(`Mise en place : ${fmtDate(d.miseEnPlace)}`);
    if(d.retrait)     details.push(`Retrait : ${fmtDate(d.retrait)}`);
  }
  if(entry.type==="inventaire"&&entry.data){
    details.push(`Total : ${entry.data.totalGl} demi-équivalents`);
    (entry.data.summary||[]).slice(0,8).forEach(r=>details.push(`${r.name} : ${r.total} (${r.demi}D + ${r.pleine}P)`));
    if((entry.data.summary||[]).length>8) details.push(`… et ${entry.data.summary.length-8} autres`);
  }
  if(entry.type==="temperature"&&entry.data){
    const d=entry.data;
    if(d.nom)   details.push(`Produit : ${d.nom}${d.format?" — "+d.format:""}`);
    if(d.lot)   details.push(`Lot : ${d.lot}`);
    if(d.temp!==null&&d.temp!==undefined) details.push(`Température : ${d.temp}°C${d.alert?" — HORS NORME":""}`);
    if(d.heure) details.push(`Heure : ${d.heure}`);
  }
  if(entry.type==="document"&&entry.data){
    const d=entry.data;
    if(d.typeLabel) details.push(`Type : ${d.typeLabel}`);
    if(d.title)     details.push(`Titre : ${d.title}`);
    details.push(`Destination : ${d.destination==="adjoint"?"Espace Production":"Espace Responsable"}`);
    if(d.week)      details.push(`Semaine : ${d.week}`);
  }
  const hasDetail=details.length>0||entry.data?.aiText;
  const ap=getAvatarProfile(entry.author||"Équipe");

  return(
    <div style={{background:"rgba(255,255,255,0.55)",backdropFilter:"blur(16px)",
      border:`1px solid ${G.border}`,borderRadius:14,marginBottom:10,overflow:"hidden",
      transition:"box-shadow .2s",animation:"slidein .25s ease both"}}>
      <div style={{display:"flex",alignItems:"center",padding:"12px 14px",gap:10}}>
        <AvatarDisplay name={entry.author||"?"} color={ap.color} shape={ap.shape} anim="none" size={34}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2,flexWrap:"wrap"}}>
            <span style={{background:conf.bg,color:conf.c,fontSize:8,padding:"2px 8px",borderRadius:10,fontWeight:600,whiteSpace:"nowrap"}}>{conf.l}</span>
            <span style={{fontSize:11,color:G.dark,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{entry.label}</span>
          </div>
          <div style={{fontSize:9,color:G.light}}>
            <span style={{fontWeight:500,color:G.mid}}>{entry.author}</span>
            {" · "}{dateStr}
          </div>
        </div>
        <div style={{display:"flex",gap:5,flexShrink:0,flexWrap:"wrap",justifyContent:"flex-end"}}>
          {onDownload&&(
            <button disabled={pdfBusy} onClick={async()=>{setPdfBusy(true);try{await onDownload();}finally{setPdfBusy(false);}}}
              style={{background:`rgba(140,60,16,0.08)`,border:`1px solid rgba(140,60,16,0.25)`,color:G.copper,
                padding:"5px 10px",fontSize:9,fontWeight:600,borderRadius:6,cursor:"pointer",minHeight:"auto",minWidth:"auto",
                opacity:pdfBusy?.5:1}}>
              {pdfBusy?"…":"PDF"}
            </button>
          )}
          {onSend&&(
            <button disabled={pdfBusy} onClick={onSend}
              style={{background:"rgba(255,255,255,0.5)",border:`1px solid ${G.border}`,color:G.mid,
                padding:"5px 10px",fontSize:9,fontWeight:600,borderRadius:6,cursor:"pointer",minHeight:"auto",minWidth:"auto"}}>
              Envoyer
            </button>
          )}
          {hasDetail&&<button onClick={()=>setExp(v=>!v)} style={{background:"rgba(255,255,255,0.5)",border:`1px solid ${G.border}`,color:G.mid,padding:"5px 10px",fontSize:11,borderRadius:6,cursor:"pointer",minHeight:"auto",minWidth:"auto"}}>{exp?"−":"+"}</button>}
          <button onClick={onDelete} style={{background:"rgba(255,255,255,0.5)",border:`1px solid ${G.border}`,color:G.danger,padding:"5px 10px",fontSize:12,borderRadius:6,cursor:"pointer",minHeight:"auto",minWidth:"auto"}}>×</button>
        </div>
      </div>
      {exp&&<div style={{padding:"0 14px 14px",borderTop:`1px solid ${G.border}`}}>
        {details.map((l,i)=><div key={i} style={{fontSize:11,color:G.mid,padding:"5px 0",borderBottom:`1px solid ${G.border}`,display:"flex",gap:8}}>
          <span style={{width:4,background:conf.c,borderRadius:2,flexShrink:0,alignSelf:"stretch"}}/>
          {l}
        </div>)}
        {entry.data?.aiText&&<div style={{marginTop:10,padding:"10px",background:"rgba(255,255,255,0.4)",borderRadius:8,fontSize:10,lineHeight:1.7,color:G.mid,whiteSpace:"pre-wrap"}}>{entry.data.aiText}</div>}
      </div>}
    </div>
  );
}

/* ═══════════════════════════
   AVATAR — Composant réutilisable + customisation complète
═══════════════════════════ */

/* 18 couleurs thématiques — chocolats, fruits, terroir */
const AVATAR_COLORS=[
  /* Chocolats & épices */
  {hex:"#8C3C10",n:"Cuivre"},  {hex:"#5C2808",n:"Cacao"},   {hex:"#A06828",n:"Caramel"},
  {hex:"#3C1A08",n:"Praliné"}, {hex:"#784010",n:"Cannelle"},{hex:"#C47C3A",n:"Miel"},
  /* Fruits & sorbets */
  {hex:"#8A1030",n:"Framboise"},{hex:"#5A1018",n:"Cerise"},  {hex:"#24468A",n:"Myrtille"},
  {hex:"#1A6A3A",n:"Menthe"},  {hex:"#4A6A20",n:"Pistache"},{hex:"#3A7A10",n:"Citron vert"},
  /* Terroir & minéraux */
  {hex:"#1A3A6A",n:"Marine"},  {hex:"#1E5E32",n:"Forêt"},   {hex:"#1A585A",n:"Océan"},
  {hex:"#5A1E6A",n:"Violet"},  {hex:"#3A3A4A",n:"Ardoise"}, {hex:"#202020",n:"Obsidienne"},
];

const AVATAR_SHAPES=[
  {id:"circle",label:"Rond",   r:"50%"},
  {id:"square",label:"Carré",  r:"22%"},
  {id:"shield",label:"Blason", r:"50% 50% 46% 46% / 56% 56% 44% 44%"},
];

const AVATAR_ANIMS=[
  {id:"none",   label:"Fixe",      css:"none"},
  {id:"breathe",label:"Respire",   css:"breathe 2.4s ease infinite"},
  {id:"bounce", label:"Rebondit",  css:"bounce 1.9s ease infinite"},
];

/* Composant réutilisable dans tout l'app */
function AvatarDisplay({name,color="#8C3C10",shape="circle",anim="breathe",size=38,onClick,style={}}){
  const initial=(name||"?").charAt(0).toUpperCase();
  const br=AVATAR_SHAPES.find(s=>s.id===shape)?.r||"50%";
  const an=AVATAR_ANIMS.find(a=>a.id===anim)?.css||"none";
  return(
    <div onClick={onClick} style={{
      width:size,height:size,borderRadius:br,flexShrink:0,
      background:`linear-gradient(135deg,${color}cc,${color})`,
      display:"flex",alignItems:"center",justifyContent:"center",
      animation:an,
      boxShadow:`0 2px 10px ${color}44`,
      cursor:onClick?"pointer":"default",
      transition:"border-radius .3s,background .35s,box-shadow .3s",
      ...style}}>
      <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:size*.44,
        fontWeight:300,color:"rgba(255,255,255,0.95)",lineHeight:1,
        transition:"font-size .2s"}}>
        {initial}
      </span>
    </div>
  );
}

/* Récupère le profil avatar d'un auteur depuis localStorage */
const getAvatarProfile=(name)=>({
  color:localStorage.getItem(`gl_avatar_color_${name}`)||G.copper,
  shape:localStorage.getItem(`gl_avatar_shape_${name}`)||"circle",
  anim: localStorage.getItem(`gl_avatar_anim_${name}`)||"none",
});

/* ── Onboarding 3 étapes ── */
function OnboardingModal({onDone,initName="",initColor="#8C3C10",initShape="circle",initAnim="breathe"}){
  const [name,  setName]  = useState(initName);
  const [color, setColor] = useState(initColor);
  const [shape, setShape] = useState(initShape);
  const [anim,  setAnim]  = useState(initAnim);
  const [step,  setStep]  = useState(initName?2:1);
  const initial=name.trim().charAt(0).toUpperCase()||"?";
  const br=AVATAR_SHAPES.find(s=>s.id===shape)?.r||"50%";
  const an=AVATAR_ANIMS.find(a=>a.id===anim)?.css||"none";

  /* Mini preview live dans le header des étapes 2-3 */
  const MiniPreview=()=>(
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:24,padding:"12px 16px",
      background:"rgba(255,251,246,0.6)",borderRadius:14,border:`1px solid ${G.border}`}}>
      <div style={{width:44,height:44,borderRadius:br,flexShrink:0,
        background:`linear-gradient(135deg,${color}cc,${color})`,
        display:"flex",alignItems:"center",justifyContent:"center",
        animation:an,boxShadow:`0 3px 12px ${color}44`,transition:"all .35s"}}>
        <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:300,color:"#fff",lineHeight:1}}>
          {initial}
        </span>
      </div>
      <div>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:16,color:G.dark}}>{name||"Ton prénom"}</div>
        <div style={{fontSize:9,color:G.light}}>Équipe Manufacture de Glace</div>
      </div>
    </div>
  );

  /* Indicateur de progression */
  const Steps=()=>(
    <div style={{display:"flex",gap:6,justifyContent:"center",marginBottom:28}}>
      {[1,2,3].map(i=>(
        <div key={i} style={{height:3,borderRadius:2,transition:"all .3s",
          background:i<=step?G.copper:"rgba(140,60,16,0.15)",
          width:i===step?28:16}}/>
      ))}
    </div>
  );

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(12,6,2,0.97)",backdropFilter:"blur(20px)",
      zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px",overflowY:"auto"}}>
      <div style={{background:G.glassS,backdropFilter:G.blur,border:`1px solid ${G.border}`,
        borderRadius:24,padding:"36px 28px",maxWidth:400,width:"100%",
        animation:"appear .4s ease both",boxShadow:G.shadowL}}>

        <Steps/>

        {/* ── ÉTAPE 1 : Prénom ── */}
        {step===1&&(
          <div style={{animation:"fadein .3s ease"}}>
            <div style={{textAlign:"center",marginBottom:32}}>
              <div style={{fontSize:7,letterSpacing:6,color:G.copper,textTransform:"uppercase",marginBottom:10,fontWeight:600}}>Alain Ducasse</div>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,fontWeight:300,color:G.dark,marginBottom:6}}>Bienvenue</div>
              <div style={{fontSize:11,color:G.light,lineHeight:1.6}}>Manufacture de Glace · Paris</div>
            </div>
            <div style={{fontSize:12,color:G.mid,fontWeight:500,marginBottom:10}}>Comment tu t'appelles ?</div>
            <input value={name} onChange={e=>setName(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&name.trim()&&setStep(2)}
              placeholder="Ton prénom" autoFocus
              style={{width:"100%",padding:"16px",border:`1.5px solid ${name?G.borderS:G.border}`,
                borderRadius:14,fontSize:22,fontWeight:500,background:"rgba(255,251,246,0.7)",
                color:G.dark,minHeight:"auto",marginBottom:20,textAlign:"center",transition:"all .2s"}}/>
            <button onClick={()=>name.trim()&&setStep(2)} disabled={!name.trim()}
              style={{width:"100%",
                background:name.trim()?`linear-gradient(135deg,${G.copperL},${G.copper})`:"rgba(140,60,16,0.08)",
                border:"none",color:name.trim()?"#fff":G.light,borderRadius:14,padding:"16px",
                fontSize:13,fontWeight:600,cursor:name.trim()?"pointer":"not-allowed",minHeight:"auto",
                boxShadow:name.trim()?"0 6px 24px rgba(140,60,16,0.35)":"none",transition:"all .25s"}}>
              Suivant
            </button>
          </div>
        )}

        {/* ── ÉTAPE 2 : Couleur ── */}
        {step===2&&(
          <div style={{animation:"fadein .3s ease"}}>
            <MiniPreview/>
            <div style={{fontSize:12,color:G.mid,fontWeight:600,marginBottom:4}}>Choisis ta couleur</div>
            <div style={{fontSize:10,color:G.light,marginBottom:16}}>3 familles : chocolats · sorbets · terroir</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:9,marginBottom:24}}>
              {AVATAR_COLORS.map((c,i)=>(
                <button key={c.hex} onClick={()=>setColor(c.hex)} title={c.n}
                  style={{width:"100%",aspectRatio:"1",borderRadius:"50%",background:c.hex,
                    border:`3px solid ${color===c.hex?"#fff":"transparent"}`,
                    outline:`2px solid ${color===c.hex?c.hex:"transparent"}`,
                    cursor:"pointer",transition:"all .18s",minHeight:"auto",minWidth:"auto",
                    transform:color===c.hex?"scale(1.25)":"scale(1)",
                    boxShadow:color===c.hex?`0 4px 16px ${c.hex}77`:"none",
                    animation:i<6?"slidein .2s ease both":"none",
                    animationDelay:`${(i%6)*0.04}s`}}/>
              ))}
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setStep(1)} style={{flex:1,background:"rgba(255,251,246,0.5)",border:`1px solid ${G.border}`,color:G.mid,borderRadius:12,padding:"12px",fontSize:11,cursor:"pointer",minHeight:"auto"}}>Retour</button>
              <button onClick={()=>setStep(3)} style={{flex:2,background:`linear-gradient(135deg,${G.copperL},${G.copper})`,border:"none",color:"#fff",borderRadius:12,padding:"12px",fontSize:12,fontWeight:600,cursor:"pointer",minHeight:"auto",boxShadow:"0 4px 18px rgba(140,60,16,0.3)"}}>Suivant</button>
            </div>
          </div>
        )}

        {/* ── ÉTAPE 3 : Forme + Animation ── */}
        {step===3&&(
          <div style={{animation:"fadein .3s ease"}}>
            <MiniPreview/>
            {/* Forme */}
            <div style={{fontSize:12,color:G.mid,fontWeight:600,marginBottom:12}}>Forme de l'avatar</div>
            <div style={{display:"flex",gap:10,marginBottom:22}}>
              {AVATAR_SHAPES.map(s=>(
                <button key={s.id} onClick={()=>setShape(s.id)}
                  style={{flex:1,padding:"14px 8px",border:`2px solid ${shape===s.id?G.copper:G.border}`,
                    borderRadius:10,background:shape===s.id?"rgba(140,60,16,0.08)":"rgba(255,251,246,0.5)",
                    cursor:"pointer",minHeight:"auto",transition:"all .18s",
                    boxShadow:shape===s.id?"0 2px 10px rgba(140,60,16,0.2)":"none"}}>
                  {/* Mini preview de la forme */}
                  <div style={{width:36,height:36,margin:"0 auto 8px",
                    background:`linear-gradient(135deg,${color}cc,${color})`,
                    borderRadius:s.r,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:"#fff",fontWeight:300}}>{initial}</span>
                  </div>
                  <div style={{fontSize:10,color:shape===s.id?G.copper:G.mid,fontWeight:shape===s.id?600:400}}>{s.label}</div>
                </button>
              ))}
            </div>
            {/* Animation */}
            <div style={{fontSize:12,color:G.mid,fontWeight:600,marginBottom:12}}>Animation</div>
            <div style={{display:"flex",gap:8,marginBottom:24}}>
              {AVATAR_ANIMS.map(a=>(
                <button key={a.id} onClick={()=>setAnim(a.id)}
                  style={{flex:1,padding:"10px",border:`2px solid ${anim===a.id?G.copper:G.border}`,
                    borderRadius:10,background:anim===a.id?"rgba(140,60,16,0.08)":"rgba(255,251,246,0.5)",
                    cursor:"pointer",minHeight:"auto",transition:"all .18s"}}>
                  {/* Mini avatar animé */}
                  <div style={{width:30,height:30,margin:"0 auto 6px",borderRadius:AVATAR_SHAPES.find(s=>s.id===shape)?.r||"50%",
                    background:`linear-gradient(135deg,${color}cc,${color})`,
                    animation:a.css,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:14,color:"#fff"}}>{initial}</span>
                  </div>
                  <div style={{fontSize:9,color:anim===a.id?G.copper:G.mid,fontWeight:anim===a.id?600:400}}>{a.label}</div>
                </button>
              ))}
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setStep(2)} style={{flex:1,background:"rgba(255,251,246,0.5)",border:`1px solid ${G.border}`,color:G.mid,borderRadius:12,padding:"12px",fontSize:11,cursor:"pointer",minHeight:"auto"}}>Retour</button>
              <button onClick={()=>onDone({name:name.trim(),color,shape,anim})}
                style={{flex:2,background:`linear-gradient(135deg,${G.copperL},${G.copper})`,border:"none",
                  color:"#fff",borderRadius:12,padding:"14px",fontSize:13,fontWeight:600,
                  cursor:"pointer",minHeight:"auto",boxShadow:"0 6px 24px rgba(140,60,16,0.35)",
                  animation:"glow 2.5s ease infinite"}}>
                C'est parti !
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════
   LOGIN SCREEN
═══════════════════════════ */
function LoginScreen({onLogin}){
  const[id,setId]=useState("");
  const[pw,setPw]=useState("");
  const[err,setErr]=useState("");
  const[loading,setLoading]=useState(false);

  const login=async()=>{
    if(!id||!pw) return;
    setLoading(true); setErr("");
    try{
      const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,password:pw})});
      const d=await r.json();
      if(!r.ok){setErr(d.error||"Erreur de connexion");setLoading(false);return;}
      onLogin(d.user);
    }catch{
      setErr("Impossible de joindre le serveur — réessayez.");
      setLoading(false);
    }
  };

  const iStyle={
    width:"100%",padding:"14px 16px",
    border:`1.5px solid ${G.border}`,borderRadius:12,
    fontSize:16,background:"rgba(255,251,246,0.7)",color:G.dark,
    minHeight:"auto",transition:"all .2s",
  };

  return(
    <div style={{minHeight:"100vh",background:G.bg,backgroundAttachment:"fixed",
      display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:"'Inter',sans-serif"}}>
      <div style={{background:G.glassS,backdropFilter:G.blur,WebkitBackdropFilter:G.blur,
        border:`1px solid ${G.border}`,borderRadius:24,padding:"44px 32px",
        maxWidth:400,width:"100%",boxShadow:G.shadowL,animation:"appear .4s ease both"}}>

        {/* Branding */}
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={{fontSize:7,letterSpacing:6,color:G.copper,textTransform:"uppercase",marginBottom:10,fontWeight:600}}>Alain Ducasse</div>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:34,fontWeight:300,color:G.dark,marginBottom:6,letterSpacing:.3}}>
            Manufacture de Glace
          </div>
          <div style={{fontSize:11,color:G.light}}>Espace équipe — connexion requise</div>
        </div>

        {/* Champ identifiant */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:10,fontWeight:600,color:G.light,marginBottom:6}}>Identifiant</div>
          <input value={id} onChange={e=>setId(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&login()}
            placeholder="votre.identifiant"
            autoFocus autoCapitalize="none"
            style={iStyle}/>
        </div>

        {/* Champ mot de passe */}
        <div style={{marginBottom:22}}>
          <div style={{fontSize:10,fontWeight:600,color:G.light,marginBottom:6}}>Mot de passe</div>
          <input type="password" value={pw} onChange={e=>setPw(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&login()}
            placeholder="••••••••"
            style={iStyle}/>
        </div>

        {/* Erreur */}
        {err&&(
          <div style={{background:G.dangerBg,border:`1px solid rgba(122,16,8,0.2)`,
            borderRadius:10,padding:"10px 14px",fontSize:11,color:G.danger,
            marginBottom:18,lineHeight:1.5}}>
            {err}
          </div>
        )}

        {/* Bouton connexion */}
        <button onClick={login} disabled={loading||!id||!pw}
          style={{width:"100%",
            background:(loading||!id||!pw)?G.faint:`linear-gradient(135deg,${G.copperL},${G.copper})`,
            border:"none",
            color:(loading||!id||!pw)?G.light:"#fff",
            borderRadius:14,padding:"16px",fontSize:13,fontWeight:600,
            cursor:(loading||!id||!pw)?"not-allowed":"pointer",minHeight:"auto",
            boxShadow:(loading||!id||!pw)?"none":"0 6px 24px rgba(140,60,16,0.35)",
            transition:"all .25s"}}>
          {loading?"Connexion en cours…":"Se connecter"}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════
   MODAL — Choix de destination document
═══════════════════════════ */
function SendDocModal({docType, onSend, onCancel}){
  const typeLabels={livraison:"Bon de réception",inventaire:"État des stocks",tracabilite:"Fiche traçabilité",commande:"Bon de commande"};
  return(
    <div style={{position:"fixed",inset:0,zIndex:900,display:"flex",alignItems:"center",justifyContent:"center",
      background:"rgba(16,10,4,0.75)",backdropFilter:"blur(12px)",padding:20,animation:"fadein .18s ease"}}>
      <div style={{background:"rgba(255,251,246,0.99)",borderRadius:22,padding:"36px 28px",maxWidth:400,width:"100%",
        boxShadow:"0 32px 80px rgba(0,0,0,0.22)",border:`1px solid ${G.border}`}}>

        {/* En-tête */}
        <div style={{marginBottom:28,paddingBottom:20,borderBottom:`1px solid ${G.border}`}}>
          <div style={{fontSize:8,letterSpacing:4,color:G.copper,textTransform:"uppercase",marginBottom:10}}>
            Destination
          </div>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,fontWeight:300,color:G.dark,marginBottom:6,lineHeight:1.2}}>
            Envoyer le document
          </div>
          <div style={{fontSize:11,color:G.light}}>
            {typeLabels[docType]||"Document"}
          </div>
        </div>

        {/* Choix */}
        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:24}}>

          <button onClick={()=>onSend("responsable")}
            style={{display:"flex",alignItems:"center",justifyContent:"space-between",
              padding:"18px 20px",
              background:"rgba(168,82,46,0.04)",
              border:`1.5px solid ${G.copper}`,borderRadius:14,cursor:"pointer",
              transition:"all .18s",textAlign:"left",width:"100%",minHeight:"auto"}}>
            <div>
              <div style={{fontSize:8,letterSpacing:3,color:G.copper,textTransform:"uppercase",marginBottom:5}}>Responsable</div>
              <div style={{fontSize:11,color:G.light,lineHeight:1.4}}>Livraisons, commandes, stocks, traçabilité</div>
            </div>
            <div style={{width:6,height:6,borderRadius:"50%",background:G.copper,flexShrink:0,marginLeft:12}}/>
          </button>

          <button onClick={()=>onSend("adjoint")}
            style={{display:"flex",alignItems:"center",justifyContent:"space-between",
              padding:"18px 20px",
              background:"rgba(58,58,74,0.04)",
              border:"1.5px solid #3A3A4A",borderRadius:14,cursor:"pointer",
              transition:"all .18s",textAlign:"left",width:"100%",minHeight:"auto"}}>
            <div>
              <div style={{fontSize:8,letterSpacing:3,color:"#3A3A4A",textTransform:"uppercase",marginBottom:5}}>Production</div>
              <div style={{fontSize:11,color:G.light,lineHeight:1.4}}>Adjoint de prod — états de stocks uniquement</div>
            </div>
            <div style={{width:6,height:6,borderRadius:"50%",background:"#3A3A4A",flexShrink:0,marginLeft:12}}/>
          </button>
        </div>

        <button onClick={onCancel}
          style={{width:"100%",padding:"12px",border:`1px solid ${G.border}`,borderRadius:12,
            background:"transparent",color:G.light,fontSize:11,cursor:"pointer",minHeight:"auto",
            letterSpacing:.5}}>
          Annuler
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════
   CAISSE DU JOUR
═══════════════════════════ */
function CaisseTab({showToast}){
  const todayKey=()=>`ad9_caisse_${new Date().toISOString().split("T")[0]}`;
  const todayFr=new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});

  const[cart,setCart]    =useState([]);
  const[txs,setTxs]      =useState([]);
  const[pdfBusy,setPdfBusy]=useState(false);
  const[cashMode,setCashMode]=useState(false);
  const[cashGiven,setCashGiven]=useState("");

  /* ── Export CSV avec TVA (séparateur ; + BOM UTF-8 pour Excel/Gourmet ERP) ── */
  const downloadCSV=txsList=>{
    const today=new Date().toISOString().split("T")[0];
    const header="Date;Heure;Mode reglement;Montant TTC;Base HT 5,5%;TVA 5,5%;Base HT 10%;TVA 10%;Monnaie rendue;Articles";
    const rows=txsList.map(tx=>{
      const tvaMap=computeTVA([tx]);
      const ht55=tvaMap[5.5]?.ht??0; const t55=tvaMap[5.5]?.tva??0;
      const ht10=tvaMap[10]?.ht??0;  const t10=tvaMap[10]?.tva??0;
      const items=tx.items.map(i=>`${i.name}${i.qty>1?` x${i.qty}`:""}`).join(" | ");
      const c=(v)=>v.toFixed(2).replace(".",",");
      return[today,tx.time,tx.payment,c(tx.total),c(ht55),c(t55),c(ht10),c(t10),
        tx.change!=null?c(tx.change):"",`"${items}"`].join(";");
    });
    const csv="﻿"+[header,...rows].join("\r\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));
    const a=Object.assign(document.createElement("a"),{href:url,download:`Caisse_${today}.csv`});
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),5000);
  };

  /* ── Export Z-Ticket (calqué sur le format clôture Gourmet ERP) ── */
  const downloadZticket=txsList=>{
    const now=new Date();
    const dateStr=now.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
    const timeStr=now.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});
    const today=now.toISOString().split("T")[0];
    const vCB=txsList.filter(t=>t.payment==="CB");
    const vAM=txsList.filter(t=>t.payment==="AMEX");
    const vES=txsList.filter(t=>t.payment==="Especes");
    const tCB=vCB.reduce((s,t)=>s+t.total,0);
    const tAM=vAM.reduce((s,t)=>s+t.total,0);
    const tES=vES.reduce((s,t)=>s+t.total,0);
    const tAL=+(tCB+tAM+tES).toFixed(2);
    const tEnc=vES.reduce((s,t)=>s+(t.given||t.total),0);
    const tRen=vES.reduce((s,t)=>s+(t.change||0),0);
    const tva=computeTVA(txsList);
    const f=v=>`${v.toFixed(2).replace(".",",")} EUR`;
    const p=(s,n)=>String(s).padEnd(n);
    const r=(s,n)=>String(s).padStart(n);
    const sep="=".repeat(48);
    const sep2="-".repeat(48);
    const lig=(lab,nb,tot)=>`${p(lab,22)}${p(nb>0?`${nb} vente${nb>1?"s":""}`:"-",12)}${r(f(tot),14)}`;

    // Lignes TVA
    const tvaLines=Object.entries(tva).sort(([a],[b])=>+a-+b).map(([rate,v])=>
      `${p(`TVA ${rate} %`,22)}  ${p(`Base HT : ${f(v.ht)}`,26)}  ${r(f(v.tva),12)}`
    );
    const totHT=Object.values(tva).reduce((s,v)=>s+v.ht,0);
    const totTVA=Object.values(tva).reduce((s,v)=>s+v.tva,0);

    const lines=[
      sep,
      "        TICKET DE CLOTURE Z",
      "    ALAIN DUCASSE - MANUFACTURE DE GLACE",
      sep,
      "",
      `Date             : ${dateStr}`,
      `Heure de cloture : ${timeStr}`,
      `Reference Z      : Z-${today.replace(/-/g,"")}`,
      "",
      sep2,
      "  MODES DE REGLEMENT",
      sep2,
      "",
      lig("Carte bancaire (CB)",vCB.length,tCB),
      lig("American Express",   vAM.length,tAM),
      lig("Especes",            vES.length,tES),
      "",
      `${p("TOTAL DE LA CAISSE",22)}${p(`${txsList.length} vente${txsList.length>1?"s":""}`,12)}${r(f(tAL),14)}`,
      "",
      sep2,
      "  DETAIL ESPECES",
      sep2,
      "",
      `${p("Montant theorique :",36)}${r(f(tES),12)}`,
      `${p("Total encaisse :",  36)}${r(f(tEnc),12)}`,
      `${p("Monnaie rendue :",  36)}${r(f(tRen),12)}`,
      "",
      sep2,
      "  DETAIL T.V.A.",
      sep2,
      "",
      ...tvaLines,
      "",
      `${p("Total H.T. :",36)}${r(f(totHT),12)}`,
      `${p("Total T.V.A. :",36)}${r(f(totTVA),12)}`,
      `${p("Total T.T.C. :",36)}${r(f(tAL),12)}`,
      "",
      sep2,
      "  DETAIL DES TRANSACTIONS",
      sep2,
      "",
      ...txsList.map(tx=>{
        const it=tx.items.map(i=>`${i.name}${i.qty>1?` x${i.qty}`:""}`).join(", ");
        const ch=tx.change>0?` (rendu ${f(tx.change)})`:"";
        return`${tx.time}  ${p(tx.payment,14)} ${r(f(tx.total),12)}${ch}\n        ${it}`;
      }),
      "",
      sep,
      `  Etabli le ${now.toLocaleDateString("fr-FR")} a ${timeStr}`,
      "  OutilGlaceAD - Manufacture de Glace",
      sep,
    ];
    const blob=new Blob([lines.join("\n")],{type:"text/plain;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=Object.assign(document.createElement("a"),{href:url,download:`Z-Ticket_${today}.txt`});
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),5000);
  };

  useEffect(()=>{
    (async()=>{try{const r=await storage.get(todayKey());if(r?.value)setTxs(JSON.parse(r.value));}catch{}}
    )();
  },[]);

  const saveTxs=async list=>{try{await storage.set(todayKey(),JSON.stringify(list));}catch{}};

  const addItem=item=>setCart(prev=>{
    const ex=prev.find(i=>i.id===item.id);
    if(ex)return prev.map(i=>i.id===item.id?{...i,qty:i.qty+1}:i);
    return[...prev,{...item,qty:1}];
  });
  const removeItem=id=>setCart(prev=>{
    const ex=prev.find(i=>i.id===id);if(!ex)return prev;
    if(ex.qty<=1)return prev.filter(i=>i.id!==id);
    return prev.map(i=>i.id===id?{...i,qty:i.qty-1}:i);
  });

  const cartTotal=cart.reduce((s,i)=>s+i.price*i.qty,0);
  const fmt=v=>`${v.toFixed(2).replace(".",",")} €`;

  // Rendu monnaie
  const given=parseFloat(String(cashGiven).replace(",","."))||0;
  const change=+(given-cartTotal).toFixed(2);
  const changeOk=given>=cartTotal&&given>0;

  const confirmSale=async(payment,givenAmt)=>{
    if(!cart.length)return;
    const tx={
      id:Date.now().toString(),
      items:cart.map(i=>({id:i.id,name:i.name,price:i.price,qty:i.qty})),
      total:cartTotal,
      payment,
      ...(givenAmt!=null?{given:givenAmt,change:+(givenAmt-cartTotal).toFixed(2)}:{}),
      time:new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}),
    };
    const next=[tx,...txs];
    setTxs(next);setCart([]);setCashMode(false);setCashGiven("");
    await saveTxs(next);
    showToast(`Vente reglee - ${fmt(cartTotal)} - ${payment}`);
  };

  const deleteTx=async id=>{const next=txs.filter(t=>t.id!==id);setTxs(next);await saveTxs(next);};

  const totCB  =txs.filter(t=>t.payment==="CB").reduce((s,t)=>s+t.total,0);
  const totAMEX=txs.filter(t=>t.payment==="AMEX").reduce((s,t)=>s+t.total,0);
  const totEsp =txs.filter(t=>t.payment==="Especes").reduce((s,t)=>s+t.total,0);
  const totDay =totCB+totAMEX+totEsp;

  const cats=[...new Set(CAISSE_ITEMS.map(i=>i.cat))];
  const BILLS=[5,10,20,50,100,200];
  const quickBills=BILLS.filter(b=>b>=cartTotal).slice(0,4);

  /* ── Styles réutilisables ── */
  const rowSep={paddingBottom:10,marginBottom:10,borderBottom:`1px solid ${G.border}`};
  const circleBtn=(bg,col)=>({width:28,height:28,borderRadius:"50%",background:bg,border:bg==="none"?`1px solid ${G.border}`:"none",cursor:"pointer",fontSize:15,color:col,display:"flex",alignItems:"center",justifyContent:"center",minHeight:"auto",lineHeight:1,flexShrink:0});

  return(
    <div style={{animation:"fadein .25s ease"}}>

      {/* ── Totaux du jour ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:22,paddingBottom:18,borderBottom:`1px solid ${G.border}`}}>
        {[{l:"CB",v:totCB,c:"#1A3A6A"},{l:"AMEX",v:totAMEX,c:"#1E5E32"},{l:"Especes",v:totEsp,c:"#945208"},{l:"Total",v:totDay,c:G.copper}].map(s=>(
          <div key={s.l} style={{textAlign:"center",padding:"10px 4px",borderRadius:10,background:`${s.c}08`,border:`1px solid ${s.c}18`}}>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:15,fontWeight:300,color:s.c,lineHeight:1,marginBottom:3}}>{fmt(s.v)}</div>
            <div style={{fontSize:7,letterSpacing:1.5,color:G.light,textTransform:"uppercase"}}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* ── Produits ── */}
      {cats.map(cat=>(
        <div key={cat} style={{marginBottom:16}}>
          <div style={{fontSize:7,letterSpacing:3,color:G.light,textTransform:"uppercase",marginBottom:8,fontWeight:500}}>{cat}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
            {CAISSE_ITEMS.filter(i=>i.cat===cat).map(item=>{
              const inCart=cart.find(c=>c.id===item.id);
              return(
                <button key={item.id} onClick={()=>addItem(item)} style={{
                  padding:"11px 6px",borderRadius:10,cursor:"pointer",
                  background:inCart?G.copper:"rgba(255,255,255,0.7)",
                  border:`1px solid ${inCart?G.copper:G.border}`,
                  color:inCart?"#fff":G.dark,
                  minHeight:"auto",transition:"background .12s,border-color .12s",
                }}>
                  <div style={{fontSize:11,fontWeight:500,marginBottom:2,lineHeight:1.2}}>{item.name}</div>
                  <div style={{fontSize:10,color:inCart?"rgba(255,255,255,0.8)":G.copper,fontWeight:600}}>{fmt(item.price)}</div>
                  {inCart&&<div style={{fontSize:9,marginTop:2,color:"rgba(255,255,255,0.65)"}}>x{inCart.qty}</div>}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* ── Panier + paiement ── */}
      {cart.length>0&&!cashMode&&(
        <div style={{marginTop:20,paddingTop:16,borderTop:`2px solid ${G.border}`}}>
          {cart.map((item,i)=>(
            <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,...(i<cart.length-1?rowSep:{})}}>
              <span style={{flex:1,fontSize:12,color:G.dark}}>{item.name}</span>
              <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                <button onClick={()=>removeItem(item.id)} style={circleBtn("none",G.mid)}>-</button>
                <span style={{fontSize:12,fontWeight:600,color:G.dark,minWidth:16,textAlign:"center"}}>{item.qty}</span>
                <button onClick={()=>addItem(item)} style={circleBtn(G.copper,"#fff")}>+</button>
                <span style={{fontSize:11,color:G.copper,fontWeight:500,minWidth:50,textAlign:"right"}}>{fmt(item.price*item.qty)}</span>
              </div>
            </div>
          ))}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginTop:14,paddingTop:12,borderTop:`1px solid ${G.border}`}}>
            <span style={{fontSize:9,color:G.light,letterSpacing:.5,textTransform:"uppercase"}}>Total</span>
            <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:34,fontWeight:300,color:G.dark}}>{fmt(cartTotal)}</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginTop:14}}>
            <button onClick={()=>confirmSale("CB")} style={{padding:"14px 4px",borderRadius:10,cursor:"pointer",background:"#1A3060",border:"none",color:"#fff",fontSize:12,fontWeight:600,minHeight:"auto"}}>CB</button>
            <button onClick={()=>confirmSale("AMEX")} style={{padding:"14px 4px",borderRadius:10,cursor:"pointer",background:"#1A5028",border:"none",color:"#fff",fontSize:12,fontWeight:600,minHeight:"auto"}}>AMEX</button>
            <button onClick={()=>setCashMode(true)} style={{padding:"14px 4px",borderRadius:10,cursor:"pointer",background:G.copper,border:"none",color:"#fff",fontSize:12,fontWeight:600,minHeight:"auto"}}>Especes</button>
          </div>
        </div>
      )}

      {/* ── Rendu monnaie (Especes seulement) ── */}
      {cart.length>0&&cashMode&&(
        <div style={{marginTop:20,paddingTop:16,borderTop:`2px solid ${G.border}`}}>
          {/* Rappel total */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:18}}>
            <span style={{fontSize:9,color:G.light,textTransform:"uppercase",letterSpacing:.5}}>Total</span>
            <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:34,fontWeight:300,color:G.dark}}>{fmt(cartTotal)}</span>
          </div>

          {/* Raccourcis billets */}
          <div style={{fontSize:9,color:G.mid,marginBottom:8,letterSpacing:.5}}>Montant remis</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
            <button onClick={()=>setCashGiven(String(cartTotal))} style={{
              padding:"9px 14px",borderRadius:8,cursor:"pointer",fontSize:11,fontWeight:500,
              background:given===cartTotal&&given>0?G.copper:`rgba(255,255,255,0.7)`,
              border:`1px solid ${given===cartTotal&&given>0?G.copper:G.border}`,
              color:given===cartTotal&&given>0?"#fff":G.dark,minHeight:"auto",transition:"all .12s",
            }}>Exact</button>
            {quickBills.map(b=>(
              <button key={b} onClick={()=>setCashGiven(String(b))} style={{
                padding:"9px 14px",borderRadius:8,cursor:"pointer",fontSize:11,fontWeight:500,
                background:given===b?G.copper:`rgba(255,255,255,0.7)`,
                border:`1px solid ${given===b?G.copper:G.border}`,
                color:given===b?"#fff":G.dark,minHeight:"auto",transition:"all .12s",
              }}>{b} €</button>
            ))}
          </div>
          <input
            type="number" inputMode="decimal"
            value={cashGiven}
            onChange={e=>setCashGiven(e.target.value)}
            placeholder="Autre montant..."
            style={{
              width:"100%",padding:"12px 14px",
              border:`1.5px solid ${cashGiven?(changeOk?"rgba(30,94,50,0.5)":"rgba(122,16,8,0.4)"):G.borderS}`,
              borderRadius:8,fontSize:17,fontWeight:500,
              background:"rgba(255,251,246,0.9)",color:G.dark,minHeight:"auto",
              outline:"none",
            }}
          />

          {/* Affichage monnaie */}
          {cashGiven&&(
            <div style={{
              marginTop:12,padding:"14px 16px",borderRadius:10,
              background:changeOk?"rgba(30,94,50,0.06)":"rgba(122,16,8,0.05)",
              border:`1px solid ${changeOk?"rgba(30,94,50,0.2)":"rgba(122,16,8,0.15)"}`,
              display:"flex",justifyContent:"space-between",alignItems:"baseline",
            }}>
              <span style={{fontSize:9,color:changeOk?"#1E5E32":"#7A1008",textTransform:"uppercase",letterSpacing:.5,fontWeight:600}}>
                {changeOk?"Monnaie a rendre":"Montant insuffisant"}
              </span>
              <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:30,fontWeight:300,color:changeOk?"#1E5E32":"#7A1008"}}>
                {changeOk?fmt(change):fmt(cartTotal-given)}
              </span>
            </div>
          )}

          {/* Actions */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:14}}>
            <button onClick={()=>{setCashMode(false);setCashGiven("");}} style={{
              padding:"13px",borderRadius:10,cursor:"pointer",
              background:"none",border:`1px solid ${G.border}`,color:G.mid,
              fontSize:12,fontWeight:500,minHeight:"auto",
            }}>Annuler</button>
            <button
              disabled={!changeOk}
              onClick={()=>confirmSale("Especes",given)}
              style={{
                padding:"13px",borderRadius:10,cursor:changeOk?"pointer":"default",
                background:changeOk?G.copper:"rgba(140,60,16,0.12)",
                border:"none",color:changeOk?"#fff":"rgba(140,60,16,0.3)",
                fontSize:12,fontWeight:600,minHeight:"auto",transition:"all .12s",
              }}>Valider la vente</button>
          </div>
        </div>
      )}

      {/* ── Transactions du jour ── */}
      <div style={{marginTop:24,paddingTop:16,borderTop:`2px solid ${G.border}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,gap:8,flexWrap:"wrap"}}>
          <span style={{fontSize:9,color:G.light,letterSpacing:2,textTransform:"uppercase"}}>
            {txs.length} vente{txs.length!==1?"s":""} aujourd'hui
          </span>
          {txs.length>0&&(
            <div style={{display:"flex",gap:6,flexShrink:0}}>
              <button onClick={async()=>{
                setPdfBusy(true);
                try{await buildCaissePDF(txs,new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"}));}
                catch{showToast("Erreur PDF");}
                setPdfBusy(false);
              }} style={{background:"none",border:`1px solid ${G.border}`,color:G.mid,padding:"5px 10px",borderRadius:6,fontSize:10,fontWeight:500,cursor:"pointer",minHeight:"auto"}}>
                {pdfBusy?"...":"PDF"}
              </button>
              <button onClick={()=>downloadCSV(txs)}
                style={{background:"none",border:`1px solid ${G.border}`,color:G.mid,padding:"5px 10px",borderRadius:6,fontSize:10,fontWeight:500,cursor:"pointer",minHeight:"auto"}}>
                CSV
              </button>
              <button onClick={()=>downloadZticket(txs)}
                style={{background:`rgba(140,60,16,0.08)`,border:`1px solid ${G.copper}30`,color:G.copper,padding:"5px 10px",borderRadius:6,fontSize:10,fontWeight:600,cursor:"pointer",minHeight:"auto"}}>
                Z-Ticket
              </button>
            </div>
          )}
        </div>

        {txs.length===0&&(
          <div style={{padding:"24px 0",textAlign:"center",fontSize:14,color:G.light,fontStyle:"italic",fontFamily:"'Cormorant Garamond',serif"}}>
            Aucune vente enregistree aujourd'hui
          </div>
        )}

        {txs.map((tx,i)=>{
          const pc=tx.payment==="CB"?"#1A3060":tx.payment==="AMEX"?"#1A5028":G.copper;
          return(
            <div key={tx.id} style={{
              display:"flex",alignItems:"flex-start",gap:12,
              paddingBottom:10,marginBottom:10,
              borderBottom:i<txs.length-1?`1px solid ${G.border}`:"none",
            }}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2,flexWrap:"wrap"}}>
                  <span style={{fontSize:9,color:pc,fontWeight:600,letterSpacing:.5}}>{tx.payment}</span>
                  <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:17,color:G.dark,fontWeight:300}}>{fmt(tx.total)}</span>
                  {tx.change>0&&<span style={{fontSize:9,color:"#1E5E32",fontWeight:500}}>rendu {fmt(tx.change)}</span>}
                  <span style={{fontSize:9,color:G.light,marginLeft:"auto"}}>{tx.time}</span>
                </div>
                <div style={{fontSize:10,color:G.mid,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {tx.items.map(it=>`${it.name}${it.qty>1?` x${it.qty}`:""}`).join(" · ")}
                </div>
              </div>
              <button onClick={()=>deleteTx(tx.id)} style={{background:"none",border:"none",color:G.light,padding:"2px 4px",fontSize:14,cursor:"pointer",minHeight:"auto",flexShrink:0,lineHeight:1}}>x</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════
   DROPBOX — Documents partagés
═══════════════════════════ */
function DropboxTab({user, showToast}){
  const[docs,setDocs]=useState([]);
  const[loading,setLoading]=useState(false);
  const[filter,setFilter]=useState("all");
  const[previewDoc,setPreviewDoc]=useState(null);   // doc object being previewed
  const[previewUrl,setPreviewUrl]=useState(null);   // blob URL of the PDF
  const[previewLoading,setPreviewLoading]=useState(false);

  const isResponsable = user?.role === "responsable";
  const isAdjoint     = user?.role === "adjoint";

  const typeColors={livraison:"#1E5E32",commande:G.copper,tracabilite:"#1A3A6A",inventaire:"#3A3A4A"};
  const typeLabels={livraison:"Livraison",commande:"Commande",tracabilite:"Traçabilité",inventaire:"Inventaire"};
  const destColors={responsable:G.copper,adjoint:"#3A3A4A"};
  const destLabels={responsable:"Espace Responsable",adjoint:"Espace Production"};

  const loadDocs=async()=>{
    setLoading(true);
    try{const r=await fetch("/api/dropbox");if(r.ok)setDocs(await r.json());}catch{}
    setLoading(false);
  };
  useEffect(()=>{loadDocs();},[]);

  /* Construit un blob URL à partir du base64 */
  const buildBlobUrl=async(doc)=>{
    const r=await fetch(`/api/dropbox/${doc.id}`);
    const d=await r.json();
    if(!d.pdfBase64) throw new Error("PDF introuvable");
    const bytes=atob(d.pdfBase64);
    const arr=new Uint8Array(bytes.length);
    for(let i=0;i<bytes.length;i++) arr[i]=bytes.charCodeAt(i);
    return URL.createObjectURL(new Blob([arr],{type:"application/pdf"}));
  };

  const download=async(doc)=>{
    try{
      const url=await buildBlobUrl(doc);
      const a=Object.assign(document.createElement("a"),{href:url,download:`${doc.title}.pdf`});
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url),5000);
    }catch{showToast("Erreur téléchargement");}
  };

  const preview=async(doc)=>{
    setPreviewLoading(true);
    setPreviewDoc(doc);
    setPreviewUrl(null);
    try{
      const url=await buildBlobUrl(doc);
      setPreviewUrl(url);
    }catch{
      showToast("Erreur de chargement du PDF");
      setPreviewDoc(null);
    }
    setPreviewLoading(false);
  };

  const closePreview=()=>{
    if(previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewDoc(null);
    setPreviewUrl(null);
  };

  const deleteDoc=async(id)=>{
    if(!confirm("Supprimer ce document ?")) return;
    const r=await fetch(`/api/dropbox/${id}`,{method:"DELETE"});
    if(r.ok){setDocs(p=>p.filter(d=>d.id!==id));showToast("Document supprimé");}
    else showToast("Suppression impossible");
  };

  const fBtnS=(active,color=G.copper)=>({
    padding:"6px 14px",borderRadius:20,fontSize:10,cursor:"pointer",minHeight:"auto",
    transition:"all .18s",fontWeight:active?600:400,
    background:active?color:"rgba(140,60,16,0.06)",
    border:`1px solid ${active?color:"transparent"}`,
    color:active?"#fff":G.light,
    boxShadow:active?`0 2px 10px ${color}44`:"none",
  });

  /* ── MODAL PRÉVISUALISATION PDF ── */
  const PreviewModal=previewDoc?(
    <div style={{position:"fixed",inset:0,zIndex:990,background:"rgba(0,0,0,0.88)",
      display:"flex",flexDirection:"column",animation:"fadein .2s ease"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",
        background:"rgba(0,0,0,0.55)",borderBottom:"1px solid rgba(255,255,255,0.1)",flexShrink:0}}>
        <button onClick={closePreview}
          style={{background:"rgba(255,255,255,0.12)",border:"none",color:"#fff",
            width:34,height:34,borderRadius:"50%",fontSize:18,cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          ←
        </button>
        <div style={{flex:1,overflow:"hidden"}}>
          <div style={{fontSize:12,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{previewDoc.title}</div>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.5)",marginTop:1}}>{previewDoc.author}</div>
        </div>
        <button onClick={()=>download(previewDoc)}
          style={{background:`linear-gradient(135deg,${G.copperL},${G.copper})`,border:"none",color:"#fff",
            padding:"7px 14px",borderRadius:8,fontSize:10,fontWeight:600,cursor:"pointer",flexShrink:0}}>
          Télécharger
        </button>
      </div>
      {previewLoading
        ? <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",
            color:"rgba(255,255,255,0.55)",fontSize:12}}>
            <span style={{animation:"pulse 1.4s infinite"}}>Chargement du document…</span>
          </div>
        : <iframe src={previewUrl} style={{flex:1,width:"100%",border:"none"}} title={previewDoc.title}/>
      }
    </div>
  ):null;

  /* ── VUE ADJOINT : espace production uniquement ── */
  if(isAdjoint){
    return(
      <div style={{animation:"fadein .28s ease"}}>
        {PreviewModal}
        <div style={{marginBottom:24,paddingBottom:18,borderBottom:`1px solid ${G.border}`}}>
          <div style={{fontSize:8,letterSpacing:4,color:"#3A3A4A",textTransform:"uppercase",marginBottom:8}}>Production</div>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:300,color:G.dark,marginBottom:6}}>
            Documents d'inventaire
          </div>
          <div style={{fontSize:11,color:G.light,lineHeight:1.5}}>
            États de stocks envoyés par le responsable ou l'équipe.
          </div>
        </div>

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontSize:10,color:G.light}}>{docs.length} document{docs.length!==1?"s":""} reçu{docs.length>1?"s":""}</div>
          <GBtn small label={loading?"Chargement…":"Actualiser"} disabled={loading} onClick={loadDocs}/>
        </div>

        {loading&&<div style={{textAlign:"center",padding:"40px 0",fontSize:10,color:G.light,animation:"pulse 1.4s infinite"}}>Chargement…</div>}
        {!loading&&docs.length===0&&(
          <div style={{textAlign:"center",padding:"48px 0",fontFamily:"'Cormorant Garamond',serif",fontSize:16,color:G.light,fontStyle:"italic"}}>
            Aucun document d'inventaire reçu
          </div>
        )}
        {docs.map(doc=>(
          <Card key={doc.id} style={{padding:"14px 16px",marginBottom:10,animation:"slidein .25s ease both",
            border:`1.5px solid #3A3A4A18`}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",gap:6,marginBottom:5,flexWrap:"wrap"}}>
                  <span style={{fontSize:8,background:"#3A3A4A18",color:"#3A3A4A",padding:"2px 8px",borderRadius:10,fontWeight:600}}>
                    Inventaire
                  </span>
                  {doc.week&&<span style={{fontSize:8,color:G.light,background:G.faint,padding:"2px 8px",borderRadius:10}}>{doc.week}</span>}
                </div>
                <div style={{fontSize:12,fontWeight:600,color:G.dark,marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{doc.title}</div>
                <div style={{fontSize:9,color:G.light}}>
                  <span style={{fontWeight:500,color:G.mid}}>{doc.author}</span>
                  {" · "}{new Date(doc.createdAt).toLocaleDateString("fr-FR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}
                </div>
              </div>
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                <button onClick={()=>preview(doc)}
                  style={{background:"rgba(58,58,74,0.08)",border:"1px solid rgba(58,58,74,0.2)",color:"#3A3A4A",
                    padding:"7px 14px",borderRadius:8,fontSize:10,fontWeight:600,cursor:"pointer",minHeight:"auto"}}>
                  Voir
                </button>
                <button onClick={()=>download(doc)}
                  style={{background:"linear-gradient(135deg,#4A4A5E,#3A3A4A)",border:"none",color:"#fff",
                    padding:"7px 14px",borderRadius:8,fontSize:10,fontWeight:600,cursor:"pointer",minHeight:"auto",
                    boxShadow:"0 2px 10px rgba(58,58,74,0.3)"}}>
                  Télécharger
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  /* ── VUE RESPONSABLE : tous les documents, triés par catégorie ── */
  const filtered=docs.filter(d=>filter==="all"||d.docType===filter);

  // Regroupement par catégorie pour le résumé
  const counts={all:docs.length};
  ["livraison","commande","tracabilite","inventaire"].forEach(t=>{counts[t]=docs.filter(d=>d.docType===t).length;});

  return(
    <div style={{animation:"fadein .28s ease"}}>
      {PreviewModal}

      {/* En-tête espace responsable */}
      <div style={{marginBottom:24,paddingBottom:18,borderBottom:`1px solid ${G.border}`}}>
        <div style={{fontSize:8,letterSpacing:4,color:G.copper,textTransform:"uppercase",marginBottom:8}}>Responsable</div>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:300,color:G.dark,marginBottom:6}}>
          Documents partagés
        </div>
        {/* Compteurs par catégorie */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginTop:14}}>
          {[
            {id:"livraison",   l:"Livraisons",  c:"#1E5E32"},
            {id:"commande",    l:"Commandes",   c:G.copper},
            {id:"tracabilite", l:"Traçabilité", c:"#1A3A6A"},
            {id:"inventaire",  l:"Inventaires", c:"#3A3A4A"},
          ].map(cat=>(
            <button key={cat.id} onClick={()=>setFilter(cat.id)}
              style={{padding:"12px 6px",borderRadius:10,
                border:`1.5px solid ${filter===cat.id?cat.c:G.border}`,
                background:filter===cat.id?`${cat.c}08`:"rgba(255,251,246,0.7)",
                cursor:"pointer",textAlign:"center",minHeight:"auto",transition:"all .18s"}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,fontWeight:300,color:cat.c,lineHeight:1,marginBottom:4}}>{counts[cat.id]||0}</div>
              <div style={{fontSize:7,letterSpacing:1,color:G.light,textTransform:"uppercase"}}>{cat.l}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Filtres */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
        {[{id:"all",l:"Tout"},
          {id:"livraison",l:"Livraisons"},
          {id:"commande",l:"Commandes"},
          {id:"tracabilite",l:"Traçabilité"},
          {id:"inventaire",l:"Stock"},
        ].map(f=>(
          <button key={f.id} onClick={()=>setFilter(f.id)} style={fBtnS(filter===f.id)}>{f.l}</button>
        ))}
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:10,color:G.light}}>{filtered.length} document{filtered.length!==1?"s":""}</div>
        <GBtn small label={loading?"Chargement…":"Actualiser"} disabled={loading} onClick={loadDocs}/>
      </div>

      {loading&&<div style={{textAlign:"center",padding:"40px 0",fontSize:10,color:G.light,animation:"pulse 1.4s infinite"}}>Chargement…</div>}

      {!loading&&filtered.length===0&&(
        <div style={{textAlign:"center",padding:"48px 0",fontFamily:"'Cormorant Garamond',serif",fontSize:16,color:G.light,fontStyle:"italic"}}>
          Aucun document{filter!=="all"?" dans cette catégorie":""}
        </div>
      )}

      {filtered.map(doc=>(
        <Card key={doc.id} style={{padding:"14px 16px",marginBottom:10,animation:"slidein .25s ease both"}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",gap:6,marginBottom:5,flexWrap:"wrap"}}>
                <span style={{fontSize:8,background:`${typeColors[doc.docType]||G.mid}18`,
                  color:typeColors[doc.docType]||G.mid,padding:"2px 8px",borderRadius:10,fontWeight:600}}>
                  {typeLabels[doc.docType]||doc.docType}
                </span>
                {doc.destination&&(
                  <span style={{fontSize:8,background:`${destColors[doc.destination]||G.mid}12`,
                    color:destColors[doc.destination]||G.mid,padding:"2px 8px",borderRadius:10}}>
                    {destLabels[doc.destination]||doc.destination}
                  </span>
                )}
                {doc.week&&<span style={{fontSize:8,color:G.light,background:G.faint,padding:"2px 8px",borderRadius:10}}>{doc.week}</span>}
              </div>
              <div style={{fontSize:12,fontWeight:600,color:G.dark,marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{doc.title}</div>
              <div style={{fontSize:9,color:G.light}}>
                <span style={{fontWeight:500,color:G.mid}}>{doc.author}</span>
                {" · "}{new Date(doc.createdAt).toLocaleDateString("fr-FR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}
              </div>
            </div>
            <div style={{display:"flex",gap:6,flexShrink:0}}>
              <button onClick={()=>preview(doc)}
                style={{background:`rgba(140,60,16,0.08)`,border:`1px solid rgba(140,60,16,0.2)`,color:G.copper,
                  padding:"7px 14px",borderRadius:8,fontSize:10,fontWeight:600,cursor:"pointer",minHeight:"auto"}}>
                Voir
              </button>
              <button onClick={()=>download(doc)}
                style={{background:`linear-gradient(135deg,${G.copperL},${G.copper})`,border:"none",color:"#fff",
                  padding:"7px 14px",borderRadius:8,fontSize:10,fontWeight:600,cursor:"pointer",minHeight:"auto",
                  boxShadow:"0 2px 10px rgba(140,60,16,0.25)"}}>
                Télécharger
              </button>
              <button onClick={()=>deleteDoc(doc.id)}
                style={{background:"none",border:`1px solid ${G.border}`,color:G.danger,
                  padding:"7px 10px",borderRadius:8,fontSize:12,cursor:"pointer",minHeight:"auto"}}>
                ×
              </button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ── Atoms redesignés ── */
const PageIntro=({title,desc})=>(
  <div style={{marginBottom:20,paddingBottom:14,borderBottom:`1px solid ${G.border}`}}>
    <div style={{fontSize:13,fontWeight:700,color:G.dark,marginBottom:4}}>{title}</div>
    <div style={{fontSize:11,color:G.light,lineHeight:1.6}}>{desc}</div>
  </div>
);

/* UX 2 — Légende Demi/Pleine */
const FormatLegend=()=>(
  <div style={{display:"flex",gap:12,marginBottom:14,flexWrap:"wrap"}}>
    {[{l:"Demi",v:"2.5 L",color:G.copper},{l:"Pleine",v:"5 L",color:G.dark}].map(f=>(
      <div key={f.l} style={{display:"flex",alignItems:"center",gap:6,
        background:"rgba(255,251,246,0.7)",border:`1px solid ${G.border}`,
        borderRadius:20,padding:"4px 12px"}}>
        <span style={{fontSize:11,fontWeight:600,color:f.color}}>{f.l}</span>
        <span style={{fontSize:10,color:G.light}}>=</span>
        <span style={{fontSize:11,fontWeight:500,color:G.mid}}>{f.v}</span>
      </div>
    ))}
  </div>
);

/* UX 5 — Étape numérotée pour formulaires */
const StepRow=({num,title,children})=>(
  <div style={{display:"flex",gap:12,alignItems:"flex-start",marginBottom:16}}>
    <div style={{width:28,height:28,borderRadius:"50%",background:G.copper,color:"#fff",
      fontSize:12,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",
      flexShrink:0,marginTop:2,boxShadow:"0 2px 8px rgba(140,60,16,0.28)"}}>
      {num}
    </div>
    <div style={{flex:1}}>
      <div style={{fontSize:12,fontWeight:600,color:G.dark,marginBottom:8}}>{title}</div>
      {children}
    </div>
  </div>
);

const SLabel=({children})=><div style={{fontSize:10,letterSpacing:.5,color:G.light,fontWeight:600,marginBottom:2}}>{children}</div>;
const GChip=({children,color})=><span style={{fontSize:8,letterSpacing:1.5,color,textTransform:"uppercase",fontWeight:600,background:`${color}15`,padding:"2px 8px",borderRadius:10}}>{children}</span>;
const GTag=({children,warn})=>(
  <span style={{
    background: warn ? G.warnBg : "rgba(255,251,246,0.75)",
    backdropFilter:"blur(8px)",
    border:`1px solid ${warn?`rgba(148,82,8,0.3)`:G.border}`,
    borderRadius:8, padding:"4px 10px",
    fontSize:9, color:warn?G.warn:G.mid, fontWeight:warn?500:400,
  }}>{children}</span>
);
const BtnRow=({children})=><div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>{children}</div>;
const GBtn=({onClick,label,primary,disabled,small})=>(
  <button onClick={onClick} disabled={disabled} style={{
    backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",
    fontSize:small?10:11, letterSpacing:0, textTransform:"none",
    cursor:disabled?"not-allowed":"pointer",
    transition:"all .22s cubic-bezier(.4,0,.2,1)",
    borderRadius:10, minHeight:"auto", fontWeight:primary?600:500,
    padding: small?"7px 14px":"11px 22px",
    background: primary
      ? (disabled?"rgba(140,60,16,0.1)":`linear-gradient(135deg,${G.copperL},${G.copper})`)
      : "rgba(255,251,246,0.72)",
    border:`1px solid ${primary?(disabled?G.border:G.copper):G.border}`,
    color: primary?(disabled?G.light:"#fff"):(disabled?G.light:G.mid),
    boxShadow: primary&&!disabled
      ? "0 4px 18px rgba(140,60,16,0.32),0 1px 4px rgba(140,60,16,0.18)"
      : "none",
    transform:"translateY(0)",
  }}
  onMouseEnter={e=>{ if(!disabled){ e.currentTarget.style.transform="translateY(-2px)"; e.currentTarget.style.boxShadow=primary?"0 8px 28px rgba(140,60,16,0.38),0 2px 6px rgba(140,60,16,0.2)":"0 4px 16px rgba(70,32,8,0.08)"; }}}
  onMouseLeave={e=>{ e.currentTarget.style.transform="translateY(0)"; e.currentTarget.style.boxShadow=primary&&!disabled?"0 4px 18px rgba(140,60,16,0.32),0 1px 4px rgba(140,60,16,0.18)":"none"; }}>
    {label}
  </button>
);
