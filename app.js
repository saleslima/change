'use strict';

const THEME_KEY = 'copomCivilTheme:v1';
const NEON_KEY = 'civilOffNeonColor:v1';
const OPERATION_MODE_KEY = 'civilOffOperationMode:v1';
const HIGHLIGHT_KEY = 'civilOffHighlightedDates:v2';
const EVENTS_KEY = 'civilOffCalendarEvents:v2';
const DEFAULT_NEON = '#4bd5ff';

const dayTeamSequence = ['B', 'A', 'B', 'A', 'E'];
const nightTeamSequence = ['D', 'E', 'C', 'D', 'C'];
const baseDate = new Date(2024, 0, 1, 12);
const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const monthNames = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });

const motivationalQuotes = [
  'A persistência é o caminho do êxito.',
  'O sucesso nasce da determinação e da constância.',
  'Disciplina é fazer o que precisa ser feito, mesmo quando ninguém está olhando.',
  'Grandes resultados são construídos por pequenas decisões bem executadas.',
  'Profissionalismo é transformar responsabilidade em confiança.',
  'A excelência não é um ato isolado, mas um padrão diário.',
  'Preparação, foco e união tornam a equipe mais forte.',
  'Cada novo dia é uma oportunidade de fazer melhor.',
  'Compromisso com o coletivo fortalece cada pessoa da equipe.',
  'Ser constante vale mais do que depender da motivação do momento.',
  'A confiança nasce quando palavra e atitude caminham juntas.',
  'Trabalho bem feito deixa segurança para quem vem depois.'
];

const els = {
  calendarTitle: document.querySelector('#calendarTitle'),
  calendarBody: document.querySelector('#teamCalendarBody'),
  previousMonth: document.querySelector('#previousMonth'),
  nextMonth: document.querySelector('#nextMonth'),
  monthPickerButton: document.querySelector('#monthPickerButton'),
  monthPicker: document.querySelector('#monthPicker'),
  todayButton: document.querySelector('#todayButton'),
  dailyThought: document.querySelector('#dailyThought'),
  themeButton: document.querySelector('#themeButton'),
  themeColorMeta: document.querySelector('#themeColorMeta'),
  mode190Button: document.querySelector('#mode190Button'),
  mode193Button: document.querySelector('#mode193Button'),
  neonButton: document.querySelector('#neonButton'),
  neonColorInput: document.querySelector('#neonColorInput'),
  installButton: document.querySelector('#installButton'),
  iosInstallDialog: document.querySelector('#iosInstallDialog'),
  toast: document.querySelector('#toast')
};

let visibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
let deferredInstallPrompt = null;
let toastTimer = null;
let taskMenu = null;
let currentUserTeam = '';
let trocaCalendarDates = {};

function normalizeTeamLetter(value) {
  const team = String(value || '').trim().toUpperCase();
  return ['A', 'B', 'C', 'D', 'E'].includes(team) ? team : '';
}

function userTeamFromAuth(user) {
  return normalizeTeamLetter(user?.team) || normalizeTeamLetter(user?.shiftId);
}

function teamIsOnDuty(team, date) {
  const letter = normalizeTeamLetter(team);
  if (!letter) return false;
  const teams = getTeams(date);
  return teams.day === letter || teams.night === letter;
}

function toLocalISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fromLocalISO(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

function titleCase(value) {
  return String(value || '').replace(/^./u, (c) => c.toLocaleUpperCase('pt-BR'));
}

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0, 12);
  return Math.floor((date - start) / 86400000);
}

function renderDailyThought() {
  if (!els.dailyThought) return;
  const today = new Date();
  const index = (dayOfYear(today) + today.getFullYear()) % motivationalQuotes.length;
  els.dailyThought.textContent = `⚡ ${motivationalQuotes[index]}   •   ${motivationalQuotes[index]}   •   `;
}

function getDaysSinceBase(date) {
  return Math.floor((new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12) - baseDate) / 86400000);
}

function getTeams(date) {
  const days = getDaysSinceBase(date);
  const idx = ((days % 5) + 5) % 5;
  return { day: dayTeamSequence[idx], night: nightTeamSequence[idx] };
}

function calculateEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day, 12);
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function getHolidayMap(year) {
  const map = new Map();
  const add = (month, day, name) => map.set(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, name);
  add(1, 1, 'Ano Novo');
  add(4, 21, 'Tiradentes');
  add(5, 1, 'Dia do Trabalho');
  add(9, 7, 'Independência');
  add(10, 12, 'Nossa Senhora Aparecida');
  add(11, 2, 'Finados');
  add(11, 15, 'Proclamação da República');
  add(11, 20, 'Consciência Negra');
  add(12, 25, 'Natal');
  const easter = calculateEaster(year);
  map.set(toLocalISO(addDays(easter, -2)), 'Sexta-feira Santa');
  map.set(toLocalISO(addDays(easter, 60)), 'Corpus Christi');
  return map;
}

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch { return fallback; }
}

function loadHighlights() {
  return new Set(readJson(HIGHLIGHT_KEY, []));
}

function saveHighlights(set) {
  localStorage.setItem(HIGHLIGHT_KEY, JSON.stringify([...set]));
}

function loadEvents() {
  return readJson(EVENTS_KEY, {});
}

function saveEvents(events) {
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
}

function toggleDateHighlight(iso) {
  const set = loadHighlights();
  if (set.has(iso)) set.delete(iso); else set.add(iso);
  saveHighlights(set);
  renderCalendar();
}

function closeTaskMenu() {
  if (taskMenu?.isConnected) taskMenu.remove();
  taskMenu = null;
}

function setCalendarEvent(iso, column, type, text = '') {
  const events = loadEvents();
  const key = `${iso}:${column}`;
  if (type === 'REMOVER') delete events[key];
  else events[key] = { type, text: text || type, updatedAt: Date.now() };
  saveEvents(events);
  renderCalendar();
}

function openTaskMenu(anchor, iso, column) {
  closeTaskMenu();
  const menu = document.createElement('div');
  menu.className = 'calendar-task-menu';
  const options = ['DEJEM', 'DELEGADA', 'TROCA DE SERVIÇO', 'OUTROS', 'REMOVER'];
  options.forEach((label) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => {
      if (label === 'OUTROS') {
        const custom = window.prompt('Digite a ocorrência (5 a 30 caracteres):', '');
        if (!custom) return;
        const normalized = custom.trim().toUpperCase();
        if (normalized.length < 5 || normalized.length > 30) {
          showToast('Use entre 5 e 30 caracteres.');
          return;
        }
        setCalendarEvent(iso, column, 'OUTROS', normalized);
      } else {
        setCalendarEvent(iso, column, label);
      }
      closeTaskMenu();
    });
    menu.appendChild(button);
  });
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - menu.offsetWidth - 8);
  menu.style.left = `${Math.min(Math.max(8, rect.left), maxLeft)}px`;
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - menu.offsetHeight - 8) + window.scrollY}px`;
  taskMenu = menu;
}

function makeTeamCell(team, iso, column, events, myTeam) {
  const td = document.createElement('td');
  td.className = 'team-duty-cell';
  if (myTeam && team === myTeam) td.classList.add('is-my-team');
  const badge = document.createElement('strong');
  badge.className = 'team-letter';
  badge.textContent = team;
  td.appendChild(badge);
  const event = events[`${iso}:${column}`];
  if (event) {
    td.classList.add('has-calendar-event');
    const marker = document.createElement('span');
    marker.className = 'calendar-event-marker';
    marker.textContent = event.text || event.type;
    td.appendChild(marker);
  }
  td.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openTaskMenu(td, iso, column);
  });
  return td;
}

function updateCalendarTeamHint() {
  const hint = document.querySelector('#calendarTeamHint');
  if (!hint) return;
  if (currentUserTeam) {
    hint.hidden = false;
    hint.textContent = `Equipe ${currentUserTeam}: dias de serviço com borda verde. Dias de troca marcados em laranja.`;
  } else {
    hint.hidden = false;
    hint.textContent = 'Faça login para destacar os dias de serviço da sua equipe e as trocas.';
  }
}

function renderCalendar() {
  if (!els.calendarBody) return;
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  els.calendarTitle.textContent = titleCase(monthNames.format(visibleMonth));
  els.monthPicker.value = `${year}-${String(month + 1).padStart(2, '0')}`;
  const lastDay = new Date(year, month + 1, 0, 12).getDate();
  const todayIso = toLocalISO(new Date());
  const holidays = getHolidayMap(year);
  const highlights = loadHighlights();
  const events = loadEvents();
  const frag = document.createDocumentFragment();
  updateCalendarTeamHint();

  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(year, month, day, 12);
    const iso = toLocalISO(date);
    const teams = getTeams(date);
    const myDuty = Boolean(currentUserTeam && teamIsOnDuty(currentUserTeam, date));
    const trocaInfo = trocaCalendarDates[iso] || null;
    const tr = document.createElement('tr');
    tr.dataset.date = iso;
    if (iso === todayIso) tr.classList.add('is-today');
    if (highlights.has(iso)) tr.classList.add('is-highlighted');
    if (holidays.has(iso)) tr.classList.add('is-holiday');
    if (myDuty) tr.classList.add('is-my-duty');
    if (trocaInfo) tr.classList.add('is-troca-day');

    const dayCell = document.createElement('td');
    dayCell.className = 'calendar-date-cell';
    const number = document.createElement('button');
    number.type = 'button';
    number.className = 'calendar-date-button';
    number.textContent = String(day).padStart(2, '0');
    number.title = highlights.has(iso) ? 'Remover marcação' : 'Marcar data em amarelo';
    if (myDuty) number.title = `Dia de serviço da Equipe ${currentUserTeam}`;
    if (trocaInfo) number.title = `${number.title} · Troca: ${trocaInfo.label}`;
    number.addEventListener('click', () => toggleDateHighlight(iso));
    dayCell.appendChild(number);
    if (holidays.has(iso)) {
      const holiday = document.createElement('small');
      holiday.className = 'calendar-holiday-name';
      holiday.textContent = holidays.get(iso);
      dayCell.appendChild(holiday);
    }
    if (trocaInfo) {
      const trocaBadge = document.createElement('small');
      trocaBadge.className = 'calendar-troca-badge';
      trocaBadge.textContent = trocaInfo.shortLabel || 'TROCA';
      dayCell.appendChild(trocaBadge);
    }

    const weekCell = document.createElement('td');
    weekCell.textContent = weekDays[date.getDay()];
    if (date.getDay() === 0 || date.getDay() === 6) weekCell.classList.add('weekend-cell');

    tr.append(
      dayCell,
      weekCell,
      makeTeamCell(teams.day, iso, 'day', events, currentUserTeam),
      makeTeamCell(teams.night, iso, 'night', events, currentUserTeam)
    );
    frag.appendChild(tr);
  }
  els.calendarBody.replaceChildren(frag);
}

document.addEventListener('civiloff:authchange', (event) => {
  const user = event.detail?.user || null;
  currentUserTeam = userTeamFromAuth(user);
  if (!user) trocaCalendarDates = {};
  renderCalendar();
});

document.addEventListener('civiloff:trocaschange', (event) => {
  trocaCalendarDates = event.detail?.dates || {};
  renderCalendar();
});

function shiftMonth(amount) {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + amount, 1, 12);
  renderCalendar();
}

function applyTheme(theme, persist = false) {
  const isLight = theme === 'light';
  document.documentElement.dataset.theme = isLight ? 'light' : 'dark';
  if (els.themeButton) {
    els.themeButton.setAttribute('aria-pressed', String(isLight));
    els.themeButton.setAttribute('aria-label', isLight ? 'Ativar modo noturno' : 'Ativar modo dia');
    els.themeButton.setAttribute('title', isLight ? 'Modo noturno' : 'Modo dia');
  }
  if (els.themeColorMeta) els.themeColorMeta.content = isLight ? '#eef5fb' : '#07111f';
  if (persist) localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark');
}

function applyOperationMode(mode, persist = false) {
  const selected = mode === '193' ? '193' : '190';
  document.documentElement.dataset.operationMode = selected;
  els.mode190Button?.classList.toggle('active', selected === '190');
  els.mode193Button?.classList.toggle('active', selected === '193');
  els.mode190Button?.setAttribute('aria-pressed', String(selected === '190'));
  els.mode193Button?.setAttribute('aria-pressed', String(selected === '193'));
  if (persist) localStorage.setItem(OPERATION_MODE_KEY, selected);
}

function normalizeNeonColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : DEFAULT_NEON;
}

function applyNeonColor(value, persist = false) {
  const color = normalizeNeonColor(value);
  const v = color.slice(1);
  const rgb = [0, 2, 4].map((o) => parseInt(v.slice(o, o + 2), 16));
  document.documentElement.style.setProperty('--neon', color);
  document.documentElement.style.setProperty('--neon-rgb', rgb.join(', '));
  if (els.neonColorInput) els.neonColorInput.value = color;
  if (persist) localStorage.setItem(NEON_KEY, color);
}

function showToast(message) {
  if (!els.toast) return;
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add('visible');
  toastTimer = setTimeout(() => els.toast.classList.remove('visible'), 2800);
}

function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }

function setupInstallFlow() {
  if (!els.installButton) return;
  if (isStandalone()) els.installButton.classList.add('hidden');
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    els.installButton.classList.remove('hidden');
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    els.installButton.classList.add('hidden');
    showToast('Aplicativo instalado.');
  });
  els.installButton.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
    } else if (isIOS() && els.iosInstallDialog) {
      els.iosInstallDialog.showModal();
    } else {
      showToast('Use o menu do navegador e escolha “Instalar aplicativo”.');
    }
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const host = location.hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  if (local) return;
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => showToast('Modo offline indisponível.')));
}

els.previousMonth?.addEventListener('click', () => shiftMonth(-1));
els.nextMonth?.addEventListener('click', () => shiftMonth(1));
els.todayButton?.addEventListener('click', () => {
  const today = new Date();
  visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1, 12);
  renderCalendar();
});
els.monthPickerButton?.addEventListener('click', () => {
  try { if (typeof els.monthPicker.showPicker === 'function') els.monthPicker.showPicker(); else els.monthPicker.click(); }
  catch { els.monthPicker.click(); }
});
els.monthPicker?.addEventListener('change', (event) => {
  const [year, month] = event.target.value.split('-').map(Number);
  if (!year || !month) return;
  visibleMonth = new Date(year, month - 1, 1, 12);
  renderCalendar();
});
els.themeButton?.addEventListener('click', () => {
  const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  applyTheme(current === 'light' ? 'dark' : 'light', true);
});
els.mode190Button?.addEventListener('click', () => applyOperationMode('190', true));
els.mode193Button?.addEventListener('click', () => applyOperationMode('193', true));
els.neonButton?.addEventListener('click', () => els.neonColorInput?.click());
els.neonColorInput?.addEventListener('input', (event) => applyNeonColor(event.target.value));
els.neonColorInput?.addEventListener('change', (event) => applyNeonColor(event.target.value, true));
document.addEventListener('click', (event) => {
  if (taskMenu && !taskMenu.contains(event.target) && !event.target.closest('.team-duty-cell')) closeTaskMenu();
});
window.addEventListener('resize', closeTaskMenu);

applyTheme(localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark');
applyOperationMode(localStorage.getItem(OPERATION_MODE_KEY) || '190');
applyNeonColor(localStorage.getItem(NEON_KEY) || DEFAULT_NEON);
renderDailyThought();
renderCalendar();
setupInstallFlow();
registerServiceWorker();
