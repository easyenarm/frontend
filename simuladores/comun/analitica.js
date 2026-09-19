(function () {
  'use strict';
  if (window.__EE_SIM_ANALITICA__) return;
  window.__EE_SIM_ANALITICA__ = true;

  var CFG = Object.assign({ origen: '', comparativa: false }, window.EE_SIM_CFG || {});

  function cq()  { try { return (typeof currentQuestions !== 'undefined' && currentQuestions) ? currentQuestions : []; } catch (e) { return []; } }
  function ua()  { try { return (typeof userAnswers !== 'undefined' && userAnswers) ? userAnswers : []; } catch (e) { return []; } }
  function gStr(get) { try { var v = get(); return v == null ? '' : v; } catch (e) { return ''; } }
  function gNum(get) { try { var v = get(); return v == null ? 0 : v; } catch (e) { return 0; } }

  var SIM_BASE = ((typeof API_SIM !== 'undefined' && API_SIM) ? API_SIM : 'https://easyenarm-api.hola-7f8.workers.dev/api').replace(/\/api\/?$/, '');
  var EP = SIM_BASE + '/sim';

  var COL_ESP = {
    'Medicina Interna': '#9073b2', 'Cirugía': '#204D98', 'Pediatría': '#a3be4f',
    'Ginecología y Obstetricia': '#DB7FA6', 'Ginecología': '#DB7FA6', 'Obstetricia': '#DB7FA6',
    'Ciencias Básicas': '#E0A800'
  };
  var PASTEL_ESP = {
    'Medicina Interna': '#f1ecf8', 'Cirugía': '#e8f0fb', 'Pediatría': '#eef5e2',
    'Ginecología y Obstetricia': '#fbecf3', 'Ginecología': '#fbecf3', 'Obstetricia': '#fbecf3',
    'Ciencias Básicas': '#fdf6da'
  };
  var ESP_SHORT = {
    'Medicina Interna': 'Med. Interna', 'Cirugía': 'Cirugía', 'Pediatría': 'Pediatría',
    'Ginecología y Obstetricia': 'Gineco-Obs', 'Ginecología': 'Gineco', 'Obstetricia': 'Obstetricia',
    'Ciencias Básicas': 'C. Básicas'
  };
  var DIF_LABEL = { facil: 'Fácil', medio: 'Medio', dificil: 'Difícil' };
  var DIF_COLOR = { facil: '#a3be4f', medio: '#E0A800', dificil: '#e75660' };
  var COL_TU = '#204D98', COL_GRUPO = '#8aa3c8';
  var LEG = '<div class="ee-an-leg"><span><i class="dot"></i>Tú</span><span><i class="dash"></i>Grupo</span></div>';

  var firstAns = {}, changeCount = {}, qTime = {}, intentoId = null;
  var lastTick = Date.now();

  function normDif(d) {
    var s = String(d || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    if (s.indexOf('fac') === 0) return 'facil';
    if (s.indexOf('dif') === 0) return 'dificil';
    return s ? 'medio' : '';
  }
  function uuid() { return 'sim_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10); }
  function escHTML(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function escSVG(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function shortLabel(s) { s = String(s || ''); return s.length > 16 ? s.slice(0, 15) + '…' : s; }
  function shortEsp(k) { return ESP_SHORT[k] || shortLabel(k); }
  function fmt(ms) { var s = Math.round(ms / 1000); if (s < 60) return s + 's'; var m = Math.floor(s / 60), r = s % 60; return m + 'm' + (r ? ' ' + r + 's' : ''); }
  function acc(o, k, ok) { if (!k) return; if (!o[k]) o[k] = { ok: 0, total: 0 }; o[k].total++; if (ok) o[k].ok++; }
  function pct(o, k) { var x = o[k]; return x && x.total ? Math.round(100 * x.ok / x.total) : 0; }
  // Número de la tarjeta, tolerante al prefijo del id (question-card-N o qcard-N)
  function cardNum(card) { try { return parseInt(String(card.id || '').split('-').pop(), 10); } catch (e) { return NaN; } }

  // ================================================================
  // 1 · INSTRUMENTACIÓN
  // ================================================================
  var _sel = window.selectAnswer;
  if (typeof _sel === 'function') {
    window.selectAnswer = function (qIndex, optIndex) {
      try {
        var Q = cq(), UA = ua();
        var q = Q[qIndex];
        if (q) {
          if (!(q.id in firstAns)) firstAns[q.id] = optIndex;
          var prev = UA[qIndex];
          if (prev != null && prev !== optIndex) changeCount[q.id] = (changeCount[q.id] || 0) + 1;
        }
      } catch (e) {}
      return _sel.apply(this, arguments);
    };
  }

  var _enter = window.enterExamMode;
  if (typeof _enter === 'function') {
    window.enterExamMode = function () {
      firstAns = {}; changeCount = {}; qTime = {}; intentoId = uuid(); lastTick = Date.now();
      var r = _enter.apply(this, arguments);
      try {
        var Q = cq(), UA = ua();
        Q.forEach(function (q, i) { var a = UA[i]; if (a != null) firstAns[q.id] = a; });
      } catch (e) {}
      return r;
    };
  }

  function cardMasCentrada() {
    var cards = document.querySelectorAll('#exam-content .question-card');
    if (!cards.length) return null;
    if (cards.length === 1) return cards[0];
    var vc = window.innerHeight / 2, best = null, bd = 1e9;
    for (var i = 0; i < cards.length; i++) {
      var r = cards[i].getBoundingClientRect();
      if (r.bottom < 60 || r.top > window.innerHeight - 60) continue;
      var d = Math.abs((r.top + r.bottom) / 2 - vc);
      if (d < bd) { bd = d; best = cards[i]; }
    }
    return best;
  }
  setInterval(function () {
    try {
      var cont = document.getElementById('exam-container');
      var now = Date.now(), dt = now - lastTick; lastTick = now;
      if (!cont || !cont.classList.contains('active')) return;
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      if (dt <= 0 || dt > 4000) return;
      var card = cardMasCentrada();
      if (!card) return;
      var idx = cardNum(card);
      var q = cq()[idx];
      if (q) qTime[q.id] = (qTime[q.id] || 0) + dt;
    } catch (e) {}
  }, 500);

  // ================================================================
  // 2 · AL FINALIZAR
  // ================================================================
  var _submit = window.submitFeedbackDetailed;
  if (typeof _submit === 'function') {
    window.submitFeedbackDetailed = async function () {
      var r = await _submit.apply(this, arguments);
      try {
        var rc = document.getElementById('results-container');
        if (rc && rc.style.display === 'block' && !document.getElementById('ee-analitica')) {
          await afterFinish();
        }
      } catch (e) { console.error('Analítica D1:', e); }
      return r;
    };
  }

  async function afterFinish() {
    var Q = cq(), UA = ua();
    var res;
    try { res = (typeof calculateResults === 'function') ? calculateResults() : null; } catch (e) { res = null; }
    if (!res) res = { percentage: 0, total: Q.length, answered: 0, correct: 0, incorrect: 0 };

    var preguntas = [], cbm = 0, cmb = 0, cmm = 0;
    var stuEsp = {}, stuSub = {}, stuDif = {}, subToEsp = {};

    Q.forEach(function (q, i) {
      var id = q.id, correct = q.correctOption;
      var final = (UA[i] == null) ? null : UA[i];
      var first = (id in firstAns) ? firstAns[id] : null;
      var finalOk = final != null && final === correct;
      var firstOk = first != null && first === correct;
      var trans = '';
      if (final != null && first != null && first !== final) {
        if (firstOk && !finalOk) { trans = 'bien_mal'; cbm++; }
        else if (!firstOk && finalOk) { trans = 'mal_bien'; cmb++; }
        else if (!firstOk && !finalOk) { trans = 'mal_mal'; cmm++; }
      }
      var t = Math.round(qTime[id] || 0);
      preguntas.push({
        pregunta: id, esp: q.specialty || '', sub: q.subspeciality || '', tema: q.topic || '',
        dificultad: q.difficulty || '', frecuencia: q.frequency || '',
        primera: first, final: final, correcta: finalOk ? 1 : 0, primera_ok: firstOk ? 1 : 0,
        cambios: changeCount[id] || 0, transicion: trans, tiempo_ms: t
      });
      if (final != null) {
        acc(stuDif, normDif(q.difficulty), finalOk);
        if (q.specialty) acc(stuEsp, q.specialty, finalOk);
        if (q.subspeciality) { acc(stuSub, q.subspeciality, finalOk); if (q.specialty) subToEsp[q.subspeciality] = q.specialty; }
      }
    });

    var simNombre = gStr(function () { return selectedSimulatorName; });
    var payload = {
      intento_id: intentoId || uuid(),
      alumno: gStr(function () { return (typeof getUserRecordId === 'function') ? getUserRecordId() : ''; }),
      simulador: gStr(function () { return selectedSimulatorId; }),
      simulador_nombre: simNombre,
      origen: CFG.origen || '',
      modo: gStr(function () { return examMode; }),
      calificacion: res.percentage, total: res.total, contestadas: res.answered, correctas: res.correct,
      tiempo_total_s: gNum(function () { return elapsedSeconds; }),
      cambios_bien_mal: cbm, cambios_mal_bien: cmb, cambios_mal_mal: cmm,
      datos: {
        examId: intentoId, origen: CFG.origen || '', simulatorName: simNombre, completedAt: new Date().toISOString(),
        percentage: res.percentage, correctAnswers: res.correct, incorrectAnswers: res.incorrect,
        totalQuestions: res.total, timeSpent: (document.getElementById('time-counter') || {}).textContent || '',
        answerSummary: preguntas.map(function (p) {
          return { id: p.pregunta, userAnswer: p.final, isCorrect: !!p.correcta, firstAnswer: p.primera, changes: p.cambios, transition: p.transicion, timeMs: p.tiempo_ms };
        })
      },
      preguntas: preguntas
    };

    try {
      await fetch(EP + '/intento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } catch (e) { console.warn('No se pudo guardar en D1:', e); }

    var comp = null, pop = {};
    try {
      var ids = preguntas.filter(function (p) { return p.final != null; }).map(function (p) { return p.pregunta; });
      var tareas = [traePreguntas(ids)];
      if (CFG.comparativa) tareas.push(traeComparativa(payload.simulador, res.percentage)); else tareas.push(Promise.resolve(null));
      var out = await Promise.all(tareas);
      pop = out[0] || {}; comp = out[1];
    } catch (e) {}

    render(res, { cbm: cbm, cmb: cmb, cmm: cmm }, stuEsp, stuSub, stuDif, subToEsp, comp, pop, preguntas, Q);
  }

  async function traeComparativa(sim, score) {
    if (!sim) return null;
    try {
      var r = await fetch(EP + '/comparativa?simulador=' + encodeURIComponent(sim) + '&score=' + (score | 0));
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  }
  async function traePreguntas(ids) {
    var out = {};
    for (var i = 0; i < ids.length; i += 100) {
      var chunk = ids.slice(i, i + 100);
      try {
        var r = await fetch(EP + '/preguntas?ids=' + chunk.join(','));
        if (r.ok) { var d = await r.json(); Object.assign(out, d.preguntas || {}); }
      } catch (e) {}
    }
    return out;
  }

  // ================================================================
  // 3 · RADAR
  // ================================================================
  function wrap2(s) {
    s = String(s || '').trim();
    if (s.length <= 12) return [s];
    var mid = Math.floor(s.length / 2);
    var li = s.lastIndexOf(' ', mid), ri = s.indexOf(' ', mid + 1), pos = -1;
    if (li > 0 && ri > 0) pos = (mid - li <= ri - mid) ? li : ri;
    else pos = Math.max(li, ri);
    var a, b;
    if (pos > 0) { a = s.slice(0, pos).trim(); b = s.slice(pos + 1).trim(); }
    else { a = s.slice(0, 12); b = s.slice(12); }
    if (a.length > 16) a = a.slice(0, 15) + '…';
    if (b.length > 16) b = b.slice(0, 15) + '…';
    return b ? [a, b] : [a];
  }
  function svgLabel(x, y, anchor, color, label) {
    var lines = wrap2(label);
    var attrs = 'text-anchor="' + anchor + '" font-size="9.5" font-weight="700" fill="' + color + '" font-family="Fredoka,sans-serif"';
    if (lines.length === 1) {
      return '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" dominant-baseline="middle" ' + attrs + '>' + escSVG(lines[0]) + '</text>';
    }
    return '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" ' + attrs + '>' +
      '<tspan x="' + x.toFixed(1) + '" dy="-0.25em">' + escSVG(lines[0]) + '</tspan>' +
      '<tspan x="' + x.toFixed(1) + '" dy="1.05em">' + escSVG(lines[1]) + '</tspan></text>';
  }
  function radarSVG(axes, series, size) {
    size = size || 300;
    var PADX = 50;
    var cx = size / 2, cy = size / 2, R = size * 0.30, N = axes.length;
    var ang = function (i) { return (-Math.PI / 2) + i * 2 * Math.PI / N; };
    var pt = function (i, r) { return [cx + Math.cos(ang(i)) * R * r, cy + Math.sin(ang(i)) * R * r]; };
    var g = '';
    [0.25, 0.5, 0.75, 1].forEach(function (r) {
      var d = axes.map(function (_, i) { var p = pt(i, r); return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ') + ' Z';
      g += '<path d="' + d + '" fill="none" stroke="rgba(32,77,152,.12)" stroke-width="1"/>';
    });
    axes.forEach(function (a, i) {
      var p = pt(i, 1);
      g += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '" stroke="rgba(32,77,152,.12)" stroke-width="1"/>';
      var lp = pt(i, 1.13);
      var anchor = Math.abs(lp[0] - cx) < 12 ? 'middle' : (lp[0] > cx ? 'start' : 'end');
      g += svgLabel(lp[0], lp[1], anchor, a.color || COL_TU, a.label);
    });
    series.forEach(function (s) {
      var d = axes.map(function (_, i) { var v = Math.max(0, Math.min(100, s.values[i] || 0)) / 100, p = pt(i, v); return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ') + ' Z';
      g += '<path d="' + d + '" fill="' + (s.fill || 'none') + '" stroke="' + s.color + '" stroke-width="2" ' + (s.dash ? 'stroke-dasharray="5 4"' : '') + ' stroke-linejoin="round"/>';
      axes.forEach(function (a, i) { var v = Math.max(0, Math.min(100, s.values[i] || 0)) / 100, p = pt(i, v); g += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.6" fill="' + (s.dot || a.color || s.color) + '"/>'; });
    });
    return '<svg viewBox="' + (-PADX) + ' 0 ' + (size + 2 * PADX) + ' ' + size + '" width="100%" style="width:100%;max-width:' + (size + 2 * PADX) + 'px" role="img" aria-label="Radar de rendimiento">' + g + '</svg>';
  }
  function barras(items) {
    return '<div class="ee-an-bars">' + items.map(function (it) {
      return '<div class="ee-an-bar"><div class="ee-an-bar-top"><span>' + escHTML(it.label) + '</span><b style="color:' + it.color + '">' + it.stu + '%</b></div>' +
        '<div class="ee-an-track"><span style="width:' + it.stu + '%;background:' + it.color + '"></span></div>' +
        (it.grp != null ? '<div class="ee-an-grp">Grupo: ' + it.grp + '%</div>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function card(title, inner, legend, opts) {
    opts = opts || {};
    var st = '';
    if (opts.bg) st += 'background:' + opts.bg + ';border-color:transparent;';
    if (opts.accent) st += 'border-top:4px solid ' + opts.accent + ';';
    var h = '<h4' + (opts.accent ? ' style="color:' + opts.accent + '"' : '') + '>' + escHTML(title) + '</h4>';
    return '<div class="ee-an-card" style="' + st + '">' + h + (legend || '') + inner + '</div>';
  }
  function radarCard(title, keys, labelFn, colorFn, stuObj, grpObj, stuColor, opts) {
    var axes = keys.map(function (k) { return { label: labelFn(k), color: colorFn(k) }; });
    var stu = { color: stuColor || COL_TU, dot: stuColor || COL_TU, fill: hexA(stuColor || '#48ACEA', .20), values: keys.map(function (k) { return pct(stuObj, k); }) };
    var series = [stu], leg = '';
    if (grpObj) { series.push({ color: COL_GRUPO, dash: true, dot: COL_GRUPO, values: keys.map(function (k) { return (grpObj[k] && grpObj[k].pct) || 0; }) }); leg = LEG; }
    if (keys.length >= 3) return card(title, radarSVG(axes, series, 300), leg, opts);
    var items = keys.map(function (k) { return { label: labelFn(k), color: colorFn(k), stu: pct(stuObj, k), grp: grpObj && grpObj[k] ? grpObj[k].pct : null }; });
    return card(title, barras(items), '', opts);
  }
  function hexA(hex, a) {
    var n = parseInt(String(hex).slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  // ================================================================
  // 4 · PINTAR
  // ================================================================
  function render(res, cnt, stuEsp, stuSub, stuDif, subToEsp, comp, pop, preguntas, Q) {
    var stats = document.getElementById('tab-stats');
    if (!stats) return;

    // Percentil (solo si comparativa está activa)
    if (comp) {
      var hero = '';
      if (comp.n >= 5 && comp.percentil != null) {
        hero = '<div class="ee-an-hero"><div class="ee-an-hero-num">P' + comp.percentil + '</div>' +
          '<div class="ee-an-hero-txt"><b>Percentil ' + comp.percentil + '</b>' +
          '<span>Mejor que el ' + comp.percentil + '% de ' + comp.n + ' alumnos que han presentado este simulador.</span>' +
          (comp.promedio != null ? '<span>Tu calificación: ' + res.percentage + '% · Promedio del grupo: ' + comp.promedio + '%</span>' : '') +
          '</div></div>';
      } else {
        hero = '<div class="ee-an-hero"><div class="ee-an-hero-num">★</div>' +
          '<div class="ee-an-hero-txt"><b>Eres de los primeros</b>' +
          '<span>' + comp.n + (comp.n === 1 ? ' alumno ha' : ' alumnos han') + ' presentado este simulador. El percentil aparece cuando hay más resultados.</span></div></div>';
      }
      var hd = document.createElement('div'); hd.id = 'ee-percentil'; hd.innerHTML = hero;
      var score = stats.querySelector('.score-container');
      if (score && score.parentNode) score.parentNode.insertBefore(hd, score.nextSibling);
      else stats.insertBefore(hd, stats.firstChild);
    }

    var neto = cnt.cmb - cnt.cbm;
    var cambios = '<div class="ee-an-card"><h4>Cambios de respuesta</h4>' +
      '<div class="ee-an-cambios">' +
      '<div class="cx" style="--c:#f08f35"><b>' + cnt.cbm + '</b><span>Bien → mal</span></div>' +
      '<div class="cx" style="--c:#48ACEA"><b>' + cnt.cmb + '</b><span>Mal → bien</span></div>' +
      '<div class="cx" style="--c:#2b2b2b"><b>' + cnt.cmm + '</b><span>Mal → mal</span></div>' +
      '</div><p class="ee-an-note">Naranja: la tenías bien y la cambiaste a mal. Azul: la rescataste. Negro: cambiaste entre incorrectas. Balance neto: ' + (neto >= 0 ? '+' : '') + neto + ' a favor.</p></div>';

    var tSum = 0, tN = 0, tOk = 0, tOkN = 0, tNo = 0, tNoN = 0;
    preguntas.forEach(function (p) {
      if (p.final != null && p.tiempo_ms > 0) {
        tSum += p.tiempo_ms; tN++;
        if (p.correcta) { tOk += p.tiempo_ms; tOkN++; } else { tNo += p.tiempo_ms; tNoN++; }
      }
    });
    var tiempos = tN ? '<div class="ee-an-card"><h4>Tiempo por pregunta</h4><div class="ee-an-tiempos">' +
      '<div><b>' + fmt(tSum / tN) + '</b><span>Promedio</span></div>' +
      '<div><b>' + (tOkN ? fmt(tOk / tOkN) : '--') + '</b><span>En las correctas</span></div>' +
      '<div><b>' + (tNoN ? fmt(tNo / tNoN) : '--') + '</b><span>En las incorrectas</span></div>' +
      '</div><p class="ee-an-note">Medido por el tiempo que cada pregunta estuvo en pantalla.</p></div>' : '';

    var radars = '';
    var espKeys = Object.keys(stuEsp);
    if (espKeys.length) radars += radarCard('Por especialidad', espKeys, function (k) { return ESP_SHORT[k] || k; }, function (k) { return COL_ESP[k] || COL_TU; }, stuEsp, comp ? comp.por_especialidad : null, null, { bg: '#e8f0fb', accent: '#204D98' });

    var difKeys = ['facil', 'medio', 'dificil'].filter(function (k) { return stuDif[k]; });
    if (difKeys.length) radars += radarCard('Por dificultad', difKeys, function (k) { return DIF_LABEL[k]; }, function (k) { return DIF_COLOR[k]; }, stuDif, comp ? comp.por_dificultad : null, null, { bg: '#f4eee4', accent: '#b8860b' });

    var subKeys = Object.keys(stuSub);
    if (subKeys.length) {
      if (subKeys.length <= 8) {
        radars += radarCard('Por subespecialidad', subKeys, function (k) { return k; }, function (k) { return COL_ESP[subToEsp[k]] || '#8e8ac7'; }, stuSub, comp ? comp.por_subespecialidad : null, null, { bg: '#eef4fb', accent: '#204D98' });
      } else {
        var order = ['Medicina Interna', 'Cirugía', 'Pediatría', 'Ginecología y Obstetricia', 'Ciencias Básicas'];
        var groups = {};
        subKeys.forEach(function (k) { var e = subToEsp[k] || 'Otros'; (groups[e] = groups[e] || []).push(k); });
        var names = order.filter(function (e) { return groups[e]; }).concat(Object.keys(groups).filter(function (e) { return order.indexOf(e) < 0; }));
        names.forEach(function (e) {
          var col = COL_ESP[e] || '#8e8ac7', bg = PASTEL_ESP[e] || '#eef4fb';
          radars += radarCard('Subesp. · ' + (ESP_SHORT[e] || e), groups[e], function (k) { return k; }, function () { return col; }, stuSub, comp ? comp.por_subespecialidad : null, col, { bg: bg, accent: col });
        });
      }
    }

    var wrap = document.createElement('div');
    wrap.id = 'ee-analitica';
    wrap.innerHTML = '<div class="ee-an-grid">' + cambios + tiempos + '</div>' +
      (radars ? '<div class="ee-an-h3">Radares de rendimiento</div><div class="ee-an-radars">' + radars + '</div>' : '');
    var subCont = stats.querySelector('.subspeciality-container');
    if (subCont && subCont.parentNode) subCont.parentNode.insertBefore(wrap, subCont);
    else stats.appendChild(wrap);

    var sections = document.getElementById('specialty-sections');
    if (sections && subCont && subCont.parentNode) {
      var sh = document.createElement('div');
      sh.className = 'ee-an-h3';
      sh.style.cssText = 'font-family:var(--font-display);color:var(--ee-azul);font-size:1.15rem;margin:24px 0 12px;font-weight:600;';
      sh.textContent = 'Detalle por tema';
      subCont.parentNode.insertBefore(sh, subCont);
      subCont.parentNode.insertBefore(sections, subCont);
    }

    if (comp) enriquecerSubespecialidad(comp);
    enriquecerRevision(Q, preguntas, pop);
    construirFiltros(Q);
  }

  function enriquecerSubespecialidad(comp) {
    if (!comp || !comp.por_subespecialidad) return;
    var items = document.querySelectorAll('#subspeciality-bars .subspeciality-item');
    Array.prototype.forEach.call(items, function (item) {
      if (item.querySelector('.ee-subgrp')) return;
      var nameSpan = item.querySelector('.subspeciality-name span');
      if (!nameSpan) return;
      var name = nameSpan.textContent.trim();
      var g = comp.por_subespecialidad[name];
      if (!g) return;
      var d = document.createElement('div');
      d.className = 'ee-subgrp';
      d.innerHTML = '<div class="progress-bar-container"><div class="ee-subgrp-fill" style="width:' + g.pct + '%"></div></div><span>Grupo ' + g.pct + '%</span>';
      item.appendChild(d);
    });
  }

  function enriquecerRevision(Q, preguntas, pop) {
    var nodes = document.querySelectorAll('#review-questions-container .review-question');
    if (!nodes.length) return;
    var TR = {
      bien_mal: { c: '#f08f35', t: 'Cambiaste de correcta a incorrecta' },
      mal_bien: { c: '#48ACEA', t: 'Rescatada: de incorrecta a correcta' },
      mal_mal: { c: '#2b2b2b', t: 'Cambiaste entre incorrectas' }
    };
    Q.forEach(function (q, i) {
      var node = nodes[i]; if (!node) return;
      var p = preguntas[i], st = pop[q.id];
      var flagged = false;
      try { flagged = (typeof flaggedQuestions !== 'undefined' && flaggedQuestions) ? !!flaggedQuestions[i] : false; } catch (e) {}
      node.dataset.ok = (p && p.correcta) ? '1' : '0';
      node.dataset.esp = q.specialty || '';
      node.dataset.sub = q.subspeciality || '';
      node.dataset.tema = q.topic || '';
      node.dataset.dif = normDif(q.difficulty) || '';
      node.dataset.flag = flagged ? '1' : '0';
      var parts = [];
      if (flagged) parts.push('<span class="ee-rev-pill" style="background:var(--ee-amarillo);color:var(--ee-azul)">🚩 Marcada</span>');
      if (st && st.total) parts.push('<span class="ee-rev-pill grupo">👥 ' + (st.pct != null ? st.pct + '% del grupo la tuvo bien' : 'sin datos') + ' · ' + st.total + (st.total === 1 ? ' respuesta' : ' respuestas') + '</span>');
      if (p && p.transicion && TR[p.transicion]) parts.push('<span class="ee-rev-pill trans" style="background:' + TR[p.transicion].c + '">' + TR[p.transicion].t + '</span>');
      if (p && p.tiempo_ms > 0) parts.push('<span class="ee-rev-pill time">⏱️ ' + fmt(p.tiempo_ms) + (st && st.t_prom_ms ? ' · grupo ' + fmt(st.t_prom_ms) : '') + '</span>');
      if (parts.length) {
        var ex = document.createElement('div');
        ex.className = 'ee-rev-extra';
        ex.innerHTML = parts.join('');
        node.appendChild(ex);
      }
      node.appendChild(construirReporte(q.id));
    });
  }

  function construirReporte(qid) {
    var wrap = document.createElement('div'); wrap.className = 'ee-rep';
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ee-rep-btn'; btn.textContent = '⚠️ Reportar un error en esta pregunta';
    var form = document.createElement('div'); form.className = 'ee-rep-form'; form.style.display = 'none';
    var ta = document.createElement('textarea'); ta.placeholder = '¿Cuál es el problema? (respuesta marcada como correcta que no lo es, error de redacción, imagen que no carga, etc.)';
    var acts = document.createElement('div'); acts.className = 'ee-rep-acts';
    var send = document.createElement('button'); send.type = 'button'; send.className = 'ee-rep-send'; send.textContent = 'Enviar reporte';
    var cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'ee-rep-cancel'; cancel.textContent = 'Cancelar';
    acts.appendChild(send); acts.appendChild(cancel);
    form.appendChild(ta); form.appendChild(acts);
    wrap.appendChild(btn); wrap.appendChild(form);
    btn.addEventListener('click', function () { var open = form.style.display !== 'none'; form.style.display = open ? 'none' : 'block'; if (!open) ta.focus(); });
    cancel.addEventListener('click', function () { form.style.display = 'none'; ta.value = ''; });
    send.addEventListener('click', function () {
      var texto = ta.value.trim();
      if (!texto) { ta.focus(); return; }
      send.disabled = true; send.textContent = 'Enviando...';
      enviarReporte(qid, texto, form);
    });
    return wrap;
  }
  function enviarReporte(qid, texto, form) {
    var body = {
      pregunta: qid,
      alumno: gStr(function () { return (typeof getUserRecordId === 'function') ? getUserRecordId() : ''; }),
      simulador: gStr(function () { return selectedSimulatorId; }),
      origen: CFG.origen || '',
      intento_id: intentoId || '',
      texto: texto
    };
    fetch(EP + '/reporte', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.ok; })
      .then(function (ok) { form.innerHTML = ok ? '<div class="ee-rep-ok">✅ ¡Gracias! Tu reporte quedó registrado.</div>' : '<div class="ee-rep-ok" style="color:var(--ee-rojo)">No se pudo enviar. Intenta de nuevo más tarde.</div>'; })
      .catch(function () { form.innerHTML = '<div class="ee-rep-ok" style="color:var(--ee-rojo)">No se pudo enviar. Intenta de nuevo más tarde.</div>'; });
  }

  function campo(id, label, inner) {
    return '<div class="campo"><label for="' + id + '">' + label + '</label><select id="' + id + '">' + inner + '</select></div>';
  }
  function construirFiltros(Q) {
    var cont = document.getElementById('review-questions-container');
    var tab = document.getElementById('tab-review');
    if (!cont || !tab || document.getElementById('ee-rev-filtros')) return;

    var esps = {}, subs = {}, temas = {}, difs = {};
    Q.forEach(function (q) {
      if (q.specialty) esps[q.specialty] = 1;
      if (q.subspeciality) subs[q.subspeciality] = 1;
      if (q.topic) temas[q.topic] = 1;
      var d = normDif(q.difficulty); if (d) difs[d] = 1;
    });
    function opts(obj, labeler) {
      return Object.keys(obj).sort().map(function (k) { return '<option value="' + escHTML(k) + '">' + escHTML(labeler ? labeler(k) : k) + '</option>'; }).join('');
    }
    var bar = document.createElement('div');
    bar.className = 'ee-rev-filtros'; bar.id = 'ee-rev-filtros';
    bar.innerHTML =
      campo('f-estado', 'Estado', '<option value="">Todas</option><option value="1">Correctas</option><option value="0">Incorrectas</option>') +
      campo('f-esp', 'Especialidad', '<option value="">Todas</option>' + opts(esps)) +
      campo('f-sub', 'Subespecialidad', '<option value="">Todas</option>' + opts(subs)) +
      campo('f-tema', 'Tema', '<option value="">Todos</option>' + opts(temas)) +
      campo('f-dif', 'Dificultad', '<option value="">Todas</option>' + opts(difs, function (k) { return DIF_LABEL[k] || k; })) +
      campo('f-flag', 'Marcadas', '<option value="">Todas</option><option value="1">🚩 Solo marcadas</option>') +
      '<button class="ee-rev-limpiar" id="f-limpiar">Limpiar</button>' +
      '<span class="ee-rev-count" id="f-count"></span>';
    tab.insertBefore(bar, cont);

    var vacio = document.createElement('div');
    vacio.className = 'ee-rev-vacio'; vacio.style.display = 'none';
    vacio.textContent = 'Ninguna pregunta coincide con estos filtros.';
    cont.parentNode.insertBefore(vacio, cont.nextSibling);

    var nodes = [].slice.call(cont.querySelectorAll('.review-question'));
    var cases = [].slice.call(cont.querySelectorAll('.case-block'));
    var sE = bar.querySelector('#f-estado'), sEsp = bar.querySelector('#f-esp'), sSub = bar.querySelector('#f-sub'), sT = bar.querySelector('#f-tema'), sD = bar.querySelector('#f-dif'), sF = bar.querySelector('#f-flag');
    var count = bar.querySelector('#f-count');

    function aplicar() {
      var fe = sE.value, fEsp = sEsp.value, fSub = sSub.value, fT = sT.value, fD = sD.value, fF = sF.value;
      var activo = !!(fe || fEsp || fSub || fT || fD || fF), vis = 0;
      nodes.forEach(function (n) {
        var ok = (!fe || n.dataset.ok === fe) && (!fEsp || n.dataset.esp === fEsp) &&
                 (!fSub || n.dataset.sub === fSub) && (!fT || n.dataset.tema === fT) &&
                 (!fD || n.dataset.dif === fD) && (!fF || n.dataset.flag === fF);
        n.style.display = ok ? '' : 'none'; if (ok) vis++;
      });
      cases.forEach(function (c) { c.style.display = activo ? 'none' : ''; });
      vacio.style.display = vis === 0 ? 'block' : 'none';
      count.textContent = 'Mostrando ' + vis + ' de ' + nodes.length;
    }
    [sE, sEsp, sSub, sT, sD, sF].forEach(function (s) { s.addEventListener('change', aplicar); });
    bar.querySelector('#f-limpiar').addEventListener('click', function () {
      sE.value = ''; sEsp.value = ''; sSub.value = ''; sT.value = ''; sD.value = ''; sF.value = ''; aplicar();
    });
    aplicar();
  }

})();
