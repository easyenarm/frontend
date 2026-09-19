// ===================================================================
// CONFIGURACIÓN
// ===================================================================
const API_SIM = 'https://easyenarm-api.hola-7f8.workers.dev/api';

const TBL_SIM_QA     = 'tbl3yENU36aK5DsBI';   // Banco de preguntas
const TBL_SIM_RESULT = 'tblIvizalM4Ei8iP2';   // Resultados
const TBL_SUBESP     = 'tblROQ2NM3ngAiSml';   // Vista Subespecialidades (EasyScore, temas)
const TBL_TEMAS      = 'tblvDru4fL6o4xwfs';   // Vista Temas (Frecuencia ENARM)
const TBL_SIM_HIST   = 'tbl377BqZHsQsF0Hd';   // Historial y pausas

// Marca de este simulador: separa sus pausas de las del simulador de Modo Estudio
const SIM_TIPO = 'imagenes';

// Mínimo de preguntas para que un simulador aparezca en el catálogo
const MIN_PREGUNTAS = 1;

// Campos que este embed realmente usa (versión IMÁGENES)
const F_SIM_QA = ['Id','text','option1','option2','option3','option4','correctOption','specialty','difficulty','caseId','order','explanation','subspeciality','topic','image','frequency','url'];
const F_SUBESP = ['Subespecialidad','Especialidad (from Especialidad)','Tema (from Temas global)','Frecuencia Historia ENARM (from Temas global)','No Simulador Imágenes (de Temas global)','Simulador_Q&A_Imágenes (de Temas global)','EasyScore'];
const F_TEMAS = ['Tema','Especialidad string','Subespecialidad string','No Simulador Imágenes','Simulador_Q&A_Imágenes (from Simulador_Q&A)','Frecuencia Historia ENARM'];
const F_SIM_RESULT = ['Calificación','Subespecialidad','Tema'];
const F_SIM_PAUSAS = ['Datos Completos Examen'];

function simFields(lista) { return lista.map(f => 'fields%5B%5D=' + encodeURIComponent(f)).join('&'); }
const HISTORY_URL_BASE = 'https://www.easyenarm.com/historial-simuladores';
const WEBHOOK_URL = 'https://hook.us1.make.com/jj7ljouuy26bidey9wcyw7m8sjnx6ief';

let subspecialityMapping = null;

// ===================================================================
// ESTADO GLOBAL
// ===================================================================
let allQuestions = [];
let currentQuestions = [];
let userAnswers = [];
let flaggedQuestions = [];
let startTime, timerInterval;
let elapsedSeconds = 0;
let selectedSimulatorId = null;
let selectedSimulatorName = null;
let examMode = 'uno';               // 'uno' | 'pdf' | 'casos'
let examSaveView = 'subespecialidades'; // 'subespecialidades' | 'temas' — dónde se guarda el resultado
let units = [];
let currentUnit = 0;
let pendingFolder = null;
let pausedRecordId = null;
let cloudPauses = {};
let loadedFolders = [];
let currentView = 'subespecialidades'; // vista activa del catálogo
const PROGRESS_KEY_PREFIX = 'enarm_img_progress_';
const MODE_KEY = 'enarm_pref_mode';
const ZOOM_KEY = 'enarm_pref_zoom';

// ===================================================================
// HELPERS
// ===================================================================
function firstOf(v) { return Array.isArray(v) ? (v.length ? v[0] : null) : v; }

function freqKey(val) {
  if (!val) return '';
  const s = String(val);
  if (s.includes('Altamente')) return 'altamente';
  if (s.includes('Poco')) return 'poco';
  if (s.includes('No Preguntado') || s.includes('No preguntado')) return 'no';
  if (s.includes('Preguntado')) return 'preguntado';
  return '';
}
function freqLabelHTML(val) {
  if (!val) return '';
  const k = freqKey(val);
  const cls = { altamente:'freq-high', preguntado:'freq-mid', poco:'freq-low', no:'freq-none' }[k] || 'freq-none';
  return `<span class="cat-freq ${cls}">${val}</span>`;
}
function easyScoreGroup(score) {
  score = Number(score) || 0;
  if (score >= 10) return { cls:'es-red',    label:'Prioridad muy alta' };
  if (score >= 7)  return { cls:'es-yellow', label:'Prioridad alta' };
  if (score >= 5)  return { cls:'es-green',  label:'Prioridad media' };
  return { cls:'es-gray', label:'Prioridad baja' };
}
function easyScoreHTML(score) {
  const g = easyScoreGroup(score);
  return `<span class="easyscore-pill ${g.cls}" title="EasyScore: ${g.label}">⚡ ${Number(score)||0} pts</span>`;
}

// ===================================================================
// IDENTIDAD DEL USUARIO (siempre desde la sesión de Softr, NUNCA del URL)
// ===================================================================
function getUserRecordId() {
  try {
    if (window['logged_in_user'] && window['logged_in_user']['airtable_record_id']) return window['logged_in_user']['airtable_record_id'];
    if (window.logged_in_user && window.logged_in_user.airtable_record_id) return window.logged_in_user.airtable_record_id;
    const scripts = document.querySelectorAll('script');
    for (let s of scripts) {
      const c = s.textContent || s.innerText;
      const m = c.match(/airtable_record_id['"]?\s*=\s*['"]([^'"]+)['"]/);
      if (m && m[1]) return m[1];
    }
    return null;
  } catch (e) { return null; }
}
function getUserEmail() {
  try {
    if (window['logged_in_user'] && window['logged_in_user']['softr_user_email']) return window['logged_in_user']['softr_user_email'];
    if (window.logged_in_user && window.logged_in_user.softr_user_email) return window.logged_in_user.softr_user_email;
    return 'email_no_encontrado@easyenarm.com';
  } catch (e) { return 'error@easyenarm.com'; }
}
function setupHistoryLink() {
  const link = document.getElementById('history-link');
  const uid = getUserRecordId();
  link.href = uid ? `${HISTORY_URL_BASE}?recordId=${uid}` : HISTORY_URL_BASE;
}

// ===================================================================
// PARÁMETROS DE URL (lanzamiento directo de un tema o subespecialidad)
// ===================================================================
function getDirectLaunchParams() {
  // Reúne los parámetros desde varias fuentes por si Softr encierra el código.
  var fuentes = [];
  try { if (window.location.search) fuentes.push(window.location.search); } catch (e) {}
  try { if (window.location.hash && window.location.hash.indexOf('=') !== -1) fuentes.push(window.location.hash.replace(/^#/, '?')); } catch (e) {}
  try { if (window.top && window.top !== window && window.top.location && window.top.location.search) fuentes.push(window.top.location.search); } catch (e) {}
  try { if (window.parent && window.parent !== window && window.parent.location && window.parent.location.search) fuentes.push(window.parent.location.search); } catch (e) {}
  try { if (document.referrer) { var u = new URL(document.referrer); if (u.search) fuentes.push(u.search); } } catch (e) {}

  // Deduce la vista según la página (para el parámetro genérico recordId).
  var ruta = '';
  try { ruta = (window.location.pathname || '') + ' ' + (document.referrer || ''); } catch (e) {}
  try { if (window.top && window.top !== window && window.top.location) ruta += ' ' + window.top.location.pathname; } catch (e) {}
  ruta = ruta.toLowerCase();
  var vistaPorPagina = ruta.indexOf('tema') !== -1 ? 'temas' : 'subespecialidades';

  for (var i = 0; i < fuentes.length; i++) {
    var p = new URLSearchParams(fuentes[i]);
    var tema = p.get('tema');
    var subesp = p.get('subespecialidad');
    var generico = p.get('recordId') || p.get('record_id') || p.get('id');
    if (tema && tema.indexOf('rec') === 0) return { recordId: tema, view: 'temas' };
    if (subesp && subesp.indexOf('rec') === 0) return { recordId: subesp, view: 'subespecialidades' };
    if (generico && generico.indexOf('rec') === 0) return { recordId: generico, view: vistaPorPagina };
  }
  return null;
}

// ===================================================================
// NOTIFICACIONES / TIMER / ZOOM
// ===================================================================
function showSuccessNotification(msg) { const n = document.createElement('div'); n.className = 'notification success'; n.textContent = msg; document.body.appendChild(n); setTimeout(() => n.remove(), 5000); }
function showErrorNotification(msg) { const n = document.createElement('div'); n.className = 'notification error'; n.textContent = msg; document.body.appendChild(n); setTimeout(() => n.remove(), 8000); }

function startTimer() {
  startTime = new Date();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    elapsedSeconds++;
    document.getElementById('time-counter').textContent = formatTime(elapsedSeconds);
  }, 1000);
}
function formatTime(secs) {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

let zoomLevel = parseFloat(localStorage.getItem(ZOOM_KEY) || '1');
function applyZoom() {
  zoomLevel = Math.min(1.3, Math.max(0.8, zoomLevel));
  document.documentElement.style.setProperty('--zoom', zoomLevel);
  const zv = document.getElementById('zoom-value');
  if (zv) zv.textContent = Math.round(zoomLevel * 100) + '%';
  try { localStorage.setItem(ZOOM_KEY, String(zoomLevel)); } catch (e) {}
}
function zoomIn() { zoomLevel = +(zoomLevel + 0.05).toFixed(2); applyZoom(); }
function zoomOut() { zoomLevel = +(zoomLevel - 0.05).toFixed(2); applyZoom(); }

// ===================================================================
// PROGRESO LOCAL (respaldo)
// ===================================================================
function saveProgress() {
  try {
    const uid = getUserRecordId();
    if (!uid || !selectedSimulatorId) return;
    const data = {
      simTipo: SIM_TIPO,
      simulatorId: selectedSimulatorId, simulatorName: selectedSimulatorName,
      examMode, examSaveView, currentUnit, userAnswers, flaggedQuestions, elapsedSeconds,
      currentQuestions, pausedRecordId,
      savedAt: new Date().toISOString(), totalQuestions: currentQuestions.length
    };
    localStorage.setItem(`${PROGRESS_KEY_PREFIX}${uid}_${selectedSimulatorId}`, JSON.stringify(data));
  } catch (e) { console.error('Save progress error:', e); }
}
function clearLocalProgress() {
  try {
    const uid = getUserRecordId();
    if (uid && selectedSimulatorId) localStorage.removeItem(`${PROGRESS_KEY_PREFIX}${uid}_${selectedSimulatorId}`);
  } catch (e) {}
}

// ===================================================================
// PAUSA EN LA NUBE (tabla de historial, Estado = "En Progreso")
// ===================================================================
function historyLinkField() { return examSaveView === 'temas' ? 'Temas' : 'Subespecialidad'; }

function buildProgressPayload() {
  return {
    type: 'progress',
    simTipo: SIM_TIPO,
    simulatorId: selectedSimulatorId, simulatorName: selectedSimulatorName,
    examMode, examSaveView, currentUnit, elapsedSeconds,
    savedAt: new Date().toISOString(),
    questionIds: currentQuestions.map(q => q.id),
    userAnswers, flaggedQuestions
  };
}
async function saveCloudProgress() {
  const uid = getUserRecordId();
  if (!uid || !selectedSimulatorId) throw new Error('Sin sesión de usuario');
  const answered = userAnswers.filter(a => a !== null && a !== undefined).length;
  const fields = {
    'Alumno': [uid],
    [historyLinkField()]: [selectedSimulatorId],
    'Fecha Examen': new Date().toISOString().split('T')[0],
    'Hora Examen': new Date().toISOString().split('T')[1].split('.')[0],
    'Preguntas Totales': currentQuestions.length,
    'Tiempo Total': formatTime(elapsedSeconds),
    'Datos Completos Examen': JSON.stringify({ ...buildProgressPayload(), answeredCount: answered }),
    'Estado': 'En Progreso'
  };
  const base = `${API_SIM}/${TBL_SIM_HIST}`;
  const headers = { 'Content-Type': 'application/json' };
  if (pausedRecordId) {
    const r = await fetch(`${base}/${pausedRecordId}`, { method: 'PATCH', headers, body: JSON.stringify({ fields, typecast: true }) });
    if (r.ok) { const d = await r.json(); saveProgress(); return d; }
    console.warn(`PATCH pausa falló (${r.status}), creando registro nuevo`);
    pausedRecordId = null;
  }
  const r = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ fields, typecast: true }) });
  if (!r.ok) throw new Error(`Error ${r.status}: ${await r.text()}`);
  const d = await r.json();
  pausedRecordId = d.id;
  saveProgress();
  return d;
}
async function deleteCloudProgress(recId) {
  try {
    await fetch(`${API_SIM}/${TBL_SIM_HIST}/${recId}`, { method: 'DELETE' });
  } catch (e) { console.error('Error eliminando pausa en la nube:', e); }
}
async function findAllCloudPauses() {
  try {
    const email = getUserEmail();
    if (!email || email.startsWith('email_no_encontrado') || email.startsWith('error@')) return {};
    const filter = `AND({Correo (from Alumno)} = '${email}', {Estado} = 'En Progreso')`;
    let records = [], offset = null;
    do {
      let url = `${API_SIM}/${TBL_SIM_HIST}?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&${simFields(F_SIM_PAUSAS)}`;
      if (offset) url += `&offset=${offset}`;
      const r = await fetch(url);
      if (!r.ok) break;
      const d = await r.json();
      records = records.concat(d.records);
      offset = d.offset || null;
    } while (offset);
    const pauses = {};
    records.forEach(rec => {
      try {
        const p = JSON.parse(rec.fields['Datos Completos Examen'] || '{}');
        // Solo las pausas creadas por ESTE simulador (imágenes)
        if (p.simTipo !== SIM_TIPO) return;
        if (p.type === 'progress' && p.simulatorId && p.questionIds && p.questionIds.length > 0) {
          if (!pauses[p.simulatorId] || new Date(p.savedAt) > new Date(pauses[p.simulatorId].payload.savedAt)) {
            pauses[p.simulatorId] = { id: rec.id, payload: p };
          }
        }
      } catch (e) {}
    });
    console.log(`⏸ Pausas en la nube (imágenes): ${Object.keys(pauses).length}`);
    return pauses;
  } catch (e) { console.error('findAllCloudPauses:', e); return {}; }
}
async function continueCloudProgress(pause) {
  if (!pause) return;
  const p = pause.payload;
  closeStartModal();
  document.getElementById('setup-panel').style.display = 'none';
  document.getElementById('loading-text').textContent = 'Recuperando tu progreso...';
  document.getElementById('loading-container').style.display = 'block';
  try {
    selectedSimulatorId = p.simulatorId;
    selectedSimulatorName = p.simulatorName;
    examSaveView = p.examSaveView || 'subespecialidades';
    pausedRecordId = pause.id;
    const qs = await loadQuestionsByNumericId(p.questionIds);
    const byId = new Map(qs.map(q => [q.id, q]));
    const keptIdx = [];
    currentQuestions = [];
    p.questionIds.forEach((id, i) => {
      const q = byId.get(id);
      if (q) { currentQuestions.push(q); keptIdx.push(i); }
    });
    if (currentQuestions.length === 0) throw new Error('No se pudieron recuperar las preguntas del examen pausado');
    userAnswers = keptIdx.map(i => (p.userAnswers && p.userAnswers[i] !== undefined) ? p.userAnswers[i] : null);
    flaggedQuestions = keptIdx.map(i => !!(p.flaggedQuestions && p.flaggedQuestions[i]));
    examMode = p.examMode || 'uno';
    elapsedSeconds = p.elapsedSeconds || 0;
    currentUnit = p.currentUnit || 0;
    document.getElementById('loading-container').style.display = 'none';
    enterExamMode();
    buildUnits();
    if (currentUnit >= units.length) currentUnit = 0;
    renderExam();
    startTimer();
    saveProgress();
    showSuccessNotification('☁️ Progreso recuperado. ¡Continúa donde te quedaste!');
  } catch (error) {
    document.getElementById('loading-container').style.display = 'none';
    document.getElementById('setup-panel').style.display = 'block';
    showErrorNotification('Error recuperando progreso: ' + error.message);
  }
}

// ===================================================================
// PARSEO DE PREGUNTAS
// ===================================================================
function parseAirtableData(resp) {
  if (!resp.records || resp.records.length === 0) throw new Error('No se encontraron registros');
  const questions = [];
  resp.records.forEach((record, index) => {
    try {
      const f = record.fields;
      if (!f.Id || !f.text || !f.option1 || !f.option2 || !f.option3 || !f.option4 || !f.correctOption || !f.specialty || !f.difficulty) return;
      function extractValue(field) {
        if (!field) return null;
        if (typeof field === 'string') return field.trim();
        if (Array.isArray(field)) {
          if (field.length === 0) return null;
          const x = field[0];
          if (typeof x === 'string') return x.trim();
          if (typeof x === 'object' && x !== null) { for (const p of ['name','Name','title','Title','value','Value']) if (x[p]) return String(x[p]).trim(); return String(x).trim(); }
          return String(x).trim();
        }
        if (typeof field === 'object' && field !== null) { for (const p of ['name','Name','title','Title','value','Value']) if (field[p]) return String(field[p]).trim(); return String(field).trim(); }
        return String(field).trim();
      }
      const correctOption = parseInt(f.correctOption) - 1;
      if (isNaN(correctOption) || correctOption < 0 || correctOption > 3) return;
      questions.push({
        id: parseInt(f.Id) || (index + 1), text: f.text.trim(),
        options: [f.option1.trim(), f.option2.trim(), f.option3.trim(), f.option4.trim()],
        correctOption, specialty: extractValue(f.specialty), difficulty: f.difficulty.trim(),
        caseId: f.caseId ? f.caseId.trim() : null, order: f.order ? parseInt(f.order) : null,
        explanation: f.explanation ? f.explanation.trim() : 'No hay explicación disponible.',
        subspeciality: extractValue(f.subspeciality), topic: f.topic ? f.topic.trim() : null,
        image: f.image && f.image.length > 0 ? f.image[0].url : null,
        frequency: extractValue(f.frequency), url: f.url ? f.url.trim() : null
      });
    } catch (e) { console.error(`Error parseando registro ${index}:`, e); }
  });
  return questions;
}

// ⭐ FILTRO EXCLUSIVO DE ESTE SIMULADOR:
// deja solo preguntas con imagen; si una pregunta pertenece a un caso clínico
// que tiene al menos una imagen, se conserva todo el caso (para no perder contexto).
function filtrarSoloImagenes(questions) {
  const casosConImagen = new Set();
  questions.forEach(q => { if (q.caseId && q.caseId !== '' && q.image) casosConImagen.add(q.caseId); });
  const filtradas = questions.filter(q => {
    if (q.image) return true;
    if (q.caseId && q.caseId !== '' && casosConImagen.has(q.caseId)) return true;
    return false;
  });
  console.log(`🖼️ Filtro de imágenes: ${filtradas.length} de ${questions.length} preguntas conservadas`);
  return filtradas;
}

// Carga de preguntas por campo numérico {Id}, en lotes, + filtro de imágenes
async function loadQuestionsByNumericId(questionIds) {
  const ids = (questionIds || []).map(id => (typeof id === 'number' ? id : (isNaN(parseInt(id)) ? id : parseInt(id))));
  const lotes = [];
  for (let i = 0; i < ids.length; i += 25) lotes.push(ids.slice(i, i + 25));
  const partes = await Promise.all(lotes.map(async chunk => {
    const filter = `OR(${chunk.map(id => `{Id} = ${id}`).join(', ')})`;
    let recs = [], offset = null;
    do {
      let url = `${API_SIM}/${TBL_SIM_QA}?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&${simFields(F_SIM_QA)}`;
      if (offset) url += `&offset=${offset}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Error ${r.status} recuperando preguntas`);
      const d = await r.json();
      recs = recs.concat(d.records);
      offset = d.offset || null;
    } while (offset);
    return recs;
  }));
  const parsed = parseAirtableData({ records: [].concat(...partes) });
  return filtrarSoloImagenes(parsed);
}

// ===================================================================
// MAPEO DE REGISTROS (tarjetas de simulador) — campos de IMÁGENES
// ===================================================================
function mapSubespRecord(rec) {
  const f = rec.fields;
  return {
    id: rec.id, view: 'subespecialidades',
    nombre: f.Subespecialidad || 'Sin nombre',
    especialidad: firstOf(f['Especialidad (from Especialidad)']) || 'Sin especialidad',
    temasGlobal: f['Tema (from Temas global)'] || [],
    frecuenciasTemas: f['Frecuencia Historia ENARM (from Temas global)'] || [],
    numeroPreguntas: f['No Simulador Imágenes (de Temas global)'] || 0,
    preguntasIds: f['Simulador_Q&A_Imágenes (de Temas global)'] || [],
    easyScore: Number(f['EasyScore']) || 0,
    frecuencia: null
  };
}
function mapTemaRecord(rec) {
  const f = rec.fields;
  return {
    id: rec.id, view: 'temas',
    nombre: f.Tema || 'Sin nombre',
    especialidad: firstOf(f['Especialidad string']) || 'Sin especialidad',
    subespecialidad: f['Subespecialidad string'] || '',
    temasGlobal: [f.Tema || 'Sin tema'],
    frecuenciasTemas: [],
    numeroPreguntas: f['No Simulador Imágenes'] || 0,
    preguntasIds: f['Simulador_Q&A_Imágenes (from Simulador_Q&A)'] || [],
    easyScore: 0,
    frecuencia: f['Frecuencia Historia ENARM'] || ''
  };
}

// Vista Subespecialidades → tblROQ2NM3ngAiSml
async function loadSubespFolders() {
  let all = [], offset = null;
  do {
    let url = `${API_SIM}/${TBL_SUBESP}?pageSize=100&${simFields(F_SUBESP)}`;
    if (offset) url += `&offset=${offset}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Error ${r.status} cargando subespecialidades`);
    const d = await r.json();
    all = all.concat(d.records);
    offset = d.offset || null;
  } while (offset);
  return all.map(mapSubespRecord);
}

// Vista Temas → tblvDru4fL6o4xwfs
async function loadTemaFolders() {
  let all = [], offset = null;
  do {
    let url = `${API_SIM}/${TBL_TEMAS}?pageSize=100&${simFields(F_TEMAS)}`;
    if (offset) url += `&offset=${offset}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Error ${r.status} cargando temas`);
    const d = await r.json();
    all = all.concat(d.records);
    offset = d.offset || null;
  } while (offset);
  return all.map(mapTemaRecord);
}

// Carga de un solo simulador por recordId (para URLs directas)
async function loadSingleFolder(recordId, view) {
  const tableId = view === 'temas' ? TBL_TEMAS : TBL_SUBESP;
  const campos = view === 'temas' ? F_TEMAS : F_SUBESP;
  const url = `${API_SIM}/${tableId}?filterByFormula=${encodeURIComponent(`RECORD_ID()='${recordId}'`)}&pageSize=1&${simFields(campos)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se encontró el simulador (${r.status})`);
  const d = await r.json();
  if (!d.records || d.records.length === 0) throw new Error('No se encontró el simulador');
  return view === 'temas' ? mapTemaRecord(d.records[0]) : mapSubespRecord(d.records[0]);
}

// Marca simuladores completados (mejor calificación) leyendo la tabla de resultados
async function loadCompletedMap() {
  const completed = new Map();
  try {
    const email = getUserEmail();
    if (!email || email === 'email_no_encontrado@easyenarm.com') return completed;
    const filter = `{Correo} = '${email}'`;
    let records = [], offset = null;
    do {
      let url = `${API_SIM}/${TBL_SIM_RESULT}?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&${simFields(F_SIM_RESULT)}`;
      if (offset) url += `&offset=${offset}`;
      const r = await fetch(url);
      if (!r.ok) { console.error('Error consultando resultados:', r.status); break; }
      const d = await r.json();
      records = records.concat(d.records);
      offset = d.offset || null;
    } while (offset);
    records.forEach(r => {
      const cal = r.fields['Calificación'];
      if (cal === undefined) return;
      ['Subespecialidad', 'Tema'].forEach(field => {
        const arr = r.fields[field];
        if (arr && Array.isArray(arr)) arr.forEach(s => { if (!completed.has(s) || completed.get(s) < cal) completed.set(s, cal); });
      });
    });
  } catch (e) {
    console.error('loadCompletedMap:', e);
  }
  return completed;
}

// Organiza casos clínicos (agrupa por caseId, ordena por 'order')
function organizeQuestionsWithCases(questions) {
  const nonCase = [], organized = [], processed = new Set();
  questions.forEach(q => { if (!q.caseId || q.caseId === '') nonCase.push(q); });
  questions.forEach(q => {
    if (q.caseId && q.caseId !== '' && !processed.has(q.caseId)) {
      const caseQs = questions.filter(x => x.caseId === q.caseId).sort((a, b) => {
        if (a.order && b.order) return parseInt(a.order) - parseInt(b.order);
        if (a.order && !b.order) return -1;
        if (!a.order && b.order) return 1;
        return a.id - b.id;
      });
      organized.push(...caseQs);
      processed.add(q.caseId);
    }
  });
  return [...organized, ...nonCase];
}

// ===================================================================
// RENDER DEL CATÁLOGO + FILTROS
// ===================================================================
const ESPECIALIDAD_COLORS = {
  "Medicina Interna": "#9073b2",
  "Cirugía": "#48ACEA",
  "Pediatría": "#a3be4f",
  "Ginecología y Obstetricia": "#e75660",
  "Ginecología": "#e75660",
  "Obstetricia": "#f08f35"
};
function espColor(name) { return ESPECIALIDAD_COLORS[name] || '#5b78a8'; }

function scoreClass(s) { return s >= 80 ? 'sc-high' : s >= 60 ? 'sc-mid' : 'sc-low'; }

function buildCardHTML(folder) {
  const pause = cloudPauses[folder.id] || null;
  let statusHTML, extraHTML = '', ctaHTML;
  if (pause) {
    const answered = (pause.payload.userAnswers || []).filter(a => a !== null && a !== undefined).length;
    statusHTML = `<span class="simulator-status paused">⏸ En pausa</span>`;
    extraHTML = `<div class="sim-paused-meta">Avance: ${answered}/${pause.payload.questionIds.length} · ${formatTime(pause.payload.elapsedSeconds || 0)}</div>`;
    ctaHTML = '▶ Continuar donde me quedé';
  } else if (folder.completed) {
    statusHTML = `<span class="simulator-status completed">Completado</span>`;
    extraHTML = `<div class="simulator-score ${scoreClass(folder.score)}">Mejor calificación: ${folder.score}%</div>`;
    ctaHTML = '🔄 Repetir simulador';
  } else {
    statusHTML = `<span class="simulator-status">Nuevo</span>`;
    ctaHTML = '▶ Presentar simulador';
  }

  // Badges: especialidad + imágenes + EasyScore (subesp) / Frecuencia (temas)
  let badges = `<span class="cat-tag" style="background:${espColor(folder.especialidad)}">${folder.especialidad}</span>`;
  badges += `<span class="img-pill">🖼️ Con imagen</span>`;
  if (folder.view === 'subespecialidades') {
    badges += easyScoreHTML(folder.easyScore);
  } else if (folder.frecuencia) {
    badges += freqLabelHTML(folder.frecuencia);
  }

  // Botón desglose de temas (solo subespecialidades)
  const temasBtn = folder.view === 'subespecialidades'
    ? `<button type="button" class="sim-temas-btn" data-temas="${folder.id}">ℹ️ Ver temas (${(folder.temasGlobal||[]).length})</button>`
    : '';

  return `
    <div class="sim-top">
      <h3 class="simulator-title">${folder.nombre}</h3>
      ${statusHTML}
    </div>
    <div class="sim-badges">${badges}</div>
    <div class="simulator-meta">📝 ${folder.numeroPreguntas} preguntas con imagen ${temasBtn}</div>
    ${extraHTML}
    <div class="sim-cta">${ctaHTML}</div>`;
}

function renderCards(folders) {
  const grid = document.getElementById('simulators-grid');
  grid.innerHTML = '';
  if (folders.length === 0) {
    grid.innerHTML = `<div class="grid-empty"><div class="grid-empty-icon">🔍</div><p>No se encontraron simuladores con imagen con los filtros aplicados.</p></div>`;
    return;
  }
  folders.forEach(folder => {
    const card = document.createElement('div');
    card.className = `simulator-card ${cloudPauses[folder.id] ? 'paused' : folder.completed ? 'completed' : ''}`;
    card.innerHTML = buildCardHTML(folder);
    card.addEventListener('click', (e) => {
      if (e.target.closest('.sim-temas-btn')) { e.stopPropagation(); mostrarTemas(folder.id); return; }
      openStartModal(folder);
    });
    grid.appendChild(card);
  });
}

function filterSimulators() {
  if (!loadedFolders || loadedFolders.length === 0) { renderCards([]); updateCounter(0, 0); return; }
  const search = (document.getElementById('search-simulators').value || '').toLowerCase();
  const specialty = document.getElementById('filter-specialty').value;
  const freq = document.getElementById('filter-frequency').value;
  const status = document.getElementById('filter-status').value;
  const sortBy = document.getElementById('sort-by').value;

  // Solo simuladores con el mínimo de preguntas con imagen
  let base = loadedFolders.filter(f => f.numeroPreguntas >= MIN_PREGUNTAS);
  const totalBase = base.length;

  let filtered = base.filter(f => {
    const mSearch = f.nombre.toLowerCase().includes(search);
    const mSpec = !specialty || f.especialidad === specialty;
    let mStatus = true;
    if (status === 'completed') mStatus = f.completed === true;
    else if (status === 'not-completed') mStatus = !f.completed;
    let mFreq = true;
    if (currentView === 'temas' && freq) mFreq = freqKey(f.frecuencia) === freq;
    return mSearch && mSpec && mStatus && mFreq;
  });

  const scoreVal = f => (f.completed ? f.score : null);
  switch (sortBy) {
    case 'za': filtered.sort((a,b)=> b.nombre.localeCompare(a.nombre,'es',{sensitivity:'base'})); break;
    case 'most-questions': filtered.sort((a,b)=> b.numeroPreguntas - a.numeroPreguntas); break;
    case 'least-questions': filtered.sort((a,b)=> a.numeroPreguntas - b.numeroPreguntas); break;
    case 'score-desc': filtered.sort((a,b)=> { const av=scoreVal(a), bv=scoreVal(b); if(av===null&&bv===null) return a.nombre.localeCompare(b.nombre,'es'); if(av===null) return 1; if(bv===null) return -1; return bv-av; }); break;
    case 'score-asc': filtered.sort((a,b)=> { const av=scoreVal(a), bv=scoreVal(b); if(av===null&&bv===null) return a.nombre.localeCompare(b.nombre,'es'); if(av===null) return 1; if(bv===null) return -1; return av-bv; }); break;
    case 'easyscore-desc': filtered.sort((a,b)=> (b.easyScore||0)-(a.easyScore||0)); break;
    case 'easyscore-asc': filtered.sort((a,b)=> (a.easyScore||0)-(b.easyScore||0)); break;
    default: filtered.sort((a,b)=> a.nombre.localeCompare(b.nombre,'es',{sensitivity:'base'}));
  }

  renderCards(filtered);
  updateCounter(filtered.length, totalBase);
}
function updateCounter(vis, total) {
  document.getElementById('visible-count').textContent = vis;
  document.getElementById('total-count').textContent = total;
}
function clearFilters() {
  document.getElementById('search-simulators').value = '';
  document.getElementById('filter-specialty').value = '';
  document.getElementById('filter-frequency').value = '';
  document.getElementById('filter-status').value = '';
  document.getElementById('sort-by').value = currentView === 'subespecialidades' ? 'easyscore-desc' : 'az';
  filterSimulators();
}

// Mostrar/ocultar filtros según la vista + ajustar orden por defecto
function updateFilterVisibility() {
  const freqField = document.getElementById('filter-freq-field');
  const easyOpts = document.querySelectorAll('#sort-by .opt-easyscore');
  const sortSel = document.getElementById('sort-by');
  if (currentView === 'temas') {
    freqField.classList.remove('filter-hidden');
    easyOpts.forEach(o => o.classList.add('filter-hidden'));
    if (sortSel.value.startsWith('easyscore')) sortSel.value = 'az';
  } else {
    freqField.classList.add('filter-hidden');
    document.getElementById('filter-frequency').value = '';
    easyOpts.forEach(o => o.classList.remove('filter-hidden'));
  }
}

// ===================================================================
// TOGGLE DE VISTA
// ===================================================================
async function toggleView() {
  currentView = (currentView === 'subespecialidades') ? 'temas' : 'subespecialidades';
  const toggle = document.getElementById('view-toggle');
  toggle.classList.toggle('temas', currentView === 'temas');
  toggle.querySelectorAll('.vt-opt').forEach(o => o.classList.toggle('active', o.dataset.view === currentView));
  updateFilterVisibility();
  document.getElementById('sort-by').value = currentView === 'subespecialidades' ? 'easyscore-desc' : 'az';
  document.getElementById('search-simulators').value = '';
  document.getElementById('filter-status').value = '';
  await loadSetup();
}

// ===================================================================
// MODAL: DESGLOSE DE TEMAS DE UNA SUBESPECIALIDAD
// ===================================================================
function mostrarTemas(folderId) {
  const folder = loadedFolders.find(f => f.id === folderId);
  if (!folder) return;
  document.getElementById('temas-modal-title').textContent = `📚 ${folder.nombre}`;
  document.getElementById('temas-modal-sub').textContent = `${(folder.temasGlobal||[]).length} temas · Frecuencia ENARM`;
  const list = document.getElementById('temas-modal-list');
  const temas = folder.temasGlobal || [];
  const frecs = folder.frecuenciasTemas || [];
  if (temas.length === 0) {
    list.innerHTML = `<li>No hay temas especificados.</li>`;
  } else {
    list.innerHTML = temas.map((t, i) => {
      const fr = frecs[i] ? freqLabelHTML(frecs[i]) : '';
      return `<li><span>${t}</span>${fr}</li>`;
    }).join('');
  }
  openInfoModal('info-temas-overlay');
}

// ===================================================================
// MODALES DE INFO
// ===================================================================
function openInfoModal(id) { document.getElementById(id).classList.add('active'); }
function closeInfoModal(id) { document.getElementById(id).classList.remove('active'); }

// ===================================================================
// MODAL DE INICIO (selección de modo) + PAUSA
// ===================================================================
function openStartModal(folder) {
  pendingFolder = folder;
  document.getElementById('sm-title').textContent = folder.nombre;
  document.getElementById('sm-meta').textContent = `🖼️ ${folder.numeroPreguntas} preguntas con imagen`;

  // Badges en el encabezado del modal
  let badges = '';
  if (folder.completed) badges += `<span class="prev-score">⭐ Mejor: ${folder.score}%</span>`;
  if (folder.view === 'subespecialidades') badges += easyScoreHTML(folder.easyScore);
  else if (folder.frecuencia) badges += freqLabelHTML(folder.frecuencia);
  document.getElementById('sm-badges').innerHTML = badges;

  const pause = cloudPauses[folder.id] || null;
  const pausedBox = document.getElementById('sm-paused-box');
  const modeBox = document.getElementById('sm-mode-box');
  if (pause) {
    const modeNames = { uno: 'Pregunta por pregunta', pdf: 'Tipo PDF', casos: 'Por casos clínicos' };
    const answered = (pause.payload.userAnswers || []).filter(a => a !== null && a !== undefined).length;
    document.getElementById('sm-paused-summary').innerHTML =
      `⏸ <strong>Simulador pausado</strong> · disponible en cualquier dispositivo<br><strong>Avance:</strong> ${answered} de ${pause.payload.questionIds.length} respondidas · ${formatTime(pause.payload.elapsedSeconds || 0)}<br><strong>Modo:</strong> ${modeNames[pause.payload.examMode] || 'Pregunta por pregunta'}<br><strong>Pausado:</strong> ${new Date(pause.payload.savedAt).toLocaleString()}`;
    pausedBox.style.display = 'block';
    modeBox.style.display = 'none';
  } else {
    pausedBox.style.display = 'none';
    modeBox.style.display = 'block';
    selectMode(localStorage.getItem(MODE_KEY) || 'uno');
  }
  document.getElementById('start-modal-overlay').classList.add('active');
  document.body.style.overflow = 'hidden';
}
function continuePausedFromModal() {
  if (!pendingFolder) return;
  const pause = cloudPauses[pendingFolder.id];
  if (pause) continueCloudProgress(pause);
}
async function restartPausedFromModal() {
  if (!pendingFolder) return;
  const pause = cloudPauses[pendingFolder.id];
  if (!pause) return;
  if (!confirm('🔄 ¿Empezar de nuevo?\n\nSe descartará la pausa guardada de este simulador (respuestas y tiempo). Esta acción no se puede deshacer.')) return;
  await deleteCloudProgress(pause.id);
  delete cloudPauses[pendingFolder.id];
  try { const uid = getUserRecordId(); if (uid) localStorage.removeItem(`${PROGRESS_KEY_PREFIX}${uid}_${pendingFolder.id}`); } catch (e) {}
  document.getElementById('sm-paused-box').style.display = 'none';
  document.getElementById('sm-mode-box').style.display = 'block';
  selectMode(localStorage.getItem(MODE_KEY) || 'uno');
  filterSimulators();
  showSuccessNotification('🗑️ Pausa descartada');
}
function closeStartModal() {
  document.getElementById('start-modal-overlay').classList.remove('active');
  document.body.style.overflow = '';
}
function selectMode(mode) {
  examMode = mode;
  try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}
  document.querySelectorAll('.mode-card').forEach(c => c.classList.toggle('selected', c.dataset.mode === mode));
}

// ===================================================================
// INICIO DEL EXAMEN
// ===================================================================
async function startSimulator() {
  if (!pendingFolder) return;
  selectedSimulatorId = pendingFolder.id;
  selectedSimulatorName = pendingFolder.nombre;
  examSaveView = pendingFolder.view;   // ← define dónde se guarda el resultado (Subespecialidad/Tema)
  pausedRecordId = null;
  const preguntasIds = pendingFolder.preguntasIds || [];
  closeStartModal();
  document.getElementById('setup-panel').style.display = 'none';
  document.getElementById('loading-text').textContent = 'Cargando preguntas con imagen...';
  document.getElementById('loading-container').style.display = 'block';
  try {
    if (!preguntasIds || preguntasIds.length === 0) throw new Error('Este simulador no tiene preguntas con imagen asociadas');
    const questions = await loadQuestionsByNumericId(preguntasIds);
    if (!questions || questions.length === 0) throw new Error('No se encontraron preguntas con imagen para este simulador');
    allQuestions = questions;
    currentQuestions = [...allQuestions];
    currentQuestions.sort(() => 0.5 - Math.random());
    currentQuestions = organizeQuestionsWithCases(currentQuestions);
    userAnswers = new Array(currentQuestions.length).fill(null);
    flaggedQuestions = new Array(currentQuestions.length).fill(false);
    currentUnit = 0;
    elapsedSeconds = 0;
    document.getElementById('loading-container').style.display = 'none';
    enterExamMode();
    buildUnits();
    renderExam();
    startTimer();
  } catch (error) {
    document.getElementById('loading-container').style.display = 'none';
    document.getElementById('setup-panel').style.display = 'block';
    document.getElementById('error-message').textContent = error.message;
    document.getElementById('error-container').style.display = 'block';
  }
}

function enterExamMode() {
  document.getElementById('setup-panel').style.display = 'none';
  document.getElementById('page-header').style.display = 'none';
  document.getElementById('error-container').style.display = 'none';
  document.getElementById('top-nav').classList.add('hidden');
  document.getElementById('exam-topbar').classList.add('active');
  document.getElementById('exam-progress-bar').classList.add('active');
  document.getElementById('exam-container').classList.add('active');
  document.getElementById('map-toggle-btn').classList.add('active');
  if (examMode === 'pdf') {
    document.getElementById('finish-section').classList.add('active');
    document.getElementById('exam-nav').classList.remove('active');
  } else {
    document.getElementById('finish-section').classList.remove('active');
    document.getElementById('exam-nav').classList.add('active');
  }
  applyZoom();
  window.scrollTo(0, 0);
}
function exitExamUI() {
  document.getElementById('exam-topbar').classList.remove('active');
  document.getElementById('exam-progress-bar').classList.remove('active');
  document.getElementById('exam-container').classList.remove('active');
  document.getElementById('exam-nav').classList.remove('active');
  document.getElementById('finish-section').classList.remove('active');
  document.getElementById('map-toggle-btn').classList.remove('active');
  document.getElementById('question-map').classList.remove('open');
  document.getElementById('top-nav').classList.remove('hidden');
  document.getElementById('page-header').style.display = 'block';
}

// ===================================================================
// UNIDADES DE NAVEGACIÓN
// ===================================================================
function buildUnits() {
  units = [];
  if (examMode === 'pdf') return;
  if (examMode === 'uno') {
    currentQuestions.forEach((q, i) => units.push({ caseId: q.caseId || null, indices: [i] }));
  } else {
    const done = new Set();
    currentQuestions.forEach((q, i) => {
      if (q.caseId && q.caseId !== '') {
        if (done.has(q.caseId)) return;
        const idx = [];
        currentQuestions.forEach((x, j) => { if (x.caseId === q.caseId) idx.push(j); });
        units.push({ caseId: q.caseId, indices: idx });
        done.add(q.caseId);
      } else {
        units.push({ caseId: null, indices: [i] });
      }
    });
  }
  if (currentUnit >= units.length) currentUnit = 0;
}
function getCaseText(caseId) {
  const cs = currentQuestions.find(q => q.caseId === caseId && q.text.includes('CASO CLÍNICO:'));
  if (!cs) return null;
  const m = cs.text.match(/CASO CLÍNICO:\s*(.*?)(?=\s*¿|\s*\?|$)/s);
  return m && m[1] ? m[1].trim() : null;
}
function questionOnlyText(q) {
  if (q.text.includes('CASO CLÍNICO:')) {
    const m = q.text.match(/¿[^?]*\?/);
    return m ? m[0] : q.text.replace(/CASO CLÍNICO:.*?\n\n/s, '');
  }
  return q.text;
}

// ===================================================================
// RENDERIZADO
// ===================================================================
function questionCardHTML(index) {
  const q = currentQuestions[index];
  const diffClass = q.difficulty === 'fácil' ? 'diff-facil' : q.difficulty === 'difícil' ? 'diff-dificil' : 'diff-medio';
  let freqClass = '';
  if (q.frequency === 'No Preguntado') freqClass = 'freq-none';
  else if (q.frequency === 'Poco Preguntado') freqClass = 'freq-low';
  else if (q.frequency === 'Preguntado') freqClass = 'freq-mid';
  else if (q.frequency === 'Altamente Preguntado') freqClass = 'freq-high';

  let tags = `<span class="q-tag specialty">${q.specialty || ''}</span>`;
  if (q.subspeciality) tags += `<span class="q-tag subspecialty">${q.subspeciality}</span>`;
  if (q.topic) tags += `<span class="q-tag topic">${q.topic}</span>`;
  tags += `<span class="q-tag ${diffClass}">${q.difficulty}</span>`;
  if (q.frequency) tags += `<span class="q-tag ${freqClass}">${q.frequency}</span>`;

  const imageHTML = q.image && q.image.trim() !== '' ? `<div class="q-image-container" id="img-container-${q.id}"><div class="image-loading"></div></div>` : '';
  const refHTML = q.url && q.url.trim() !== '' ? `<a href="${q.url}" target="_blank" class="q-reference">📖 Ver referencia</a>` : '';

  let opts = '';
  q.options.forEach((opt, oi) => {
    const checked = userAnswers[index] === oi ? 'checked' : '';
    const sel = userAnswers[index] === oi ? 'selected' : '';
    opts += `<li class="q-option ${sel}" id="opt-${index}-${oi}"><label><input type="radio" name="q-${index}" value="${oi}" ${checked} onchange="selectAnswer(${index}, ${oi})"><span>${String.fromCharCode(65 + oi)}. ${opt}</span></label></li>`;
  });

  const answered = userAnswers[index] !== null && userAnswers[index] !== undefined ? 'answered' : '';
  const flagged = flaggedQuestions[index] ? 'flagged' : '';
  return `<div class="question-card ${answered} ${flagged}" id="question-card-${index}">
    <div class="q-header">
      <span class="q-number">Pregunta ${index + 1}</span>
      <button class="q-flag-btn ${flaggedQuestions[index] ? 'flagged' : ''}" id="flag-${index}" onclick="toggleFlag(${index})" title="Marcar para revisar">🚩</button>
    </div>
    <div class="q-tags">${tags}</div>
    <div class="q-text">${questionOnlyText(q)}</div>
    ${imageHTML}<ul class="q-options">${opts}</ul>${refHTML}</div>`;
}
function caseBlockHTML(caseId) {
  const text = getCaseText(caseId);
  if (!text) return '';
  return `<div class="case-block"><div class="case-block-label">🩺 Caso clínico</div><div class="case-block-text">${text}</div></div>`;
}
function loadImagesFor(indices) {
  indices.forEach(i => {
    const q = currentQuestions[i];
    if (q.image && q.image.trim() !== '') {
      const c = document.getElementById(`img-container-${q.id}`);
      if (c) loadImageWithRetries(processImageUrlWithFallbacks(q.image, q.id), c, 0, 6, q.id);
    }
  });
}
function renderExam() {
  if (examMode === 'pdf') renderAllQuestions();
  else renderUnit(currentUnit);
  generateQuestionMap();
  updateCounters();
}
function renderAllQuestions() {
  const container = document.getElementById('exam-content');
  let html = '';
  const renderedCases = new Set();
  currentQuestions.forEach((q, i) => {
    if (q.caseId && q.caseId !== '' && !renderedCases.has(q.caseId)) {
      html += caseBlockHTML(q.caseId);
      renderedCases.add(q.caseId);
    }
    html += questionCardHTML(i);
  });
  container.innerHTML = html;
  loadImagesFor(currentQuestions.map((_, i) => i));
}
function renderUnit(n) {
  const unit = units[n];
  if (!unit) return;
  const container = document.getElementById('exam-content');
  let html = '';
  if (unit.caseId) html += caseBlockHTML(unit.caseId);
  unit.indices.forEach(i => { html += questionCardHTML(i); });
  container.innerHTML = html;
  loadImagesFor(unit.indices);
  document.getElementById('nav-prev').disabled = n === 0;
  const isLast = n === units.length - 1;
  document.getElementById('nav-next').style.display = isLast ? 'none' : 'block';
  document.getElementById('nav-finish').style.display = isLast ? 'block' : 'none';
  window.scrollTo(0, 0);
}
function prevUnit() { if (currentUnit > 0) { currentUnit--; renderUnit(currentUnit); updateCounters(); saveProgress(); } }
function nextUnit() { if (currentUnit < units.length - 1) { currentUnit++; renderUnit(currentUnit); updateCounters(); saveProgress(); } }

// ===================================================================
// INTERACCIÓN
// ===================================================================
function selectAnswer(qIndex, optIndex) {
  userAnswers[qIndex] = optIndex;
  const card = document.getElementById(`question-card-${qIndex}`);
  if (card) card.classList.add('answered');
  currentQuestions[qIndex].options.forEach((_, i) => {
    const opt = document.getElementById(`opt-${qIndex}-${i}`);
    if (opt) opt.classList.toggle('selected', i === optIndex);
  });
  updateCounters(); saveProgress();
}
function toggleFlag(qIndex) {
  flaggedQuestions[qIndex] = !flaggedQuestions[qIndex];
  const card = document.getElementById(`question-card-${qIndex}`);
  const btn = document.getElementById(`flag-${qIndex}`);
  if (card) card.classList.toggle('flagged', flaggedQuestions[qIndex]);
  if (btn) btn.classList.toggle('flagged', flaggedQuestions[qIndex]);
  updateCounters(); saveProgress();
}
function updateCounters() {
  const answered = userAnswers.filter(a => a !== null && a !== undefined).length;
  const total = currentQuestions.length;
  const flagged = flaggedQuestions.filter(Boolean).length;
  let label = `${answered}/${total}`;
  if (examMode === 'uno') label = `P. ${currentUnit + 1}/${total} · ${answered} resp.`;
  else if (examMode === 'casos') label = `Bloque ${currentUnit + 1}/${units.length} · ${answered}/${total} resp.`;
  document.getElementById('answered-counter').textContent = label;
  document.getElementById('flagged-counter').textContent = flagged;
  document.getElementById('exam-progress-fill').style.width = `${total > 0 ? (answered / total) * 100 : 0}%`;
  const canFinish = answered > 0;
  document.getElementById('finish-btn').disabled = !canFinish;
  document.getElementById('map-finish-btn').disabled = !canFinish;
  const msg = document.getElementById('finish-message');
  if (answered === 0) msg.textContent = 'Responde al menos una pregunta para poder finalizar.';
  else if (answered < total) msg.textContent = `Has respondido ${answered} de ${total} preguntas. Puedes finalizar cuando quieras.`;
  else msg.textContent = `¡Respondiste todas las ${total} preguntas! Puedes finalizar el examen.`;
  updateQuestionMap();
}

// ===================================================================
// MAPA DE PREGUNTAS
// ===================================================================
function toggleQuestionMap() { document.getElementById('question-map').classList.toggle('open'); }
function generateQuestionMap() {
  const c = document.getElementById('map-questions');
  c.innerHTML = '';
  currentQuestions.forEach((q, i) => {
    const el = document.createElement('div');
    el.className = 'map-question';
    el.id = `map-q-${i}`;
    el.textContent = i + 1;
    if (q.specialty) el.setAttribute('data-specialty', q.specialty);
    el.onclick = () => jumpToQuestion(i);
    c.appendChild(el);
  });
  updateQuestionMap();
}
function updateQuestionMap() {
  currentQuestions.forEach((q, i) => {
    const el = document.getElementById(`map-q-${i}`);
    if (!el) return;
    el.classList.remove('answered', 'flagged', 'current');
    if (userAnswers[i] !== null && userAnswers[i] !== undefined) el.classList.add('answered');
    if (flaggedQuestions[i]) el.classList.add('flagged');
    if (examMode !== 'pdf' && units[currentUnit] && units[currentUnit].indices.includes(i)) el.classList.add('current');
    el.innerHTML = flaggedQuestions[i] ? `${i + 1}<span style="font-size:.6rem">🚩</span>` : (i + 1);
  });
}
function jumpToQuestion(qIndex) {
  toggleQuestionMap();
  if (examMode === 'pdf') {
    const card = document.getElementById(`question-card-${qIndex}`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    const unitIdx = units.findIndex(u => u.indices.includes(qIndex));
    if (unitIdx >= 0) { currentUnit = unitIdx; renderUnit(currentUnit); updateCounters(); saveProgress(); }
  }
}

// ===================================================================
// IMÁGENES
// ===================================================================
async function refreshAirtableImageUrl(questionId) {
  try {
    const filter = `AND({Id} = ${questionId}, ${Date.now()} > 0)`;
    const url = `${API_SIM}/${TBL_SIM_QA}?filterByFormula=${encodeURIComponent(filter)}&fields%5B%5D=image`;
    const r = await fetch(url);
    if (r.ok) {
      const d = await r.json();
      if (d.records && d.records.length > 0 && d.records[0].fields.image && d.records[0].fields.image.length > 0) return d.records[0].fields.image[0].url;
    }
    return null;
  } catch (e) { return null; }
}
function processImageUrlWithFallbacks(imageUrl, questionId) {
  if (!imageUrl || imageUrl.trim() === '') return [];
  const out = [], ts = Date.now();
  if (imageUrl.includes('airtableusercontent.com')) {
    out.push(`${imageUrl}${imageUrl.includes('?') ? '&' : '?'}cb=${ts}`);
    out.push(`${imageUrl}${imageUrl.includes('?') ? '&' : '?'}t=${ts}&r=${Math.random()}`);
    out.push(`${imageUrl.split('?')[0]}?v=${ts}`);
  } else out.push(imageUrl);
  return [...new Set(out)];
}
function loadImageWithRetries(imageUrls, container, retryCount, maxRetries, questionId) {
  retryCount = retryCount || 0; maxRetries = maxRetries || 6;
  if (retryCount >= imageUrls.length && retryCount < maxRetries) {
    if (questionId && imageUrls[0] && imageUrls[0].includes('airtableusercontent.com')) {
      refreshAirtableImageUrl(questionId).then(fresh => {
        if (fresh) loadImageWithRetries(processImageUrlWithFallbacks(fresh, questionId), container, 0, maxRetries, questionId);
        else showImageErrorInContainer(container, questionId);
      }).catch(() => showImageErrorInContainer(container, questionId));
      return;
    }
  }
  if (retryCount >= Math.min(imageUrls.length, maxRetries)) { showImageErrorInContainer(container, questionId); return; }
  const currentUrl = imageUrls[retryCount % imageUrls.length];
  const img = document.createElement('img'); img.className = 'q-image'; img.alt = 'Imagen clínica';
  const timeout = setTimeout(() => { img.src = ''; loadImageWithRetries(imageUrls, container, retryCount + 1, maxRetries, questionId); }, 5000);
  img.onload = () => {
    clearTimeout(timeout);
    container.innerHTML = '';
    container.appendChild(img);
    const hint = document.createElement('span');
    hint.className = 'q-image-hint';
    hint.textContent = '🔍 Toca la imagen para ampliarla';
    container.appendChild(hint);
    img.onclick = () => openImageModal(currentUrl);
  };
  img.onerror = () => { clearTimeout(timeout); setTimeout(() => loadImageWithRetries(imageUrls, container, retryCount + 1, maxRetries, questionId), 300); };
  img.src = currentUrl.includes('airtableusercontent.com') ? `${currentUrl}${currentUrl.includes('?') ? '&' : '?'}bust=${Date.now()}` : currentUrl;
}
function showImageErrorInContainer(container, questionId) {
  container.innerHTML = `<div class="image-error"><strong>⚠️ La imagen ha expirado.</strong><br><button onclick="refreshImageForQuestion(${questionId})">☁️ Refrescar imagen</button></div>`;
}
window.refreshImageForQuestion = function(questionId) {
  const q = currentQuestions.find(x => x.id === questionId);
  if (!q) return;
  const c = document.getElementById(`img-container-${questionId}`);
  if (!c) return;
  c.innerHTML = '<div class="image-loading"></div>';
  refreshAirtableImageUrl(questionId).then(fresh => {
    if (fresh) { q.image = fresh; loadImageWithRetries(processImageUrlWithFallbacks(fresh, questionId), c, 0, 6, questionId); }
    else showImageErrorInContainer(c, questionId);
  }).catch(() => showImageErrorInContainer(c, questionId));
};
function openImageModal(src) { document.getElementById('modal-image').src = src; document.getElementById('image-modal').style.display = 'flex'; }
function closeImageModal() { document.getElementById('image-modal').style.display = 'none'; }

document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeImageModal(); document.getElementById('question-map').classList.remove('open'); } });
document.getElementById('image-modal').addEventListener('click', function(e) { if (e.target === this) closeImageModal(); });
document.getElementById('start-modal-overlay').addEventListener('click', function(e) { if (e.target === this) closeStartModal(); });
['info-easyscore-overlay','info-frecuencia-overlay','info-temas-overlay','info-imagenes-overlay'].forEach(id => {
  document.getElementById(id).addEventListener('click', function(e) { if (e.target === this) this.classList.remove('active'); });
});

// ===================================================================
// FINALIZAR / PAUSAR / REINICIAR
// ===================================================================
function finishQuiz() {
  const answered = userAnswers.filter(a => a !== null && a !== undefined).length;
  if (!confirm(`Has respondido ${answered} de ${currentQuestions.length} preguntas.\n¿Deseas finalizar el examen?`)) return;
  clearInterval(timerInterval); clearLocalProgress();
  exitExamUI();
  document.getElementById('page-header').style.display = 'none';
  document.getElementById('feedback-container').style.display = 'block';
  window.scrollTo(0, 0);
}
async function pauseSimulator() {
  if (!confirm('⏸ ¿Pausar el simulador?\n\nTu progreso se guardará en tu cuenta y podrás continuar desde cualquier dispositivo.')) return;
  const btn = document.getElementById('tb-pause-btn');
  btn.disabled = true; btn.textContent = '⏳ Guardando...';
  saveProgress();
  clearInterval(timerInterval);
  try {
    await saveCloudProgress();
    cloudPauses[selectedSimulatorId] = { id: pausedRecordId, payload: buildProgressPayload() };
    showSuccessNotification('☁️ Progreso guardado en tu cuenta');
  } catch (e) {
    console.error('Pausa en nube falló, queda el respaldo local:', e);
    showErrorNotification('⚠️ Sin conexión: progreso guardado solo en este dispositivo');
  }
  btn.disabled = false; btn.textContent = '⏸ Pausar';
  exitExamUI();
  document.getElementById('setup-panel').style.display = 'block';
  filterSimulators();
  window.scrollTo(0, 0);
}
function restartQuiz() {
  if (!confirm('¿Iniciar un nuevo simulador?')) return;
  document.getElementById('results-container').style.display = 'none';
  document.getElementById('feedback-container').style.display = 'none';
  document.getElementById('setup-panel').style.display = 'block';
  document.getElementById('page-header').style.display = 'block';
  const btn = document.getElementById('submit-feedback');
  btn.disabled = false; btn.textContent = 'Ver mis resultados →';
  currentQuestions = []; userAnswers = []; flaggedQuestions = []; units = [];
  elapsedSeconds = 0; currentUnit = 0; selectedSimulatorId = null; selectedSimulatorName = null;
  pausedRecordId = null;
  document.getElementById('time-counter').textContent = '00:00:00';
  loadSetup();
  window.scrollTo(0, 0);
}

// ===================================================================
// RESULTADOS: CÁLCULO Y VISUALIZACIÓN
// ===================================================================
function calculateResults() {
  let correct = 0, answered = 0;
  for (let i = 0; i < currentQuestions.length; i++) {
    if (userAnswers[i] !== null && userAnswers[i] !== undefined) { answered++; if (userAnswers[i] === currentQuestions[i].correctOption) correct++; }
  }
  const total = currentQuestions.length;
  return { correct, incorrect: answered - correct, total, percentage: total > 0 ? Math.round((correct / total) * 100) : 0, answered };
}
function calculateStatsBy(property) {
  const stats = {};
  currentQuestions.forEach((q, i) => {
    const key = q[property];
    if (key) {
      if (!stats[key]) stats[key] = { correct: 0, total: 0 };
      stats[key].total++;
      if (userAnswers[i] === q.correctOption) stats[key].correct++;
    }
  });
  for (const k in stats) stats[k].percentage = Math.round((stats[k].correct / stats[k].total) * 100);
  return stats;
}
function generateStatisticalAnalysis(results) {
  const specialtyResults = {}, subspecialityResults = {};
  const mainSpecialties = ["Medicina Interna","Cirugía","Pediatría","Ginecología","Ginecología y Obstetricia"];
  mainSpecialties.forEach(s => { specialtyResults[s] = { correct: 0, total: 0, topics: {} }; });
  currentQuestions.forEach((q, i) => {
    const ok = userAnswers[i] === q.correctOption;
    if (q.specialty) {
      if (!specialtyResults[q.specialty]) specialtyResults[q.specialty] = { correct: 0, total: 0, topics: {} };
      specialtyResults[q.specialty].total++; if (ok) specialtyResults[q.specialty].correct++;
      if (q.topic) {
        if (!specialtyResults[q.specialty].topics[q.topic]) specialtyResults[q.specialty].topics[q.topic] = { correct: 0, total: 0 };
        specialtyResults[q.specialty].topics[q.topic].total++; if (ok) specialtyResults[q.specialty].topics[q.topic].correct++;
      }
    }
    if (q.subspeciality) {
      if (!subspecialityResults[q.subspeciality]) subspecialityResults[q.subspeciality] = { correct: 0, total: 0 };
      subspecialityResults[q.subspeciality].total++; if (ok) subspecialityResults[q.subspeciality].correct++;
    }
  });
  const grid = document.getElementById('specialty-grid');
  if (grid) {
    grid.innerHTML = '';
    const all = [...mainSpecialties, ...Object.keys(specialtyResults).filter(s => !mainSpecialties.includes(s))];
    all.forEach(name => {
      const s = specialtyResults[name];
      if (s && s.total > 0) {
        const pct = Math.round((s.correct / s.total) * 100);
        grid.innerHTML += `<div class="specialty-card"><h4>${name}</h4><div class="specialty-score">${pct}%</div><div class="specialty-details">${s.correct} de ${s.total}</div></div>`;
      }
    });
  }
  const sections = document.getElementById('specialty-sections');
  if (sections) {
    sections.innerHTML = '';
    Object.keys(specialtyResults).forEach(name => {
      const s = specialtyResults[name];
      if (s && s.total > 0) {
        const pct = Math.round((s.correct / s.total) * 100);
        let topicsHTML = '';
        Object.keys(s.topics).forEach(t => {
          const tp = s.topics[t];
          if (tp.total > 0) {
            const tpct = Math.round((tp.correct / tp.total) * 100);
            topicsHTML += `<div class="topic-item"><div class="topic-name"><span>${t}</span><span class="topic-score">${tpct}%</span></div><div class="progress-bar-container"><div class="topic-progress" style="width:${tpct}%"></div></div></div>`;
          }
        });
        sections.innerHTML += `<div class="specialty-section"><h3>${name} — ${pct}%</h3>${topicsHTML || '<p style="color:#8aa3c8;font-size:.85rem;">Sin temas específicos</p>'}</div>`;
      }
    });
  }
  const bars = document.getElementById('subspeciality-bars');
  if (bars) {
    bars.innerHTML = '';
    Object.keys(subspecialityResults).forEach(name => {
      const s = subspecialityResults[name];
      if (s.total > 0) {
        const pct = Math.round((s.correct / s.total) * 100);
        bars.innerHTML += `<div class="subspeciality-item"><div class="subspeciality-name"><span>${name}</span><span class="subspeciality-score">${pct}%</span></div><div class="progress-bar-container"><div class="subspeciality-progress" style="width:${pct}%"></div></div></div>`;
      }
    });
    if (!bars.innerHTML) bars.innerHTML = '<p style="color:#8aa3c8;">Sin subespecialidades disponibles</p>';
  }
}
function generateReview() {
  const container = document.getElementById('review-questions-container');
  if (!container) return; container.innerHTML = '';
  const renderedCases = new Set();
  let html = '';
  currentQuestions.forEach((q, i) => {
    if (q.caseId && q.caseId !== '' && !renderedCases.has(q.caseId)) { html += caseBlockHTML(q.caseId); renderedCases.add(q.caseId); }
    const ua = userAnswers[i], isCorrect = ua === q.correctOption;
    let tags = `<span class="q-tag specialty">${q.specialty}</span>`;
    if (q.subspeciality) tags += `<span class="q-tag subspecialty">${q.subspeciality}</span>`;
    if (q.topic) tags += `<span class="q-tag topic">${q.topic}</span>`;
    const imgHTML = q.image ? `<div style="text-align:center;"><img src="${q.image}" alt="Imagen clínica" class="review-image" onclick="openImageModal('${q.image}')" onerror="this.style.display='none'"></div>` : '';
    let opts = '';
    q.options.forEach((opt, oi) => {
      let cls = '';
      if (oi === q.correctOption) cls = 'option-correct';
      else if (oi === ua && ua !== q.correctOption) cls = 'option-incorrect';
      opts += `<div class="review-option ${cls}"><span class="review-option-prefix">${String.fromCharCode(65 + oi)}.</span><span>${opt}${oi === ua ? ' 👈 <b>Tu respuesta</b>' : ''}${oi === q.correctOption ? ' ✅' : ''}</span></div>`;
    });
    const ref = q.url ? `<a href="${q.url}" target="_blank" class="reference-link">📖 Ver referencia</a>` : '';
    html += `<div class="review-question" style="border-left:4px solid ${isCorrect ? 'var(--ee-verde-exito)' : 'var(--ee-rojo)'}"><div class="review-question-header"><span class="q-number">Pregunta ${i + 1} ${flaggedQuestions[i] ? '🚩' : ''} ${isCorrect ? '✅' : '❌'}</span><div class="q-tags">${tags}</div></div><div class="review-question-text">${questionOnlyText(q)}</div>${imgHTML}<div>${opts}</div><div class="explanation-container"><div class="explanation-title">💡 Explicación:</div><div class="explanation-text">${q.explanation || 'No disponible.'}</div>${ref}</div></div>`;
  });
  container.innerHTML = html;
}
function downloadResults() {
  const s = document.createElement('style'); s.id = 'print-style';
  s.innerHTML = `@media print { body * { visibility: hidden; } #results-container, #results-container * { visibility: visible; } #results-container { position: absolute; left: 0; top: 0; width: 100%; } .action-buttons, .results-tabs { display: none !important; } }`;
  document.head.appendChild(s);
  document.querySelector('.tab[data-tab="stats"]')?.click();
  setTimeout(() => { window.print(); setTimeout(() => { document.getElementById('print-style')?.remove(); }, 500); }, 300);
}

// ===================================================================
// MAPEO DE SUBESPECIALIDADES (para guardar estadísticas por campo)
// ===================================================================
async function loadSubspecialityMapping() {
  try {
    const url = `${API_SIM}/${TBL_SUBESP}?pageSize=100&fields%5B%5D=Subespecialidad&fields%5B%5D=Variable`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Error ${r.status}`);
    const d = await r.json(); const mapping = {};
    d.records.forEach(x => {
      const sub = x.fields.Subespecialidad, v = x.fields.Variable;
      if (sub && v) mapping[sub] = { correctas: `${v}Correctas`, total: `${v}Total`, calificacion: `${v}Calificacion` };
    });
    if (Object.keys(mapping).length > 0) { console.log(`✅ ${Object.keys(mapping).length} subespecialidades mapeadas`); return mapping; }
    throw new Error('Mapeo vacío');
  } catch (e) {
    console.warn('⚠️ Usando mapeo de respaldo:', e.message);
    return SUBSPECIALITY_FALLBACK_MAP;
  }
}
const SUBSPECIALITY_FALLBACK_MAP = {
  "Adolescencia": { correctas: "AdolescenciaCorrectas", total: "AdolescenciaTotal", calificacion: "AdolescenciaCalificacion" },
  "Alteraciones relacionadas con la menstruación": { correctas: "Ginecologia GeneralCorrectas", total: "Ginecologia GeneralTotal", calificacion: "Ginecologia GeneralCalificacion" },
  "Amígdalas y Cuello": { correctas: "OrlCuelloCorrectas", total: "OrlCuelloTotal", calificacion: "OrlCuelloCalificacion" },
  "Angiología": { correctas: "AngiologiaCorrectas", total: "AngiologiaTotal", calificacion: "AngiologiaCalificacion" },
  "ATLS": { correctas: "AtlsCorrectas", total: "AtlsTotal", calificacion: "AtlsCalificacion" },
  "Cardiología": { correctas: "CardiologiaCorrectas", total: "CardiologiaTotal", calificacion: "CardiologiaCalificacion" },
  "Cardiología pediátrica": { correctas: "Cardiologia pediatricaCorrectas", total: "Cardiologia pediatricaTotal", calificacion: "Cardiologia pediatricaCalificacion" },
  "Cirugía general": { correctas: "Cirugia generalCorrectas", total: "Cirugia generalTotal", calificacion: "Cirugia generalCalificacion" },
  "Cirugía pediátrica": { correctas: "Cirugia PediatricaCorrectas", total: "Cirugia PediatricaTotal", calificacion: "Cirugia PediatricaCalificacion" },
  "Coloproctología": { correctas: "Colon y rectoCorrectas", total: "Colon y rectoTotal", calificacion: "Colon y rectoCalificacion" },
  "Columna": { correctas: "ColumnaCorrectas", total: "ColumnaTotal", calificacion: "ColumnaCalificacion" },
  "Complicaciones en el embarazo": { correctas: "ComplicacionesEmbarazoCorrectas", total: "ComplicacionesEmbarazoTotal", calificacion: "ComplicacionesEmbarazoCalificacion" },
  "Control Prenatal y Parto": { correctas: "ControlPrenatalCorrectas", total: "ControlPrenatalTotal", calificacion: "ControlPrenatalCalificacion" },
  "Crecimiento y desarrollo": { correctas: "Crecimiento y DesarrolloCorrectas", total: "Crecimiento y DesarrolloTotal", calificacion: "Crecimiento y DesarrolloCalificacion" },
  "Defectos de pared/hernias": { correctas: "HerniasCorrectas", total: "HerniasTotal", calificacion: "HerniasCalificacion" },
  "Dermatología": { correctas: "DermatologiaCorrectas", total: "DermatologiaTotal", calificacion: "DermatologiaCalificacion" },
  "Dermatología pediátrica": { correctas: "Dermatologia PediatricaCorrectas", total: "Dermatologia PediatricaTotal", calificacion: "Dermatologia PediatricaCalificacion" },
  "Dolor abdominal": { correctas: "DolorAbdominalCorrectas", total: "DolorAbdominalTotal", calificacion: "DolorAbdominalCalificacion" },
  "Endocrinología": { correctas: "EndocrinologiaCorrectas", total: "EndocrinologiaTotal", calificacion: "EndocrinologiaCalificacion" },
  "Endocrinología pediátrica": { correctas: "Endocrinologia pediatricaCorrectas", total: "Endocrinologia pediatricaTotal", calificacion: "Endocrinologia pediatricaCalificacion" },
  "Epidemiología": { correctas: "EpidemiologiaCorrectas", total: "EpidemiologiaTotal", calificacion: "EpidemiologiaCalificacion" },
  "Esófago y Estómago Clínico": { correctas: "GastroenterologiaCorrectas", total: "GastroenterologiaTotal", calificacion: "GastroenterologiaCalificacion" },
  "Esófago y Estómago Quirúrgico": { correctas: "EsofagoEstomagoCorrectas", total: "EsofagoEstomagoTotal", calificacion: "EsofagoEstomagoCalificacion" },
  "Estomatología": { correctas: "EstomatologiaCorrectas", total: "EstomatologiaTotal", calificacion: "EstomatologiaCalificacion" },
  "Farmacología": { correctas: "FarmacologíaCorrectas", total: "FarmacologíaTotal", calificacion: "FarmacologíaCalificacion" },
  "Fisiología": { correctas: "FisiologíaCorrectas", total: "FisiologíaTotal", calificacion: "FisiologíaCalificacion" },
  "Gastroenterología pediátrica": { correctas: "Gastroenterologia pediatricaCorrectas", total: "Gastroenterologia pediatricaTotal", calificacion: "Gastroenterologia pediatricaCalificacion" },
  "Genética": { correctas: "GeneticaCorrectas", total: "GeneticaTotal", calificacion: "GeneticaCalificacion" },
  "Geriatría": { correctas: "GeriatriaCorrectas", total: "GeriatriaTotal", calificacion: "GeriatriaCalificacion" },
  "Hematología": { correctas: "HematologiaCorrectas", total: "HematologiaTotal", calificacion: "HematologiaCalificacion" },
  "Hematología pediátrica": { correctas: "Hematologia pediatricaCorrectas", total: "Hematologia pediatricaTotal", calificacion: "Hematologia pediatricaCalificacion" },
  "Hígado": { correctas: "Higado y vias biliaresCorrectas", total: "Higado y vias biliaresTotal", calificacion: "Higado y vias biliaresCalificacion" },
  "Infectología": { correctas: "InfectologiaCorrectas", total: "InfectologiaTotal", calificacion: "InfectologiaCalificacion" },
  "Infectología pediátrica": { correctas: "Infectologia PediatricaCorrectas", total: "Infectologia PediatricaTotal", calificacion: "Infectologia PediatricaCalificacion" },
  "Infectología y Cérvix": { correctas: "Ginecologia infectologiaCorrectas", total: "Ginecologia infectologiaTotal", calificacion: "Ginecologia infectologiaCalificacion" },
  "Inmunología": { correctas: "InmunologiaCorrectas", total: "InmunologiaTotal", calificacion: "InmunologiaCalificacion" },
  "Intestino": { correctas: "IntestinoCorrectas", total: "IntestinoTotal", calificacion: "IntestinoCalificacion" },
  "Mama": { correctas: "Patologia de mamaCorrectas", total: "Patologia de mamaTotal", calificacion: "Patologia de mamaCalificacion" },
  "Menopausia": { correctas: "Ginecologia MenopausiaCorrectas", total: "Ginecologia MenopausiaTotal", calificacion: "Ginecologia MenopausiaCalificacion" },
  "Nariz": { correctas: "OrlNarizCorrectas", total: "OrlNarizTotal", calificacion: "OrlNarizCalificacion" },
  "Nefrología": { correctas: "NefrologiaCorrectas", total: "NefrologiaTotal", calificacion: "NefrologiaCalificacion" },
  "Nefrología pediátrica": { correctas: "Nefrologia pediatricaCorrectas", total: "Nefrologia pediatricaTotal", calificacion: "Nefrologia pediatricaCalificacion" },
  "Neonatología": { correctas: "NeonatologiaCorrectas", total: "NeonatologiaTotal", calificacion: "NeonatologiaCalificacion" },
  "Neumología": { correctas: "NeumologiaCorrectas", total: "NeumologiaTotal", calificacion: "NeumologiaCalificacion" },
  "Neumología pediátrica": { correctas: "Neumologia PediatricaCorrectas", total: "Neumologia PediatricaTotal", calificacion: "Neumologia PediatricaCalificacion" },
  "Neurología": { correctas: "NeurologiaCorrectas", total: "NeurologiaTotal", calificacion: "NeurologiaCalificacion" },
  "Neurología pediátrica": { correctas: "Neurologia pediatricaCorrectas", total: "Neurologia pediatricaTotal", calificacion: "Neurologia pediatricaCalificacion" },
  "Nutrición pediátrica": { correctas: "Nutricion pediatricaCorrectas", total: "Nutricion pediatricaTotal", calificacion: "Nutricion pediatricaCalificacion" },
  "Obstetricia": { correctas: "ObstetriciaCorrectas", total: "ObstetriciaTotal", calificacion: "ObstetriciaCalificacion" },
  "Oftalmología": { correctas: "OftalmologiaCorrectas", total: "OftalmologiaTotal", calificacion: "OftalmologiaCalificacion" },
  "Oftalmología - Cámara anterior": { correctas: "OftalmoAnteriorCorrectas", total: "OftalmoAnteriorTotal", calificacion: "OftalmoAnteriorCalificacion" },
  "Oftalmología - Cámara posterior": { correctas: "OftalmoPosteriorCorrectas", total: "OftalmoPosteriorTotal", calificacion: "OftalmoPosteriorCalificacion" },
  "Oftalmología - Órbita y Párpado": { correctas: "OftamoOrbitaCorrectas", total: "OftamoOrbitaTotal", calificacion: "OftamoOrbitaCalificacion" },
  "Oído": { correctas: "OrlOidoCorrectas", total: "OrlOidoTotal", calificacion: "OrlOidoCalificacion" },
  "Oncología": { correctas: "OncologiaCorrectas", total: "OncologiaTotal", calificacion: "OncologiaCalificacion" },
  "Oncología Ginecológica": { correctas: "Oncologia GinecologicaCorrectas", total: "Oncologia GinecologicaTotal", calificacion: "Oncologia GinecologicaCalificacion" },
  "Oncología pediátrica": { correctas: "Oncologia pediatricaCorrectas", total: "Oncologia pediatricaTotal", calificacion: "Oncologia pediatricaCalificacion" },
  "Ovario": { correctas: "OvarioCorrectas", total: "OvarioTotal", calificacion: "OvarioCalificacion" },
  "Pediatría general": { correctas: "Pediatria generalCorrectas", total: "Pediatria generalTotal", calificacion: "Pediatria generalCalificacion" },
  "Pediatría misceláneos": { correctas: "Pediatría misceláneosCorrectas", total: "Pediatría misceláneosTotal", calificacion: "Pediatría misceláneosCalificacion" },
  "Planificación familiar": { correctas: "Planificacion familiarCorrectas", total: "Planificacion familiarTotal", calificacion: "Planificacion familiarCalificacion" },
  "Psiquiatría": { correctas: "PsiquiatriaCorrectas", total: "PsiquiatriaTotal", calificacion: "PsiquiatriaCalificacion" },
  "Puerperio": { correctas: "PuerperioCorrectas", total: "PuerperioTotal", calificacion: "PuerperioCalificacion" },
  "Reumatología": { correctas: "ReumatologiaCorrectas", total: "ReumatologiaTotal", calificacion: "ReumatologiaCalificacion" },
  "Sangrado en el embarazo": { correctas: "Sangrado en el embarazoCorrectas", total: "Sangrado en el embarazoTotal", calificacion: "Sangrado en el embarazoCalificacion" },
  "Toxicología": { correctas: "ToxicologiaCorrectas", total: "ToxicologiaTotal", calificacion: "ToxicologiaCalificacion" },
  "Trabajo anormal de parto": { correctas: "PartoAnormalCorrectas", total: "PartoAnormalTotal", calificacion: "PartoAnormalCalificacion" },
  "Traumatología y ortopedia": { correctas: "Traumatologia y ortopediaCorrectas", total: "Traumatologia y ortopediaTotal", calificacion: "Traumatologia y ortopediaCalificacion" },
  "Traumatología y ortopedia pediátrica": { correctas: "Traumatologia y ortopedia pediatricaCorrectas", total: "Traumatologia y ortopedia pediatricaTotal", calificacion: "Traumatologia y ortopedia pediatricaCalificacion" },
  "TyO - Extremidades Inferiores": { correctas: "TyOInferiorCorrectas", total: "TyOInferiorTotal", calificacion: "TyOInferiorCalificacion" },
  "TyO - Extremidades Superiores": { correctas: "TyOSuperiorCorrectas", total: "TyOSuperiorTotal", calificacion: "TyOSuperiorCalificacion" },
  "Urgencias": { correctas: "UrgenciasCorrectas", total: "UrgenciasTotal", calificacion: "UrgenciasCalificacion" },
  "Urgencias pediátricas": { correctas: "Urgencias pediatricasCorrectas", total: "Urgencias pediatricasTotal", calificacion: "Urgencias pediatricasCalificacion" },
  "Urología": { correctas: "UrologiaCorrectas", total: "UrologiaTotal", calificacion: "UrologiaCalificacion" },
  "Uro-ginecología": { correctas: "GinecoUroCorrectas", total: "GinecoUroTotal", calificacion: "GinecoUroCalificacion" },
  "Útero": { correctas: "UteroCorrectas", total: "UteroTotal", calificacion: "UteroCalificacion" },
  "Vulva": { correctas: "VulvaCorrectas", total: "VulvaTotal", calificacion: "VulvaCalificacion" }
};

async function calculateDetailedStats() {
  if (!subspecialityMapping) subspecialityMapping = await loadSubspecialityMapping();
  const specialties = ["Medicina Interna","Cirugía","Pediatría","Ginecología y Obstetricia"];
  const topics = ["Medicina Familiar","Urgencias","Salud Pública"];
  const frequencies = ["No Preguntado","Poco Preguntado","Preguntado","Altamente Preguntado"];
  const stats = { specialties: {}, specialtyTopics: {}, frequencies: {}, subspecialties: {} };
  specialties.forEach(s => { stats.specialties[s] = { correct:0, total:0, percentage:0 }; stats.specialtyTopics[s] = {}; topics.forEach(t => { stats.specialtyTopics[s][t] = { correct:0, total:0, percentage:0 }; }); });
  frequencies.forEach(f => { stats.frequencies[f] = { correct:0, total:0, percentage:0 }; });
  Object.keys(subspecialityMapping).forEach(s => { stats.subspecialties[s] = { correct:0, total:0, percentage:0 }; });
  currentQuestions.forEach((q, i) => {
    const ok = userAnswers[i] === q.correctOption;
    if (q.specialty && stats.specialties[q.specialty]) { stats.specialties[q.specialty].total++; if (ok) stats.specialties[q.specialty].correct++; }
    if (q.specialty && q.topic && stats.specialtyTopics[q.specialty]?.[q.topic]) { stats.specialtyTopics[q.specialty][q.topic].total++; if (ok) stats.specialtyTopics[q.specialty][q.topic].correct++; }
    if (q.frequency && stats.frequencies[q.frequency]) { stats.frequencies[q.frequency].total++; if (ok) stats.frequencies[q.frequency].correct++; }
    if (q.subspeciality) {
      if (!stats.subspecialties[q.subspeciality]) stats.subspecialties[q.subspeciality] = { correct:0, total:0, percentage:0 };
      stats.subspecialties[q.subspeciality].total++; if (ok) stats.subspecialties[q.subspeciality].correct++;
    }
  });
  specialties.forEach(s => {
    if (stats.specialties[s].total > 0) stats.specialties[s].percentage = Math.round((stats.specialties[s].correct / stats.specialties[s].total) * 100);
    topics.forEach(t => { if (stats.specialtyTopics[s][t].total > 0) stats.specialtyTopics[s][t].percentage = Math.round((stats.specialtyTopics[s][t].correct / stats.specialtyTopics[s][t].total) * 100); });
  });
  frequencies.forEach(f => { if (stats.frequencies[f].total > 0) stats.frequencies[f].percentage = Math.round((stats.frequencies[f].correct / stats.frequencies[f].total) * 100); });
  Object.keys(stats.subspecialties).forEach(s => { if (stats.subspecialties[s].total > 0) stats.subspecialties[s].percentage = Math.round((stats.subspecialties[s].correct / stats.subspecialties[s].total) * 100); });
  return stats;
}

// ===================================================================
// GUARDADO DE RESULTADOS (tabla de resultados) — con respaldo escalonado
// ===================================================================
function resultLinkField() { return examSaveView === 'temas' ? 'Tema' : 'Subespecialidad'; }

// Nombres posibles de la columna de vínculo a tema en la tabla de resultados
const TEMA_LINK_ALTERNATIVAS = ['Tema', 'Temas'];

// Lee del mensaje de error de Airtable el nombre del campo rechazado y lo quita del payload
function stripRejectedField(fields, errorText) {
  const patterns = [
    /Field "([^"]+)" cannot accept/i,
    /Unknown field name:?\s*"?([^"\\]+)"?/i,
    /for field "([^"]+)"/i,
    /field "([^"]+)"/i,
    /Field "([^"]+)"/i
  ];
  for (let i = 0; i < patterns.length; i++) {
    const m = errorText.match(patterns[i]);
    if (m && m[1] && Object.prototype.hasOwnProperty.call(fields, m[1])) { delete fields[m[1]]; return m[1]; }
  }
  // Último recurso: si el error no nombró un campo, quita los vínculos del simulador uno por uno
  const linkFallback = ['Temas', 'Tema', 'Subespecialidad'];
  for (const lf of linkFallback) {
    if (Object.prototype.hasOwnProperty.call(fields, lf)) { delete fields[lf]; return lf; }
  }
  return null;
}

// Guarda un registro y, si Airtable rechaza algún campo (calculado o inexistente),
// lo quita automáticamente y reintenta. Si el rechazo fue la columna de tema,
// prueba el siguiente nombre alternativo ('Tema' → 'Temas').
async function postResultRecord(fields, recordId) {
  const work = {};
  Object.keys(fields).forEach(k => { if (fields[k] !== undefined) work[k] = fields[k]; });
  const base = `${API_SIM}/${TBL_SIM_RESULT}`;
  for (let intento = 0; intento < 40; intento++) {
    if (Object.keys(work).length === 0) throw new Error('No quedaron campos válidos para guardar');
    const r = await fetch(recordId ? `${base}/${recordId}` : base, {
      method: recordId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: work, typecast: true })
    });
    if (r.ok) return await r.json();
    const t = await r.text();
    if (r.status === 422) {
      const removed = stripRejectedField(work, t);
      if (removed) {
        console.warn('Campo omitido en resultados:', removed, '· error:', t);
        // Si el campo rechazado era el vínculo del tema, intenta con el siguiente nombre posible
        if (examSaveView === 'temas' && selectedSimulatorId) {
          const idx = TEMA_LINK_ALTERNATIVAS.indexOf(removed);
          if (idx >= 0 && idx + 1 < TEMA_LINK_ALTERNATIVAS.length) {
            const siguiente = TEMA_LINK_ALTERNATIVAS[idx + 1];
            work[siguiente] = [selectedSimulatorId];
            console.warn('Reintentando el vínculo del tema con el campo:', siguiente);
          }
        }
        continue;
      }
    }
    console.error('Error de Airtable (resultados):', r.status, t);
    throw new Error(`${r.status}: ${t}`);
  }
  throw new Error('Demasiados campos rechazados al guardar resultados');
}

// Construye los campos del resultado con los NOMBRES REALES de la tabla de resultados.
function buildResultFields(calificacion, results, detailed, feedbackData) {
  const uid = getUserRecordId();
  const sp = detailed.specialties || {};
  const st = detailed.specialtyTopics || {};
  const fr = detailed.frequencies || {};
  const g = o => o || { correct: 0, total: 0, percentage: 0 };
  const fields = {
    'Alumno': uid ? [uid] : undefined,
    'Subespecialidad': (examSaveView === 'subespecialidades' && selectedSimulatorId) ? [selectedSimulatorId] : undefined,
    'Tema': (examSaveView === 'temas' && selectedSimulatorId) ? [selectedSimulatorId] : undefined,
    'Calificación': Math.round(calificacion),
    'Tiempo Total': formatTime(elapsedSeconds),

    // Especialidades
    'Medicina internaCorrectas': g(sp["Medicina Interna"]).correct, 'Medicina internaTotal': g(sp["Medicina Interna"]).total, 'Medicina internaCalificacion': g(sp["Medicina Interna"]).percentage,
    'CirugíaCorrectas': g(sp["Cirugía"]).correct, 'CirugíaTotal': g(sp["Cirugía"]).total, 'CirugíaCalificacion': g(sp["Cirugía"]).percentage,
    'PediatríaCorrectas': g(sp["Pediatría"]).correct, 'PediatríaTotal': g(sp["Pediatría"]).total, 'PediatríaCalificacion': g(sp["Pediatría"]).percentage,
    'Ginecología y obstetriciaCorrectas': g(sp["Ginecología y Obstetricia"]).correct, 'Ginecología y obstetriciaTotal': g(sp["Ginecología y Obstetricia"]).total, 'Ginecología y obstetriciaCalificacion': g(sp["Ginecología y Obstetricia"]).percentage,

    // Temas por especialidad — Medicina Familiar
    'Medicina Interna Medicina FamiliarCorrectas': g(st["Medicina Interna"]?.["Medicina Familiar"]).correct, 'Cirugía Medicina FamiliarCorrectas': g(st["Cirugía"]?.["Medicina Familiar"]).correct, 'Pediatría Medicina FamiliarCorrectas': g(st["Pediatría"]?.["Medicina Familiar"]).correct, 'Ginecología y obstetricia Medicina FamiliarCorrectas': g(st["Ginecología y Obstetricia"]?.["Medicina Familiar"]).correct,
    'Medicina Interna Medicina FamiliarTotal': g(st["Medicina Interna"]?.["Medicina Familiar"]).total, 'Cirugía Medicina FamiliarTotal': g(st["Cirugía"]?.["Medicina Familiar"]).total, 'Pediatría Medicina FamiliarTotal': g(st["Pediatría"]?.["Medicina Familiar"]).total, 'Ginecología y obstetricia Medicina FamiliarTotal': g(st["Ginecología y Obstetricia"]?.["Medicina Familiar"]).total,
    'Medicina Interna Medicina FamiliarCalificacion': g(st["Medicina Interna"]?.["Medicina Familiar"]).percentage, 'Cirugía Medicina FamiliarCalificacion': g(st["Cirugía"]?.["Medicina Familiar"]).percentage, 'Pediatría Medicina FamiliarCalificacion': g(st["Pediatría"]?.["Medicina Familiar"]).percentage, 'Ginecología y obstetricia Medicina FamiliarCalificacion': g(st["Ginecología y Obstetricia"]?.["Medicina Familiar"]).percentage,

    // Temas por especialidad — Salud Pública
    'Medicina Interna Salud PúblicaCorrectas': g(st["Medicina Interna"]?.["Salud Pública"]).correct, 'Cirugía Salud PúblicaCorrectas': g(st["Cirugía"]?.["Salud Pública"]).correct, 'Pediatría Salud PúblicaCorrectas': g(st["Pediatría"]?.["Salud Pública"]).correct, 'Ginecología y obstetricia Salud PúblicaCorrectas': g(st["Ginecología y Obstetricia"]?.["Salud Pública"]).correct,
    'Medicina Interna Salud PúblicaTotal': g(st["Medicina Interna"]?.["Salud Pública"]).total, 'Cirugía Salud PúblicaTotal': g(st["Cirugía"]?.["Salud Pública"]).total, 'Pediatría Salud PúblicaTotal': g(st["Pediatría"]?.["Salud Pública"]).total, 'Ginecología y obstetricia Salud PúblicaTotal': g(st["Ginecología y Obstetricia"]?.["Salud Pública"]).total,
    'Medicina Interna Salud PúblicaCalificacion': g(st["Medicina Interna"]?.["Salud Pública"]).percentage, 'Cirugía Salud PúblicaCalificacion': g(st["Cirugía"]?.["Salud Pública"]).percentage, 'Pediatría Salud PúblicaCalificacion': g(st["Pediatría"]?.["Salud Pública"]).percentage, 'Ginecología y obstetricia Salud PúblicaCalificacion': g(st["Ginecología y Obstetricia"]?.["Salud Pública"]).percentage,

    // Temas por especialidad — Urgencias
    'Medicina Interna UrgenciasCorrectas': g(st["Medicina Interna"]?.["Urgencias"]).correct, 'Cirugía UrgenciasCorrectas': g(st["Cirugía"]?.["Urgencias"]).correct, 'Pediatría UrgenciasCorrectas': g(st["Pediatría"]?.["Urgencias"]).correct, 'Ginecología y obstetricia UrgenciasCorrectas': g(st["Ginecología y Obstetricia"]?.["Urgencias"]).correct,
    'Medicina Interna UrgenciasTotal': g(st["Medicina Interna"]?.["Urgencias"]).total, 'Cirugía UrgenciasTotal': g(st["Cirugía"]?.["Urgencias"]).total, 'Pediatría UrgenciasTotal': g(st["Pediatría"]?.["Urgencias"]).total, 'Ginecología y obstetricia UrgenciasTotal': g(st["Ginecología y Obstetricia"]?.["Urgencias"]).total,
    'Medicina Interna UrgenciasCalificacion': g(st["Medicina Interna"]?.["Urgencias"]).percentage, 'Cirugía UrgenciasCalificacion': g(st["Cirugía"]?.["Urgencias"]).percentage, 'Pediatría UrgenciasCalificacion': g(st["Pediatría"]?.["Urgencias"]).percentage, 'Ginecología y obstetricia UrgenciasCalificacion': g(st["Ginecología y Obstetricia"]?.["Urgencias"]).percentage,

    // Frecuencias
    'No preguntadas Correctas': g(fr["No Preguntado"]).correct, 'No preguntadas Total': g(fr["No Preguntado"]).total,
    'Poco preguntadas Correctas': g(fr["Poco Preguntado"]).correct, 'Poco preguntadas Total': g(fr["Poco Preguntado"]).total,
    'Preguntadas Correctas': g(fr["Preguntado"]).correct, 'Preguntadas Total': g(fr["Preguntado"]).total,
    'Altamente Preguntadas Correctas': g(fr["Altamente Preguntado"]).correct, 'Altamente Preguntadas Total': g(fr["Altamente Preguntado"]).total,

    // Feedback
    'Calif. Simulador': feedbackData.experiencia ? parseInt(feedbackData.experiencia) : undefined,
    'Calidad': feedbackData.calidad ? parseInt(feedbackData.calidad) : undefined,
    'Comentarios': feedbackData.comentarios || ''
  };

  // Subespecialidades: usa el mapeo por 'Variable' (nombres reales de columna)
  Object.keys(detailed.subspecialties || {}).forEach(name => {
    const d = detailed.subspecialties[name];
    const m = subspecialityMapping && subspecialityMapping[name];
    if (m && d && d.total > 0) { fields[m.correctas] = d.correct; fields[m.total] = d.total; fields[m.calificacion] = d.percentage; }
  });

  return fields;
}

async function sendDetailedResultsToAirtable(calificacion, results, detailed, feedbackData) {
  try {
    if (!subspecialityMapping) subspecialityMapping = await loadSubspecialityMapping();
    await postResultRecord(buildResultFields(calificacion, results, detailed, feedbackData));
    console.log('✅ Resultado guardado en la tabla de resultados (con desglose)');
    return true;
  } catch (e1) {
    console.warn('Guardado en Airtable falló, uso webhook de respaldo:', e1.message);
    await fallbackToWebhook(calificacion, results, detailed, feedbackData);
    return false;
  }
}
async function fallbackToWebhook(calificacion, results, detailed, feedbackData) {
  try {
    const uid = getUserRecordId();
    const payload = {
      tipo: 'resultado_simulador',
      simulador: SIM_TIPO,
      origen: examSaveView,
      campoDestino: resultLinkField(),
      simuladorId: selectedSimulatorId,
      simuladorNombre: selectedSimulatorName,
      correo: getUserEmail(),
      alumnoRecordId: uid,
      calificacion, correctas: results.correct, totales: results.total,
      tiempoTotal: formatTime(elapsedSeconds),
      fecha: new Date().toISOString(),
      feedback: feedbackData,
      detalle: detailed
    };
    await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    console.log('📤 Resultado enviado por webhook (respaldo)');
  } catch (e) { console.error('Webhook de respaldo también falló:', e); }
}

// ===================================================================
// GUARDADO DE HISTORIAL COMPLETO (tabla de historial)
// ===================================================================
async function saveCompleteExamHistory(results, feedbackData, calificacion) {
  try {
    const uid = getUserRecordId();
    if (!uid) { console.warn('Sin recordId de usuario, no se guarda historial'); return; }
    const answerSummary = currentQuestions.map((q, i) => ({
      id: q.id,
      respuesta: userAnswers[i],
      correcta: q.correctOption,
      acierto: userAnswers[i] === q.correctOption,
      marcada: !!flaggedQuestions[i]
    }));
    const datos = {
      type: 'completed',
      simTipo: SIM_TIPO,
      simulatorId: selectedSimulatorId, simulatorName: selectedSimulatorName,
      examSaveView, examMode,
      questionIds: currentQuestions.map(q => q.id),
      answerSummary,
      calificacion, correctas: results.correct, totales: results.total,
      tiempoSegundos: elapsedSeconds,
      feedback: feedbackData,
      finishedAt: new Date().toISOString()
    };
    const now = new Date();
    const fields = {
      'Alumno': [uid],
      [historyLinkField()]: selectedSimulatorId ? [selectedSimulatorId] : undefined,
      'Fecha Examen': now.toISOString().split('T')[0],
      'Hora Examen': now.toISOString().split('T')[1].split('.')[0],
      'Preguntas Totales': currentQuestions.length,
      'Respuestas Correctas': results.correct,
      'Respuestas Incorrectas': results.incorrect,
      'Tiempo Total': formatTime(elapsedSeconds),
      'Calificación': Math.round(calificacion),
      'Datos Completos Examen': JSON.stringify(datos),
      'Estado': 'Completado'
    };
    Object.keys(fields).forEach(k => { if (fields[k] === undefined) delete fields[k]; });
    const base = `${API_SIM}/${TBL_SIM_HIST}`;
    const headers = { 'Content-Type': 'application/json' };
    if (pausedRecordId) {
      // Convierte la pausa "En Progreso" en "Completado"
      const r = await fetch(`${base}/${pausedRecordId}`, { method: 'PATCH', headers, body: JSON.stringify({ fields, typecast: true }) });
      if (r.ok) { console.log('✅ Historial actualizado (pausa → completado)'); if (cloudPauses[selectedSimulatorId]) delete cloudPauses[selectedSimulatorId]; pausedRecordId = null; return; }
      console.warn('PATCH historial falló, creando registro nuevo');
    }
    const r = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ fields, typecast: true }) });
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    if (cloudPauses[selectedSimulatorId]) delete cloudPauses[selectedSimulatorId];
    console.log('✅ Historial completo guardado');
  } catch (e) { console.error('saveCompleteExamHistory:', e); }
}

// ===================================================================
// ENVÍO DE FEEDBACK → GUARDA RESULTADOS + HISTORIAL → MUESTRA RESULTADOS
// ===================================================================
let feedbackSubmitting = false;
async function submitFeedbackDetailed() {
  if (feedbackSubmitting) return;
  const exp = document.querySelector('input[name="experiencia"]:checked');
  const cal = document.querySelector('input[name="calidad"]:checked');
  if (!exp || !cal) { showErrorNotification('Por favor califica tu experiencia y la calidad del contenido'); return; }
  feedbackSubmitting = true;
  const btn = document.getElementById('submit-feedback');
  btn.disabled = true; btn.textContent = '⏳ Guardando resultados...';

  const feedbackData = {
    experiencia: exp.value,
    calidad: cal.value,
    comentarios: (document.getElementById('comentarios').value || '').trim()
  };

  const results = calculateResults();
  const calificacion = results.percentage;
  let detailed;
  try { detailed = await calculateDetailedStats(); }
  catch (e) { console.error('calculateDetailedStats:', e); detailed = { specialties:{}, specialtyTopics:{}, frequencies:{}, subspecialties:{} }; }

  try {
    await Promise.all([
      sendDetailedResultsToAirtable(calificacion, results, detailed, feedbackData),
      saveCompleteExamHistory(results, feedbackData, calificacion)
    ]);
  } catch (e) { console.error('Error guardando:', e); }

  clearLocalProgress();

  // Poblar UI de resultados
  document.getElementById('final-score').textContent = calificacion + '%';
  document.getElementById('correct-answers').textContent = results.correct;
  document.getElementById('incorrect-answers').textContent = results.total - results.correct;
  document.getElementById('total-time').textContent = formatTime(elapsedSeconds);
  generateStatisticalAnalysis(results);
  generateReview();

  document.getElementById('feedback-container').style.display = 'none';
  document.getElementById('results-container').style.display = 'block';
  feedbackSubmitting = false;
  window.scrollTo(0, 0);
}

// Pestañas de resultados
function wireTabs() {
  document.querySelectorAll('.results-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.results-tabs .tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab === 'review' ? 'tab-review' : 'tab-stats';
      document.getElementById(target).classList.add('active');
    });
  });
}

// ===================================================================
// CARGA DEL CATÁLOGO
// ===================================================================
async function loadSetup() {
  const grid = document.getElementById('simulators-grid');
  grid.innerHTML = `<div class="grid-empty"><div class="loading-spinner"></div><p>Cargando simuladores...</p></div>`;
  document.getElementById('error-container').style.display = 'none';
  const pFolders = currentView === 'temas' ? loadTemaFolders() : loadSubespFolders();
  const pCompleted = loadCompletedMap();
  const pPauses = findAllCloudPauses();
  try {
    const rawFolders = await pFolders;
    loadedFolders = rawFolders.map(f => ({ ...f, completed: false, score: null }));
    updateFilterVisibility();
    filterSimulators();
    const [completedMap, pauses] = await Promise.all([pCompleted, pPauses]);
    cloudPauses = pauses;
    loadedFolders = rawFolders.map(f => ({ ...f, completed: completedMap.has(f.id), score: completedMap.has(f.id) ? completedMap.get(f.id) : null }));
    filterSimulators();
  } catch (e) {
    console.error('loadSetup:', e);
    grid.innerHTML = '';
    document.getElementById('error-message').textContent = 'No se pudieron cargar los simuladores: ' + e.message;
    document.getElementById('error-container').style.display = 'block';
  }
}

// ===================================================================
// LANZAMIENTO DIRECTO POR URL (?tema=recXXX / ?subespecialidad=recYYY)
// ===================================================================
async function initDirectLaunch(recordId, view) {
  currentView = view;
  const toggle = document.getElementById('view-toggle');
  toggle.classList.toggle('temas', currentView === 'temas');
  toggle.querySelectorAll('.vt-opt').forEach(o => o.classList.toggle('active', o.dataset.view === currentView));
  document.getElementById('sort-by').value = currentView === 'subespecialidades' ? 'easyscore-desc' : 'az';
  await loadSetup();
  try {
    let folder = loadedFolders.find(f => f.id === recordId);
    if (!folder) folder = await loadSingleFolder(recordId, view);
    if (folder) openStartModal(folder);
    else showErrorNotification('No se encontró el simulador solicitado');
  } catch (e) {
    console.error('initDirectLaunch:', e);
    showErrorNotification('No se pudo abrir el simulador del enlace: ' + e.message);
  }
}

// ===================================================================
// INICIALIZACIÓN
// ===================================================================
document.addEventListener('DOMContentLoaded', function() {
  applyZoom();
  setupHistoryLink();
  wireTabs();
  updateFilterVisibility();
  document.getElementById('sort-by').value = 'easyscore-desc';
  const direct = getDirectLaunchParams();
  if (direct) initDirectLaunch(direct.recordId, direct.view);
  else loadSetup();
});
