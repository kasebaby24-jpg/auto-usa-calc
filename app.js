/* ============================================================
   Авто з США — калькулятор
   Формули розрахунку повністю відповідають оригінальному
   калькулятору (перевірено на 6 контрольних прикладах).
   ============================================================ */
(function () {
'use strict';

var D  = window.CALC_DATA;
var EU = D.nbu.eurUsd;          // 1 EUR -> USD
var USD= D.nbu.usd;             // 1 USD -> UAH
var CY = D.currentYear;

var tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) {
  try {
    tg.ready(); tg.expand();
    if (tg.setHeaderColor) tg.setHeaderColor('#05070f');
    if (tg.setBackgroundColor) tg.setBackgroundColor('#05070f');
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
  } catch (e) {}
}
function haptic(t){ try{ tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred(t||'light'); }catch(e){} }

/* ------------------------------------------------------------------ */
/* СТАН                                                                */
/* ------------------------------------------------------------------ */
var S = {
  platform: 1, lotPrice: 0, auctionFee: 0,
  body: '', fuel: 0,
  stateId: 0, cityId: 0,
  sublot: 0, title: 0, insPct: 0.9,
  year: 0, engine: 0, battery: 0, moto: 0,
  service: 349, serve: 500,
  regionId: 0, uaCityId: 0,
  repair: 0, repairOn: false
};

var $  = function (s) { return document.querySelector(s); };
var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
var money = function (n) { return '$' + Math.round(n).toLocaleString('uk-UA').replace(/ /g,' '); };

/* ------------------------------------------------------------------ */
/* РОЗРАХУНОК (точна копія логіки оригіналу)                           */
/* ------------------------------------------------------------------ */
function platformFlag(o, p) {
  if (p === 2 || p === 5) return o.i;
  if (p === 3)            return o.m;
  if (p === 6)            return o.h;
  return o.c;                                   // Copart / CrashedToys
}
function specialFlag(st, p) {
  if (!st) return 0;
  if (p === 1 || p === 4) return st.sc;
  if (p === 2 || p === 5) return st.si;
  if (p === 3)            return st.sm;
  if (p === 6)            return st.sh;
  return 0;
}

function calc() {
  var P    = S.platform;
  var st   = D.states.filter(function (x) { return x.id === S.stateId; })[0] || null;
  var g    = specialFlag(st, P);
  var lot  = +S.lotPrice || 0;
  var isBig= (S.body === 'pickup' || S.body === 'van');

  /* --- 1. ціна лоту зі зборами --- */
  var lotTotal = 0;
  if (lot) {
    if (P === 6) {
      lotTotal = lot + (+S.auctionFee || 0);
    } else {
      var L = D.fees[P][S.body === 'van' ? 'heavy' : 'standard'];
      var a = lot;
      if (L['3'] && L['3'][0]) a += L['3'][0][4];        // фікс. збір типу 3
      if (L['4'] && L['4'][0]) a += L['4'][0][4];        // фікс. збір типу 4
      if ((P === 1 || P === 4) && g != 1) a += 55;       // gate fee
      ['1', '2'].forEach(function (grp) {
        var rows = L[grp] || [];
        for (var k = 0; k < rows.length; k++) {
          var f = rows[k];                    // [state_ids, clean, min, max, value, isPercent]
          if (f[1]) continue;                                        // docType = non-clean title
          if (g == 1 && f[0].indexOf(S.stateId) === -1) continue;
          if (!S.stateId && f[0].length) continue;
          if (g == 0 && f[0].length) continue;
          if (lot >= f[2] && (f[3] === null || lot <= f[3])) {
            a += f[5] ? lot * parseFloat(f[4]) / 100 : parseFloat(f[4]);
            break;
          }
        }
      });
      lotTotal = a;
    }
  }
  lotTotal = parseInt(lotTotal, 10) || 0;

  /* --- 2. страхування --- */
  var ins = lotTotal > 0 ? Math.ceil(lotTotal * S.insPct / 100) : 0;

  /* --- 3. доставка до порту --- */
  var port = 0, portCode = '';
  var extra = (+S.sublot || 0) + (+S.title || 0) + ins;
  if (S.cityId) {
    var key = D.logistics[S.body] ? S.body : 'sedan';   // "suv" рахується як sedan
    var e = (D.logistics[key][P] || {})[S.cityId];
    if (!e || e.price == null) {
      port = 0;                                          // немає тарифу
    } else {
      port = e.price;
      portCode = e.port || '';
      if (st && st.ca == 1) {
        if (S.body === 'suv') port += 250;
        if (S.fuel == 1)      port += 300;
      }
      port = Math.ceil(port + extra);
    }
  } else {
    port = Math.ceil(extra);
  }

  /* --- 4. митні платежі --- */
  var customs = 0;
  if (!isBig) {
    var ready = (S.year || S.body === 'moto') &&
                (S.engine || S.battery || S.moto) && S.fuel;
    if (ready) {
      if (S.fuel == 1) {                                     // електро
        var kw = (+S.battery || 0) * EU;                     // 1 EUR за кВт·год
        var vat = (lotTotal + 1600 + kw) * 0.2;
        customs = kw + vat;
      } else if (lotTotal) {
        var age = CY - S.year - 1; if (age < 1) age = 1;
        if (S.body === 'moto') {
          var cc = +S.moto || 0;
          var ex = cc > 800 ? cc * 0.447 : cc > 500 ? cc * 0.443 : cc * 0.062;
          ex *= EU;
          var rate = (st && st.ca == 1) ? 0.05 : 0.10;
          var duty = (lotTotal + 600) * rate;
          customs = ex + duty + (lotTotal + 600 + duty + ex) * 0.2;
        } else {
          var cm = +S.engine || 0, exc = 0;
          if (S.fuel == 2 || S.fuel == 4) exc = cm / 1000 * age * (cm > 3000 ? 100 : 50);
          else if (S.fuel == 3)           exc = cm / 1000 * age * (cm > 3500 ? 150 : 75);
          exc *= EU;
          var d2 = (lotTotal + 1600) * 0.1;
          customs = exc + d2 + (lotTotal + 1600 + exc + d2) * 0.2;
        }
      }
    }
  }
  customs = Math.ceil(customs);

  /* --- 5. послуги --- */
  var service = parseInt(S.service, 10) || 0;
  var serve   = parseInt(S.serve, 10)   || 0;

  /* --- 6. доставка по Україні --- */
  var ua = 0;
  if (S.uaCityId && !isBig) {
    var c = D.uaCities.filter(function (x) { return x.id === S.uaCityId; })[0];
    if (c) { ua = c.p; if (S.body === 'moto') ua -= 200; }
  }
  ua = parseInt(ua, 10) || 0;

  var repair = S.repairOn ? (parseInt(S.repair, 10) || 0) : 0;

  return {
    lotTotal: lotTotal, ins: ins, port: port, portCode: portCode,
    customs: customs, service: service, serve: serve, ua: ua, repair: repair,
    total: lotTotal + port + customs + service + serve + ua + repair
  };
}

/* базова вартість експедиторських послуг для типу кузова */
function baseService(body) {
  if (body === 'pickup') return 349 + parseInt(50 * EU, 10);
  if (body === 'van')    return 349 + parseInt(100 * EU, 10);
  return 349;
}

/* ------------------------------------------------------------------ */
/* СПИСКИ ДЛЯ ВИБОРУ                                                   */
/* ------------------------------------------------------------------ */
var BODIES = [
  { v: 'sedan',  n: 'Седан' },
  { v: 'suv',    n: 'Кросовер / позашляховик' },
  { v: 'moto',   n: 'Мото' },
  { v: 'pickup', n: 'Пікап' },
  { v: 'van',    n: 'VAN' }
];
var FUELS = [
  { v: 2, n: 'Бензин' },
  { v: 1, n: 'Електро' },
  { v: 3, n: 'Дизель' },
  { v: 4, n: 'Гібрид (бензин)' }
];

function statesList() {
  return D.states.filter(function (o) { return platformFlag(o, S.platform) === 1; });
}
function citiesList() {
  return D.cities.filter(function (o) {
    return o.s === S.stateId && platformFlag(o, S.platform) === 1;
  });
}
function uaCitiesList() {
  return D.uaCities.filter(function (o) { return o.r === S.regionId; });
}

var PICKERS = {
  body:   { title: 'Тип кузова',  search: false, items: function(){ return BODIES.map(function(b){return {id:b.v,n:b.n};}); }, cur: function(){ return S.body; }, set: function(v){ setBody(v); } },
  fuel:   { title: 'Тип палива',  search: false, items: function(){ return FUELS.map(function(f){return {id:f.v,n:f.n};}); },  cur: function(){ return S.fuel; },  set: function(v){ setFuel(+v); } },
  state:  { title: 'Штат',        search: true,  items: function(){ return statesList().map(function(o){return {id:o.id,n:o.n};}); }, cur: function(){ return S.stateId; }, set: function(v){ setState(+v); } },
  city:   { title: 'Місто аукціону', search: true, items: function(){ return citiesList().map(function(o){return {id:o.id,n:o.n};}); }, cur: function(){ return S.cityId; }, set: function(v){ S.cityId=+v; save(); update(); } },
  year:   { title: 'Рік випуску',  search: true,  items: function(){ return D.years.map(function(y){return {id:y,n:String(y)};}); }, cur: function(){ return S.year; }, set: function(v){ S.year=+v; save(); update(); } },
  engine: { title: "Об'єм двигуна, л", search: true, items: function(){
              var seen={}; var out=[];
              D.engines.forEach(function(cc){ if(seen[cc])return; seen[cc]=1; out.push({id:cc,n:(cc/1000).toFixed(1).replace('.0','.0')+' л',sub:cc+' см³'}); });
              out.sort(function(a,b){return a.id-b.id;});
              return out; }, cur: function(){ return S.engine; }, set: function(v){ S.engine=+v; save(); update(); } },
  moto:   { title: "Об'єм двигуна, см³", search: true, items: function(){ return D.motoEngines.map(function(c){return {id:c,n:c+' см³'};}); }, cur: function(){ return S.moto; }, set: function(v){ S.moto=+v; save(); update(); } },
  region: { title: 'Область',     search: true,  items: function(){ return D.uaRegions.map(function(o){return {id:o.id,n:o.n};}); }, cur: function(){ return S.regionId; }, set: function(v){ S.regionId=+v; S.uaCityId=0; save(); update(); } },
  uacity: { title: 'Місто доставки', search: true, items: function(){ return uaCitiesList().map(function(o){return {id:o.id,n:o.n,sub:'$'+o.p};}); }, cur: function(){ return S.uaCityId; }, set: function(v){ S.uaCityId=+v; save(); update(); } },
  sublot: { title: 'Оберіть SUBLOT', search: true, items: function(){ return D.sublots.map(function(o,i){return {id:'s'+i,n:o.n,sub:'$'+o.p,val:o.p};}); }, cur: function(){ return null; }, set: function(v,it){ S.sublot=it.val; $('#sublotFee').value=it.val; save(); update(); } },
  title:  { title: 'Оберіть TITLE',  search: true, items: function(){ return D.titles.map(function(o,i){return {id:'t'+i,n:o.n,sub:'$'+o.p+(o.d?' · '+o.d+' дн':'')  ,val:o.p};}); }, cur: function(){ return null; }, set: function(v,it){ S.title=it.val; $('#titleFee').value=it.val; save(); update(); } }
};

/* ------------------------------------------------------------------ */
/* SHEET (модальний вибір)                                             */
/* ------------------------------------------------------------------ */
var sheetKey = null;

function openSheet(key) {
  var p = PICKERS[key]; if (!p) return;
  var items = p.items();
  if (!items.length) { toast('Спочатку оберіть попереднє поле'); return; }
  sheetKey = key;
  $('#sheetTitle').textContent = p.title;
  $('#sheetSearchBox').classList.toggle('hidden', !p.search || items.length < 8);
  $('#sheetSearch').value = '';
  renderSheet('');
  $('#sheet').classList.remove('hidden');
  $('.sheet').classList.remove('out');
  haptic('light');
  if (tg && tg.BackButton) { tg.BackButton.show(); }
  document.body.style.overflow = 'hidden';
}

function renderSheet(q) {
  var p = PICKERS[sheetKey];
  var items = p.items();
  var cur = p.cur();
  q = (q || '').trim().toLowerCase();
  if (q) items = items.filter(function (i) { return i.n.toLowerCase().indexOf(q) !== -1; });
  var box = $('#sheetList');
  if (!items.length) { box.innerHTML = '<div class="opt-empty">Нічого не знайдено</div>'; return; }
  var html = '';
  var lim = items.slice(0, 400);
  lim.forEach(function (i, idx) {
    html += '<div class="opt' + (cur !== null && String(cur) === String(i.id) ? ' on' : '') +
            '" data-i="' + idx + '"><span>' + esc(i.n) + '</span>' +
            (i.sub ? '<em>' + esc(i.sub) + '</em>' : '') + '</div>';
  });
  if (items.length > lim.length) html += '<div class="opt-empty">Показано ' + lim.length + ' з ' + items.length + ' — уточніть пошук</div>';
  box.innerHTML = html;
  box._items = lim;
  box.scrollTop = 0;
}

function closeSheet() {
  var s = $('.sheet');
  s.classList.add('out');
  setTimeout(function () { $('#sheet').classList.add('hidden'); s.classList.remove('out'); }, 280);
  sheetKey = null;
  document.body.style.overflow = '';
  if (tg && tg.BackButton) tg.BackButton.hide();
}

function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

$('#sheetList').addEventListener('click', function (ev) {
  var el = ev.target.closest('.opt'); if (!el) return;
  var it = this._items[+el.dataset.i]; if (!it) return;
  haptic('medium');
  PICKERS[sheetKey].set(it.id, it);
  closeSheet();
});
$('#sheetSearch').addEventListener('input', function () { renderSheet(this.value); });
$('#sheetClose').addEventListener('click', closeSheet);
$('.sheet-bg').addEventListener('click', closeSheet);
if (tg && tg.BackButton) tg.BackButton.onClick(function () { if (sheetKey) closeSheet(); });

/* ------------------------------------------------------------------ */
/* ЗМІНА ПОЛІВ                                                         */
/* ------------------------------------------------------------------ */
function setPlatform(p) {
  S.platform = p;
  if (!D.states.filter(function (o) { return o.id === S.stateId && platformFlag(o, p) === 1; }).length) {
    S.stateId = 0; S.cityId = 0;
  } else if (!citiesList().filter(function (c) { return c.id === S.cityId; }).length) {
    S.cityId = 0;
  }
  save(); update();
}
function setState(id) {
  S.stateId = id; S.cityId = 0;
  var cs = citiesList();
  if (cs.length === 1) S.cityId = cs[0].id;      // як в оригіналі
  save(); update();
}
function setBody(v) {
  S.body = v;
  S.service = baseService(v);
  $('#service').value = S.service;
  if (v === 'moto') S.year = 0;
  if (v !== 'moto') S.moto = 0;
  save(); update();
}
function setFuel(v) {
  S.fuel = v;
  if (v === 1) { S.engine = 0; } else { S.battery = 0; $('#battery').value = ''; }
  save(); update();
}

/* ------------------------------------------------------------------ */
/* РЕНДЕР                                                              */
/* ------------------------------------------------------------------ */
function pickText(key) {
  switch (key) {
    case 'body':   return (BODIES.filter(function(b){return b.v===S.body;})[0]||{}).n;
    case 'fuel':   return (FUELS.filter(function(f){return f.v===S.fuel;})[0]||{}).n;
    case 'state':  return (D.states.filter(function(o){return o.id===S.stateId;})[0]||{}).n;
    case 'city':   return (D.cities.filter(function(o){return o.id===S.cityId;})[0]||{}).n;
    case 'year':   return S.year || '';
    case 'engine': return S.engine ? (S.engine/1000).toFixed(1) + ' л' : '';
    case 'moto':   return S.moto ? S.moto + ' см³' : '';
    case 'region': return (D.uaRegions.filter(function(o){return o.id===S.regionId;})[0]||{}).n;
    case 'uacity': return (D.uaCities.filter(function(o){return o.id===S.uaCityId;})[0]||{}).n;
  }
  return '';
}

function update() {
  var r = calc();
  var isBig = (S.body === 'pickup' || S.body === 'van');

  /* поки не введено ціну лоту — не показуємо базові послуги в підсумку */
  if (!S.lotPrice) { r.service = 0; r.serve = 0; r.total = 0; }

  /* кнопки-пікери */
  $$('.pick').forEach(function (b) {
    var k = b.dataset.pick;
    if (!PICKERS[k] || k === 'sublot' || k === 'title') return;
    var t = pickText(k);
    b.querySelector('span').textContent = t || 'Оберіть';
    b.classList.toggle('set', !!t);
    if (k === 'city')   b.disabled = !S.stateId;
    if (k === 'uacity') b.disabled = !S.regionId;
  });

  /* видимість полів двигуна */
  $('#motoBox').classList.toggle('hidden', S.body !== 'moto');
  $('#battBox').classList.toggle('hidden', !(S.body !== 'moto' && S.fuel === 1));
  $('#engBox').classList.toggle('hidden',  !(S.body !== 'moto' && S.fuel !== 1));
  $('#yearBox').classList.toggle('hidden', S.body === 'moto');

  $('#auctionFeeBox').classList.toggle('hidden', S.platform !== 6);
  $('#customsCard').classList.toggle('hidden', isBig);
  $('#uaCard').classList.toggle('hidden', isBig);
  $('#managerNote').classList.toggle('hidden', !isBig);

  $('#portLine').classList.toggle('hidden', !r.portCode);
  $('#portCode').textContent = r.portCode;

  /* чипи аукціонів */
  $$('#platforms button').forEach(function (b) { b.classList.toggle('on', +b.dataset.v === S.platform); });
  $$('#insurance button').forEach(function (b) { b.classList.toggle('on', parseFloat(b.dataset.v) === S.insPct); });

  /* результати */
  $('#rLot').textContent     = money(r.lotTotal);
  $('#rIns').textContent     = money(r.ins);
  $('#rPort').textContent    = money(r.port);
  $('#rCustoms').textContent = money(r.customs);
  $('#rUa').textContent      = money(r.ua);
  $('#rTotal').textContent   = money(r.total);
  $('#sTotal').textContent   = money(r.total);
  $('#rTotalUah').textContent= '≈ ' + Math.round(r.total * USD).toLocaleString('uk-UA').replace(/ /g,' ') + ' ₴';

  /* деталізація */
  var rows = [
    ['Ціна лоту зі зборами', r.lotTotal],
    ['Доставка до порту' + (r.ins ? ' (зі страхуванням)' : ''), r.port],
    ['Митні платежі', r.customs],
    ['Експедиторські послуги', r.service],
    ['Комісія за обслуговування', r.serve],
    ['Доставка по Україні', r.ua]
  ];
  if (r.repair) rows.push(['Ремонт', r.repair]);
  $('#breakdown').innerHTML = rows.filter(function (x) { return x[1] > 0; })
    .map(function (x) { return '<div><span>' + x[0] + '</span><b>' + money(x[1]) + '</b></div>'; }).join('')
    || '<div><span>Заповніть поля вище</span><b>—</b></div>';

  /* попередження про неповний розрахунок */
  var need = !S.lotPrice || !S.body || !S.fuel || !S.stateId || !S.cityId ||
             (S.platform === 6 && !S.auctionFee) ||
             (!isBig && (S.body === 'moto' ? !S.moto : (S.fuel === 1 ? !S.battery : (!S.year || !S.engine)))) ||
             (!isBig && !S.uaCityId);
  $('#incomplete').classList.toggle('hidden', !need);

  window._last = r;
}

function toast(msg) {
  if (tg && tg.showPopup) { try { tg.showPopup({ message: msg }); return; } catch (e) {} }
  alert(msg);
}

/* ------------------------------------------------------------------ */
/* ЗБЕРЕЖЕННЯ                                                          */
/* ------------------------------------------------------------------ */
function save() { try { localStorage.setItem('usaCalc', JSON.stringify(S)); } catch (e) {} }
function load() {
  try {
    var v = JSON.parse(localStorage.getItem('usaCalc'));
    if (v && typeof v === 'object') { Object.keys(S).forEach(function (k) { if (v[k] !== undefined) S[k] = v[k]; }); }
  } catch (e) {}
}

/* ------------------------------------------------------------------ */
/* ІНІЦІАЛІЗАЦІЯ                                                       */
/* ------------------------------------------------------------------ */
load();

$('#platforms').innerHTML = D.platforms.map(function (p) {
  return '<button data-v="' + p.id + '">' + esc(p.n === 'Rec Rides.' ? 'Rec Rides' : p.n) + '</button>';
}).join('');
$('#platforms').addEventListener('click', function (ev) {
  var b = ev.target.closest('button'); if (!b) return;
  haptic('light'); setPlatform(+b.dataset.v);
});
$('#insurance').addEventListener('click', function (ev) {
  var b = ev.target.closest('button'); if (!b) return;
  haptic('light'); S.insPct = parseFloat(b.dataset.v); save(); update();
});

document.addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-pick]'); if (!b || b.disabled) return;
  openSheet(b.dataset.pick);
});

function bindNum(sel, key) {
  var el = $(sel); if (!el) return;
  if (S[key]) el.value = S[key];
  el.addEventListener('input', function () { S[key] = this.value === '' ? 0 : parseFloat(this.value) || 0; save(); update(); });
}
bindNum('#lotPrice',   'lotPrice');
bindNum('#auctionFee', 'auctionFee');
bindNum('#sublotFee',  'sublot');
bindNum('#titleFee',   'title');
bindNum('#battery',    'battery');
bindNum('#service',    'service');
bindNum('#serve',      'serve');
bindNum('#repair',     'repair');
$('#service').value = S.service || 349;
$('#serve').value   = S.serve   || 500;

$('#repairToggle').addEventListener('click', function () {
  S.repairOn = !S.repairOn;
  this.classList.toggle('on', S.repairOn);
  this.innerHTML = S.repairOn ? '<i>−</i> Прибрати вартість ремонту' : '<i>+</i> Додати приблизну вартість ремонту';
  $('#repairBox').classList.toggle('hidden', !S.repairOn);
  haptic('light'); save(); update();
});
if (S.repairOn) $('#repairToggle').click();

/* копіювання розрахунку */
function summary() {
  var r = window._last || calc();
  var L = [];
  L.push('РОЗРАХУНОК АВТО З США');
  L.push('');
  L.push('Аукціон: ' + (D.platforms.filter(function(p){return p.id===S.platform;})[0]||{}).n);
  L.push('Ціна лоту: ' + money(S.lotPrice));
  if (pickText('body'))  L.push('Кузов: ' + pickText('body'));
  if (pickText('fuel'))  L.push('Паливо: ' + pickText('fuel'));
  if (pickText('state')) L.push('Локація: ' + pickText('state') + (pickText('city') ? ', ' + pickText('city') : ''));
  if (S.year)   L.push('Рік: ' + S.year);
  if (S.engine) L.push("Об'єм: " + (S.engine/1000).toFixed(1) + ' л');
  if (S.moto)   L.push("Об'єм: " + S.moto + ' см³');
  if (S.battery)L.push('Батарея: ' + S.battery + ' кВт·год');
  if (pickText('uacity')) L.push('Доставка: ' + pickText('uacity'));
  L.push('');
  L.push('Лот зі зборами: ' + money(r.lotTotal));
  L.push('Доставка до порту: ' + money(r.port));
  L.push('Митні платежі: ' + money(r.customs));
  L.push('Експедиторські: ' + money(r.service));
  L.push('Комісія: ' + money(r.serve));
  L.push('Доставка по Україні: ' + money(r.ua));
  if (r.repair) L.push('Ремонт: ' + money(r.repair));
  L.push('');
  L.push('РАЗОМ: ' + money(r.total));
  return L.join('\n');
}
$('#copyBtn').addEventListener('click', function () {
  var t = summary();
  var done = function () { toast('Розрахунок скопійовано — надішліть його менеджеру в Telegram'); haptic('medium'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(done, function () { fallbackCopy(t); done(); });
  } else { fallbackCopy(t); done(); }
});
function fallbackCopy(t) {
  var ta = document.createElement('textarea');
  ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
}

/* посилання на телеграм всередині міні-аппи */
$$('#tgBtn, #sBtn').forEach(function (a) {
  a.addEventListener('click', function (ev) {
    if (tg && tg.openTelegramLink) { ev.preventDefault(); tg.openTelegramLink('https://t.me/evvgenij'); }
  });
});

/* ховаємо нижню панель під час скролу вниз */
var lastY = 0;
window.addEventListener('scroll', function () {
  var y = window.scrollY;
  var atBottom = (window.innerHeight + y) >= document.body.scrollHeight - 90;
  $('#sticky').classList.toggle('hide', atBottom);
  lastY = y;
}, { passive: true });

/* ------------------------------------------------------------------ */
/* КУРС НБУ — підтягуємо актуальний (як на сайті-оригіналі)            */
/* ------------------------------------------------------------------ */
(function fetchRates() {
  if (!window.fetch) return;
  fetch('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var u = null, e = null;
      d.forEach(function (x) { if (x.cc === 'USD') u = x; if (x.cc === 'EUR') e = x; });
      if (u && e && u.rate > 0 && e.rate > 0) {
        USD = u.rate;
        EU  = e.rate / u.rate;
        var f = $('#rates');
        if (f) f.textContent = 'Курс НБУ на ' + u.exchangedate + ': $1 = ' +
                 u.rate.toFixed(2) + ' ₴ · €1 = ' + e.rate.toFixed(2) + ' ₴';
        update();
      }
    })
    .catch(function () {});
})();

update();

/* debug-хуки (не впливають на роботу) */
window.__S = S; window.__calc = calc; window.__update = update;
})();
