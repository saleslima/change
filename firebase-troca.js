import { database } from './firebase-config.js';
import {
  get,
  onValue,
  push,
  ref,
  runTransaction,
  serverTimestamp,
  update
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';

const USERS_PATH = 'civiloff/v1/users';
const TROCAS_REQUESTS_PATH = 'civiloff/v1/trocas/requests';
const TROCAS_INBOX_PATH = 'civiloff/v1/trocas/inbox';
const TROCAS_DOCS_PATH = 'civiloff/v1/trocas/documents';
const TROCAS_PROPOSALS_PATH = 'civiloff/v1/trocas/proposals';
const TEAMS = ['A', 'B', 'C', 'D', 'E'];
const dayTeamSequence = ['B', 'A', 'B', 'A', 'E'];
const nightTeamSequence = ['D', 'E', 'C', 'D', 'C'];
const baseDate = new Date(2024, 0, 1, 12);
const monthFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });

let currentUserKey = '';
let currentUser = null;
let unsubscribeInbox = null;
let unsubscribeAdminRequests = null;
let unsubscribeAdminDocs = null;
let inboxCache = {};
let adminRequestsCache = {};
let adminDocsCache = {};
let openDocumentId = '';
let activeProposalMessage = null;
let proposalVisibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
let requestVisibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
let jsPdfLoader = null;

const els = {
  trocaButton: document.querySelector('#trocaButton'),
  inboxButton: document.querySelector('#trocaInboxButton'),
  inboxBadge: document.querySelector('#trocaInboxBadge'),
  requestDialog: document.querySelector('#trocaRequestDialog'),
  requestForm: document.querySelector('#trocaRequestForm'),
  requestDate: document.querySelector('#trocaDateInput'),
  requestCalendarTitle: document.querySelector('#requestCalendarTitle'),
  requestCalendarGrid: document.querySelector('#requestCalendarGrid'),
  requestSelectedDate: document.querySelector('#requestSelectedDate'),
  requestPrevMonth: document.querySelector('#requestPrevMonth'),
  requestNextMonth: document.querySelector('#requestNextMonth'),
  teamChoices: document.querySelector('#trocaTeamChoices'),
  requestStatus: document.querySelector('#trocaRequestStatus'),
  cancelRequest: document.querySelector('#cancelTrocaRequest'),
  inboxDialog: document.querySelector('#trocaInboxDialog'),
  inboxList: document.querySelector('#trocaInboxList'),
  inboxEmpty: document.querySelector('#trocaInboxEmpty'),
  closeInbox: document.querySelector('#closeTrocaInbox'),
  proposalDialog: document.querySelector('#trocaProposalDialog'),
  proposalForm: document.querySelector('#trocaProposalForm'),
  proposalDate: document.querySelector('#trocaProposalDateInput'),
  proposalIntro: document.querySelector('#trocaProposalIntro'),
  proposalStatus: document.querySelector('#trocaProposalStatus'),
  proposalCalendarTitle: document.querySelector('#proposalCalendarTitle'),
  proposalCalendarGrid: document.querySelector('#proposalCalendarGrid'),
  proposalSelectedDate: document.querySelector('#proposalSelectedDate'),
  proposalPrevMonth: document.querySelector('#proposalPrevMonth'),
  proposalNextMonth: document.querySelector('#proposalNextMonth'),
  proposalSignature: document.querySelector('#trocaProposalSignature'),
  clearProposalSignature: document.querySelector('#clearProposalSignature'),
  cancelProposal: document.querySelector('#cancelTrocaProposal'),
  adminList: document.querySelector('#trocaAdminList'),
  adminEmpty: document.querySelector('#trocaAdminEmpty'),
  adminCount: document.querySelector('#trocaAdminCount'),
  adminBadge: document.querySelector('#adminTrocasBadge'),
  signedList: document.querySelector('#trocaSignedList'),
  signedEmpty: document.querySelector('#trocaSignedEmpty'),
  signedCount: document.querySelector('#trocaSignedCount'),
  docDialog: document.querySelector('#trocaDocDialog'),
  docMeta: document.querySelector('#trocaDocMeta'),
  docTimeline: document.querySelector('#trocaTimeline'),
  docSignAreas: document.querySelector('#trocaDocSignAreas'),
  docStatus: document.querySelector('#trocaDocStatus'),
  closeDoc: document.querySelector('#closeTrocaDoc')
};

function setStatus(element, message = '', type = '') {
  if (!element) return;
  element.textContent = message;
  element.dataset.type = type;
  element.hidden = !message;
}

function normalizeTeam(value) {
  const team = String(value || '').trim().toUpperCase();
  return TEAMS.includes(team) ? team : '';
}

function normalizeProfile(value) {
  if (value === 'common') return 'dispatcher';
  return ['dispatcher', 'supervisor', 'operations-chief', 'admin'].includes(value) ? value : '';
}

function userTeam(user) {
  return normalizeTeam(user?.team) || normalizeTeam(user?.shiftId);
}

function userProfile(user) {
  return normalizeProfile(user?.profile);
}

function userDisplayName(user) {
  return user?.warName || user?.name || 'Usuário';
}

function fullUserLabel(user) {
  const rank = user?.rank ? `${String(user.rank).replaceAll('_', ' ')} · ` : '';
  return `${rank}${user?.name || userDisplayName(user)}`;
}

function formatDateBr(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function toLocalISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fromLocalISO(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

function todayIso() {
  return toLocalISO(new Date());
}

function getDaysSinceBase(date) {
  return Math.floor((new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12) - baseDate) / 86400000);
}

function getTeams(date) {
  const days = getDaysSinceBase(date);
  const index = ((days % 5) + 5) % 5;
  return { day: dayTeamSequence[index], night: nightTeamSequence[index] };
}

function isTeamOnDuty(date, team) {
  const normalized = normalizeTeam(team);
  if (!date || !normalized) return false;
  const teams = getTeams(date);
  return teams.day === normalized || teams.night === normalized;
}

function targetTeamText(teams) {
  const list = Array.isArray(teams) ? teams : Object.keys(teams || {});
  return list.map((team) => `Equipe ${team}`).join(', ');
}

function teamPair(doc) {
  return [...new Set([normalizeTeam(doc?.fromTeam), normalizeTeam(doc?.interestedTeam)].filter(Boolean))];
}

function updateBadge(count) {
  const value = Number(count) || 0;
  if (els.inboxBadge) {
    els.inboxBadge.textContent = String(value);
    els.inboxBadge.hidden = value <= 0;
  }
  if (els.inboxButton) {
    els.inboxButton.setAttribute('aria-label', value ? `Mensagens de troca (${value})` : 'Mensagens de troca');
  }
}

function pendingMessages() {
  return Object.entries(inboxCache)
    .map(([id, message]) => ({ id, ...message }))
    .filter((message) => !message.status || message.status === 'pending')
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
}

function pendingAdminRequests() {
  return Object.entries(adminRequestsCache)
    .map(([id, request]) => ({ id, ...request }))
    .filter((request) => request.documentId && request.status !== 'completed')
    .sort((a, b) => (Number(b.selectedAt) || Number(b.updatedAt) || 0) - (Number(a.selectedAt) || Number(a.updatedAt) || 0));
}

function completedAdminDocuments() {
  return Object.entries(adminDocsCache)
    .map(([id, doc]) => ({ id, ...doc }))
    .filter((doc) => doc.status === 'completed')
    .sort((a, b) => (Number(b.updatedAt) || Number(b.createdAt) || 0) - (Number(a.updatedAt) || Number(a.createdAt) || 0));
}

function updateAdminBadge(count) {
  const value = Number(count) || 0;
  if (els.adminBadge) {
    els.adminBadge.textContent = String(value);
    els.adminBadge.hidden = value <= 0;
  }
  if (els.adminCount) els.adminCount.textContent = String(value);
}

function addAction(actions, text, className, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `troca-action ${className || ''}`.trim();
  button.textContent = text;
  button.addEventListener('click', handler);
  actions.appendChild(button);
  return button;
}

function statusStepText(status, requestOrDoc = {}) {
  if (status === 'completed') return 'OK · 3 passos concluídos';
  if (status === 'step1-requester') return 'PENDENTE · Passo 1 — assinatura do solicitante';
  if (status === 'step2-supervisors') return 'PENDENTE · Passo 2 — ciência e assinatura dos supervisores';
  if (status === 'step3-chiefs') return 'PENDENTE · Passo 3 — ciência e assinatura dos chefes de operações';
  if (status === 'selected') return 'PENDENTE · Preparando documento';
  if (status === 'open') return 'Pedido aberto para propostas';
  return requestOrDoc.pendingStep ? `PENDENTE · Passo ${requestOrDoc.pendingStep}` : 'PENDENTE';
}

function renderInboxList() {
  if (!els.inboxList) return;
  const messages = pendingMessages();
  els.inboxList.replaceChildren();
  if (els.inboxEmpty) els.inboxEmpty.hidden = messages.length > 0;

  messages.forEach((message) => {
    const card = document.createElement('article');
    card.className = 'troca-message-card';
    card.dataset.messageId = message.id;
    const title = document.createElement('h3');
    const meta = document.createElement('p');
    meta.className = 'troca-message-meta';
    const detail = document.createElement('p');
    detail.className = 'troca-message-from';

    if (message.kind === 'proposal') {
      title.textContent = `Proposta de ${message.proposalByName || 'Interessado'}`;
      meta.textContent = `Você quer trocar ${formatDateBr(message.requestDate)}. A contraproposta é ${formatDateBr(message.counterDate)} e já está assinada pelo interessado.`;
      detail.textContent = `Equipe ${message.proposalTeam || '—'} · Você pode comparar várias propostas antes de aceitar uma.`;
    } else if (message.kind === 'sign-request') {
      title.textContent = 'Passo 1 · Sua assinatura';
      meta.textContent = `A proposta de ${message.otherName || 'interessado'} foi aceita. Assine o documento para concluir o Passo 1.`;
      detail.textContent = `${formatDateBr(message.requestDate)} ↔ ${formatDateBr(message.counterDate)}`;
    } else if (message.kind === 'approval-request') {
      const roleText = message.approvalRole === 'supervisor' ? 'Supervisor' : 'Chefe de Operações';
      const step = message.approvalRole === 'supervisor' ? 2 : 3;
      title.textContent = `Passo ${step} · Ciente ${roleText}`;
      meta.textContent = `Troca das Equipes ${message.fromTeam || '—'} e ${message.interestedTeam || '—'}. Clique para dar ciência e assinar pela Equipe ${message.approvalTeam || '—'}.`;
      detail.textContent = `${formatDateBr(message.requestDate)} ↔ ${formatDateBr(message.counterDate)}`;
    } else if (message.kind === 'selected-notice') {
      title.textContent = 'Sua contraproposta foi escolhida';
      meta.textContent = 'Sua assinatura do Passo 1 já está registrada. Agora o solicitante precisa assinar.';
      detail.textContent = `${formatDateBr(message.requestDate)} ↔ ${formatDateBr(message.counterDate)}`;
    } else if (message.kind === 'completed-notice') {
      title.textContent = 'Troca concluída · OK';
      meta.textContent = message.noticeText || 'Os 3 passos foram concluídos.';
      detail.textContent = `${formatDateBr(message.requestDate)} ↔ ${formatDateBr(message.counterDate)}`;
    } else if (message.kind === 'proposal-rejected') {
      title.textContent = 'Proposta não escolhida';
      meta.textContent = message.noticeText || 'O solicitante não escolheu esta alternativa.';
      detail.textContent = 'Enquanto o pedido estiver aberto, você pode enviar outra alternativa.';
    } else {
      title.textContent = `${message.fromName || 'Usuário'} solicita troca`;
      meta.textContent = `Dia solicitado: ${formatDateBr(message.requestDate || message.date)}.`;
      detail.textContent = `Você recebeu este pedido como Despachador da Equipe ${message.recipientTeam || userTeam(currentUser) || '—'}. Escolha um dos dias em que sua equipe está de serviço.`;
    }

    card.append(title, meta, detail);
    const actions = document.createElement('div');
    actions.className = 'troca-message-actions';
    if (!message.kind || message.kind === 'request') {
      addAction(actions, 'Fazer contraproposta', 'accept', () => openProposalDialog(message));
    } else if (message.kind === 'proposal') {
      addAction(actions, 'Aceitar proposta', 'accept', () => handleSelectProposal(message));
      addAction(actions, 'Rejeitar', 'remove', () => handleRejectProposal(message));
    } else if (['sign-request', 'approval-request', 'completed-notice', 'selected-notice'].includes(message.kind) && message.documentId) {
      addAction(actions, message.kind === 'completed-notice' ? 'Visualizar' : 'Abrir documento', 'accept', () => openDocument(message.documentId));
    }
    if (!['proposal'].includes(message.kind)) addAction(actions, 'Fechar', 'close', () => handleClose(message));
    card.appendChild(actions);
    els.inboxList.appendChild(card);
  });
}

function renderAdminList() {
  if (!els.adminList) return;
  const requests = pendingAdminRequests();
  els.adminList.replaceChildren();
  if (els.adminEmpty) els.adminEmpty.hidden = requests.length > 0;
  updateAdminBadge(requests.length);

  requests.forEach((request) => {
    const card = document.createElement('article');
    card.className = 'admin-list-card';
    const info = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = `${request.fromName || 'Solicitante'} ↔ ${request.selectedByName || 'Interessado'}`;
    const span = document.createElement('span');
    span.textContent = `${formatDateBr(request.requestDate)} ↔ ${formatDateBr(request.counterDate)}`;
    const tags = document.createElement('div');
    tags.className = 'admin-tags';
    const status = document.createElement('small');
    status.className = 'troca-pending-tag';
    const requestDoc = adminDocsCache[request.documentId];
    status.textContent = requestDoc ? pendingDetail(requestDoc) : statusStepText(request.status, request);
    const teams = document.createElement('small');
    teams.textContent = `Equipes ${request.fromTeam || '—'} / ${request.selectedTeam || '—'}`;
    tags.append(status, teams);
    info.append(strong, span, tags);
    const actions = document.createElement('div');
    actions.className = 'admin-list-actions';
    if (request.documentId) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'admin-action';
      btn.textContent = 'Ver pendência';
      btn.addEventListener('click', () => openDocument(request.documentId));
      actions.appendChild(btn);
    }
    card.append(info, actions);
    els.adminList.appendChild(card);
  });
}

function renderSignedAdminList() {
  if (!els.signedList) return;
  const docs = completedAdminDocuments();
  els.signedList.replaceChildren();
  if (els.signedEmpty) els.signedEmpty.hidden = docs.length > 0;
  if (els.signedCount) els.signedCount.textContent = String(docs.length);
  docs.forEach((doc) => {
    const card = document.createElement('article');
    card.className = 'admin-list-card';
    const info = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = `${doc.partyA?.warName || doc.partyA?.name || 'Solicitante'} ↔ ${doc.partyB?.warName || doc.partyB?.name || 'Interessado'}`;
    const span = document.createElement('span');
    span.textContent = `${formatDateBr(doc.requestDate)} ↔ ${formatDateBr(doc.counterDate)}`;
    const tags = document.createElement('div');
    tags.className = 'admin-tags';
    const ok = document.createElement('small');
    ok.className = 'troca-ok-tag';
    ok.textContent = 'OK · 3 PASSOS';
    const team = document.createElement('small');
    team.textContent = `Equipes ${doc.fromTeam || '—'} / ${doc.interestedTeam || '—'}`;
    tags.append(ok, team);
    info.append(strong, span, tags);
    const actions = document.createElement('div');
    actions.className = 'admin-list-actions';
    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'admin-action';
    viewBtn.textContent = 'Visualizar';
    viewBtn.addEventListener('click', () => openDocument(doc.id));
    const pdfBtn = document.createElement('button');
    pdfBtn.type = 'button';
    pdfBtn.className = 'admin-action';
    pdfBtn.textContent = 'Baixar PDF';
    pdfBtn.addEventListener('click', () => downloadDocumentPdf(doc));
    actions.append(viewBtn, pdfBtn);
    card.append(info, actions);
    els.signedList.appendChild(card);
  });
}

function subscribeInbox() {
  if (unsubscribeInbox) unsubscribeInbox();
  unsubscribeInbox = null;
  inboxCache = {};
  updateBadge(0);
  renderInboxList();
  if (!currentUserKey) return;
  unsubscribeInbox = onValue(ref(database, `${TROCAS_INBOX_PATH}/${currentUserKey}`), (snapshot) => {
    inboxCache = snapshot.val() || {};
    updateBadge(pendingMessages().length);
    if (els.inboxDialog?.open) renderInboxList();
  }, (error) => console.warn('[CivilOff] Inbox de troca:', error));
}

function subscribeAdminRequests() {
  if (unsubscribeAdminRequests) unsubscribeAdminRequests();
  if (unsubscribeAdminDocs) unsubscribeAdminDocs();
  unsubscribeAdminRequests = null;
  unsubscribeAdminDocs = null;
  adminRequestsCache = {};
  adminDocsCache = {};
  updateAdminBadge(0);
  renderAdminList();
  renderSignedAdminList();
  if (currentUser?.profile !== 'admin') return;
  unsubscribeAdminRequests = onValue(ref(database, TROCAS_REQUESTS_PATH), (snapshot) => {
    adminRequestsCache = snapshot.val() || {};
    renderAdminList();
  });
  unsubscribeAdminDocs = onValue(ref(database, TROCAS_DOCS_PATH), (snapshot) => {
    adminDocsCache = snapshot.val() || {};
    renderAdminList();
    renderSignedAdminList();
  });
}

async function allUsers() {
  const snapshot = await get(ref(database, USERS_PATH));
  return snapshot.val() || {};
}

async function findRecipients(targetTeams, requesterKey) {
  const users = await allUsers();
  const wanted = new Set(targetTeams.map(normalizeTeam).filter(Boolean));
  return Object.entries(users)
    .filter(([userKey, user]) => userKey !== requesterKey && user && user.active !== false && userProfile(user) === 'dispatcher' && wanted.has(userTeam(user)))
    .map(([userKey, user]) => ({ userKey, name: user.name || 'Usuário', warName: user.warName || '', team: userTeam(user) }));
}

async function findApprovers(profile, teams) {
  const users = await allUsers();
  const wanted = new Set(teams.map(normalizeTeam).filter(Boolean));
  return Object.entries(users)
    .filter(([, user]) => user && user.active !== false && userProfile(user) === profile && wanted.has(userTeam(user)))
    .map(([userKey, user]) => ({ userKey, name: user.name || 'Usuário', warName: user.warName || '', team: userTeam(user), rank: user.rank || '' }));
}

async function createTrocaRequest(requestDate, targetTeams) {
  if (!currentUserKey || !currentUser) throw new Error('Faça login para solicitar troca.');
  if (userProfile(currentUser) !== 'dispatcher') throw new Error('Somente o perfil Despachador solicita e participa diretamente das trocas.');
  const fromTeam = userTeam(currentUser);
  if (!fromTeam) throw new Error('Seu cadastro ainda não possui equipe.');
  const requestDateObject = fromLocalISO(requestDate);
  if (!requestDateObject || requestDate < todayIso()) throw new Error('Escolha um dia de serviço válido e não passado.');
  if (!isTeamOnDuty(requestDateObject, fromTeam)) {
    throw new Error(`Escolha um dia em que a Equipe ${fromTeam} esteja de serviço.`);
  }
  const teams = [...new Set(targetTeams.map(normalizeTeam).filter((team) => team && team !== fromTeam))];
  if (!teams.length) throw new Error('Escolha pelo menos uma equipe diferente da sua.');
  const recipients = await findRecipients(teams, currentUserKey);
  if (!recipients.length) throw new Error('Nenhum Despachador ativo foi encontrado nas equipes selecionadas.');

  const requestRef = push(ref(database, TROCAS_REQUESTS_PATH));
  const requestId = requestRef.key;
  const writes = {};
  writes[`${TROCAS_REQUESTS_PATH}/${requestId}`] = {
    requestDate,
    fromUserKey: currentUserKey,
    fromName: currentUser.name || userDisplayName(currentUser),
    fromWarName: currentUser.warName || '',
    fromRank: currentUser.rank || '',
    fromTeam,
    targetTeams: teams,
    status: 'open',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  recipients.forEach((recipient) => {
    const messageId = push(ref(database, `${TROCAS_INBOX_PATH}/${recipient.userKey}`)).key;
    writes[`${TROCAS_INBOX_PATH}/${recipient.userKey}/${messageId}`] = {
      kind: 'request',
      requestId,
      requestDate,
      fromUserKey: currentUserKey,
      fromName: currentUser.warName || currentUser.name || 'Usuário',
      fromTeam,
      recipientTeam: recipient.team,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
  });
  await update(ref(database), writes);
  return { requestId, teams, recipientCount: recipients.length };
}

function renderDutyCalendar({
  grid,
  titleEl,
  prevBtn,
  nextBtn,
  selectedInput,
  selectedLabel,
  visibleMonth,
  blockedDates = [],
  onSelect
}) {
  if (!grid) return;
  const team = userTeam(currentUser);
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const currentMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
  if (prevBtn) prevBtn.disabled = visibleMonth <= currentMonthStart;
  if (titleEl) {
    const label = monthFormatter.format(visibleMonth);
    titleEl.textContent = label.charAt(0).toUpperCase() + label.slice(1);
  }
  grid.replaceChildren();
  const first = new Date(year, month, 1, 12);
  const lastDay = new Date(year, month + 1, 0, 12).getDate();
  for (let gap = 0; gap < first.getDay(); gap += 1) {
    const spacer = document.createElement('span');
    spacer.className = 'proposal-day-spacer';
    grid.appendChild(spacer);
  }
  const minIso = todayIso();
  const blocked = new Set(blockedDates.filter(Boolean));
  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(year, month, day, 12);
    const iso = toLocalISO(date);
    const onDuty = isTeamOnDuty(date, team);
    const eligible = onDuty && iso >= minIso && !blocked.has(iso);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'proposal-calendar-day';
    button.textContent = String(day);
    button.dataset.date = iso;
    button.disabled = !eligible;
    if (onDuty) button.classList.add('is-duty');
    if (!eligible) button.classList.add('is-dimmed');
    if (selectedInput?.value === iso) button.classList.add('is-selected');
    button.title = eligible
      ? `Equipe ${team} em serviço — selecionar ${formatDateBr(iso)}`
      : `Equipe ${team || '—'} não está de serviço neste dia`;
    if (eligible) {
      button.addEventListener('click', () => {
        if (selectedInput) selectedInput.value = iso;
        if (selectedLabel) selectedLabel.textContent = `Selecionado: ${formatDateBr(iso)} · Equipe ${team} em serviço.`;
        onSelect?.();
      });
    }
    grid.appendChild(button);
  }
}

function renderRequestCalendar() {
  renderDutyCalendar({
    grid: els.requestCalendarGrid,
    titleEl: els.requestCalendarTitle,
    prevBtn: els.requestPrevMonth,
    nextBtn: els.requestNextMonth,
    selectedInput: els.requestDate,
    selectedLabel: els.requestSelectedDate,
    visibleMonth: requestVisibleMonth,
    onSelect: renderRequestCalendar
  });
}

function renderProposalCalendar() {
  if (!activeProposalMessage) return;
  renderDutyCalendar({
    grid: els.proposalCalendarGrid,
    titleEl: els.proposalCalendarTitle,
    prevBtn: els.proposalPrevMonth,
    nextBtn: els.proposalNextMonth,
    selectedInput: els.proposalDate,
    selectedLabel: els.proposalSelectedDate,
    visibleMonth: proposalVisibleMonth,
    blockedDates: [activeProposalMessage.requestDate || ''],
    onSelect: renderProposalCalendar
  });
}

function isCanvasBlank(canvas) {
  if (!canvas) return true;
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false;
  return true;
}

function exportSignature(canvas) {
  const out = document.createElement('canvas');
  out.width = 420;
  out.height = 160;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.55);
}

function clearSignatureCanvas(canvas) {
  if (!canvas) return;
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

function bindSignaturePad(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#102033';
  let drawing = false;
  let lastX = 0;
  let lastY = 0;
  const point = (event) => {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  canvas.onpointerdown = (event) => {
    event.preventDefault();
    drawing = true;
    const p = point(event);
    lastX = p.x;
    lastY = p.y;
    canvas.setPointerCapture?.(event.pointerId);
  };
  canvas.onpointermove = (event) => {
    if (!drawing) return;
    event.preventDefault();
    const p = point(event);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastX = p.x;
    lastY = p.y;
  };
  canvas.onpointerup = () => { drawing = false; };
  canvas.onpointercancel = () => { drawing = false; };
}

function openProposalDialog(message) {
  if (!message?.requestId || !els.proposalDialog) return;
  if (userProfile(currentUser) !== 'dispatcher') {
    window.alert('Somente Despachadores podem apresentar contraproposta.');
    return;
  }
  activeProposalMessage = message;
  const base = fromLocalISO(message.requestDate) || new Date();
  proposalVisibleMonth = new Date(base.getFullYear(), base.getMonth(), 1, 12);
  if (proposalVisibleMonth < new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12)) {
    proposalVisibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
  }
  if (els.proposalDate) els.proposalDate.value = '';
  if (els.proposalSelectedDate) els.proposalSelectedDate.textContent = `Selecione um dia em que a Equipe ${userTeam(currentUser) || '—'} esteja de serviço.`;
  if (els.proposalIntro) els.proposalIntro.textContent = `${message.fromName || 'O solicitante'} quer trocar ${formatDateBr(message.requestDate)}. Só os dias de serviço da Equipe ${userTeam(currentUser) || '—'} estão habilitados.`;
  setStatus(els.proposalStatus);
  renderProposalCalendar();
  els.proposalDialog.showModal();
  requestAnimationFrame(() => bindSignaturePad(els.proposalSignature));
}

async function createProposal(message, counterDate, signature) {
  if (!currentUserKey || !currentUser || !message?.requestId) throw new Error('Dados da solicitação incompletos.');
  const requestSnap = await get(ref(database, `${TROCAS_REQUESTS_PATH}/${message.requestId}`));
  const request = requestSnap.val();
  if (!request || request.status !== 'open') throw new Error('Este pedido já foi encerrado ou outra proposta foi escolhida.');
  const team = userTeam(currentUser);
  if (!team || !(request.targetTeams || []).includes(team)) throw new Error('Sua equipe não está entre as equipes escolhidas para esta troca.');
  if (userProfile(currentUser) !== 'dispatcher') throw new Error('Somente Despachadores podem apresentar contraproposta.');
  const counterDateObject = fromLocalISO(counterDate);
  if (!counterDateObject || !isTeamOnDuty(counterDateObject, team)) throw new Error(`Escolha um dia em que a Equipe ${team} esteja de serviço.`);
  if (counterDate < todayIso() || counterDate === request.requestDate) throw new Error('Escolha outro dia de serviço válido e não passado.');

  const proposalId = push(ref(database, `${TROCAS_PROPOSALS_PATH}/${message.requestId}`)).key;
  const requesterMessageId = push(ref(database, `${TROCAS_INBOX_PATH}/${request.fromUserKey}`)).key;
  const now = Date.now();
  const proposal = {
    requestId: message.requestId,
    proposalId,
    requestDate: request.requestDate,
    counterDate,
    proposalBy: currentUserKey,
    proposalByName: currentUser.name || userDisplayName(currentUser),
    proposalByWarName: currentUser.warName || '',
    proposalByRank: currentUser.rank || '',
    proposalTeam: team,
    interestedSignature: signature,
    interestedSignedAt: now,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  const writes = {};
  writes[`${TROCAS_PROPOSALS_PATH}/${message.requestId}/${proposalId}`] = proposal;
  writes[`${TROCAS_INBOX_PATH}/${request.fromUserKey}/${requesterMessageId}`] = {
    kind: 'proposal',
    requestId: message.requestId,
    proposalId,
    requestDate: request.requestDate,
    counterDate,
    proposalBy: currentUserKey,
    proposalByName: currentUser.warName || currentUser.name || 'Interessado',
    proposalTeam: team,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await update(ref(database), writes);
  return proposal;
}

async function handleProposalSubmit(event) {
  event.preventDefault();
  if (!activeProposalMessage) return;
  const counterDate = els.proposalDate?.value || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(counterDate)) {
    setStatus(els.proposalStatus, 'Escolha no calendário um dia em que sua equipe esteja de serviço.', 'error');
    return;
  }
  const date = fromLocalISO(counterDate);
  if (!isTeamOnDuty(date, userTeam(currentUser))) {
    setStatus(els.proposalStatus, 'A contraproposta só pode usar um dia de serviço da sua equipe.', 'error');
    return;
  }
  if (isCanvasBlank(els.proposalSignature)) {
    setStatus(els.proposalStatus, 'Assine a contraproposta antes de enviar.', 'error');
    return;
  }
  setStatus(els.proposalStatus, 'Registrando contraproposta e assinatura…', 'loading');
  try {
    const signature = exportSignature(els.proposalSignature);
    await createProposal(activeProposalMessage, counterDate, signature);
    setStatus(els.proposalStatus, 'Contraproposta enviada. Sua assinatura do Passo 1 já foi registrada.', 'success');
    window.setTimeout(() => {
      els.proposalDialog?.close();
      activeProposalMessage = null;
      setStatus(els.proposalStatus);
    }, 1300);
  } catch (error) {
    console.error(error);
    setStatus(els.proposalStatus, error.message || 'Não foi possível enviar a contraproposta.', 'error');
  }
}

async function handleRejectProposal(message) {
  if (!message?.requestId || !message?.proposalId || !currentUserKey) return;
  try {
    const proposalSnap = await get(ref(database, `${TROCAS_PROPOSALS_PATH}/${message.requestId}/${message.proposalId}`));
    const proposal = proposalSnap.val();
    if (!proposal) throw new Error('Proposta não encontrada.');
    const noticeId = push(ref(database, `${TROCAS_INBOX_PATH}/${proposal.proposalBy}`)).key;
    const writes = {};
    writes[`${TROCAS_PROPOSALS_PATH}/${message.requestId}/${message.proposalId}/status`] = 'rejected';
    writes[`${TROCAS_PROPOSALS_PATH}/${message.requestId}/${message.proposalId}/updatedAt`] = serverTimestamp();
    writes[`${TROCAS_INBOX_PATH}/${currentUserKey}/${message.id}`] = null;
    writes[`${TROCAS_INBOX_PATH}/${proposal.proposalBy}/${noticeId}`] = {
      kind: 'proposal-rejected',
      requestId: message.requestId,
      requestDate: message.requestDate,
      counterDate: message.counterDate,
      noticeText: `Sua proposta para ${formatDateBr(message.counterDate)} não foi escolhida.`,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    await update(ref(database), writes);
  } catch (error) {
    console.error(error);
    window.alert(error.message || 'Não foi possível rejeitar a proposta.');
  }
}

async function removeMessagesByPredicate(predicate) {
  const snapshot = await get(ref(database, TROCAS_INBOX_PATH));
  const all = snapshot.val() || {};
  const writes = {};
  Object.entries(all).forEach(([userKey, messages]) => {
    Object.entries(messages || {}).forEach(([messageId, message]) => {
      if (predicate(message, userKey, messageId)) writes[`${TROCAS_INBOX_PATH}/${userKey}/${messageId}`] = null;
    });
  });
  if (Object.keys(writes).length) await update(ref(database), writes);
}

async function closeMessagesForRequest(requestId) {
  await removeMessagesByPredicate((message) => message?.requestId === requestId);
}

async function closeApprovalMessages(documentId, approvalRole, approvalTeam) {
  await removeMessagesByPredicate((message) => message?.documentId === documentId && message?.kind === 'approval-request' && message?.approvalRole === approvalRole && message?.approvalTeam === approvalTeam);
}

function deterministicMessageId(documentId, role, team, userKey) {
  return `d_${documentId}_${role}_${team}_${String(userKey).slice(0, 16)}`.replace(/[^A-Za-z0-9_-]/g, '_');
}

async function dispatchApproverMessages(doc, role) {
  const teams = teamPair(doc);
  const approvers = await findApprovers(role, teams);
  const writes = {};
  const counts = Object.fromEntries(teams.map((team) => [team, 0]));
  approvers.forEach((approver) => {
    counts[approver.team] = (counts[approver.team] || 0) + 1;
    const messageId = deterministicMessageId(doc.requestId, role, approver.team, approver.userKey);
    writes[`${TROCAS_INBOX_PATH}/${approver.userKey}/${messageId}`] = {
      kind: 'approval-request',
      approvalRole: role,
      approvalTeam: approver.team,
      requestId: doc.requestId,
      documentId: doc.requestId,
      requestDate: doc.requestDate,
      counterDate: doc.counterDate,
      fromTeam: doc.fromTeam,
      interestedTeam: doc.interestedTeam,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
  });
  teams.forEach((team) => {
    writes[`${TROCAS_DOCS_PATH}/${doc.requestId}/approvalAvailability/${role}/${team}`] = counts[team] || 0;
  });
  if (Object.keys(writes).length) await update(ref(database), writes);
}

async function handleSelectProposal(message) {
  if (!message?.requestId || !message?.proposalId || !currentUserKey) return;
  try {
    const requestRef = ref(database, `${TROCAS_REQUESTS_PATH}/${message.requestId}`);

    // Carrega o pedido no cache local antes da transação.
    // Sem isso, o Firebase costuma chamar a transação com null e abortar.
    const existingSnap = await get(requestRef);
    const existing = existingSnap.val();
    if (!existing) throw new Error('Pedido de troca não encontrado.');
    if (existing.fromUserKey !== currentUserKey) {
      throw new Error('Somente quem solicitou a troca pode aceitar a proposta.');
    }
    if (existing.status !== 'open') {
      throw new Error(existing.status === 'selected' || existing.status === 'step1-requester'
        ? 'Este pedido já teve uma proposta aceita.'
        : 'Este pedido já foi encerrado.');
    }

    const proposalPath = `${TROCAS_PROPOSALS_PATH}/${message.requestId}/${message.proposalId}`;
    const selectedSnap = await get(ref(database, proposalPath));
    const selected = selectedSnap.val();
    if (!selected?.interestedSignature) {
      throw new Error('A proposta selecionada não possui assinatura válida do interessado.');
    }
    if (selected.status && !['pending', 'selected'].includes(selected.status)) {
      throw new Error('Esta proposta não está mais disponível.');
    }

    const tx = await runTransaction(requestRef, (request) => {
      // Se ainda vier null (corrida rara), devolve o snapshot conhecido para forçar nova tentativa.
      if (request === null) {
        return {
          ...existing,
          status: 'selected',
          selectedProposalId: message.proposalId,
          selectedBy: message.proposalBy || selected.proposalBy,
          selectedByName: message.proposalByName || selected.proposalByName,
          selectedTeam: message.proposalTeam || selected.proposalTeam,
          counterDate: message.counterDate || selected.counterDate,
          selectedAt: Date.now(),
          updatedAt: Date.now()
        };
      }
      if (request.status !== 'open' || request.fromUserKey !== currentUserKey) return;
      return {
        ...request,
        status: 'selected',
        selectedProposalId: message.proposalId,
        selectedBy: message.proposalBy || selected.proposalBy,
        selectedByName: message.proposalByName || selected.proposalByName,
        selectedTeam: message.proposalTeam || selected.proposalTeam,
        counterDate: message.counterDate || selected.counterDate,
        selectedAt: Date.now(),
        updatedAt: Date.now()
      };
    });

    if (!tx.committed) {
      const latest = (await get(requestRef)).val();
      if (latest?.status === 'open' && latest?.fromUserKey === currentUserKey) {
        // Fallback sem transação (ambiente com cache inconsistente).
        await update(requestRef, {
          status: 'selected',
          selectedProposalId: message.proposalId,
          selectedBy: message.proposalBy || selected.proposalBy,
          selectedByName: message.proposalByName || selected.proposalByName,
          selectedTeam: message.proposalTeam || selected.proposalTeam,
          counterDate: message.counterDate || selected.counterDate,
          selectedAt: Date.now(),
          updatedAt: serverTimestamp()
        });
      } else {
        throw new Error('Este pedido já foi encerrado ou outra proposta já foi escolhida.');
      }
    }

    const request = (await get(requestRef)).val() || tx.snapshot.val();
    if (!request) throw new Error('Não foi possível carregar o pedido após o aceite.');

    const proposalsSnap = await get(ref(database, `${TROCAS_PROPOSALS_PATH}/${message.requestId}`));
    const proposals = proposalsSnap.val() || {};
    const selectedFresh = proposals[message.proposalId] || selected;
    if (!selectedFresh?.interestedSignature) {
      throw new Error('A proposta selecionada não possui assinatura válida do interessado.');
    }

    await closeMessagesForRequest(message.requestId);
    const now = Date.now();
    const documentId = message.requestId;
    const requesterMessageId = push(ref(database, `${TROCAS_INBOX_PATH}/${request.fromUserKey}`)).key;
    const selectedNoticeId = push(ref(database, `${TROCAS_INBOX_PATH}/${selectedFresh.proposalBy}`)).key;
    const doc = {
      requestId: message.requestId,
      requestDate: request.requestDate,
      counterDate: selectedFresh.counterDate,
      fromTeam: request.fromTeam,
      interestedTeam: selectedFresh.proposalTeam,
      status: 'step1-requester',
      overallStatus: 'PENDENTE',
      pendingStep: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      partyA: {
        userKey: request.fromUserKey,
        name: request.fromName || 'Solicitante',
        warName: request.fromWarName || '',
        rank: request.fromRank || '',
        team: request.fromTeam || '',
        role: 'requester',
        signature: null,
        signedAt: null
      },
      partyB: {
        userKey: selectedFresh.proposalBy,
        name: selectedFresh.proposalByName || 'Interessado',
        warName: selectedFresh.proposalByWarName || '',
        rank: selectedFresh.proposalByRank || '',
        team: selectedFresh.proposalTeam || '',
        role: 'interested',
        signature: selectedFresh.interestedSignature,
        signedAt: selectedFresh.interestedSignedAt || now
      },
      steps: {
        step1: { status: 'pending', interestedSignedAt: selectedFresh.interestedSignedAt || now, requesterSignedAt: null },
        step2: { status: 'pending' },
        step3: { status: 'pending' }
      },
      approvals: { supervisors: {}, chiefs: {} }
    };

    const writes = {};
    writes[`${TROCAS_DOCS_PATH}/${documentId}`] = doc;
    writes[`${TROCAS_REQUESTS_PATH}/${message.requestId}/status`] = 'step1-requester';
    writes[`${TROCAS_REQUESTS_PATH}/${message.requestId}/documentId`] = documentId;
    writes[`${TROCAS_REQUESTS_PATH}/${message.requestId}/pendingStep`] = 1;
    writes[`${TROCAS_REQUESTS_PATH}/${message.requestId}/updatedAt`] = serverTimestamp();
    Object.entries(proposals).forEach(([proposalId]) => {
      writes[`${TROCAS_PROPOSALS_PATH}/${message.requestId}/${proposalId}/status`] = proposalId === message.proposalId ? 'selected' : 'closed-not-selected';
      writes[`${TROCAS_PROPOSALS_PATH}/${message.requestId}/${proposalId}/updatedAt`] = serverTimestamp();
    });
    writes[`${TROCAS_INBOX_PATH}/${request.fromUserKey}/${requesterMessageId}`] = {
      kind: 'sign-request',
      stage: 'requester',
      requestId: message.requestId,
      documentId,
      requestDate: request.requestDate,
      counterDate: selectedFresh.counterDate,
      otherName: selectedFresh.proposalByWarName || selectedFresh.proposalByName || 'Interessado',
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    writes[`${TROCAS_INBOX_PATH}/${selectedFresh.proposalBy}/${selectedNoticeId}`] = {
      kind: 'selected-notice',
      requestId: message.requestId,
      documentId,
      requestDate: request.requestDate,
      counterDate: selectedFresh.counterDate,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    await update(ref(database), writes);
    await openDocument(documentId);
  } catch (error) {
    console.error(error);
    window.alert(error.message || 'Não foi possível aceitar esta proposta.');
  }
}

function stepCompletion(doc) {
  const teams = teamPair(doc);
  const step1 = Boolean(doc?.partyA?.signature && doc?.partyB?.signature);
  const step2 = teams.length > 0 && teams.every((team) => Boolean(doc?.approvals?.supervisors?.[team]?.signature));
  const step3 = teams.length > 0 && teams.every((team) => Boolean(doc?.approvals?.chiefs?.[team]?.signature));
  return { step1, step2, step3 };
}

function pendingDetail(doc) {
  const done = stepCompletion(doc);
  const teams = teamPair(doc);
  if (!done.step1) return `Passo 1 pendente: ${doc?.partyA?.signature ? '' : 'assinatura do solicitante'}`.trim();
  if (!done.step2) {
    const pendingTeams = teams.filter((team) => !doc?.approvals?.supervisors?.[team]?.signature);
    return `Passo 2 pendente: Supervisor ${pendingTeams.map((team) => `Equipe ${team}`).join(' e ')}`;
  }
  if (!done.step3) {
    const pendingTeams = teams.filter((team) => !doc?.approvals?.chiefs?.[team]?.signature);
    return `Passo 3 pendente: Chefe de Operações ${pendingTeams.map((team) => `Equipe ${team}`).join(' e ')}`;
  }
  return 'OK · Todos os passos concluídos';
}

function renderTimeline(doc) {
  if (!els.docTimeline) return;
  els.docTimeline.replaceChildren();
  const done = stepCompletion(doc);
  const teams = teamPair(doc);
  const pendingSupervisors = teams.filter((team) => !doc?.approvals?.supervisors?.[team]?.signature);
  const pendingChiefs = teams.filter((team) => !doc?.approvals?.chiefs?.[team]?.signature);
  const data = [
    { n: 1, done: done.step1, title: 'Partes', text: doc?.partyB?.signature && !doc?.partyA?.signature ? 'Interessado já assinou; falta o solicitante.' : 'Interessado assina a contraproposta; solicitante assina após aceitar.' },
    { n: 2, done: done.step2, title: 'Supervisores', text: pendingSupervisors.length ? `Falta ${pendingSupervisors.map((team) => `Equipe ${team}`).join(' e ')}.` : 'Supervisor de cada equipe dá ciência e assina.' },
    { n: 3, done: done.step3, title: 'Chefes de Operações', text: pendingChiefs.length ? `Falta ${pendingChiefs.map((team) => `Equipe ${team}`).join(' e ')}.` : 'Chefe de Operações de cada equipe dá ciência e assina.' }
  ];
  data.forEach((step) => {
    const item = document.createElement('article');
    item.className = `timeline-step ${step.done ? 'is-complete' : 'is-pending'}`;
    const icon = document.createElement('span');
    icon.className = 'timeline-check';
    icon.textContent = step.done ? '✓' : String(step.n);
    const copy = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = `Passo ${step.n} · ${step.title}`;
    const small = document.createElement('small');
    small.textContent = step.done ? 'Concluído' : step.text;
    copy.append(strong, small);
    item.append(icon, copy);
    els.docTimeline.appendChild(item);
  });
}

function appendSignedImage(block, signer) {
  if (!signer?.signature) return false;
  const img = document.createElement('img');
  img.className = 'troca-signature-image';
  img.alt = `Assinatura de ${signer.name || signer.warName || 'usuário'}`;
  img.src = signer.signature;
  const done = document.createElement('p');
  done.className = 'troca-sign-done';
  done.textContent = `Ciente e assinado por ${signer.warName || signer.name || 'usuário'}`;
  block.append(img, done);
  return true;
}

function renderPartyBlock(doc, partyKey) {
  const party = doc[partyKey];
  if (!party) return;
  const block = document.createElement('section');
  block.className = 'troca-sign-block';
  const heading = document.createElement('h3');
  heading.textContent = `Passo 1 · ${partyKey === 'partyA' ? 'Solicitante' : 'Interessado'} — ${party.warName || party.name}`;
  const role = document.createElement('p');
  role.className = 'troca-message-from';
  role.textContent = `${party.name || ''} · Equipe ${party.team || '—'}`;
  block.append(heading, role);
  if (!appendSignedImage(block, party)) {
    const allowed = partyKey === 'partyA' && party.userKey === currentUserKey && doc.status === 'step1-requester';
    if (allowed) {
      const canvas = document.createElement('canvas');
      canvas.className = 'troca-signature-canvas';
      canvas.setAttribute('aria-label', `Assine aqui, ${party.warName || party.name}`);
      block.appendChild(canvas);
      const actions = document.createElement('div');
      actions.className = 'troca-message-actions';
      addAction(actions, 'Limpar', 'close', () => clearSignatureCanvas(canvas));
      addAction(actions, 'Confirmar assinatura', 'accept', () => saveRequesterSignature(canvas));
      block.appendChild(actions);
      requestAnimationFrame(() => bindSignaturePad(canvas));
    } else {
      const waiting = document.createElement('p');
      waiting.className = 'troca-inbox-empty';
      waiting.textContent = 'Assinatura pendente.';
      block.appendChild(waiting);
    }
  }
  els.docSignAreas.appendChild(block);
}

function canCurrentUserApprove(doc, role, team) {
  return userProfile(currentUser) === role && userTeam(currentUser) === team && (
    (role === 'supervisor' && doc.status === 'step2-supervisors') ||
    (role === 'operations-chief' && doc.status === 'step3-chiefs')
  );
}

function renderApprovalGroup(doc, role) {
  const isSupervisor = role === 'supervisor';
  const key = isSupervisor ? 'supervisors' : 'chiefs';
  const step = isSupervisor ? 2 : 3;
  teamPair(doc).forEach((team) => {
    const approval = doc?.approvals?.[key]?.[team];
    const block = document.createElement('section');
    block.className = 'troca-sign-block approval-sign-block';
    const heading = document.createElement('h3');
    heading.textContent = `Passo ${step} · ${isSupervisor ? 'Supervisor' : 'Chefe de Operações'} — Equipe ${team}`;
    block.appendChild(heading);
    if (!appendSignedImage(block, approval)) {
      const availability = Number(doc?.approvalAvailability?.[role]?.[team] || 0);
      if (canCurrentUserApprove(doc, role, team)) {
        const ciente = document.createElement('p');
        ciente.className = 'approval-ciente-copy';
        ciente.textContent = 'Ao confirmar, você registra ciência desta troca e sua assinatura.';
        const canvas = document.createElement('canvas');
        canvas.className = 'troca-signature-canvas';
        block.append(ciente, canvas);
        const actions = document.createElement('div');
        actions.className = 'troca-message-actions';
        addAction(actions, 'Limpar', 'close', () => clearSignatureCanvas(canvas));
        addAction(actions, 'Ciente e assinar', 'accept', () => saveApprovalSignature(role, team, canvas));
        block.appendChild(actions);
        requestAnimationFrame(() => bindSignaturePad(canvas));
      } else {
        const waiting = document.createElement('p');
        waiting.className = 'troca-inbox-empty';
        waiting.textContent = availability === 0
          ? `Pendente: não há ${isSupervisor ? 'Supervisor' : 'Chefe de Operações'} ativo cadastrado na Equipe ${team}.`
          : `Aguardando ${isSupervisor ? 'Supervisor' : 'Chefe de Operações'} da Equipe ${team}.`;
        block.appendChild(waiting);
      }
    }
    els.docSignAreas.appendChild(block);
  });
}

function renderDocument(doc) {
  if (!els.docMeta || !els.docSignAreas) return;
  setStatus(els.docStatus);
  els.docMeta.replaceChildren();
  els.docSignAreas.replaceChildren();
  const rows = [
    ['Dia solicitado', formatDateBr(doc.requestDate)],
    ['Dia da contraproposta', formatDateBr(doc.counterDate)],
    ['Equipes', `Equipe ${doc.fromTeam || '—'} ↔ Equipe ${doc.interestedTeam || '—'}`],
    ['Status', doc.status === 'completed' ? 'OK' : 'PENDENTE'],
    ['Pendência atual', pendingDetail(doc)]
  ];
  rows.forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'troca-doc-row';
    const dt = document.createElement('span');
    dt.textContent = label;
    const dd = document.createElement('strong');
    dd.textContent = value;
    item.append(dt, dd);
    els.docMeta.appendChild(item);
  });
  renderTimeline(doc);
  renderPartyBlock(doc, 'partyB');
  renderPartyBlock(doc, 'partyA');
  renderApprovalGroup(doc, 'supervisor');
  renderApprovalGroup(doc, 'operations-chief');
}

function canViewDocument(doc) {
  if (currentUser?.profile === 'admin') return true;
  if ([doc.partyA?.userKey, doc.partyB?.userKey].includes(currentUserKey)) return true;
  const team = userTeam(currentUser);
  const profile = userProfile(currentUser);
  if (teamPair(doc).includes(team) && ['supervisor', 'operations-chief'].includes(profile)) return true;
  const signed = [...Object.values(doc?.approvals?.supervisors || {}), ...Object.values(doc?.approvals?.chiefs || {})];
  return signed.some((item) => item?.userKey === currentUserKey);
}

async function openDocument(documentId) {
  if (!documentId || !els.docDialog) return;
  openDocumentId = documentId;
  setStatus(els.docStatus, 'Carregando documento…', 'loading');
  try {
    const snapshot = await get(ref(database, `${TROCAS_DOCS_PATH}/${documentId}`));
    const doc = snapshot.val();
    if (!doc) throw new Error('Documento não encontrado.');
    if (!canViewDocument(doc)) throw new Error('Você não tem acesso a este documento.');
    if (!els.docDialog.open) els.docDialog.showModal();
    renderDocument(doc);
    requestAnimationFrame(() => {
      els.docSignAreas?.querySelectorAll('canvas.troca-signature-canvas').forEach((canvas) => bindSignaturePad(canvas));
    });
  } catch (error) {
    console.error(error);
    setStatus(els.docStatus);
    window.alert(error.message || 'Não foi possível abrir o documento.');
  }
}

async function saveRequesterSignature(canvas) {
  if (!openDocumentId || !currentUserKey) return;
  if (isCanvasBlank(canvas)) {
    setStatus(els.docStatus, 'Desenhe sua assinatura antes de confirmar.', 'error');
    return;
  }
  setStatus(els.docStatus, 'Salvando assinatura do Passo 1…', 'loading');
  try {
    const docRef = ref(database, `${TROCAS_DOCS_PATH}/${openDocumentId}`);
    const snap = await get(docRef);
    const doc = snap.val();
    if (!doc) throw new Error('Documento não encontrado.');
    if (doc.status !== 'step1-requester') {
      throw new Error(doc.partyA?.signature
        ? 'Sua assinatura do Passo 1 já foi registrada.'
        : 'Esta etapa de assinatura não está mais disponível.');
    }
    if (doc.partyA?.userKey !== currentUserKey) {
      throw new Error('Somente o solicitante pode assinar este campo.');
    }
    if (doc.partyA?.signature) throw new Error('Sua assinatura do Passo 1 já foi registrada.');
    if (!doc.partyB?.signature) throw new Error('A assinatura do interessado não está no documento.');

    const signature = exportSignature(canvas);
    const now = Date.now();
    await update(ref(database), {
      [`${TROCAS_DOCS_PATH}/${openDocumentId}/partyA/signature`]: signature,
      [`${TROCAS_DOCS_PATH}/${openDocumentId}/partyA/signedAt`]: now,
      [`${TROCAS_DOCS_PATH}/${openDocumentId}/steps/step1`]: {
        ...(doc.steps?.step1 || {}),
        status: 'completed',
        interestedSignedAt: doc.steps?.step1?.interestedSignedAt || doc.partyB?.signedAt || now,
        requesterSignedAt: now,
        completedAt: now
      },
      [`${TROCAS_DOCS_PATH}/${openDocumentId}/status`]: 'step2-supervisors',
      [`${TROCAS_DOCS_PATH}/${openDocumentId}/overallStatus`]: 'PENDENTE',
      [`${TROCAS_DOCS_PATH}/${openDocumentId}/pendingStep`]: 2,
      [`${TROCAS_DOCS_PATH}/${openDocumentId}/updatedAt`]: now,
      [`${TROCAS_REQUESTS_PATH}/${doc.requestId}/status`]: 'step2-supervisors',
      [`${TROCAS_REQUESTS_PATH}/${doc.requestId}/pendingStep`]: 2,
      [`${TROCAS_REQUESTS_PATH}/${doc.requestId}/updatedAt`]: serverTimestamp()
    });

    const refreshed = (await get(docRef)).val();
    await closeMessagesForRequest(refreshed.requestId);
    await dispatchApproverMessages(refreshed, 'supervisor');
    renderDocument(refreshed);
    requestAnimationFrame(() => {
      els.docSignAreas?.querySelectorAll('canvas.troca-signature-canvas').forEach((item) => bindSignaturePad(item));
    });
    setStatus(els.docStatus, 'Passo 1 concluído. Supervisores das duas equipes receberam a solicitação de ciência e assinatura.', 'success');
  } catch (error) {
    console.error(error);
    setStatus(els.docStatus, error.message || 'Não foi possível salvar a assinatura.', 'error');
  }
}

async function saveApprovalSignature(role, team, canvas) {
  if (!openDocumentId || !currentUserKey) return;
  if (isCanvasBlank(canvas)) {
    setStatus(els.docStatus, 'Desenhe sua assinatura antes de confirmar o ciente.', 'error');
    return;
  }
  const normalizedTeam = normalizeTeam(team);
  const isSupervisor = role === 'supervisor';
  const approvalKey = isSupervisor ? 'supervisors' : 'chiefs';
  const expectedStatus = isSupervisor ? 'step2-supervisors' : 'step3-chiefs';
  if (userProfile(currentUser) !== role || userTeam(currentUser) !== normalizedTeam) {
    setStatus(els.docStatus, 'Seu perfil/equipe não permite assinar esta ciência.', 'error');
    return;
  }

  setStatus(els.docStatus, `Registrando ciente do ${isSupervisor ? 'Supervisor' : 'Chefe de Operações'}…`, 'loading');
  try {
    const docRef = ref(database, `${TROCAS_DOCS_PATH}/${openDocumentId}`);
    const snap = await get(docRef);
    const doc = snap.val();
    if (!doc) throw new Error('Documento não encontrado.');
    if (doc.status !== expectedStatus) throw new Error('Esta etapa ainda não está liberada ou já foi concluída.');
    if (!teamPair(doc).includes(normalizedTeam)) throw new Error('Equipe inválida para esta ciência.');
    if (doc.approvals?.[approvalKey]?.[normalizedTeam]?.signature) {
      throw new Error('A ciência desta equipe já foi registrada.');
    }

    const signature = exportSignature(canvas);
    const now = Date.now();
    const approvalRecord = {
      userKey: currentUserKey,
      name: currentUser.name || userDisplayName(currentUser),
      warName: currentUser.warName || '',
      rank: currentUser.rank || '',
      team: normalizedTeam,
      profile: role,
      ciente: true,
      signature,
      signedAt: now
    };
    const nextApprovals = {
      ...(doc.approvals || {}),
      [approvalKey]: {
        ...(doc.approvals?.[approvalKey] || {}),
        [normalizedTeam]: approvalRecord
      }
    };
    const teams = teamPair(doc);
    const allDone = teams.every((item) => Boolean(nextApprovals[approvalKey]?.[item]?.signature));
    const writes = {
      [`${TROCAS_DOCS_PATH}/${openDocumentId}/approvals/${approvalKey}/${normalizedTeam}`]: approvalRecord,
      [`${TROCAS_DOCS_PATH}/${openDocumentId}/updatedAt`]: now
    };

    if (allDone && isSupervisor) {
      writes[`${TROCAS_DOCS_PATH}/${openDocumentId}/steps/step2`] = { ...(doc.steps?.step2 || {}), status: 'completed', completedAt: now };
      writes[`${TROCAS_DOCS_PATH}/${openDocumentId}/status`] = 'step3-chiefs';
      writes[`${TROCAS_DOCS_PATH}/${openDocumentId}/pendingStep`] = 3;
      writes[`${TROCAS_REQUESTS_PATH}/${doc.requestId}/status`] = 'step3-chiefs';
      writes[`${TROCAS_REQUESTS_PATH}/${doc.requestId}/pendingStep`] = 3;
      writes[`${TROCAS_REQUESTS_PATH}/${doc.requestId}/updatedAt`] = serverTimestamp();
    } else if (allDone && !isSupervisor) {
      writes[`${TROCAS_DOCS_PATH}/${openDocumentId}/steps/step3`] = { ...(doc.steps?.step3 || {}), status: 'completed', completedAt: now };
      writes[`${TROCAS_DOCS_PATH}/${openDocumentId}/status`] = 'completed';
      writes[`${TROCAS_DOCS_PATH}/${openDocumentId}/overallStatus`] = 'OK';
      writes[`${TROCAS_DOCS_PATH}/${openDocumentId}/pendingStep`] = null;
      writes[`${TROCAS_DOCS_PATH}/${openDocumentId}/completedAt`] = now;
      writes[`${TROCAS_REQUESTS_PATH}/${doc.requestId}/status`] = 'completed';
      writes[`${TROCAS_REQUESTS_PATH}/${doc.requestId}/pendingStep`] = null;
      writes[`${TROCAS_REQUESTS_PATH}/${doc.requestId}/completedAt`] = serverTimestamp();
      writes[`${TROCAS_REQUESTS_PATH}/${doc.requestId}/updatedAt`] = serverTimestamp();
    }

    await update(ref(database), writes);
    await closeApprovalMessages(openDocumentId, role, normalizedTeam);
    const refreshed = (await get(docRef)).val();

    if (allDone && isSupervisor) {
      await dispatchApproverMessages(refreshed, 'operations-chief');
    } else if (allDone && !isSupervisor) {
      await closeMessagesForRequest(refreshed.requestId);
      const noticeWrites = {};
      [refreshed.partyA, refreshed.partyB].forEach((party) => {
        if (!party?.userKey) return;
        const noticeId = push(ref(database, `${TROCAS_INBOX_PATH}/${party.userKey}`)).key;
        noticeWrites[`${TROCAS_INBOX_PATH}/${party.userKey}/${noticeId}`] = {
          kind: 'completed-notice',
          requestId: refreshed.requestId,
          documentId: openDocumentId,
          requestDate: refreshed.requestDate,
          counterDate: refreshed.counterDate,
          noticeText: 'Passos 1, 2 e 3 concluídos. Status da troca: OK.',
          status: 'pending',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
      });
      if (Object.keys(noticeWrites).length) await update(ref(database), noticeWrites);
    }

    renderDocument(refreshed);
    requestAnimationFrame(() => {
      els.docSignAreas?.querySelectorAll('canvas.troca-signature-canvas').forEach((item) => bindSignaturePad(item));
    });
    setStatus(els.docStatus, refreshed.status === 'completed'
      ? 'Passo 3 concluído. Todos os passos estão ticados e o status é OK.'
      : isSupervisor && refreshed.status === 'step3-chiefs'
        ? 'Passo 2 concluído. Chefes de Operações das duas equipes receberam a solicitação.'
        : `Ciência registrada. ${pendingDetail(refreshed)}`, 'success');
  } catch (error) {
    console.error(error);
    setStatus(els.docStatus, error.message || 'Não foi possível registrar a ciência.', 'error');
  }
}

function loadJsPdf() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (jsPdfLoader) return jsPdfLoader;
  jsPdfLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
    script.async = true;
    script.onload = () => window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('Biblioteca PDF indisponível.'));
    script.onerror = () => reject(new Error('Falha ao carregar gerador de PDF.'));
    document.head.appendChild(script);
  });
  return jsPdfLoader;
}

async function downloadDocumentPdf(doc) {
  if (!doc) return;
  try {
    const JsPDF = await loadJsPdf();
    const pdf = new JsPDF({ unit: 'mm', format: 'a4' });
    const margin = 16;
    let y = 20;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.text('Termo de troca de serviço — CivilOff', margin, y);
    y += 9;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    const lines = [
      `Status: ${doc.status === 'completed' ? 'OK — 3 passos concluídos' : pendingDetail(doc)}`,
      `Dia solicitado: ${formatDateBr(doc.requestDate)}`,
      `Dia da contraproposta: ${formatDateBr(doc.counterDate)}`,
      `Solicitante: ${doc.partyA?.name || '—'} — Equipe ${doc.fromTeam || '—'}`,
      `Interessado: ${doc.partyB?.name || '—'} — Equipe ${doc.interestedTeam || '—'}`
    ];
    lines.forEach((line) => { pdf.text(line, margin, y); y += 6; });
    y += 4;
    const addSignature = (label, signer) => {
      pdf.setFont('helvetica', 'bold');
      pdf.text(`${label}: ${signer?.name || signer?.warName || 'Pendente'}`, margin, y);
      y += 4;
      if (signer?.signature) {
        try { pdf.addImage(signer.signature, 'JPEG', margin, y, 74, 28); y += 32; } catch { y += 6; }
      } else { y += 5; }
      if (y > 260) { pdf.addPage(); y = 20; }
    };
    addSignature('Passo 1 — Interessado', doc.partyB);
    addSignature('Passo 1 — Solicitante', doc.partyA);
    teamPair(doc).forEach((team) => addSignature(`Passo 2 — Supervisor Equipe ${team}`, doc.approvals?.supervisors?.[team]));
    teamPair(doc).forEach((team) => addSignature(`Passo 3 — Chefe de Operações Equipe ${team}`, doc.approvals?.chiefs?.[team]));
    pdf.save(`troca_${String(doc.requestDate || '').replace(/-/g, '')}_${String(doc.counterDate || '').replace(/-/g, '')}.pdf`);
  } catch (error) {
    console.error(error);
    window.alert(error.message || 'Não foi possível gerar o PDF.');
  }
}

async function handleClose(message) {
  if (!currentUserKey || !message?.id) return;
  try {
    await update(ref(database, `${TROCAS_INBOX_PATH}/${currentUserKey}/${message.id}`), { status: 'closed', updatedAt: serverTimestamp() });
  } catch (error) {
    console.error(error);
    window.alert('Não foi possível fechar a mensagem.');
  }
}

function selectedTargetTeams() {
  return Array.from(els.teamChoices?.querySelectorAll('input[name="targetTeam"]:checked') || []).map((input) => input.value);
}

function refreshTeamChoices() {
  const mine = userTeam(currentUser);
  els.teamChoices?.querySelectorAll('input[name="targetTeam"]').forEach((input) => {
    input.checked = false;
    input.disabled = input.value === mine;
    input.closest('label')?.classList.toggle('is-disabled', input.disabled);
  });
}

function openRequestDialog() {
  if (!els.requestDialog) return;
  const mine = userTeam(currentUser);
  if (userProfile(currentUser) !== 'dispatcher') {
    window.alert('Somente Despachadores podem solicitar troca. Supervisores e Chefes de Operações atuam nas etapas de ciência.');
    return;
  }
  if (!mine) {
    window.alert('Seu usuário ainda não possui equipe A–E. Peça ao administrador para vincular sua equipe.');
    return;
  }
  setStatus(els.requestStatus);
  if (els.requestDate) els.requestDate.value = '';
  if (els.requestSelectedDate) {
    els.requestSelectedDate.textContent = `Selecione um dia iluminado. Somente a Equipe ${mine} em serviço.`;
  }
  requestVisibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
  refreshTeamChoices();
  renderRequestCalendar();
  els.requestDialog.showModal();
}

function openInboxDialog() {
  if (!els.inboxDialog) return;
  renderInboxList();
  els.inboxDialog.showModal();
}

function updateVisibility() {
  const isLogged = Boolean(currentUserKey && currentUser);
  const isAdmin = currentUser?.profile === 'admin';
  if (els.trocaButton) els.trocaButton.hidden = !isLogged || isAdmin || userProfile(currentUser) !== 'dispatcher';
  if (els.inboxButton) els.inboxButton.hidden = !isLogged || isAdmin;
  if (!isLogged || isAdmin) updateBadge(0);
}

async function handleRequestSubmit(event) {
  event.preventDefault();
  setStatus(els.requestStatus);
  const requestDate = els.requestDate?.value || '';
  const teams = selectedTargetTeams();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestDate)) {
    setStatus(els.requestStatus, 'Escolha um dia de serviço da sua equipe no calendário.', 'error');
    return;
  }
  const requestDateObject = fromLocalISO(requestDate);
  if (!requestDateObject || !isTeamOnDuty(requestDateObject, userTeam(currentUser))) {
    setStatus(els.requestStatus, 'O dia escolhido precisa ser um dia de serviço da sua equipe.', 'error');
    return;
  }
  if (!teams.length) {
    setStatus(els.requestStatus, 'Escolha uma ou mais equipes de destino.', 'error');
    return;
  }
  setStatus(els.requestStatus, 'Enviando solicitação…', 'loading');
  try {
    const result = await createTrocaRequest(requestDate, teams);
    setStatus(els.requestStatus, `Pedido enviado para ${result.recipientCount} Despachador(es) de ${targetTeamText(result.teams)}.`, 'success');
    window.setTimeout(() => {
      els.requestDialog?.close();
      setStatus(els.requestStatus);
    }, 1200);
  } catch (error) {
    console.error(error);
    setStatus(els.requestStatus, error.message || 'Não foi possível enviar a solicitação.', 'error');
  }
}

function bindEvents() {
  els.trocaButton?.addEventListener('click', openRequestDialog);
  els.inboxButton?.addEventListener('click', openInboxDialog);
  els.cancelRequest?.addEventListener('click', () => els.requestDialog?.close());
  els.closeInbox?.addEventListener('click', () => els.inboxDialog?.close());
  els.closeDoc?.addEventListener('click', () => els.docDialog?.close());
  els.cancelProposal?.addEventListener('click', () => {
    activeProposalMessage = null;
    els.proposalDialog?.close();
  });
  els.requestForm?.addEventListener('submit', handleRequestSubmit);
  els.proposalForm?.addEventListener('submit', handleProposalSubmit);
  els.requestPrevMonth?.addEventListener('click', () => {
    requestVisibleMonth = new Date(requestVisibleMonth.getFullYear(), requestVisibleMonth.getMonth() - 1, 1, 12);
    renderRequestCalendar();
  });
  els.requestNextMonth?.addEventListener('click', () => {
    requestVisibleMonth = new Date(requestVisibleMonth.getFullYear(), requestVisibleMonth.getMonth() + 1, 1, 12);
    renderRequestCalendar();
  });
  els.proposalPrevMonth?.addEventListener('click', () => {
    proposalVisibleMonth = new Date(proposalVisibleMonth.getFullYear(), proposalVisibleMonth.getMonth() - 1, 1, 12);
    renderProposalCalendar();
  });
  els.proposalNextMonth?.addEventListener('click', () => {
    proposalVisibleMonth = new Date(proposalVisibleMonth.getFullYear(), proposalVisibleMonth.getMonth() + 1, 1, 12);
    renderProposalCalendar();
  });
  els.clearProposalSignature?.addEventListener('click', () => clearSignatureCanvas(els.proposalSignature));
}

document.addEventListener('civiloff:authchange', (event) => {
  const detail = event.detail || {};
  currentUserKey = detail.userKey || '';
  currentUser = detail.user || null;
  updateVisibility();
  subscribeInbox();
  subscribeAdminRequests();
});

bindEvents();
updateVisibility();
