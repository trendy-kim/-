'use strict';

/* ───────── 공통 유틸 ───────── */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = n => Math.round(n || 0).toLocaleString('ko-KR');
const pad = n => String(n).padStart(2, '0');
const ymd = d => d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '';
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const fmtDist = m => m == null ? '-' : m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(2)}km`;
const pct = (a, b) => b ? `${(a / b * 100).toFixed(1)}%` : '-';

const store = {
  get(k, d) { try { const v = localStorage.getItem('cch.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('cch.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem('cch.' + k); sessionStorage.removeItem('cch.' + k); } catch (e) { /* noop */ } },
};
/* 카드 거래 원본은 탭을 닫으면 사라지도록 sessionStorage에만 둔다 */
const tmp = {
  get(k, d) { try { const v = sessionStorage.getItem('cch.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { sessionStorage.setItem('cch.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
};

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), ms);
}

/* ───────── 필드 정의 ───────── */
const HEADERS = ['순번', '카드번호', '이용자명', '이용일', '가맹점명', '이용금액', '가맹점 주소', '사업자 등록번호', '승인번호',
  '과세유형', '전표구분', '미화금액', '미화환율', '승인시간', '가맹점업종코드', '가맹점업종명', '유종', '리터당단가'];
const FIELD_MAP = {
  순번: 'seq', 카드번호: 'card', 이용자명: 'user', 사용자명: 'user', 이용자: 'user',
  이용일: 'date', 이용일자: 'date', 사용일: 'date', 사용일자: 'date', 승인일자: 'date',
  가맹점명: 'merchant', 이용금액: 'amount', 사용금액: 'amount', 승인금액: 'amount',
  가맹점주소: 'addr', 주소: 'addr', 사업자등록번호: 'bizNo', 승인번호: 'approvalNo', 과세유형: 'taxType',
  전표구분: 'slipType', 미화금액: 'usd', 미화환율: 'fx', 승인시간: 'time', 이용시간: 'time',
  가맹점업종코드: 'catCode', 가맹점업종명: 'catName', 업종명: 'catName', 유종: 'fuel', 리터당단가: 'unitPrice',
};
const REQUIRED = { user: '이용자명', date: '이용일', merchant: '가맹점명', amount: '이용금액', addr: '가맹점 주소' };
const normKey = v => String(v ?? '').replace(/\(.*?\)/g, '').replace(/\s/g, '');

/* 2025·2026 법정공휴일 (대체공휴일·선거일 포함) */
const HOLIDAYS = [
  '2025-01-01', '2025-01-27', '2025-01-28', '2025-01-29', '2025-01-30', '2025-03-01', '2025-03-03', '2025-05-05', '2025-05-06',
  '2025-06-03', '2025-06-06', '2025-08-15', '2025-10-03', '2025-10-05', '2025-10-06', '2025-10-07', '2025-10-08', '2025-10-09', '2025-12-25',
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02', '2026-05-05', '2026-05-24', '2026-05-25',
  '2026-06-03', '2026-06-06', '2026-08-15', '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03', '2026-10-05',
  '2026-10-09', '2026-12-25',
];

/* ───────── 상태 ───────── */
const S = {
  rows: [],
  users: [],
  fileInfo: null,
  homes: store.get('homes', {}),       // { 이용자명: {addr, lat, lng} }
  geo: store.get('geocache', {}),      // { 주소: {lat, lng, src} | {fail:true} }
  settings: Object.assign({ key: '', radius: 1000, nightStart: 22, nightEnd: 6, excludeCancel: true, holidays: '', gemKey: '', gemModel: 'gemini-3.8-flash', pseudo: true }, store.get('settings', {})),
  kakao: false, map: null, geocoder: null, places: null,
  overlays: [], info: null, pickFor: null,
  sort: { key: 'score', dir: -1 },
  geoRunning: false,
};

/* 종료된 옛 기본 모델명이 저장돼 있으면 새 기본값으로 교체 */
if (/^gemini-(1\.|2\.)/.test(S.settings.gemModel || '')) { S.settings.gemModel = 'gemini-3.8-flash'; store.set('settings', S.settings); }

/* ───────── 값 파싱 ───────── */
function toNum(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  const n = parseFloat(s.replace(/[^\d.]/g, ''));
  return isNaN(n) ? 0 : neg ? -n : n;
}

function toDate(v) {
  if (v instanceof Date && !isNaN(v)) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    return new Date(d.y, d.m - 1, d.d);
  }
  const s = String(v ?? '').trim();
  let m;
  if (/^\d{8}$/.test(s)) m = [0, s.slice(0, 4), s.slice(4, 6), s.slice(6, 8)];
  else m = s.match(/(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})/);
  if (!m) {
    const m2 = s.match(/^(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    if (m2) m = [0, '20' + m2[1], m2[2], m2[3]];
  }
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(d) ? null : d;
}

function toTime(v) {
  if (v instanceof Date && !isNaN(v)) return `${pad(v.getHours())}:${pad(v.getMinutes())}`;
  if (typeof v === 'number') {
    if (v > 0 && v < 1) { const mins = Math.round(v * 1440); return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`; }
    if (v >= 10000 && v < 240000) { const s = String(Math.round(v)).padStart(6, '0'); return `${s.slice(0, 2)}:${s.slice(2, 4)}`; }
    if (v >= 0 && v < 2400) { const s = String(Math.round(v)).padStart(4, '0'); return `${s.slice(0, 2)}:${s.slice(2, 4)}`; }
    return '';
  }
  const s = String(v ?? '').trim();
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return `${pad(m[1])}:${m[2]}`;
  const d = s.replace(/\D/g, '');
  if (d.length === 6 || d.length === 4) return `${d.slice(0, 2)}:${d.slice(2, 4)}`;
  return '';
}

const maskCard = c => {
  const d = String(c ?? '').replace(/[^\d*]/g, '');
  return d.length >= 4 ? `****-${d.slice(-4)}` : String(c ?? '');
};

/* ───────── 파일 읽기 ───────── */
async function readFile(file) {
  const buf = await file.arrayBuffer();
  let wb;
  if (/\.(csv|txt)$/i.test(file.name)) {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder('euc-kr').decode(buf); }
    wb = XLSX.read(text.replace(/^﻿/, ''), { type: 'string', raw: true });
  } else {
    wb = XLSX.read(buf, { type: 'array', cellDates: true });
  }
  for (const name of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    for (let i = 0; i < Math.min(aoa.length, 30); i++) {
      const keys = aoa[i].map(normKey);
      if (keys.includes('가맹점명') && (keys.includes('이용금액') || keys.includes('카드번호'))) {
        return { aoa, hi: i, sheet: name };
      }
    }
  }
  throw new Error('머리글(가맹점명·이용금액 등)이 있는 시트를 찾지 못했습니다.');
}

function buildRows(aoa, hi) {
  const head = aoa[hi].map(h => FIELD_MAP[normKey(h)] || null);
  const missing = Object.entries(REQUIRED).filter(([k]) => !head.includes(k)).map(([, v]) => v);
  if (missing.length) throw new Error(`필수 열이 없습니다: ${missing.join(', ')}`);
  const rows = [];
  for (let i = hi + 1; i < aoa.length; i++) {
    const raw = {};
    aoa[i].forEach((v, j) => { if (head[j] && raw[head[j]] === undefined) raw[head[j]] = v; });
    if (!String(raw.merchant ?? '').trim() && !raw.amount) continue;
    if (/합계|소계|total/i.test(String(raw.seq ?? '') + String(raw.card ?? ''))) continue;
    const date = toDate(raw.date);
    const time = toTime(raw.time !== undefined && raw.time !== '' ? raw.time : raw.date);
    const amount = toNum(raw.amount);
    const slip = String(raw.slipType ?? '').trim();
    rows.push({
      id: rows.length,
      seq: String(raw.seq ?? ''),
      card: maskCard(raw.card),   // 카드번호 전체는 저장하지 않고 뒤 4자리만 보관
      user: String(raw.user ?? '').trim() || '(미상)',
      date, dateStr: ymd(date), time,
      hour: time ? +time.slice(0, 2) : null,
      merchant: String(raw.merchant ?? '').trim(),
      amount,
      addr: String(raw.addr ?? '').replace(/\s+/g, ' ').trim(),
      bizNo: String(raw.bizNo ?? ''),
      approvalNo: String(raw.approvalNo ?? ''),
      taxType: String(raw.taxType ?? ''),
      slipType: slip,
      usd: toNum(raw.usd), fx: toNum(raw.fx),
      catCode: String(raw.catCode ?? ''),
      catName: String(raw.catName ?? '').trim() || '(업종 없음)',
      fuel: String(raw.fuel ?? ''), unitPrice: toNum(raw.unitPrice),
      cancelled: /취소/.test(slip) || amount < 0,
    });
  }
  return rows;
}

function setData(rows, info) {
  S.rows = rows;
  S.fileInfo = info;
  S.users = [...new Set(rows.map(r => r.user))].sort((a, b) => a.localeCompare(b, 'ko'));
  const ok = tmp.set('rows', { info, rows: rows.map(r => ({ ...r, date: r.dateStr })) });
  if (!ok) toast('데이터가 커서 새로고침용 임시저장을 못했습니다. 새로고침하면 다시 올려야 합니다.', 4000);
  initFilters();
  analyze();
  renderAll();
}

function restoreData() {
  try { localStorage.removeItem('cch.rows'); } catch (e) { /* 이전 버전이 남긴 카드 내역 삭제 */ }
  const saved = tmp.get('rows', null);
  if (!saved || !saved.rows) return;
  const rows = saved.rows.map(r => ({ ...r, date: r.date ? toDate(r.date) : null }));
  S.rows = rows;
  S.fileInfo = saved.info;
  S.users = [...new Set(rows.map(r => r.user))].sort((a, b) => a.localeCompare(b, 'ko'));
}

/* ───────── 샘플 데이터 ───────── */
function makeSample() {
  let seed = 20261102;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const M = (n, a, c, lat, lng, min, max) => ({ n, a, c, lat, lng, min, max });
  const office = [
    M('광화문 한정식', '서울 종로구 세종대로 175', '일반한식', 37.5725, 126.9760, 30000, 180000),
    M('시청앞 국밥', '서울 중구 세종대로 110', '일반한식', 37.5663, 126.9779, 9000, 60000),
    M('을지로 커피랩', '서울 중구 을지로 30', '커피전문점', 37.5652, 126.9810, 4500, 30000),
    M('명동 오피스문구', '서울 중구 남대문로 63', '문구용품', 37.5640, 126.9830, 8000, 90000),
    M('새문안 셀프주유소', '서울 종로구 새문안로 68', '주유소', 37.5705, 126.9715, 50000, 90000),
  ];
  const people = [
    { user: '김민준', card: '5585-2611-0000-1234', home: { addr: '서울 송파구 올림픽로 300', lat: 37.5126, lng: 127.1025 }, near: [
      M('잠실 대형마트', '서울 송파구 올림픽로 240', '대형할인점', 37.5111, 127.0980, 20000, 250000),
      M('잠실 치킨앤비어', '서울 송파구 올림픽로 269', '주점', 37.5145, 127.1040, 25000, 95000),
      M('타워 스시', '서울 송파구 올림픽로 300', '일식', 37.5126, 127.1025, 40000, 200000),
      M('올림픽공원 셀프주유소', '서울 송파구 올림픽로 424', '주유소', 37.5206, 127.1215, 50000, 90000),
    ] },
    { user: '이서연', card: '5585-2611-0000-5678', home: { addr: '서울 마포구 월드컵북로 396', lat: 37.5790, lng: 126.8895 }, near: [
      M('상암 브런치카페', '서울 마포구 월드컵북로 400', '커피전문점', 37.5795, 126.8890, 6000, 40000),
      M('월드컵 홈마트', '서울 마포구 월드컵로 240', '대형할인점', 37.5683, 126.8972, 15000, 180000),
      M('매봉산 고깃집', '서울 마포구 매봉산로 31', '일반한식', 37.5770, 126.8920, 30000, 150000),
    ] },
    { user: '박지훈', card: '5585-2611-0000-9012', home: { addr: '경기 성남시 분당구 판교역로 166', lat: 37.3952, lng: 127.1109 }, near: [
      M('판교 식품관', '경기 성남시 분당구 판교역로146번길 20', '백화점', 37.3925, 127.1120, 20000, 300000),
      M('판교 이자카야', '경기 성남시 분당구 판교역로 235', '주점', 37.4020, 127.1080, 30000, 160000),
      M('아지트 편의점', '경기 성남시 분당구 판교역로 166', '편의점', 37.3952, 127.1109, 3000, 30000),
    ] },
  ];
  const aoa = [HEADERS];
  let seq = 1;
  for (const p of people) {
    for (let i = 0; i < 30; i++) {
      const d = new Date(2026, 8, 1 + Math.floor(rnd() * 61));
      const off = d.getDay() === 0 || d.getDay() === 6 || HOLIDAYS.includes(ymd(d));
      const isNear = rnd() < (off ? 0.85 : 0.18);
      const m = isNear ? pick(p.near) : pick(office);
      let h = off ? 11 + Math.floor(rnd() * 10) : isNear ? 19 + Math.floor(rnd() * 4) : pick([8, 12, 12, 13, 18, 19]);
      if (isNear && rnd() < 0.2) h = pick([22, 23, 0, 1]);
      const tm = `${pad(h)}:${pad(Math.floor(rnd() * 60))}:${pad(Math.floor(rnd() * 60))}`;
      let amt = Math.round((m.min + rnd() * (m.max - m.min)) / 100) * 100;
      let fuel = '', unit = '';
      if (m.c === '주유소') { fuel = '휘발유'; unit = 1650 + Math.round(rnd() * 80); amt = Math.round(amt / unit) * unit; }
      aoa.push([seq++, p.card, p.user, ymd(d), m.n, amt, m.a, `${100 + seq}-81-${10000 + seq * 7}`, String(30000000 + Math.floor(rnd() * 9999999)),
        '일반', '승인', '', '', tm, String(4000 + Math.floor(rnd() * 900)), m.c, fuel, unit]);
      if (!S.geo[m.a]) S.geo[m.a] = { lat: m.lat, lng: m.lng, src: 'sample' };
    }
    if (!S.homes[p.user]) S.homes[p.user] = { ...p.home, src: 'sample' };
  }
  // 취소 전표 예시
  const c = aoa[5].slice(); c[0] = seq++; c[5] = -c[5]; c[10] = '취소'; aoa.push(c);
  store.set('geocache', S.geo);
  store.set('homes', S.homes);
  return aoa;
}

/* ───────── 분석 ───────── */
function holidaySet() {
  const extra = (S.settings.holidays || '').split(/\s+/).map(s => ymd(toDate(s))).filter(Boolean);
  return new Set([...HOLIDAYS, ...extra]);
}

function distM(a, b, c, d) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(c - a), dLng = rad(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function analyze() {
  const R = +S.settings.radius;
  const hol = holidaySet();
  const ns = +S.settings.nightStart, ne = +S.settings.nightEnd;
  for (const r of S.rows) {
    const g = S.geo[r.addr];
    r.lat = g && !g.fail ? g.lat : null;
    r.lng = g && !g.fail ? g.lng : null;
    const h = S.homes[r.user];
    r.dist = r.lat != null && h && h.lat != null ? distM(h.lat, h.lng, r.lat, r.lng) : null;
    r.near = r.dist != null && r.dist <= R;
    const dow = r.date ? r.date.getDay() : null;
    r.weekend = dow === 0 || dow === 6;
    r.holiday = hol.has(r.dateStr);
    r.off = r.weekend || r.holiday;
    r.night = r.hour != null && (ns > ne ? (r.hour >= ns || r.hour < ne) : (r.hour >= ns && r.hour < ne));
    r.score = r.near ? Math.min(100, 40 + Math.round(20 * (1 - r.dist / R)) + (r.off ? 25 : 0) + (r.night ? 15 : 0)) : 0;
  }
}

function baseRows() {
  const u = $('#fUser').value, from = $('#fFrom').value, to = $('#fTo').value;
  const q = $('#fSearch').value.trim().toLowerCase();
  return S.rows.filter(r =>
    (!S.settings.excludeCancel || !r.cancelled) &&
    (!u || r.user === u) &&
    (!from || r.dateStr >= from) &&
    (!to || r.dateStr <= to) &&
    (!q || `${r.merchant} ${r.catName} ${r.addr}`.toLowerCase().includes(q)));
}

const level = s => s >= 80 ? ['high', '높음'] : s >= 60 ? ['mid', '주의'] : ['low', '참고'];

/* ───────── 렌더링 ───────── */
function renderAll() {
  renderDataTab();
  renderHomes();
  renderDash();
  if (typeof renderAi === 'function') renderAi();
}

function initFilters() {
  const sel = $('#fUser'), cur = sel.value;
  sel.innerHTML = '<option value="">전체</option>' + S.users.map(u => `<option>${esc(u)}</option>`).join('');
  if (S.users.includes(cur)) sel.value = cur;
  const dates = S.rows.map(r => r.dateStr).filter(Boolean).sort();
  $('#fFrom').value = dates[0] || '';
  $('#fTo').value = dates[dates.length - 1] || '';
  $('#fRadius').value = S.settings.radius;
}

function table(cols, rows, opt = {}) {
  if (!rows.length) return `<p class="muted">${opt.empty || '해당 데이터가 없습니다.'}</p>`;
  const th = cols.map(c => {
    const s = opt.sortable && c.k ? ` class="sortable ${c.num ? 'num' : ''}" data-sort="${c.k}"` : c.num ? ' class="num"' : '';
    const arrow = opt.sortable && S.sort.key === c.k ? (S.sort.dir > 0 ? ' ▲' : ' ▼') : '';
    return `<th${s}>${c.label}${arrow}</th>`;
  }).join('');
  const tb = rows.map(r => `<tr${opt.rowAttr ? opt.rowAttr(r) : ''}>${cols.map(c =>
    `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.f ? c.f(r) : esc(r[c.k])}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`;
}

function barCell(v, max, text) {
  return `<div class="bar"><i style="width:${max ? Math.max(2, v / max * 100) : 0}%"></i><span>${text}</span></div>`;
}

function renderDash() {
  const has = S.rows.length > 0;
  $('#emptyDash').classList.toggle('hidden', has);
  const rows = baseRows();
  const near = rows.filter(r => r.near);
  const sum = a => a.reduce((s, r) => s + r.amount, 0);
  const R = +S.settings.radius;

  // 배너: 집주소 미설정 / 지도 선택 모드
  const scope = $('#fUser').value ? [$('#fUser').value] : S.users;
  const noHome = scope.filter(u => !(S.homes[u] && S.homes[u].lat != null));
  const pending = S.rows.filter(r => r.addr && !S.geo[r.addr]).length;
  const msgs = [];
  if (S.pickFor) msgs.push(`<b>${esc(S.pickFor)}</b>님의 집 위치를 지도에서 클릭하세요. <a href="#" id="cancelPick">취소</a>`);
  if (has && noHome.length) msgs.push(`집주소가 없는 이용자 ${noHome.length}명(${noHome.slice(0, 5).map(esc).join(', ')}${noHome.length > 5 ? ' 외' : ''})은 분석에서 빠집니다. <a href="#" data-goto="homes">집주소 등록</a>`);
  if (has && pending) msgs.push(`좌표 변환이 안 된 거래 ${pending}건이 있습니다. <a href="#" data-goto="data">좌표 변환</a>`);
  $('#banner').innerHTML = msgs.join('<br>');
  $('#banner').classList.toggle('hidden', !msgs.length);
  const cp = $('#cancelPick');
  if (cp) cp.onclick = e => { e.preventDefault(); S.pickFor = null; renderDash(); };

  // KPI
  const offNear = near.filter(r => r.off), nightNear = near.filter(r => r.night);
  const high = near.filter(r => r.score >= 80);
  const located = rows.filter(r => r.lat != null).length;
  $('#kpis').innerHTML = !has ? '' : [
    ['전체 사용', `${won(sum(rows))}원`, `${won(rows.length)}건 · 좌표 확보 ${pct(located, rows.length)}`],
    ['집근처 사용', `${won(sum(near))}원`, `${won(near.length)}건 · 금액 비중 ${pct(sum(near), sum(rows))}`, true],
    ['주말·공휴일 집근처', `${won(offNear.length)}건`, `${won(sum(offNear))}원`, offNear.length > 0],
    ['심야 집근처', `${won(nightNear.length)}건`, `${won(sum(nightNear))}원 · ${S.settings.nightStart}시~${S.settings.nightEnd}시`, nightNear.length > 0],
    ['고위험(80점+)', `${won(high.length)}건`, `${won(sum(high))}원`, high.length > 0],
    ['분석 반경', fmtDist(R), `집주소 등록 ${scope.length - noHome.length}/${scope.length}명`],
  ].map(([k, v, s, alert]) => `<div class="kpi ${alert ? 'alert' : ''}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('');

  // 이용자별
  const byUser = scope.map(u => {
    const ur = rows.filter(r => r.user === u), un = ur.filter(r => r.near);
    return {
      user: u, home: S.homes[u] && S.homes[u].lat != null,
      cnt: ur.length, sum: sum(ur), ncnt: un.length, nsum: sum(un),
      risk: un.filter(r => r.off || r.night).length,
      max: un.reduce((m, r) => Math.max(m, r.score), 0),
    };
  }).sort((a, b) => b.nsum - a.nsum);
  const maxN = Math.max(0, ...byUser.map(x => x.nsum));
  $('#userTable').innerHTML = table([
    { label: '이용자', f: r => `<a href="#" data-user="${esc(r.user)}">${esc(r.user)}</a>${r.home ? '' : ' <span class="err-txt">(집주소 없음)</span>'}` },
    { label: '전체', num: true, f: r => `${won(r.sum)}<br><span class="muted">${r.cnt}건</span>` },
    { label: '집근처 금액', f: r => barCell(r.nsum, maxN, `${won(r.nsum)} <span class="muted">(${r.ncnt}건)</span>`) },
    { label: '비중', num: true, f: r => pct(r.nsum, r.sum) },
    { label: '휴일·심야', num: true, f: r => r.risk ? `<b class="err-txt">${r.risk}</b>` : '0' },
    { label: '최고점', num: true, f: r => r.max ? `<span class="badge ${level(r.max)[0]}">${r.max}</span>` : '-' },
  ], byUser, { empty: '데이터가 없습니다.' });

  // 가맹점 TOP
  const mg = {};
  near.forEach(r => {
    const k = `${r.user}|${r.merchant}|${r.addr}`;
    (mg[k] = mg[k] || { user: r.user, merchant: r.merchant, cat: r.catName, dist: r.dist, cnt: 0, sum: 0, off: 0, row: r }).cnt++;
    mg[k].sum += r.amount;
    if (r.off) mg[k].off++;
  });
  const mlist = Object.values(mg).sort((a, b) => b.cnt - a.cnt || b.sum - a.sum).slice(0, 20);
  $('#merchantTable').innerHTML = table([
    { label: '가맹점', f: r => `${esc(r.merchant)}<br><span class="muted">${esc(r.cat)}</span>` },
    { label: '이용자', k: 'user' },
    { label: '집에서', num: true, f: r => fmtDist(r.dist) },
    { label: '건수', num: true, f: r => `${r.cnt}${r.off ? ` <span class="tag off">휴일 ${r.off}</span>` : ''}` },
    { label: '금액', num: true, f: r => won(r.sum) },
  ], mlist, { empty: '집근처 사용 내역이 없습니다.', rowAttr: r => ` class="clickable" data-focus="${r.row.id}"` });

  // 업종별
  const cg = {};
  near.forEach(r => { (cg[r.catName] = cg[r.catName] || { cat: r.catName, cnt: 0, sum: 0 }).cnt++; cg[r.catName].sum += r.amount; });
  const clist = Object.values(cg).sort((a, b) => b.sum - a.sum);
  const nsum = sum(near), maxC = Math.max(0, ...clist.map(c => c.sum));
  $('#catTable').innerHTML = table([
    { label: '업종', k: 'cat' },
    { label: '금액', f: r => barCell(r.sum, maxC, won(r.sum)) },
    { label: '건수', num: true, k: 'cnt' },
    { label: '비중', num: true, f: r => pct(r.sum, nsum) },
  ], clist, { empty: '집근처 사용 내역이 없습니다.' });

  // 상세
  const minLv = +$('#fLevel').value;
  const detail = near.filter(r => r.score >= minLv);
  const { key, dir } = S.sort;
  detail.sort((a, b) => {
    const x = a[key], y = b[key];
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'ko');
    return c * dir || (b.dateStr + b.time).localeCompare(a.dateStr + a.time);
  });
  S.detail = detail;
  $('#detailCount').textContent = `${detail.length}건 · ${won(sum(detail))}원`;
  $('#detailTable').innerHTML = table([
    { k: 'score', label: '위험', num: true, f: r => `<span class="badge ${level(r.score)[0]}">${level(r.score)[1]} ${r.score}</span>` },
    { k: 'dateStr', label: '이용일', f: r => `${r.dateStr} (${r.date ? DOW[r.date.getDay()] : ''})` },
    { k: 'time', label: '시간' },
    { k: 'user', label: '이용자' },
    { k: 'merchant', label: '가맹점' },
    { k: 'catName', label: '업종' },
    { k: 'amount', label: '금액', num: true, f: r => won(r.amount) },
    { k: 'dist', label: '집에서', num: true, f: r => fmtDist(r.dist) },
    { label: '구분', f: r => [r.holiday ? '<span class="tag off">공휴일</span>' : r.weekend ? '<span class="tag off">주말</span>' : '',
      r.night ? '<span class="tag night">심야</span>' : '', r.fuel ? `<span class="tag">${esc(r.fuel)}</span>` : ''].join('') },
    { k: 'card', label: '카드', f: r => esc(maskCard(r.card)) },
    { k: 'addr', label: '가맹점 주소', cls: 'wrap' },
  ], detail, { sortable: true, empty: has ? '조건에 맞는 집근처 사용 내역이 없습니다.' : '', rowAttr: r => ` class="clickable" data-focus="${r.id}"` });

  renderMap(rows);
}

/* ───────── 지도 ───────── */
function ensureMap() {
  if (!S.kakao || S.map) return;
  $('#mapPh').remove();
  S.map = new kakao.maps.Map($('#map'), { center: new kakao.maps.LatLng(37.5665, 126.978), level: 8 });
  S.map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
  kakao.maps.event.addListener(S.map, 'click', e => {
    if (S.pickFor) {
      const user = S.pickFor, ll = e.latLng;
      S.pickFor = null;
      S.geocoder.coord2Address(ll.getLng(), ll.getLat(), (res, st) => {
        const a = st === kakao.maps.services.Status.OK && res[0]
          ? (res[0].road_address ? res[0].road_address.address_name : res[0].address.address_name) : '지도에서 지정한 위치';
        S.homes[user] = { addr: a, lat: ll.getLat(), lng: ll.getLng(), src: 'pick' };
        store.set('homes', S.homes);
        toast(`${user}님 집 위치를 저장했습니다.`);
        analyze(); renderAll();
      });
    } else closeInfo();
  });
}

function closeInfo() { if (S.info) { S.info.setMap(null); S.info = null; } }

function showInfo(g) {
  closeInfo();
  const list = g.rows.slice().sort((a, b) => (b.dateStr + b.time).localeCompare(a.dateStr + a.time));
  const el = document.createElement('div');
  el.className = 'info';
  el.innerHTML = `<button class="x" title="닫기">×</button>
    <h4>${esc(list[0].merchant)}</h4>
    <div class="muted">${esc(list[0].catName)} · ${esc(list[0].addr)}</div>
    ${g.near ? `<div class="err-txt">집에서 ${fmtDist(Math.min(...list.filter(r => r.dist != null).map(r => r.dist)))}</div>` : ''}
    <table><tbody>${list.slice(0, 30).map(r => `<tr><td>${r.dateStr} ${esc(r.time)}${r.off ? ' <span class="tag off">휴일</span>' : ''}${r.night ? ' <span class="tag night">심야</span>' : ''}</td>
      <td>${esc(r.user)}</td><td class="num">${won(r.amount)}</td></tr>`).join('')}</tbody></table>
    ${list.length > 30 ? `<div class="muted">외 ${list.length - 30}건</div>` : ''}`;
  el.querySelector('.x').onclick = closeInfo;
  el.addEventListener('mousedown', e => e.stopPropagation());
  S.info = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(g.lat, g.lng), content: el, yAnchor: 1, zIndex: 50, clickable: true });
  S.info.setMap(S.map);
}

function renderMap(rows) {
  if (!S.map) return;
  closeInfo();
  S.overlays.forEach(o => o.setMap(null));
  S.overlays = [];
  const R = +S.settings.radius;
  const bounds = new kakao.maps.LatLngBounds();
  let any = false;
  const users = $('#fUser').value ? [$('#fUser').value] : S.users;
  for (const u of users) {
    const h = S.homes[u];
    if (!h || h.lat == null) continue;
    const pos = new kakao.maps.LatLng(h.lat, h.lng);
    const circle = new kakao.maps.Circle({ center: pos, radius: R, strokeWeight: 2, strokeColor: '#e5484d', strokeOpacity: 0.7, fillColor: '#e5484d', fillOpacity: 0.07 });
    circle.setMap(S.map);
    const mk = new kakao.maps.CustomOverlay({ position: pos, content: `<div class="home-mk">🏠 ${esc(u)}</div>`, yAnchor: 1, zIndex: 20 });
    mk.setMap(S.map);
    S.overlays.push(circle, mk);
    bounds.extend(pos); any = true;
  }
  const onlyNear = $('#fOnlyNear').checked;
  const groups = {};
  rows.forEach(r => {
    if (r.lat == null || (onlyNear && !r.near)) return;
    const k = `${r.lat.toFixed(5)},${r.lng.toFixed(5)}`;
    (groups[k] = groups[k] || { lat: r.lat, lng: r.lng, rows: [], near: false }).rows.push(r);
    if (r.near) groups[k].near = true;
  });
  S.groups = groups;
  Object.values(groups).forEach(g => {
    const el = document.createElement('div');
    el.className = `dot ${g.near ? 'near' : 'far'} ${g.rows.length > 1 ? 'multi' : ''}`;
    el.textContent = g.rows.length > 1 ? g.rows.length : '';
    el.title = g.rows[0].merchant;
    el.onclick = e => { e.stopPropagation(); showInfo(g); };
    const pos = new kakao.maps.LatLng(g.lat, g.lng);
    const ov = new kakao.maps.CustomOverlay({ position: pos, content: el, xAnchor: 0.5, yAnchor: 0.5, zIndex: g.near ? 10 : 5, clickable: true });
    ov.setMap(S.map);
    S.overlays.push(ov);
    bounds.extend(pos); any = true;
  });
  if (any && !S.pickFor) S.map.setBounds(bounds, 40, 40, 40, 40);
}

function focusRow(id) {
  const r = S.rows[id];
  if (!r || r.lat == null) return toast('이 거래는 좌표가 없습니다.');
  if (!S.map) return toast('지도를 쓰려면 설정에서 카카오 키를 입력하세요.');
  const g = Object.values(S.groups || {}).find(x => x.rows.includes(r)) || { lat: r.lat, lng: r.lng, rows: [r], near: r.near };
  S.map.setLevel(4);
  S.map.panTo(new kakao.maps.LatLng(r.lat, r.lng));
  showInfo(g);
  $('#map').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ───────── 카카오 로드 · 지오코딩 ───────── */
function loadKakao(key) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('시간 초과')), 10000);
    const s = document.createElement('script');
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&libraries=services&autoload=false`;
    s.onerror = () => { clearTimeout(timer); reject(Object.assign(new Error('카카오 서버가 요청을 거절했습니다'), { rejected: true })); };
    s.onload = () => {
      if (!window.kakao || !kakao.maps) { clearTimeout(timer); return reject(new Error('키 또는 도메인을 확인하세요')); }
      kakao.maps.load(() => { clearTimeout(timer); resolve(); });
    };
    document.head.appendChild(s);
  });
}

const kAddr = q => new Promise(res => S.geocoder.addressSearch(q, (r, st) =>
  res(st === kakao.maps.services.Status.OK && r[0] ? { lat: +r[0].y, lng: +r[0].x } : null)));
const kWord = q => new Promise(res => S.places.keywordSearch(q, (r, st) =>
  res(st === kakao.maps.services.Status.OK && r[0] ? { lat: +r[0].y, lng: +r[0].x } : null)));

function cleanAddr(a) {
  const s = a.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(.*?\S+(?:로|길)\s*\d+(?:-\d+)?)(?![\d-]|번길|길)/) || s.match(/^(.*?\S+(?:동|리|가)\s+(?:산\s*)?\d+(?:-\d+)?)(?![\d-])/);
  return m ? m[1] : s;
}
const region = a => a.split(' ').slice(0, 2).join(' ');

async function geocodeOne(addr, name) {
  let p = await kAddr(addr);
  if (p) return { ...p, src: 'addr' };
  const c = cleanAddr(addr);
  if (c !== addr && (p = await kAddr(c))) return { ...p, src: 'addr2' };
  if (name && (p = await kWord(`${region(addr)} ${name}`))) return { ...p, src: 'place' };
  if ((p = await kWord(c))) return { ...p, src: 'place2' };
  return { fail: true };
}

async function geocodeAll(retry) {
  if (!S.kakao) return toast('설정에서 카카오 JavaScript 키를 먼저 입력하세요.');
  if (S.geoRunning) return;
  const nameOf = {};
  S.rows.forEach(r => { if (r.addr && !nameOf[r.addr]) nameOf[r.addr] = r.merchant; });
  const queue = Object.keys(nameOf).filter(a => !S.geo[a] || (retry && S.geo[a].fail));
  if (!queue.length) { toast('변환할 주소가 없습니다.'); return renderDataTab(); }
  S.geoRunning = true;
  const total = queue.length;
  let done = 0;
  $('#geoProg').classList.remove('hidden');
  const tick = () => {
    $('#geoBar').style.width = `${done / total * 100}%`;
    $('#geoStatus').textContent = `좌표 변환 중… ${done}/${total}`;
  };
  tick();
  const worker = async () => {
    while (queue.length) {
      const a = queue.shift();
      try { S.geo[a] = await geocodeOne(a, nameOf[a]); } catch (e) { S.geo[a] = { fail: true }; }
      done++;
      tick();
      if (done % 20 === 0) store.set('geocache', S.geo);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  store.set('geocache', S.geo);
  S.geoRunning = false;
  $('#geoProg').classList.add('hidden');
  analyze();
  renderAll();
  toast(`좌표 변환 완료 (${total}건)`);
}

async function setHomeByAddr(user, addr) {
  if (!S.kakao) { toast('설정에서 카카오 JavaScript 키를 먼저 입력하세요.'); return false; }
  addr = addr.trim();
  if (!addr) return false;
  let p = await kAddr(addr);
  if (!p) p = await kAddr(cleanAddr(addr));
  if (!p) p = await kWord(addr);
  if (!p) return false;
  S.homes[user] = { addr, ...p, src: 'addr' };
  store.set('homes', S.homes);
  return true;
}

/* ───────── 데이터 탭 / 집주소 탭 ───────── */
function renderDataTab() {
  const rows = S.rows;
  if (!rows.length) {
    $('#dataSummary').innerHTML = '';
    $('#preview').innerHTML = '<p class="muted">불러온 데이터가 없습니다.</p>';
    $('#geoStatus').textContent = '';
    $('#geoFails').innerHTML = '';
    return;
  }
  const dates = rows.map(r => r.dateStr).filter(Boolean).sort();
  const addrs = [...new Set(rows.map(r => r.addr).filter(Boolean))];
  const ok = addrs.filter(a => S.geo[a] && !S.geo[a].fail), fail = addrs.filter(a => S.geo[a] && S.geo[a].fail);
  const i = S.fileInfo || {};
  $('#dataSummary').innerHTML = `<div class="summary">
    <div>파일<b>${esc(i.name || '-')}</b><span class="muted">${esc(i.sheet || '')}</span></div>
    <div>거래<b>${won(rows.length)}건</b><span class="muted">취소 ${rows.filter(r => r.cancelled).length}건</span></div>
    <div>이용자<b>${S.users.length}명</b></div>
    <div>기간<b>${dates[0] || '-'}</b><span class="muted">~ ${dates[dates.length - 1] || '-'}</span></div>
    <div>총 이용금액<b>${won(rows.filter(r => !r.cancelled).reduce((s, r) => s + r.amount, 0))}원</b></div>
    <div>주소 없음<b>${rows.filter(r => !r.addr).length}건</b><span class="muted">해외·온라인 등</span></div>
  </div>`;
  if (!S.geoRunning) {
    $('#geoStatus').innerHTML = `가맹점 주소 ${addrs.length}곳 · 변환 완료 <b class="ok-txt">${ok.length}</b> · 실패 <b class="err-txt">${fail.length}</b> · 대기 ${addrs.length - ok.length - fail.length}`
      + (S.kakao ? '' : ' · <span class="err-txt">카카오 키 미설정</span>');
  }
  $('#geoFails').innerHTML = fail.length ? `<details><summary>실패한 주소 ${fail.length}곳 보기</summary>
    ${table([{ label: '가맹점 주소', k: 'a', cls: 'wrap' }, { label: '가맹점', k: 'm' }],
      fail.map(a => ({ a, m: (rows.find(r => r.addr === a) || {}).merchant })))}</details>` : '';
  const cols = ['seq', 'card', 'user', 'dateStr', 'time', 'merchant', 'amount', 'addr', 'catName', 'slipType'];
  const labels = ['순번', '카드번호', '이용자명', '이용일', '승인시간', '가맹점명', '이용금액', '가맹점 주소', '업종명', '전표구분'];
  $('#preview').innerHTML = table(cols.map((k, j) => ({
    k, label: labels[j], num: k === 'amount',
    f: k === 'amount' ? r => won(r.amount) : k === 'card' ? r => esc(maskCard(r.card)) : null,
  })), rows.slice(0, 15));
}

function renderHomes() {
  const users = [...new Set([...S.users, ...Object.keys(S.homes)])];
  if (!users.length) { $('#homeTable').innerHTML = '<p class="muted">데이터를 먼저 불러오면 이용자가 나열됩니다. 아래 일괄 등록으로 미리 넣어둘 수도 있습니다.</p>'; return; }
  const cards = {};
  S.rows.forEach(r => { (cards[r.user] = cards[r.user] || new Set()).add(maskCard(r.card)); });
  $('#homeTable').innerHTML = table([
    { label: '이용자', f: r => esc(r) + (S.users.includes(r) ? '' : ' <span class="muted">(데이터 없음)</span>') },
    { label: '카드', f: r => [...(cards[r] || [])].map(esc).join('<br>') },
    { label: '집주소', f: r => `<input class="home-addr" data-home="${esc(r)}" value="${esc(S.homes[r] ? S.homes[r].addr : '')}" placeholder="예) 서울 중구 세종대로 110">` },
    { label: '상태', f: r => S.homes[r] && S.homes[r].lat != null ? `<span class="ok-txt">✓ 좌표 있음</span>${S.homes[r].src === 'sample' ? ' <span class="muted">(샘플)</span>' : ''}` : '<span class="err-txt">미설정</span>' },
    { label: '', f: r => `<button class="btn sm" data-act="search" data-u="${esc(r)}">검색</button>
      <button class="btn sm" data-act="pick" data-u="${esc(r)}">지도에서 선택</button>
      <button class="btn sm ghost danger" data-act="del" data-u="${esc(r)}">삭제</button>` },
  ], users);
}

/* ───────── CSV ───────── */
function downloadCsv(name, rows) {
  const csv = rows.map(r => r.map(v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportDetail() {
  const d = S.detail || [];
  if (!d.length) return toast('내보낼 집근처 내역이 없습니다.');
  downloadCsv(`집근처사용_${ymd(new Date())}.csv`, [
    ['위험점수', '위험도', ...HEADERS, '요일', '주말', '공휴일', '심야', '집까지거리(m)', '집주소'],
    ...d.map(r => [r.score, level(r.score)[1], r.seq, r.card, r.user, r.dateStr, r.merchant, r.amount, r.addr, r.bizNo, r.approvalNo,
      r.taxType, r.slipType, r.usd || '', r.fx || '', r.time, r.catCode, r.catName, r.fuel, r.unitPrice || '',
      r.date ? DOW[r.date.getDay()] : '', r.weekend ? 'Y' : '', r.holiday ? 'Y' : '', r.night ? 'Y' : '', Math.round(r.dist),
      (S.homes[r.user] || {}).addr || '']),
  ]);
}

/* ───────── 이벤트 ───────── */
function showTab(name) {
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === `tab-${name}`));
  if (name === 'ai' && typeof renderAi === 'function') renderAi();
  if (name === 'dash') {
    ensureMap();
    if (S.map) { S.map.relayout(); renderDash(); }
  }
}

async function handleFile(file) {
  if (!file) return;
  try {
    const { aoa, hi, sheet } = await readFile(file);
    const rows = buildRows(aoa, hi);
    if (!rows.length) throw new Error('거래 행이 없습니다.');
    setData(rows, { name: file.name, sheet });
    toast(`${rows.length}건을 불러왔습니다.`);
    if (S.kakao) geocodeAll();
  } catch (e) {
    console.error(e);
    toast(`불러오기 실패: ${e.message}`, 5000);
  }
}

function bind() {
  $$('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-goto]');
    if (go) { e.preventDefault(); showTab(go.dataset.goto); return; }
    const u = e.target.closest('[data-user]');
    if (u) { e.preventDefault(); $('#fUser').value = u.dataset.user; renderDash(); return; }
    const f = e.target.closest('[data-focus]');
    if (f) { focusRow(+f.dataset.focus); return; }
    const s = e.target.closest('th[data-sort]');
    if (s) {
      const k = s.dataset.sort;
      S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : (['score', 'amount', 'dist', 'dateStr'].includes(k) ? -1 : 1) };
      renderDash();
    }
  });

  ['#fUser', '#fFrom', '#fTo', '#fLevel', '#fOnlyNear'].forEach(id => $(id).addEventListener('change', renderDash));
  let t;
  $('#fSearch').addEventListener('input', () => { clearTimeout(t); t = setTimeout(renderDash, 250); });
  $('#fRadius').addEventListener('change', () => {
    S.settings.radius = +$('#fRadius').value;
    store.set('settings', S.settings);
    $('#sRadius').value = S.settings.radius;
    analyze(); renderDash();
  });
  $('#btnExport').onclick = exportDetail;

  // 업로드
  const drop = $('#drop');
  $('#file').onchange = e => { handleFile(e.target.files[0]); e.target.value = ''; };
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));
  $('#btnSample').onclick = () => {
    const aoa = makeSample();
    setData(buildRows(aoa, 0), { name: '샘플 데이터', sheet: '2026년 9~10월 · 3명' });
    toast('샘플 데이터(3명, 좌표·집주소 포함)를 불러왔습니다.');
    showTab('dash');
  };
  $('#btnTemplate').onclick = () => downloadCsv('법인카드_양식.csv', [HEADERS]);
  $('#btnClearData').onclick = () => {
    if (!confirm('불러온 카드 내역을 지울까요? (집주소·좌표 캐시는 유지)')) return;
    store.del('rows');
    S.rows = []; S.users = []; S.fileInfo = null;
    initFilters(); analyze(); renderAll();
  };
  $('#btnGeo').onclick = () => geocodeAll(false);
  $('#btnGeoRetry').onclick = () => geocodeAll(true);

  // 집주소
  $('#homeTable').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const user = b.dataset.u;
    if (b.dataset.act === 'search') {
      const input = $$('input[data-home]').find(i => i.dataset.home === user);
      b.disabled = true;
      const ok = await setHomeByAddr(user, input.value);
      b.disabled = false;
      if (ok) { toast(`${user}님 집주소를 저장했습니다.`); analyze(); renderAll(); } else if (S.kakao) toast('주소를 찾지 못했습니다. 도로명/지번 주소를 확인하세요.');
    } else if (b.dataset.act === 'pick') {
      if (!S.kakao) return toast('설정에서 카카오 JavaScript 키를 먼저 입력하세요.');
      S.pickFor = user;
      showTab('dash');
      renderDash();
      $('#map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (b.dataset.act === 'del') {
      delete S.homes[user];
      store.set('homes', S.homes);
      analyze(); renderAll();
    }
  });
  $('#homeTable').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.dataset.home !== undefined) {
      const b = $$('button[data-act="search"]').find(x => x.dataset.u === e.target.dataset.home);
      if (b) b.click();
    }
  });
  $('#btnBulk').onclick = async () => {
    const lines = $('#bulkHomes').value.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    if (!S.kakao) return toast('설정에서 카카오 JavaScript 키를 먼저 입력하세요.');
    let ok = 0;
    const fails = [];
    for (const [i, l] of lines.entries()) {
      const m = l.match(/^([^,\t]+)[,\t]\s*(.+)$/);
      $('#bulkStatus').textContent = `처리 중… ${i + 1}/${lines.length}`;
      if (m && await setHomeByAddr(m[1].trim(), m[2])) ok++; else fails.push(l);
    }
    $('#bulkStatus').innerHTML = `등록 ${ok}건${fails.length ? ` · <span class="err-txt">실패 ${fails.length}건: ${fails.map(esc).join(' / ')}</span>` : ''}`;
    analyze(); renderAll();
  };

  // 설정
  $('#btnSaveSettings').onclick = () => {
    const oldKey = S.settings.key;
    Object.assign(S.settings, {
      key: $('#sKey').value.replace(/[\s'"]/g, ''),
      radius: +$('#sRadius').value,
      nightStart: Math.min(23, Math.max(0, +$('#sNightStart').value || 0)),
      nightEnd: Math.min(23, Math.max(0, +$('#sNightEnd').value || 0)),
      excludeCancel: $('#sExcludeCancel').checked,
      holidays: $('#sHolidays').value,
      gemKey: $('#sGemKey').value.replace(/[\s'"]/g, ''),
      gemModel: $('#sGemModel').value.trim() || 'gemini-3.8-flash',
      pseudo: $('#sPseudo').checked,
    });
    store.set('settings', S.settings);
    if (oldKey !== S.settings.key) { location.reload(); return; }
    $('#fRadius').value = S.settings.radius;
    analyze(); renderAll();
    toast('설정을 저장했습니다.');
  };
  $('#btnClearGeo').onclick = () => {
    if (!confirm('저장된 가맹점 좌표를 모두 지울까요?')) return;
    S.geo = {}; store.set('geocache', S.geo);
    analyze(); renderAll();
  };
  $('#btnClearAll').onclick = () => {
    if (!confirm('카카오 키, 집주소, 좌표 캐시, 불러온 데이터를 모두 지울까요?')) return;
    ['settings', 'homes', 'geocache', 'rows'].forEach(store.del);
    location.reload();
  };
}

function fillSettings() {
  const s = S.settings;
  $('#sKey').value = s.key;
  $('#origin').textContent = location.origin;
  $('#sGemKey').value = s.gemKey;
  $('#sGemModel').value = s.gemModel;
  $('#sPseudo').checked = s.pseudo;
  $('#sRadius').value = s.radius;
  $('#sNightStart').value = s.nightStart;
  $('#sNightEnd').value = s.nightEnd;
  $('#sExcludeCancel').checked = s.excludeCancel;
  $('#sHolidays').value = s.holidays;
}

async function init() {
  bind();
  fillSettings();
  restoreData();
  initFilters();
  analyze();
  renderAll();
  if (!S.rows.length) showTab('data');

  const pill = $('#kakaoStatus');
  if (!S.settings.key) {
    pill.textContent = '카카오 키 미설정';
    pill.className = 'pill err';
    return;
  }
  if (location.protocol === 'file:') {
    pill.textContent = '지도 사용 불가: start.bat 으로 실행하세요';
    pill.className = 'pill err';
    return;
  }
  try {
    await loadKakao(S.settings.key);
    S.kakao = true;
    S.geocoder = new kakao.maps.services.Geocoder();
    S.places = new kakao.maps.services.Places();
    pill.textContent = '카카오맵 연결됨';
    pill.className = 'pill ok';
    if ($('#tab-dash').classList.contains('active')) { ensureMap(); renderDash(); }
    renderDataTab();
  } catch (e) {
    pill.textContent = `카카오맵 연결 실패: ${e.message}`;
    pill.className = 'pill err';
    $('#mapPh').innerHTML = `<div style="text-align:left;max-width:560px"><b class="err-txt">카카오맵을 불러오지 못했습니다 (${esc(e.message)})</b>
      <p>카카오는 아래 중 하나라도 맞지 않으면 SDK를 거절합니다. 순서대로 확인하세요.</p>
      <ol class="guide">
        <li><b>키 종류</b>: [앱 키]의 <b>JavaScript 키</b>여야 합니다. REST API 키·네이티브 앱 키를 넣으면 거절됩니다.</li>
        <li><b>도메인 등록</b>: [앱 설정 &gt; 플랫폼 &gt; Web]에 <code>${esc(location.origin)}</code> 를 정확히(포트 포함) 등록하세요.
          주소창이 <code>127.0.0.1</code> 이면 <code>http://127.0.0.1:8080</code> 도 따로 등록해야 합니다.</li>
        <li><b>카카오맵 활성화</b>: [제품 설정 &gt; 카카오맵]에서 <b>사용 설정 ON</b>. (꺼져 있으면 키가 맞아도 거절됩니다)</li>
        <li>키 앞뒤에 공백·따옴표가 없는지, 광고차단 확장이 dapi.kakao.com을 막지 않는지 확인하세요.</li>
      </ol>
      <p class="muted">고친 뒤 설정 탭에서 [저장]을 누르면 다시 시도합니다.</p></div>`;
  }
}

init();
