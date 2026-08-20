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

/* Налаштування. Значення тут — резервні: якщо сервер недоступний,
   калькулятор працює на них. Адмін-панель перезаписує їх на сервері. */
var CFG = {
  serviceBase: 349, servicePickupEur: 50, serviceVanEur: 100, serve: 500,
  portMargin: 250,       // надбавка до доставки США — у ціні, окремо не показується
  uaMargin: 50,          // надбавка до доставки по Україні — так само
  insurancePct: 0.9,     // страхування — враховане в доставці, клієнту не показується
  transferPct: 3, transferPctBigLot: 2.9, transferBigLotFrom: 10000,
  transferUaPct: 1, showTransfer: 1,
  contactTg: 'evvgenij', contactPhone: '+380505155904'
};

var tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) {
  try {
    tg.ready(); tg.expand();
    if (tg.setHeaderColor) tg.setHeaderColor('#EDEFF2');
    if (tg.setBackgroundColor) tg.setBackgroundColor('#EDEFF2');
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
  sublot: 0, title: 0,
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

  /* --- 2. страхування (у ціні доставки, окремим рядком не показуємо) --- */
  var ins = lotTotal > 0 ? Math.ceil(lotTotal * CFG.insurancePct / 100) : 0;

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
      port = Math.ceil(port + extra + CFG.portMargin);
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
    if (ua > 0) ua += CFG.uaMargin;
  }
  ua = parseInt(ua, 10) || 0;

  var repair = S.repairOn ? (parseInt(S.repair, 10) || 0) : 0;

  /* --- 7. комісія за переказ коштів ---
     Ставка як в еталонному калькуляторі: базовий відсоток на лот,
     доставку до порту й експедиторські; на доставку по Україні — окрема,
     нижча ставка. Митні платежі не входять (сплачуються напряму). */
  var transfer = 0;
  if (CFG.showTransfer && lotTotal > 0) {
    var pLot = (lotTotal > CFG.transferBigLotFrom ? CFG.transferPctBigLot : CFG.transferPct) / 100;
    var pAll = CFG.transferPct / 100;
    transfer = lotTotal * pLot + port * pAll + service * pAll + ua * (CFG.transferUaPct / 100);
    transfer = Math.ceil(transfer);
  }

  return {
    lotTotal: lotTotal, ins: ins, port: port, portCode: portCode,
    customs: customs, service: service, serve: serve, ua: ua,
    repair: repair, transfer: transfer,
    total: lotTotal + port + customs + service + serve + ua + repair + transfer
  };
}

/* базова вартість експедиторських послуг для типу кузова */
function baseService(body) {
  var b = parseFloat(CFG.serviceBase) || 0;
  if (body === 'pickup') return b + parseInt(CFG.servicePickupEur * EU, 10);
  if (body === 'van')    return b + parseInt(CFG.serviceVanEur * EU, 10);
  return b;
}

/* ------------------------------------------------------------------ */
/* СПИСКИ ДЛЯ ВИБОРУ                                                   */
/* ------------------------------------------------------------------ */
var BODIES = [
  { v: 'sedan',  n: 'Седан / купе / хетчбек' },
  { v: 'suv',    n: 'Кросовер / позашляховик' },
  { v: 'moto',   n: 'Мото' },
  { v: 'pickup', n: 'Пікап' },
  { v: 'van',    n: 'VAN / мінівен' }
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
  if (!S.lotPrice) { r.service = 0; r.serve = 0; r.transfer = 0; r.total = 0; }

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


  /* результати */
  $('#rLot').textContent     = money(r.lotTotal);
  $('#rPort').textContent    = money(r.port);
  $('#rCustoms').textContent = money(r.customs);
  $('#rUa').textContent      = money(r.ua);
  $('#rTransfer').textContent = money(r.transfer);
  $('#transferRow').classList.toggle('hidden', !r.transfer);
  $('#rTotal').textContent   = money(r.total);
  $('#rTotalUah').textContent= '≈ ' + Math.round(r.total * USD).toLocaleString('uk-UA').replace(/ /g,' ') + ' ₴';

  /* деталізація */
  var rows = [
    ['Ціна лоту зі зборами', r.lotTotal],
    ['Доставка до порту', r.port],
    ['Митні платежі', r.customs],
    ['Експедиторські послуги', r.service],
    ['Комісія за обслуговування', r.serve],
    ['Доставка по Україні', r.ua]
  ];
  if (r.transfer) rows.push(['Комісія за переказ коштів', r.transfer]);
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

  /* підсвічуємо те, що заважає порахувати */
  var need = {
    lotPrice: !S.lotPrice,
    body:     !S.body,
    fuel:     !S.fuel,
    state:    !S.stateId,
    city:     !S.cityId,
    year:     !isBig && S.body !== 'moto' && !S.year,
    engine:   !isBig && S.body !== 'moto' && S.fuel !== 1 && !S.engine,
    battery:  !isBig && S.body !== 'moto' && S.fuel === 1 && !S.battery,
    moto:     !isBig && S.body === 'moto' && !S.moto,
    region:   !isBig && !S.regionId,
    uacity:   !isBig && !S.uaCityId
  };
  $$('.pick').forEach(function (b) {
    var k = b.dataset.pick;
    b.classList.toggle('need', !!need[k] && !b.disabled);
  });
  $('#lotPrice').classList.toggle('need', need.lotPrice);
  $('#battery').classList.toggle('need', need.battery);

  /* нижня панель: не показуємо $0 без пояснення */
  var sb = $('#sTotal');
  if (!S.lotPrice) {
    sb.textContent = 'Вкажіть ціну лоту';
    sb.style.fontSize = '15px';
  } else {
    sb.textContent = money(r.total);
    sb.style.fontSize = '';
  }

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
  if (r.transfer) L.push('Комісія за переказ: ' + money(r.transfer));
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

/* дзвінок: у Telegram WebView tel: інколи блокується — тоді копіюємо номер */
var callBtn = $('#callBtn');
if (callBtn) {
  callBtn.addEventListener('click', function (ev) {
    ev.preventDefault();
    haptic('medium');
    var left = false;
    var onHide = function () { left = true; };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    var PHONE = CFG.contactPhone;
    try { window.location.href = 'tel:' + PHONE; } catch (e) {}
    setTimeout(function () {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      if (!left && !document.hidden) {
        fallbackCopy(PHONE);
        toast('Телефон не відкрився з Telegram. Номер ' + PHONE + ' скопійовано — вставте в набирач.');
      }
    }, 1200);
  });
}

/* посилання на телеграм всередині міні-аппи */
$$('#tgBtn, #sBtn').forEach(function (a) {
  a.addEventListener('click', function (ev) {
    var u = window.__TG_URL || ('https://t.me/' + String(CFG.contactTg || '').replace(/^@/, ''));
    if (tg && tg.openTelegramLink) { ev.preventDefault(); tg.openTelegramLink(u); }
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


/* ==================================================================
   ПОШУК ЛОТА — дані тягнуться з аукціону автоматично
   ------------------------------------------------------------------
   LOT_API — адреса твого проксі (Cloudflare Worker).
   Поки порожньо — блок пошуку прихований і додаток працює як звичайний
   калькулятор. Встав адресу — блок з'явиться сам.
   ================================================================== */
var LOT_API = 'https://dry-cherry-8689.kasebaby24.workers.dev';

var ST_NAMES = {
  alabama:'AL',alaska:'AK',arizona:'AZ',arkansas:'AR',california:'CA',colorado:'CO',
  connecticut:'CT',delaware:'DE',florida:'FL',georgia:'GA',hawaii:'HI',idaho:'ID',
  illinois:'IL',indiana:'IN',iowa:'IA',kansas:'KS',kentucky:'KY',louisiana:'LA',
  maine:'ME',maryland:'MD',massachusetts:'MA',michigan:'MI',minnesota:'MN',
  mississippi:'MS',missouri:'MO',montana:'MT',nebraska:'NE',nevada:'NV',
  'new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY',
  'north carolina':'NC','north dakota':'ND',ohio:'OH',oklahoma:'OK',oregon:'OR',
  pennsylvania:'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD',
  tennessee:'TN',texas:'TX',utah:'UT',vermont:'VT',virginia:'VA',washington:'WA',
  'west virginia':'WV',wisconsin:'WI',wyoming:'WY','district of columbia':'DC',
  alberta:'AB',ontario:'ON',quebec:'QC','nova scotia':'NS','new brunswick':'NB'
};


/* ------------------------------------------------------------------ */
/* ВИЗНАЧЕННЯ ТИПУ КУЗОВА ЗА МОДЕЛЛЮ                                   */
/* Аукціон тип кузова не віддає, тому визначаємо за назвою моделі.      */
/* Седан, купе і хетчбек ідуть за одним тарифом — це не помилка.        */
/* ------------------------------------------------------------------ */
var BODY_WORDS = {
  pickup: 'f 150|f 250|f 350|f 450|f150|f250|f350|f450|ranger|maverick|lightning|silverado|colorado|avalanche|s 10|sierra|canyon|ram 1500|ram 2500|ram 3500|ram 4500|dakota|tacoma|tundra|t100|frontier|titan|ridgeline|gladiator|santa cruz|cybertruck|r1t|sport trac|mark lt|ssr|hummer ev',
  van:    'transit|transit connect|e 150|e 250|e 350|e 450|econoline|express 1500|express 2500|express 3500|express cargo|savana|promaster|promaster city|sprinter|metris|nv200|nv 200|nv1500|nv2500|nv3500|nv cargo|city express|astro|safari|ram cargo',
  moto:   'harley|davidson|sportster|softail|dyna|road king|street glide|road glide|electra glide|fat boy|fatboy|night rod|v rod|ducati|panigale|multistrada|scrambler|ktm|duke|rc 390|exc|sx f|husqvarna|triumph|bonneville|speed triple|street triple|aprilia|rsv4|tuono|chieftain|moto guzzi|royal enfield|buell|victory motorcycle|ninja|zx 6r|zx 10r|zx 14|z900|z650|versys|vulcan|klx|klr|yzf|mt 07|mt 09|mt 03|fzr|v star|vmax|tenere|gsx r|gsxr|gsx s|hayabusa|katana|sv650|dr z|drz|rm z|cbr|crf|cb500|cb650|rebel|goldwing|gold wing|africa twin|grom|ruckus|vespa|piaggio|can am|spyder|ryker|sportsman|rzr|sea doo|seadoo|scooter|moped|motorcycle',
  suv:    'sienna|odyssey|pacifica|voyager|town and country|town country|grand caravan|caravan|quest|carnival|sedona|uplander|montana|venture|freestar|windstar|aerostar|previa|villager|terraza|relay|mazda5|rav4|rav 4|cr v|crv|hr v|br v|pilot|passport|highlander|4runner|sequoia|land cruiser|venza|corolla cross|explorer|escape|edge|expedition|bronco|ecosport|flex|mach e|escalade|tahoe|suburban|traverse|equinox|blazer|trailblazer|trax|captiva|yukon|acadia|terrain|envoy|durango|journey|nitro|grand cherokee|cherokee|wrangler|compass|patriot|renegade|commander|wagoneer|rogue|murano|pathfinder|armada|kicks|juke|xterra|ariya|qx50|qx55|qx60|qx70|qx80|santa fe|tucson|palisade|kona|venue|ioniq 5|nexo|sorento|sportage|telluride|seltos|soul|niro|ev6|ev9|outback|forester|ascent|crosstrek|tribeca|cx 3|cx 30|cx 5|cx 50|cx 7|cx 9|cx 90|tribute|model y|model x|x1|x2|x3|x4|x5|x6|x7|q3|q5|q7|q8|e tron|gla|glb|glc|gle|gls|glk|ml 350|gl 450|g class|tiguan|atlas|touareg|taos|id 4|id4|rx 350|rx 450|nx 200|nx 300|gx 460|gx 470|lx 470|lx 570|ux 200|rdx|mdx|zdx|xc40|xc60|xc70|xc90|range rover|discovery|evoque|velar|defender|freelander|lr2|lr3|lr4|cayenne|macan|levante|stelvio|urus|bentayga|dbx|cullinan|eclipse cross|outlander|montero|endeavor|rodeo|trooper|ascender|aviator|navigator|nautilus|corsair|mkx|mkc|mkt|xt4|xt5|xt6|srx|encore|enclave|envision|rendezvous|grand vitara|vitara|xl7|veracruz|borrego|sorento|edge|escape',
  sedan:  'ct 200|ct 200h|ct200h|hs 250|is f|rc 350|rc f|lc 500|sc 430|es 250|es 300|es 330|gs 300|gs 430|ls 400|ls 430|ls 600|crown|solara|tercel|scion|xb|xd|iq|gt86|86|fr s|frs|k900|cadenza|regal|lacrosse|lesabre|century|allure|verano|catera|cts|ats|sts|dts|deville|lucerne|impala limited|milan|zephyr|mkz|mks|continental|town car|grand marquis|crown victoria|marauder|azera|entourage|tiburon|sebring convertible|stratus|breeze|intrepid|magnum|lumina|prizm|metro|swift|esteem|verona|forenza|reno|amanti|corolla|camry|avalon|prius|yaris|echo|matrix|celica|supra|mr2|civic|accord|insight|integra|tsx|tlx|ilx|rsx|legend|altima|sentra|maxima|versa|leaf|370z|350z|gt r|elantra|sonata|accent|veloster|genesis|azera|ioniq|g70|g80|g90|forte|optima|k5|rio|stinger|cadenza|amanti|spectra|malibu|impala|cruze|sonic|spark|camaro|corvette|cobalt|aveo|monte carlo|fusion|focus|taurus|mustang|fiesta|contour|charger|challenger|dart|avenger|neon|chrysler 200|chrysler 300|sebring|pt cruiser|jetta|passat|golf|gti|arteon|beetle|3 series|5 series|7 series|320i|328i|330i|335i|340i|428i|430i|435i|528i|530i|535i|540i|550i|740i|750i|i3|i4|i8|c class|e class|s class|cla|cls|c300|e350|s550|a3|a4|a5|a6|a7|a8|model 3|model s|mazda3|mazda6|mazda 3|mazda 6|miata|mx 5|rx 8|impreza|legacy|wrx|sti|brz|is 250|is 300|is 350|es 300|es 350|gs 350|ls 460|mirage|lancer|eclipse|galant|q50|q60|q70|g35|g37|m35|m37'
};

function detectBody(l) {
  var t = ((l.title || '') + ' ' + (l.model || '') + ' ' + (l.brand || '') + ' ' + (l.body_type || '')).toLowerCase();
  t = ' ' + t.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';

  /* прямі слова в описі */
  if (/ (pickup|crew cab|quad cab|super cab|extended cab) /.test(t)) return 'pickup';
  if (/ (cargo van|panel van) /.test(t))                              return 'van';
  if (/ (minivan|passenger van) /.test(t))                            return 'suv';
  if (/ (motorcycle|scooter|moped|atv|utv) /.test(t))                return 'moto';
  if (/ (suv|crossover|sport utility) /.test(t))                     return 'suv';
  if (/ (sedan|coupe|hatchback|convertible|wagon|liftback) /.test(t))  return 'sedan';

  /* за назвою моделі — порядок важливий */
  var order = ['moto', 'pickup', 'van', 'suv', 'sedan'], i, j, w;
  for (i = 0; i < order.length; i++) {
    w = BODY_WORDS[order[i]].split('|');
    for (j = 0; j < w.length; j++) {
      if (t.indexOf(' ' + w[j] + ' ') > -1) return order[i];
    }
  }
  return '';
}

/* ------------------------------------------------------------------ */
/* ЛОТИ, ЯКІ НЕ МОЖНА ВВЕЗТИ                                           */
/* ------------------------------------------------------------------ */
var BAD_ANY = ['NO VIN PLATE', 'CERT OF DESTRUCT', 'REASIGNED VIN', 'VIN REPLACEMENT',
               'STOLEN', 'THEFT', 'MISSING/ALTERED VIN', 'NOT FOR EXPORT', 'AOC ATTACHED'];
var BAD_ELECTRIC = ['WATER', 'FLOOD', 'STORM DAMAGE', 'BURN'];

function lotWarning(l) {
  var txt = [l.damage_description, l.secondary_damage, l.sale_title_type]
              .filter(Boolean).join(' | ').toUpperCase();
  var fuel = +l.fuel;
  var i;
  for (i = 0; i < BAD_ANY.length; i++) {
    if (txt.indexOf(BAD_ANY[i]) > -1) {
      return 'Такий лот не приймається до відправки: ' + BAD_ANY[i].toLowerCase() +
             '. Уточніть у менеджера перед ставкою.';
    }
  }
  if (fuel === 1) {
    for (i = 0; i < BAD_ELECTRIC.length; i++) {
      if (txt.indexOf(BAD_ELECTRIC[i]) > -1) {
        return 'Електромобілі після води/пожежі не приймаються до перевезення. Уточніть у менеджера.';
      }
    }
  }
  var st = (l.location_state || '').toUpperCase();
  if ((fuel === 1 || fuel === 4) && (st === 'HI' || /HAWAII/i.test(l.location_state_name || ''))) {
    return 'Електро та гібриди з Гаваїв не відправляються.';
  }
  return '';
}

/* ==================================================================
   УТОЧНЕННЯ ХАРАКТЕРИСТИК ЗА VIN (офіційний декодер NHTSA)
   ------------------------------------------------------------------
   Аукціон не віддає тип кузова, тому раніше він вгадувався за назвою
   моделі — і на незнайомих моделях завжди виходив «седан».
   Тепер кузов, паливо й об'єм двигуна беруться з держреєстру за VIN.
   Працює і без оновлення сервера: якщо сервер уже все уточнив
   (body_source = 'vin'), другий запит не робиться.
   ================================================================== */
var NHTSA_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/';
var vinCache = {};

function bodyFromClass(bodyClass, vehicleType, gvwr) {
  var b = String(bodyClass || '').toLowerCase();
  var t = String(vehicleType || '').toLowerCase();
  if (/motorcycle|moped|scooter|\batv\b|\butv\b|low speed/.test(b) || /motorcycle/.test(t)) return 'moto';
  if (/minivan|mini-van/.test(b)) return 'suv';
  if (/cargo van|van - cargo|step van|panel/.test(b)) return 'van';
  if (/\bvan\b/.test(b)) return 'van';
  if (/pickup|crew cab|cab chassis|truck-tractor/.test(b)) return 'pickup';
  if (/sport utility|\bsuv\b|crossover/.test(b)) return 'suv';
  if (/wagon|hatchback|sedan|saloon|coupe|convertible|roadster|limousine|liftback/.test(b)) return 'sedan';
  if (/truck/.test(t)) return 'pickup';
  if (/multipurpose/.test(t)) return 'suv';
  if (/passenger car/.test(t)) return 'sedan';
  return '';
}

function fuelFromText(primary, secondary) {
  var p = String(primary || '').toLowerCase();
  var q = String(secondary || '').toLowerCase();
  if (/electric/.test(p) && /gasoline|petrol/.test(q)) return 4;
  if (/gasoline|petrol|flex/.test(p) && /electric/.test(q)) return 4;
  if (/electric/.test(p) && !q) return 1;
  if (/diesel/.test(p)) return 3;
  if (/gasoline|petrol|flex|ethanol|natural gas|propane/.test(p)) return 2;
  if (/electric/.test(p)) return 1;
  return 0;
}

/* Дописує в об'єкт лоту дані з VIN. cb(true) — щось уточнили. */
function enrichFromVin(l, cb) {
  var vin = String(l && l.vin || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (vin.length !== 17 || !window.fetch) { cb(false); return; }

  var done = function (v) {
    if (!v) { cb(false); return; }
    var body = bodyFromClass(v.BodyClass, v.VehicleType, v.GVWR);
    if (body) { l.body_type = body; l.body_source = 'vin'; }
    l.vin_body_class = v.BodyClass || '';

    var f = fuelFromText(v.FuelTypePrimary, v.FuelTypeSecondary);
    if (f) { l.fuel = f; l.fuel_source = 'vin'; }

    var cc = 0;
    if (v.DisplacementCC) cc = Math.round(parseFloat(v.DisplacementCC));
    else if (v.DisplacementL) {
      var L = parseFloat(String(v.DisplacementL).replace(',', '.'));
      if (!isNaN(L) && L > 0 && L < 12) cc = Math.round(L * 1000);
    }
    if (cc > 0 && cc <= 12000) { l.engine_cc = cc; l.engine_source = 'vin'; }

    if (v.BatteryKWh) {
      var kw = parseFloat(v.BatteryKWh);
      if (!isNaN(kw) && kw > 0) l.battery_kwh = kw;
    }
    if (!l.year && v.ModelYear) l.year = v.ModelYear;
    cb(true);
  };

  if (vinCache[vin] !== undefined) { done(vinCache[vin]); return; }

  var t = setTimeout(function () { t = null; cb(false); }, 6000);
  fetch(NHTSA_URL + vin + '?format=json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!t) return;                       /* уже віддали відповідь по таймауту */
      clearTimeout(t);
      var v = d && d.Results && d.Results[0] ? d.Results[0] : null;
      vinCache[vin] = v;
      done(v);
    })
    .catch(function () { if (t) { clearTimeout(t); cb(false); } });
}

var lotPhotos = [], lotIdx = 0, lotData = null;

function lotStatus(txt, isErr, isOk) {
  var el = $('#lotStatus');
  el.textContent = txt || '';
  el.classList.toggle('hidden', !txt);
  el.classList.toggle('err', !!isErr);
  el.classList.toggle('ok', !!isOk);
}

function findStateId(l) {
  var cand = [];
  if (l.location_state)      cand.push(String(l.location_state).trim().toLowerCase());
  if (l.location_state_name) cand.push(String(l.location_state_name).trim().toLowerCase());
  var i, k, m;
  /* 1 — точний збіг з кодом штату */
  for (i = 0; i < cand.length; i++) {
    var up = cand[i].toUpperCase();
    m = D.states.filter(function (o) {
      var n = o.n.toUpperCase();
      return n === up || n.replace(' - CANADA', '') === up;
    })[0];
    if (m) return m.id;
  }
  /* 2 — повна назва -> код */
  for (i = 0; i < cand.length; i++) {
    var code = ST_NAMES[cand[i]];
    if (code) {
      m = D.states.filter(function (o) { return o.n.toUpperCase().replace(' - CANADA', '') === code; })[0];
      if (m) return m.id;
    }
  }
  /* 3 — обрізана назва ("quebe", "ontar") */
  for (i = 0; i < cand.length; i++) {
    if (cand[i].length < 4) continue;
    for (k in ST_NAMES) {
      if (k.indexOf(cand[i]) === 0) {
        m = D.states.filter(function (o) { return o.n.toUpperCase().replace(' - CANADA', '') === ST_NAMES[k]; })[0];
        if (m) return m.id;
      }
    }
  }
  return 0;
}

function findCityId(stId, l) {
  var names = [];
  ['location_city', 'location_branch_name', 'location'].forEach(function (f) {
    if (l[f]) names.push(String(l[f]).trim().toLowerCase());
  });
  var pool = D.cities.filter(function (c) {
    return c.s === stId && platformFlag(c, S.platform) === 1;
  });
  var i, j;
  for (i = 0; i < names.length; i++) {
    for (j = 0; j < pool.length; j++) if (pool[j].n.toLowerCase() === names[i]) return pool[j].id;
  }
  for (i = 0; i < names.length; i++) {
    for (j = 0; j < pool.length; j++) {
      var n = pool[j].n.toLowerCase();
      if (n.indexOf(names[i]) === 0 || names[i].indexOf(n) === 0) return pool[j].id;
    }
  }
  return pool.length === 1 ? pool[0].id : 0;
}

/* ==================================================================
   ЛОКАЦІЯ ЛОТА
   ------------------------------------------------------------------
   У джерела поля location_state / location_city часто не збігаються
   між собою ("ny" + "garland", хоча насправді Erie у Пенсильванії).
   Надійне поле — location_branch_name: там назва площадки разом зі
   штатом: "hartford (ct)", "fl - west palm beach", "erie (pa)".
   Тому розбираємо спершу його, і лише потім віримо окремим полям.
   ================================================================== */
function parseBranch(b) {
  var t = String(b || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return null;
  var m = t.match(/^(.+?)\s*\(([a-z]{2})\)\s*$/);        /* "hartford (ct)" */
  if (m) return { city: m[1].trim(), st: m[2] };
  m = t.match(/^([a-z]{2})\s*[-\u2013]\s*(.+)$/);          /* "fl - orlando south" */
  if (m) return { st: m[1], city: m[2].trim() };
  return null;
}

function stateIdByCode(code) {
  var up = String(code || '').trim().toUpperCase();
  if (!up) return 0;
  var m = D.states.filter(function (o) {
    var n = o.n.toUpperCase();
    return n === up || n.replace(' - CANADA', '') === up;
  })[0];
  return m ? m.id : 0;
}

/* Шукає місто в межах штату. Без вгадування: або збіг, або 0. */
function cityIdIn(stId, names) {
  if (!stId) return 0;
  var pool = D.cities.filter(function (c) {
    return c.s === stId && platformFlag(c, S.platform) === 1;
  });
  var i, j, n, want;
  for (i = 0; i < names.length; i++) {
    want = String(names[i] || '').trim().toLowerCase();
    if (!want) continue;
    for (j = 0; j < pool.length; j++) if (pool[j].n.toLowerCase() === want) return pool[j].id;
  }
  /* часткові збіги: "orlando" -> "Orlando South", "baltimore east" -> "Baltimore East" */
  for (i = 0; i < names.length; i++) {
    want = String(names[i] || '').trim().toLowerCase();
    if (want.length < 4) continue;
    for (j = 0; j < pool.length; j++) {
      n = pool[j].n.toLowerCase();
      if (n.indexOf(want) === 0 || want.indexOf(n) === 0) return pool[j].id;
    }
  }
  return 0;
}

/* Остання спроба: шукаємо місто по всіх штатах. Беремо лише якщо
   назва однозначна (зустрічається рівно в одному штаті). */
function cityAnywhere(names) {
  var i, want, hits, j;
  for (i = 0; i < names.length; i++) {
    want = String(names[i] || '').trim().toLowerCase();
    if (want.length < 4) continue;
    hits = D.cities.filter(function (c) {
      return c.n.toLowerCase() === want && platformFlag(c, S.platform) === 1;
    });
    var seen = {}, uniq = [];
    for (j = 0; j < hits.length; j++) if (!seen[hits[j].s]) { seen[hits[j].s] = 1; uniq.push(hits[j]); }
    if (uniq.length === 1) return { stateId: uniq[0].s, cityId: uniq[0].id };
  }
  return null;
}

function resolveLocation(l) {
  var br  = parseBranch(l.location_branch_name) || parseBranch(l.location);
  var cityNames = [];
  if (br && br.city)        cityNames.push(br.city);
  if (l.location_city)      cityNames.push(l.location_city);
  if (l.location_branch_name) cityNames.push(l.location_branch_name);

  /* 1 — штат із площадки (найнадійніше) */
  if (br && br.st) {
    var sid = stateIdByCode(br.st);
    if (sid) {
      var cid = cityIdIn(sid, cityNames);
      if (cid) return { stateId: sid, cityId: cid };
    }
  }

  /* 2 — штат із окремого поля */
  var sid2 = findStateId(l);
  if (sid2) {
    var cid2 = cityIdIn(sid2, cityNames);
    if (cid2) return { stateId: sid2, cityId: cid2 };
  }

  /* 3 — по назві міста через усі штати */
  var any = cityAnywhere(cityNames);
  if (any) return any;

  /* 4 — хоч штат, місто лишиться на вибір людині */
  if (br && br.st) { var s3 = stateIdByCode(br.st); if (s3) return { stateId: s3, cityId: 0 }; }
  if (sid2) return { stateId: sid2, cityId: 0 };
  return { stateId: 0, cityId: 0 };
}

function nearestEngine(cc) {
  var best = 0, diff = 1e9;
  D.engines.forEach(function (e) {
    var d = Math.abs(e - cc);
    if (d < diff) { diff = d; best = e; }
  });
  return best;
}

function renderLot(l) {
  lotData = l;
  lotPhotos = (l.images || []).map(function (x) { return x.image_url; }).filter(Boolean);
  if (!lotPhotos.length && l.img) lotPhotos = [l.img];
  lotIdx = 0;

  $('#lotRes').classList.remove('hidden');
  $('#lotPhoto').classList.toggle('hidden', !lotPhotos.length);
  if (lotPhotos.length) showPhoto(0);

  var auc = (D.platforms.filter(function (p) { return p.id == +l.auction; })[0] || {}).n || '';
  $('#lotAuc').textContent = auc;
  $('#lotAuc').classList.toggle('hidden', !auc);

  $('#lotTitle').textContent = l.title || ((l.year || '') + ' ' + (l.brand || '') + ' ' + (l.model || '')).trim() || 'Лот ' + (l.lot_number || '');
  $('#lotVin').textContent = l.vin ? 'VIN ' + l.vin : '';

  var sp = [];
  if (l.year)        sp.push(['Рік', l.year]);
  if (+l.engine > 0) sp.push(['Двигун', (l.engine / 1000).toFixed(1) + ' л']);
  else if (l.engine) sp.push(['Двигун', String(l.engine).slice(0, 22)]);
  if (l.odometer)    sp.push(['Пробіг', (+l.odometer).toLocaleString('uk-UA') + ' mi']);
  var fn = { 1: 'Електро', 2: 'Бензин', 3: 'Дизель', 4: 'Гібрид' }[+l.fuel];
  if (fn)                     sp.push(['Паливо', fn]);
  if (l.location_branch_name) sp.push(['Локація', l.location_branch_name]);
  if (l.sale_title_type)      sp.push(['Title', l.sale_title_type]);
  if (+l.buy_now_price > 0)   sp.push(['Buy Now', '$' + (+l.buy_now_price).toLocaleString('uk-UA')]);
  $('#lotSpecs').innerHTML = sp.map(function (x) {
    return '<span>' + esc(x[0]) + ' <b>' + esc(x[1]) + '</b></span>';
  }).join('');

  var dmg = [l.damage_description, l.secondary_damage].filter(Boolean).join(' · ');
  $('#lotDmg').textContent = dmg ? 'Пошкодження: ' + dmg : '';
  $('#lotDmg').classList.toggle('hidden', !dmg);

  var warn = lotWarning(l);
  $('#lotWarn').textContent = warn;
  $('#lotWarn').classList.toggle('hidden', !warn);
}

function showPhoto(i) {
  if (!lotPhotos.length) return;
  lotIdx = (i + lotPhotos.length) % lotPhotos.length;
  $('#lotImg').src = lotPhotos[lotIdx];
  $('#lotDots').innerHTML = lotPhotos.slice(0, 12).map(function (_, k) {
    return '<i class="' + (k === lotIdx ? 'on' : '') + '"></i>';
  }).join('');
  var multi = lotPhotos.length > 1;
  $('#lotPrev').classList.toggle('hidden', !multi);
  $('#lotNext').classList.toggle('hidden', !multi);
}

/* Витягує номер лота або VIN з будь-якого тексту:
   "lot # 45678912", посилання на Copart/IAAI, VIN з пробілами тощо. */
function cleanQuery(v) {
  var t = String(v || '').toUpperCase();
  var vin = t.replace(/[^A-Z0-9]/g, '').match(/[A-HJ-NPR-Z0-9]{17}/);
  if (vin && /[A-Z]/.test(vin[0])) return vin[0];
  var nums = t.match(/\d{6,10}/g);
  if (nums) {
    nums.sort(function (a, b) { return b.length - a.length; });
    return nums[0];
  }
  return t.replace(/[^A-Z0-9]/g, '');
}

var lotTimer = null, lastQuery = '', lotReq = 0;

/* Чи схоже введене на завершений номер?
   Потрібно, щоб не стріляти пошуком на кожній літері VIN. */
function looksComplete(q) {
  if (/^\d{6,10}$/.test(q)) return true;   // номер лота
  if (q.length === 17)      return true;   // VIN
  return false;
}

function searchLot(auto) {
  var q = cleanQuery($('#lotQuery').value);
  if (!q) { if (!auto) lotStatus('Введіть номер лота або VIN', true); return; }
  if (q.length < 6) { if (!auto) lotStatus('Замало символів — перевірте номер', true); return; }

  /* новий запит завжди має пріоритет над попереднім */
  var my = ++lotReq;
  lastQuery = q;

  $('#lotGo').disabled = true;
  $('#lotStatus').classList.remove('hidden');
  $('#lotStatus').classList.remove('err');
  $('#lotStatus').classList.remove('ok');
  $('#lotStatus').innerHTML = '<i class="lot-spin"></i>Шукаємо лот…';

  fetch(LOT_API + (LOT_API.indexOf('?') > -1 ? '&' : '?') + 'value=' + encodeURIComponent(q))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (my !== lotReq) return;                 /* прийшла відповідь на застарілий запит */
      $('#lotGo').disabled = false;
      if (!d || d.status !== 'success' || !d.lot) {
        $('#lotRes').classList.add('hidden');
        lotStatus(q.length === 17
          ? 'За цим VIN лот не знайдено. Спробуйте номер лота.'
          : 'Лот не знайдено. Перевірте номер або введіть VIN.', true);
        return;
      }
      var lot = d.lot;
      if (lot.body_source === 'vin') {          /* сервер уже все уточнив */
        renderLot(lot); applyLot(); haptic('medium'); return;
      }
      $('#lotStatus').innerHTML = '<i class="lot-spin"></i>Уточнюємо характеристики за VIN…';
      enrichFromVin(lot, function () {
        if (my !== lotReq) return;
        renderLot(lot);
        applyLot();
        haptic('medium');
      });
    })
    .catch(function () {
      if (my !== lotReq) return;
      $('#lotGo').disabled = false;
      lotStatus('Не вдалося зв\'язатися з сервером. Спробуйте ще раз.', true);
    });
}

function applyLot() {
  var l = lotData; if (!l) return;

  /* Спершу чистимо все, що стосується САМОГО АВТО.
     Без цього дані попереднього лоту залишались і змішувались з новим:
     наприклад ціна від минулої машини тихо потрапляла в новий розрахунок. */
  S.lotPrice = 0; S.auctionFee = 0;
  S.body = ''; S.fuel = 0; S.year = 0;
  S.engine = 0; S.moto = 0; S.battery = 0;
  S.stateId = 0; S.cityId = 0;
  S.sublot = 0; S.title = 0;
  $('#lotPrice').value = '';
  $('#battery').value = '';
  $('#sublotFee').value = '';
  $('#titleFee').value = '';
  $('#auctionFee').value = '';

  if (+l.auction && D.platforms.filter(function (p) { return p.id == +l.auction; }).length) S.platform = +l.auction;
  if (+l.year) S.year = +l.year;
  if (+l.buy_now_price > 0) { S.lotPrice = parseInt(l.buy_now_price, 10); $('#lotPrice').value = S.lotPrice; }
  if (+l.fuel >= 1 && +l.fuel <= 4) S.fuel = +l.fuel;

  /* Тип кузова.
     Пріоритет 1 — офіційний декодер VIN (сервер уже поклав це в body_type).
     Пріоритет 2 — назва моделі, як резерв для лотів без VIN. */
  var body = '', bodySure = false;
  if (l.body_source === 'vin' && l.body_type) { body = l.body_type; bodySure = true; }
  if (!body) body = detectBody(l);
  var autoBody = false;
  if (body) { S.body = body; autoBody = true; }

  /* об'єм двигуна: спершу з VIN, потім з даних лоту */
  var cc = parseInt(l.engine_cc, 10) || parseInt(l.engine, 10);
  if (S.fuel !== 1 && cc > 0 && cc <= 10000) S.engine = nearestEngine(cc);
  if (S.body === 'moto' && cc > 0 && cc <= 2000) S.moto = nearestMoto(cc);

  if (S.fuel === 1 && +l.battery_kwh > 0 && !S.battery) {
    S.battery = Math.round(+l.battery_kwh);
    $('#battery').value = S.battery;
  }

  var loc = resolveLocation(l);
  if (loc.stateId) { S.stateId = loc.stateId; S.cityId = loc.cityId; }

  S.service = baseService(S.body);
  $('#service').value = S.service;

  save(); update();

  /* що лишилось заповнити вручну */
  var miss = [];
  if (!S.lotPrice) miss.push('ціну лоту (вашу ставку)');
  if (!S.body)     miss.push('тип кузова');
  if (!S.fuel)     miss.push('тип палива');
  if (S.body !== 'moto' && S.fuel !== 1 && !S.engine) miss.push("об'єм двигуна");
  if (S.body === 'moto' && !S.moto) miss.push("об'єм двигуна");
  if (!S.stateId || !S.cityId) miss.push('штат і місто');

  var bodyName = (BODIES.filter(function (b) { return b.v === S.body; })[0] || {}).n;
  var bodyTxt = !autoBody ? ''
    : bodySure ? ' Кузов за VIN: «' + bodyName + '».'
               : ' Кузов визначено приблизно як «' + bodyName + '» — перевірте.';

  if (miss.length) {
    lotStatus('Заповніть вручну: ' + miss.join(', ') + '.' + bodyTxt);
  } else {
    lotStatus('Готово — розрахунок нижче.' + bodyTxt, false, true);
  }

  haptic('light');
}

function nearestMoto(cc) {
  var best = 0, diff = 1e9;
  D.motoEngines.forEach(function (e) {
    var d = Math.abs(e - cc);
    if (d < diff) { diff = d; best = e; }
  });
  return best;
}

if (LOT_API) {
  $('#lotGo').addEventListener('click', function () { searchLot(false); });
  $('#lotApply').addEventListener('click', applyLot);
  $('#lotPrev').addEventListener('click', function () { showPhoto(lotIdx - 1); });
  $('#lotNext').addEventListener('click', function () { showPhoto(lotIdx + 1); });
  $('#lotImg').addEventListener('error', function () { $('#lotPhoto').classList.add('hidden'); });

  /* автопошук: чекаємо, поки номер виглядатиме завершеним */
  $('#lotQuery').addEventListener('input', function () {
    var q = cleanQuery(this.value);
    clearTimeout(lotTimer);
    if (q === lastQuery) return;
    if (looksComplete(q)) {
      lotTimer = setTimeout(function () { searchLot(true); }, 400);
    } else if (q.length >= 6) {
      /* нестандартний ввід — даємо людині домрукувати */
      lotTimer = setTimeout(function () { searchLot(true); }, 1200);
    }
  });
  $('#lotQuery').addEventListener('paste', function () {
    var el = this;
    setTimeout(function () {
      clearTimeout(lotTimer);
      if (cleanQuery(el.value).length >= 6) searchLot(true);
    }, 30);
  });
  $('#lotQuery').addEventListener('blur', function () {
    var q = cleanQuery(this.value);
    clearTimeout(lotTimer);
    if (q.length >= 6 && q !== lastQuery) searchLot(true);
  });
  $('#lotQuery').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); this.blur(); clearTimeout(lotTimer); searchLot(false); }
  });
} else {
  $('.lot-card').classList.add('hidden');
}

/* ------------------------------------------------------------------ */
/* НАЛАШТУВАННЯ З СЕРВЕРА (керуються з адмін-панелі)                    */
/* ------------------------------------------------------------------ */
function applyContacts() {
  var tgUrl = 'https://t.me/' + String(CFG.contactTg || '').replace(/^@/, '');
  $$('#tgBtn, #sBtn').forEach(function (a) { if (a) a.href = tgUrl; });
  var cb = $('#callBtn');
  if (cb) {
    cb.href = 'tel:' + CFG.contactPhone;
    var lbl = cb.querySelector('span') || cb;
    if (lbl && lbl !== cb) lbl.textContent = formatPhone(CFG.contactPhone);
  }
  window.__TG_URL = tgUrl;
}
function formatPhone(p) {
  var d = String(p || '').replace(/[^0-9]/g, '');
  if (d.length === 12 && d.indexOf('380') === 0)
    return '+380 ' + d.slice(3, 5) + ' ' + d.slice(5, 8) + ' ' + d.slice(8, 10) + ' ' + d.slice(10);
  return p;
}

(function fetchSettings() {
  if (!window.fetch || !LOT_API) return;
  fetch(LOT_API.replace(/\/+$/, '') + '/settings')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || typeof d !== 'object') return;
      Object.keys(CFG).forEach(function (k) {
        if (d[k] !== undefined && d[k] !== null && d[k] !== '') CFG[k] = d[k];
      });
      /* значення з адмінки перебивають те, що лежало локально */
      S.service = baseService(S.body);
      S.serve   = parseFloat(CFG.serve) || 0;
      var si = $('#service'), sv = $('#serve');
      if (si) si.value = S.service;
      if (sv) sv.value = S.serve;
      applyContacts();
      save(); update();
    })
    .catch(function () {});
})();

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

applyContacts();
update();

/* debug-хуки (не впливають на роботу) */
window.__S = S; window.__calc = calc; window.__update = update; window.__detectBody = detectBody;
window.__lotWarning = lotWarning; window.__enrichFromVin = enrichFromVin;
window.__bodyFromClass = bodyFromClass; window.__CFG = CFG;
window.__findStateId = findStateId; window.__findCityId = findCityId; window.__applyLot = applyLot;
window.__resolveLocation = resolveLocation; window.__parseBranch = parseBranch;
window.__setLotData = function (l) { lotData = l; };
})();
