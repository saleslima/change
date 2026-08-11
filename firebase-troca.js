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
const RANK_LABELS = Object.freeze({
  SD_PM: 'Sd PM',
  CB_PM: 'Cb PM',
  '3SGT_PM': '3º Sgt PM',
  '2SGT_PM': '2º Sgt PM',
  '1SGT_PM': '1º Sgt PM',
  SUBTEN_PM: 'Subten PM',
  '2TEN_PM': '2º Ten PM',
  '1TEN_PM': '1º Ten PM',
  CAP_PM: 'Cap PM',
  MAJ_PM: 'Maj PM',
  TEN_CEL_PM: 'Ten Cel PM',
  CEL_PM: 'Cel PM'
});
const dayTeamSequence = ['B', 'A', 'B', 'A', 'E'];
const nightTeamSequence = ['D', 'E', 'C', 'D', 'C'];
const baseDate = new Date(2024, 0, 1, 12);
const monthFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });

let currentUserKey = '';
let currentUser = null;
let unsubscribeInbox = null;
let unsubscribeMyDocs = null;
let unsubscribeMyRequests = null;
let unsubscribeAdminRequests = null;
let unsubscribeAdminDocs = null;
let unsubscribeUsersDir = null;
let inboxCache = {};
let myDocsCache = {};
let myRequestsCache = {};
let adminRequestsCache = {};
let adminDocsCache = {};
let usersDirectory = {};
let openDocumentId = '';
let openDocumentCache = null;
let editingRequestId = '';
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
  requestTitle: document.querySelector('#trocaRequestTitle'),
  requestIntro: document.querySelector('#trocaRequestIntro'),
  requestSubmit: document.querySelector('#trocaRequestSubmit'),
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
  vigentesList: document.querySelector('#trocaVigentesList'),
  vigentesEmpty: document.querySelector('#trocaVigentesEmpty'),
  vigentesCount: document.querySelector('#trocaVigentesCount'),
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
  docPdfActions: document.querySelector('#trocaDocPdfActions'),
  viewPdf: document.querySelector('#viewTrocaPdf'),
  downloadPdf: document.querySelector('#downloadTrocaPdf'),
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

function rankLabel(rank) {
  if (!rank) return '';
  if (rank === 'ADMIN') return 'Administrador';
  return RANK_LABELS[rank] || String(rank).replaceAll('_', ' ');
}

function normalizeRe(value) {
  const cleaned = String(value || '').toUpperCase().replace(/[^0-9AB]/g, '');
  const first = cleaned.slice(0, 6).replace(/\D/g, '');
  const last = cleaned.slice(6, 7).replace(/[^0-9AB]/g, '');
  return `${first}${last}`.slice(0, 7);
}

function formatRe(value) {
  const raw = normalizeRe(value);
  if (raw.length <= 6) return raw;
  return `${raw.slice(0, 6)}-${raw.slice(6)}`;
}

function pickIdentity(parts = {}, userKey = '') {
  const user = userKey ? usersDirectory[userKey] : null;
  const re = parts.re || user?.re || '';
  const reMasked = parts.reMasked || user?.reMasked || formatRe(re);
  return {
    name: parts.name || user?.name || '',
    warName: parts.warName || user?.warName || parts.name || user?.name || '',
    rank: parts.rank || user?.rank || '',
    re,
    reMasked,
    userKey: userKey || parts.userKey || ''
  };
}

function currentUserIdentity() {
  return pickIdentity({
    name: currentUser?.name || '',
    warName: currentUser?.warName || '',
    rank: currentUser?.rank || '',
    re: currentUser?.re || '',
    reMasked: currentUser?.reMasked || ''
  }, currentUserKey);
}

function requesterIdentity(source = {}) {
  return pickIdentity({
    name: source.fromName || source.partyA?.name || '',
    warName: source.fromWarName || source.partyA?.warName || '',
    rank: source.fromRank || source.partyA?.rank || '',
    re: source.fromRe || source.partyA?.re || '',
    reMasked: source.fromReMasked || source.partyA?.reMasked || ''
  }, source.fromUserKey || source.partyA?.userKey || '');
}

function proposerIdentity(source = {}) {
  return pickIdentity({
    name: source.proposalByName || source.selectedByName || source.partyB?.name || '',
    warName: source.proposalByWarName || source.selectedByWarName || source.partyB?.warName || '',
    rank: source.proposalByRank || source.selectedByRank || source.partyB?.rank || '',
    re: source.proposalByRe || source.selectedByRe || source.partyB?.re || '',
    reMasked: source.proposalByReMasked || source.selectedByReMasked || source.partyB?.reMasked || ''
  }, source.proposalBy || source.selectedBy || source.partyB?.userKey || '');
}

function officerLine(person, fallback = 'Usuário') {
  if (!person) return fallback;
  const war = person.warName || person.name || fallback;
  const rank = rankLabel(person.rank);
  const re = person.reMasked || formatRe(person.re);
  const head = [rank, war].filter(Boolean).join(' ') || fallback;
  return re ? `${head} · RE ${re}` : head;
}

function requesterWriteFields(identity = currentUserIdentity()) {
  return {
    fromName: identity.name || identity.warName || 'Usuário',
    fromWarName: identity.warName || identity.name || '',
    fromRank: identity.rank || '',
    fromRe: identity.re || '',
    fromReMasked: identity.reMasked || formatRe(identity.re)
  };
}

function proposerWriteFields(identity = currentUserIdentity()) {
  return {
    proposalByName: identity.name || identity.warName || 'Interessado',
    proposalByWarName: identity.warName || identity.name || '',
    proposalByRank: identity.rank || '',
    proposalByRe: identity.re || '',
    proposalByReMasked: identity.reMasked || formatRe(identity.re)
  };
}

function fullUserLabel(user) {
  return officerLine(pickIdentity(user || {}, user?.userKey || ''), userDisplayName(user));
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

function isRequestStillEditable(request) {
  return Boolean(
    request
    && request.status === 'open'
    && !request.documentId
    && !request.selectedBy
    && !request.selectedProposalId
  );
}

function isCurrentRequester(request) {
  return Boolean(currentUserKey && request?.fromUserKey === currentUserKey);
}

function isCurrentAdmin() {
  return currentUser?.profile === 'admin';
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

function isApprovalDenied(record) {
  return record?.decision === 'denied' || record?.status === 'denied';
}

function isStepDenied(doc, step) {
  if (step === 2) return doc?.status === 'step2-denied' || doc?.steps?.step2?.status === 'denied';
  if (step === 3) return doc?.status === 'step3-denied' || doc?.steps?.step3?.status === 'denied';
  return false;
}

function isDocDenied(doc) {
  return isStepDenied(doc, 2) || isStepDenied(doc, 3) || doc?.overallStatus === 'INDEFERIDO';
}

function isInvolvedInDoc(doc) {
  if (!doc || !currentUserKey) return false;
  if ([doc.partyA?.userKey, doc.partyB?.userKey].includes(currentUserKey)) return true;
  const approvals = [...Object.values(doc.approvals?.supervisors || {}), ...Object.values(doc.approvals?.chiefs || {})];
  if (approvals.some((item) => item?.userKey === currentUserKey)) return true;
  const team = userTeam(currentUser);
  const profile = userProfile(currentUser);
  return teamPair(doc).includes(team) && ['supervisor', 'operations-chief'].includes(profile);
}

function isTrocaVigenteForMe(doc) {
  if (!isInvolvedInDoc(doc)) return false;
  if (isDocDenied(doc)) return true;
  if (doc.status !== 'completed') return true;
  return isWithinFulfillmentWindow(doc.requestDate, doc.counterDate);
}

function isOpenRequestVigenteForMe(request) {
  if (!request || !currentUserKey) return false;
  if (request.fromUserKey !== currentUserKey) return false;
  if (request.documentId) return false;
  return ['open', 'selected'].includes(request.status);
}

function myVigentes() {
  const docs = Object.entries(myDocsCache)
    .map(([id, doc]) => ({ id, ...doc, requestId: doc.requestId || id }))
    .filter((doc) => isTrocaVigenteForMe(doc));
  const openRequests = Object.entries(myRequestsCache)
    .map(([id, request]) => ({ id, ...request }))
    .filter((request) => isOpenRequestVigenteForMe(request))
    .map((request) => ({
      id: request.id,
      requestId: request.id,
      kind: 'open-request',
      status: request.status,
      requestDate: request.requestDate,
      counterDate: request.counterDate || '',
      fromUserKey: request.fromUserKey,
      fromName: request.fromName,
      fromWarName: request.fromWarName,
      fromRank: request.fromRank,
      fromRe: request.fromRe,
      fromReMasked: request.fromReMasked,
      fromTeam: request.fromTeam,
      targetTeams: request.targetTeams || [],
      documentId: request.documentId || '',
      selectedBy: request.selectedBy || '',
      selectedByName: request.selectedByName || '',
      selectedByWarName: request.selectedByWarName || '',
      selectedByRank: request.selectedByRank || '',
      selectedByRe: request.selectedByRe || '',
      selectedByReMasked: request.selectedByReMasked || '',
      selectedProposalId: request.selectedProposalId || '',
      interestedTeam: request.selectedTeam || '',
      partyA: {
        name: request.fromName,
        warName: request.fromWarName,
        rank: request.fromRank,
        re: request.fromRe,
        reMasked: request.fromReMasked,
        userKey: request.fromUserKey
      },
      partyB: {
        name: request.selectedByName || 'Aguardando proposta',
        warName: request.selectedByWarName || '',
        rank: request.selectedByRank || '',
        re: request.selectedByRe || '',
        reMasked: request.selectedByReMasked || '',
        userKey: request.selectedBy || ''
      }
    }));
  return [...docs, ...openRequests].sort((a, b) => (
    (Number(b.updatedAt) || Number(b.createdAt) || 0) - (Number(a.updatedAt) || Number(a.createdAt) || 0)
  ));
}

function refreshInboxBadge() {
  const messageCount = pendingMessages().length;
  const vigentesCount = myVigentes().length;
  updateBadge(messageCount + vigentesCount);
}

function renderVigentesList() {
  if (!els.vigentesList) return;
  const items = myVigentes();
  els.vigentesList.replaceChildren();
  if (els.vigentesEmpty) els.vigentesEmpty.hidden = items.length > 0;
  if (els.vigentesCount) els.vigentesCount.textContent = String(items.length);

  items.forEach((doc) => {
    const card = document.createElement('article');
    card.className = 'troca-message-card troca-tracking-card';
    if (doc.status === 'completed') card.classList.add('is-ok');
    if (isDocDenied(doc)) card.classList.add('is-denied');

    const title = document.createElement('h3');
    const meta = document.createElement('p');
    meta.className = 'troca-message-meta';
    const detail = document.createElement('p');
    detail.className = 'troca-message-from';

    const iAmRequester = doc.partyA?.userKey === currentUserKey;
    const other = iAmRequester ? doc.partyB : doc.partyA;
    const otherName = other?.warName || other?.name || 'Contraparte';

    if (doc.kind === 'open-request') {
      title.textContent = 'Pedido vigente · aguardando proposta';
      const canManage = isCurrentRequester(doc) && isRequestStillEditable(doc);
      meta.textContent = canManage
        ? `${statusStepText(doc.status, doc)} · Você pode editar ou apagar até aceitar uma proposta.`
        : statusStepText(doc.status, doc);
      const destinos = doc.targetTeams?.length ? ` · Destino: ${targetTeamText(doc.targetTeams)}` : '';
      detail.textContent = `${officerLine(requesterIdentity(doc))} · Dia solicitado: ${formatDateBr(doc.requestDate)} · Equipe ${doc.fromTeam || '—'}${destinos}`;
    } else {
      const isOk = doc.status === 'completed';
      const denied = isDocDenied(doc);
      title.textContent = isOk ? 'Troca vigente · OK' : denied ? 'Troca vigente · INDEFERIDA' : 'Troca vigente · PENDENTE';
      meta.textContent = `${isOk ? 'OK · 3 passos concluídos' : publicStepStatus(doc)} · Com ${otherName}.`;
      detail.textContent = `Cumprimento: ${formatDateBr(doc.requestDate)} ↔ ${formatDateBr(doc.counterDate || '—')} · Equipes ${doc.fromTeam || '—'} / ${doc.interestedTeam || '—'}`;
    }

    card.append(title, meta, detail);
    const actions = document.createElement('div');
    actions.className = 'troca-message-actions';
    if (doc.kind === 'open-request') {
      if (isCurrentRequester(doc) && isRequestStillEditable(doc)) {
        addAction(actions, 'Editar data/equipes', 'accept', () => openRequestDialogForEdit(doc));
        addAction(actions, 'Apagar pedido', 'remove', () => handleRequesterCancelRequest(doc));
        card.appendChild(actions);
      }
    } else {
      addAction(actions, 'Ver status / documento', 'accept', () => openDocument(doc.id || doc.requestId));
      if (doc.status === 'completed') appendPdfActions(actions, doc.id || doc.requestId);
      card.appendChild(actions);
    }
    els.vigentesList.appendChild(card);
  });
}

function pendingMessages() {
  return Object.entries(inboxCache)
    .map(([id, message]) => ({ id, ...message }))
    .filter((message) => {
      if (message.status && message.status !== 'pending') return false;
      // Tracking fica na seção de vigentes; evita duplicar no bloco de mensagens.
      if (message.kind === 'troca-tracking') return false;
      return true;
    })
    .sort((a, b) => (Number(b.updatedAt) || Number(b.createdAt) || 0) - (Number(a.updatedAt) || Number(a.createdAt) || 0));
}

function renderInboxPanel() {
  renderVigentesList();
  renderInboxList();
  refreshInboxBadge();
}

function pendingAdminRequests() {
  return Object.entries(adminRequestsCache)
    .map(([id, request]) => ({ id, ...request }))
    .filter((request) => request.status !== 'completed' && (request.documentId || !isRequestStillEditable(request)))
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

function appendPdfActions(actions, documentId) {
  if (!actions || !documentId) return;
  addAction(actions, 'Ver PDF', 'accept', () => handleViewPdf(documentId));
  addAction(actions, 'Baixar PDF', '', () => handleDownloadPdf(documentId));
}

function addAdminDeleteButton(actions, requestId) {
  if (!requestId || !actions) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'admin-action danger';
  button.textContent = 'Excluir';
  button.addEventListener('click', () => handleAdminDeleteTroca(requestId));
  actions.appendChild(button);
  return button;
}

function statusStepText(status, requestOrDoc = {}) {
  if (status === 'completed') return 'OK · 3 passos concluídos';
  if (status === 'step2-denied') return 'INDEFERIDO · Passo 2 — supervisores';
  if (status === 'step3-denied') return 'INDEFERIDO · Passo 3 — chefes de operações';
  if (status === 'step1-requester') return 'PENDENTE · Passo 1 — assinatura do solicitante';
  if (status === 'step2-supervisors') return 'PENDENTE · Passo 2 — ciência e assinatura dos supervisores';
  if (status === 'step3-chiefs') return 'PENDENTE · Passo 3 — ciência e assinatura dos chefes de operações';
  if (status === 'selected') return 'PENDENTE · Preparando documento';
  if (status === 'open') return 'Pedido aberto para propostas';
  return requestOrDoc.pendingStep ? `PENDENTE · Passo ${requestOrDoc.pendingStep}` : 'PENDENTE';
}

function fulfillmentEndIso(requestDate, counterDate) {
  const dates = [requestDate, counterDate].filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '')).sort();
  return dates.length ? dates[dates.length - 1] : '';
}

function isWithinFulfillmentWindow(requestDate, counterDate) {
  const end = fulfillmentEndIso(requestDate, counterDate);
  return Boolean(end && todayIso() <= end);
}

function trackingMessageId(requestId) {
  return `track_${String(requestId || '').replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

function buildTrackingPayload(doc, partyRole) {
  const overall = isDocDenied(doc) ? 'INDEFERIDO' : doc.status === 'completed' ? 'OK' : 'PENDENTE';
  const statusText = doc.status === 'completed' ? 'OK · 3 passos concluídos' : publicStepStatus(doc);
  const other = partyRole === 'requester' ? doc.partyB : doc.partyA;
  return {
    kind: 'troca-tracking',
    requestId: doc.requestId,
    documentId: doc.requestId || openDocumentId,
    requestDate: doc.requestDate,
    counterDate: doc.counterDate,
    fromTeam: doc.fromTeam || '',
    interestedTeam: doc.interestedTeam || '',
    partyRole,
    otherName: officerLine(pickIdentity(other || {}, other?.userKey || ''), other?.warName || other?.name || 'Contraparte'),
    docStatus: doc.status || '',
    overallStatus: overall,
    statusText,
    visibleUntil: fulfillmentEndIso(doc.requestDate, doc.counterDate),
    pinUntilFulfillment: true,
    status: 'pending',
    updatedAt: serverTimestamp()
  };
}

async function upsertPartyTracking(doc) {
  if (!doc?.requestId || !doc?.partyA?.userKey || !doc?.partyB?.userKey) return;
  if (!isWithinFulfillmentWindow(doc.requestDate, doc.counterDate) && doc.status !== 'completed') {
    // ainda assim grava se estiver em andamento sem datas válidas
  }
  const messageId = trackingMessageId(doc.requestId);
  const writes = {};
  [
    [doc.partyA.userKey, 'requester'],
    [doc.partyB.userKey, 'interested']
  ].forEach(([userKey, partyRole]) => {
    writes[`${TROCAS_INBOX_PATH}/${userKey}/${messageId}`] = {
      ...buildTrackingPayload(doc, partyRole),
      createdAt: serverTimestamp()
    };
  });
  await update(ref(database), writes);
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
      title.textContent = `Contraproposta de ${officerLine(proposerIdentity(message), 'Interessado')}`;
      meta.textContent = `Você quer trocar ${formatDateBr(message.requestDate)}. A contraproposta é ${formatDateBr(message.counterDate)} e já está assinada pelo interessado.`;
      detail.textContent = `Equipe ${message.proposalTeam || '—'} · Compare as propostas antes de aceitar uma.`;
    } else if (message.kind === 'sign-request') {
      title.textContent = 'Passo 1 · Sua assinatura';
      meta.textContent = `A proposta de ${message.otherName || 'interessado'} foi aceita. Assine o documento para concluir o Passo 1.`;
      detail.textContent = `${formatDateBr(message.requestDate)} ↔ ${formatDateBr(message.counterDate)}`;
    } else if (message.kind === 'approval-request') {
      const roleText = message.approvalRole === 'supervisor' ? 'Supervisor' : 'Chefe de Operações';
      const step = message.approvalRole === 'supervisor' ? 2 : 3;
      title.textContent = `Passo ${step} · Ciente ou indeferir · ${roleText}`;
      meta.textContent = `Troca das Equipes ${message.fromTeam || '—'} e ${message.interestedTeam || '—'}. Abra o documento para dar ciência e assinar ou indeferir pela Equipe ${message.approvalTeam || '—'}.`;
      detail.textContent = `${formatDateBr(message.requestDate)} ↔ ${formatDateBr(message.counterDate)}`;
    } else if (message.kind === 'selected-notice') {
      title.textContent = 'Sua contraproposta foi escolhida';
      meta.textContent = 'Sua assinatura do Passo 1 já está registrada. Agora o solicitante precisa assinar.';
      detail.textContent = `${formatDateBr(message.requestDate)} ↔ ${formatDateBr(message.counterDate)}`;
    } else if (message.kind === 'troca-tracking') {
      const isOk = message.overallStatus === 'OK' || message.docStatus === 'completed';
      const denied = message.overallStatus === 'INDEFERIDO' || String(message.docStatus || '').includes('denied');
      title.textContent = isOk ? 'Troca acompanhada · OK' : denied ? 'Troca acompanhada · INDEFERIDA' : 'Troca em acompanhamento · PENDENTE';
      meta.textContent = `${message.statusText || statusStepText(message.docStatus)} · Com ${message.otherName || 'contraparte'}.`;
      detail.textContent = `Cumprimento: ${formatDateBr(message.requestDate)} ↔ ${formatDateBr(message.counterDate)} · Disponível até ${formatDateBr(message.visibleUntil || fulfillmentEndIso(message.requestDate, message.counterDate))}.`;
    } else if (message.kind === 'completed-notice') {
      title.textContent = 'Troca concluída · OK';
      meta.textContent = message.noticeText || 'Os 3 passos foram concluídos. Você já pode ver ou baixar o PDF.';
      detail.textContent = `${formatDateBr(message.requestDate)} ↔ ${formatDateBr(message.counterDate)}`;
    } else if (message.kind === 'denied-notice') {
      title.textContent = `Troca indeferida · Passo ${message.deniedStep || '—'}`;
      meta.textContent = message.noticeText || 'Um responsável indeferiu esta troca neste passo.';
      detail.textContent = `${formatDateBr(message.requestDate)} ↔ ${formatDateBr(message.counterDate)}`;
    } else if (message.kind === 'proposal-rejected') {
      title.textContent = 'Proposta não escolhida';
      meta.textContent = message.noticeText || 'O solicitante não escolheu esta alternativa.';
      detail.textContent = 'Enquanto o pedido estiver aberto, você pode enviar outra alternativa.';
    } else if (message.kind === 'request-updated') {
      title.textContent = 'Pedido de troca atualizado';
      meta.textContent = message.noticeText || `O solicitante alterou o dia para ${formatDateBr(message.requestDate)}.`;
      detail.textContent = message.targetTeams?.length
        ? `Equipes de destino: ${targetTeamText(message.targetTeams)}.`
        : 'Confira o pedido atualizado na sua caixa.';
    } else if (message.kind === 'request-cancelled') {
      title.textContent = 'Pedido de troca cancelado';
      meta.textContent = message.noticeText || 'O solicitante cancelou este pedido.';
      detail.textContent = message.requestDate ? `Dia que havia sido pedido: ${formatDateBr(message.requestDate)}.` : 'O pedido não está mais disponível.';
    } else if (message.kind === 'troca-deleted') {
      title.textContent = 'Troca excluída';
      meta.textContent = message.noticeText || 'Esta troca foi excluída pelo administrador.';
      detail.textContent = message.requestDate ? `${formatDateBr(message.requestDate)} ↔ ${formatDateBr(message.counterDate || '—')}` : 'O documento e as mensagens relacionadas foram removidos.';
    } else {
      title.textContent = `${officerLine(requesterIdentity(message))} solicita troca`;
      meta.textContent = `Dia solicitado: ${formatDateBr(message.requestDate || message.date)}.`;
      detail.textContent = `Você recebeu este pedido como Despachador da Equipe ${message.recipientTeam || userTeam(currentUser) || '—'}. Escolha um dos dias em que sua equipe está de serviço.`;
    }

    if (message.kind === 'troca-tracking') {
      card.classList.add('troca-tracking-card');
      if (message.overallStatus === 'OK' || message.docStatus === 'completed') card.classList.add('is-ok');
      if (message.overallStatus === 'INDEFERIDO' || String(message.docStatus || '').includes('denied')) card.classList.add('is-denied');
    }
    if (message.kind === 'denied-notice') card.classList.add('is-denied');

    card.append(title, meta, detail);
    const actions = document.createElement('div');
    actions.className = 'troca-message-actions';
    if (!message.kind || message.kind === 'request') {
      addAction(actions, 'Fazer contraproposta', 'accept', () => openProposalDialog(message));
    } else if (message.kind === 'proposal') {
      addAction(actions, 'Aceitar proposta', 'accept', () => handleSelectProposal(message));
      addAction(actions, 'Rejeitar', 'remove', () => handleRejectProposal(message));
    } else if (['sign-request', 'approval-request', 'completed-notice', 'denied-notice', 'selected-notice', 'troca-tracking'].includes(message.kind) && message.documentId) {
      addAction(actions, message.kind === 'completed-notice' || message.kind === 'troca-tracking' || message.kind === 'denied-notice' ? 'Ver status / documento' : 'Abrir documento', 'accept', () => openDocument(message.documentId));
      if (message.kind === 'completed-notice' || ((message.kind === 'troca-tracking') && (message.overallStatus === 'OK' || message.docStatus === 'completed'))) {
        appendPdfActions(actions, message.documentId);
      }
    }
    if (message.kind === 'troca-tracking') {
      if (!isWithinFulfillmentWindow(message.requestDate, message.counterDate)) {
        addAction(actions, 'Arquivar', 'close', () => handleClose(message));
      }
    } else if (!['proposal'].includes(message.kind)) {
      addAction(actions, 'Fechar', 'close', () => handleClose(message));
    }
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
    strong.textContent = `${officerLine(requesterIdentity(request), 'Solicitante')} ↔ ${officerLine(proposerIdentity(request), request.selectedByName || 'Interessado')}`;
    const span = document.createElement('span');
    span.textContent = `${formatDateBr(request.requestDate)} ↔ ${formatDateBr(request.counterDate)}`;
    const tags = document.createElement('div');
    tags.className = 'admin-tags';
    const status = document.createElement('small');
    const requestDoc = adminDocsCache[request.documentId];
    const denied = isDocDenied(requestDoc) || String(request.status || '').includes('denied');
    status.className = denied ? 'troca-denied-tag' : 'troca-pending-tag';
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
    addAdminDeleteButton(actions, request.id || request.documentId);
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
    strong.textContent = `${officerLine(requesterIdentity(doc), 'Solicitante')} ↔ ${officerLine(proposerIdentity(doc), 'Interessado')}`;
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
    addAdminDeleteButton(actions, doc.requestId || doc.id);
    card.append(info, actions);
    els.signedList.appendChild(card);
  });
}

function publishTrocaCalendarDates() {
  const dates = {};
  const addDate = (iso, kind, docOrRequest) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return;
    if (!dates[iso]) {
      dates[iso] = {
        kinds: [],
        status: docOrRequest?.status || '',
        pending: docOrRequest?.status !== 'completed',
        shortLabel: 'TROCA',
        label: ''
      };
    }
    if (!dates[iso].kinds.includes(kind)) dates[iso].kinds.push(kind);
    const parts = [];
    if (dates[iso].kinds.includes('request')) parts.push('dia solicitado');
    if (dates[iso].kinds.includes('counter')) parts.push('contrapartida');
    dates[iso].shortLabel = dates[iso].kinds.length > 1
      ? 'TROCA'
      : (kind === 'request' ? 'TROCA PEDIDO' : 'TROCA CONTRA');
    dates[iso].label = `${parts.join(' + ')} · ${docOrRequest?.status === 'completed' ? 'OK' : 'PENDENTE'}`;
    dates[iso].pending = dates[iso].pending || docOrRequest?.status !== 'completed';
  };

  Object.values(myDocsCache || {}).forEach((doc) => {
    addDate(doc.requestDate, 'request', doc);
    addDate(doc.counterDate, 'counter', doc);
  });

  Object.values(myRequestsCache || {}).forEach((request) => {
    if (request.documentId) return;
    if (!['open', 'selected'].includes(request.status)) return;
    addDate(request.requestDate, 'request', request);
    if (request.counterDate) addDate(request.counterDate, 'counter', request);
  });

  document.dispatchEvent(new CustomEvent('civiloff:trocaschange', {
    detail: { dates }
  }));
}

function subscribeUsersDirectory() {
  if (unsubscribeUsersDir) unsubscribeUsersDir();
  unsubscribeUsersDir = null;
  usersDirectory = {};
  if (!currentUserKey) return;
  unsubscribeUsersDir = onValue(ref(database, USERS_PATH), (snapshot) => {
    usersDirectory = snapshot.val() || {};
    if (els.inboxDialog?.open) renderInboxPanel();
    if (currentUser?.profile === 'admin') {
      renderAdminList();
      renderSignedAdminList();
    }
    if (openDocumentId && els.docDialog?.open) {
      const doc = adminDocsCache[openDocumentId] || myDocsCache[openDocumentId];
      if (doc) renderDocument({ id: openDocumentId, ...doc });
    }
  }, (error) => console.warn('[CivilOff] Cadastro para identidade da troca:', error));
}

function subscribeInbox() {
  if (unsubscribeInbox) unsubscribeInbox();
  if (unsubscribeMyDocs) unsubscribeMyDocs();
  if (unsubscribeMyRequests) unsubscribeMyRequests();
  unsubscribeInbox = null;
  unsubscribeMyDocs = null;
  unsubscribeMyRequests = null;
  inboxCache = {};
  myDocsCache = {};
  myRequestsCache = {};
  updateBadge(0);
  publishTrocaCalendarDates();
  renderInboxPanel();
  if (!currentUserKey || currentUser?.profile === 'admin') return;

  unsubscribeInbox = onValue(ref(database, `${TROCAS_INBOX_PATH}/${currentUserKey}`), (snapshot) => {
    inboxCache = snapshot.val() || {};
    refreshInboxBadge();
    if (els.inboxDialog?.open) renderInboxPanel();
  }, (error) => console.warn('[CivilOff] Inbox de troca:', error));

  unsubscribeMyDocs = onValue(ref(database, TROCAS_DOCS_PATH), (snapshot) => {
    const all = snapshot.val() || {};
    const mine = {};
    Object.entries(all).forEach(([id, doc]) => {
      if (isInvolvedInDoc({ ...doc, requestId: doc?.requestId || id })) {
        mine[id] = doc;
      }
    });
    myDocsCache = mine;
    publishTrocaCalendarDates();
    refreshInboxBadge();
    if (els.inboxDialog?.open) renderVigentesList();
  }, (error) => console.warn('[CivilOff] Documentos vigentes:', error));

  unsubscribeMyRequests = onValue(ref(database, TROCAS_REQUESTS_PATH), (snapshot) => {
    const all = snapshot.val() || {};
    const mine = {};
    Object.entries(all).forEach(([id, request]) => {
      if (request?.fromUserKey === currentUserKey || request?.selectedBy === currentUserKey) {
        mine[id] = request;
      }
    });
    myRequestsCache = mine;
    publishTrocaCalendarDates();
    refreshInboxBadge();
    if (els.inboxDialog?.open) renderVigentesList();
  }, (error) => console.warn('[CivilOff] Pedidos vigentes:', error));
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
  const requester = currentUserIdentity();
  writes[`${TROCAS_REQUESTS_PATH}/${requestId}`] = {
    requestDate,
    fromUserKey: currentUserKey,
    ...requesterWriteFields(requester),
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
      ...requesterWriteFields(requester),
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

async function listInboxEntries() {
  const snapshot = await get(ref(database, TROCAS_INBOX_PATH));
  const all = snapshot.val() || {};
  const entries = [];
  Object.entries(all).forEach(([userKey, messages]) => {
    Object.entries(messages || {}).forEach(([messageId, message]) => {
      entries.push({ userKey, messageId, message });
    });
  });
  return entries;
}

function pushInboxNotice(writes, userKey, payload) {
  if (!userKey) return;
  const messageId = push(ref(database, `${TROCAS_INBOX_PATH}/${userKey}`)).key;
  writes[`${TROCAS_INBOX_PATH}/${userKey}/${messageId}`] = {
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...payload
  };
}

async function validateRequesterDutyDay(requestDate) {
  if (!currentUserKey || !currentUser) throw new Error('Faça login para alterar a troca.');
  if (userProfile(currentUser) !== 'dispatcher') throw new Error('Somente o perfil Despachador solicita e edita pedidos de troca.');
  const fromTeam = userTeam(currentUser);
  if (!fromTeam) throw new Error('Seu cadastro ainda não possui equipe.');
  const requestDateObject = fromLocalISO(requestDate);
  if (!requestDateObject || requestDate < todayIso()) throw new Error('Escolha um dia de serviço válido e não passado.');
  if (!isTeamOnDuty(requestDateObject, fromTeam)) {
    throw new Error(`Escolha um dia em que a Equipe ${fromTeam} esteja de serviço.`);
  }
  return fromTeam;
}

async function updateOpenTrocaRequest(requestId, requestDate, targetTeams) {
  const requestSnap = await get(ref(database, `${TROCAS_REQUESTS_PATH}/${requestId}`));
  const request = requestSnap.val();
  if (!request) throw new Error('Pedido de troca não encontrado.');
  if (!isCurrentRequester(request)) throw new Error('Somente quem solicitou a troca pode editar este pedido.');
  if (!isRequestStillEditable(request)) {
    throw new Error('Não é possível editar depois de aceitar uma contraproposta. Somente o administrador pode excluir.');
  }

  const fromTeam = await validateRequesterDutyDay(requestDate);
  const teams = [...new Set(targetTeams.map(normalizeTeam).filter((team) => team && team !== fromTeam))];
  if (!teams.length) throw new Error('Escolha pelo menos uma equipe diferente da sua.');
  const recipients = await findRecipients(teams, currentUserKey);
  if (!recipients.length) throw new Error('Nenhum Despachador ativo foi encontrado nas equipes selecionadas.');

  const proposalsSnap = await get(ref(database, `${TROCAS_PROPOSALS_PATH}/${requestId}`));
  const proposals = proposalsSnap.val() || {};
  const dateChanged = request.requestDate !== requestDate;
  const previousTeams = new Set((request.targetTeams || []).map(normalizeTeam).filter(Boolean));
  const nextTeams = new Set(teams);
  const writes = {};

  writes[`${TROCAS_REQUESTS_PATH}/${requestId}/requestDate`] = requestDate;
  writes[`${TROCAS_REQUESTS_PATH}/${requestId}/targetTeams`] = teams;
  writes[`${TROCAS_REQUESTS_PATH}/${requestId}/updatedAt`] = serverTimestamp();

  const inboxEntries = await listInboxEntries();
  inboxEntries.forEach(({ userKey, messageId, message }) => {
    if (message?.requestId !== requestId) return;
    if (message.kind === 'request' || !message.kind) {
      writes[`${TROCAS_INBOX_PATH}/${userKey}/${messageId}`] = null;
      return;
    }
    if (message.kind === 'proposal') {
      const proposal = proposals[message.proposalId];
      if (proposal && !nextTeams.has(normalizeTeam(proposal.proposalTeam))) {
        writes[`${TROCAS_INBOX_PATH}/${userKey}/${messageId}`] = null;
        return;
      }
      writes[`${TROCAS_INBOX_PATH}/${userKey}/${messageId}/requestDate`] = requestDate;
      writes[`${TROCAS_INBOX_PATH}/${userKey}/${messageId}/updatedAt`] = serverTimestamp();
    }
  });

  const requester = currentUserIdentity();
  const requesterFields = requesterWriteFields(requester);
  Object.entries(requesterFields).forEach(([field, value]) => {
    writes[`${TROCAS_REQUESTS_PATH}/${requestId}/${field}`] = value;
  });
  recipients.forEach((recipient) => {
    const messageId = push(ref(database, `${TROCAS_INBOX_PATH}/${recipient.userKey}`)).key;
    writes[`${TROCAS_INBOX_PATH}/${recipient.userKey}/${messageId}`] = {
      kind: 'request',
      requestId,
      requestDate,
      fromUserKey: currentUserKey,
      ...requesterWriteFields(requester),
      fromTeam,
      recipientTeam: recipient.team,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
  });

  const notifiedProposers = new Set();
  Object.entries(proposals).forEach(([proposalId, proposal]) => {
    const proposalTeam = normalizeTeam(proposal?.proposalTeam);
    if (!nextTeams.has(proposalTeam)) {
      writes[`${TROCAS_PROPOSALS_PATH}/${requestId}/${proposalId}/status`] = 'rejected';
      writes[`${TROCAS_PROPOSALS_PATH}/${requestId}/${proposalId}/updatedAt`] = serverTimestamp();
      if (proposal?.proposalBy && !notifiedProposers.has(proposal.proposalBy)) {
        notifiedProposers.add(proposal.proposalBy);
        pushInboxNotice(writes, proposal.proposalBy, {
          kind: 'proposal-rejected',
          requestId,
          requestDate,
          counterDate: proposal.counterDate || '',
          noticeText: 'O solicitante removeu sua equipe deste pedido. A contraproposta foi cancelada.'
        });
      }
      return;
    }
    writes[`${TROCAS_PROPOSALS_PATH}/${requestId}/${proposalId}/requestDate`] = requestDate;
    writes[`${TROCAS_PROPOSALS_PATH}/${requestId}/${proposalId}/updatedAt`] = serverTimestamp();
    if (dateChanged && proposal?.proposalBy && !notifiedProposers.has(proposal.proposalBy)) {
      notifiedProposers.add(proposal.proposalBy);
      pushInboxNotice(writes, proposal.proposalBy, {
        kind: 'request-updated',
        requestId,
        requestDate,
        targetTeams: teams,
        noticeText: `O solicitante alterou o dia da troca para ${formatDateBr(requestDate)}.`
      });
    }
  });

  await update(ref(database), writes);
  return { requestId, teams, recipientCount: recipients.length, dateChanged, teamsChanged: [...previousTeams].join() !== [...nextTeams].join() };
}

async function wipeTrocaRecords(requestId, { notify = [], noticeKind = 'troca-deleted', noticeText = '' } = {}) {
  const proposalsSnap = await get(ref(database, `${TROCAS_PROPOSALS_PATH}/${requestId}`));
  const requestSnap = await get(ref(database, `${TROCAS_REQUESTS_PATH}/${requestId}`));
  const docSnap = await get(ref(database, `${TROCAS_DOCS_PATH}/${requestId}`));
  const request = requestSnap.val() || {};
  const doc = docSnap.val() || {};
  const writes = {};
  writes[`${TROCAS_REQUESTS_PATH}/${requestId}`] = null;
  writes[`${TROCAS_DOCS_PATH}/${requestId}`] = null;
  writes[`${TROCAS_PROPOSALS_PATH}/${requestId}`] = null;

  const inboxEntries = await listInboxEntries();
  inboxEntries.forEach(({ userKey, messageId, message }) => {
    if (message?.requestId === requestId || message?.documentId === requestId) {
      writes[`${TROCAS_INBOX_PATH}/${userKey}/${messageId}`] = null;
    }
  });

  const seen = new Set();
  notify.forEach((userKey) => {
    if (!userKey || seen.has(userKey)) return;
    seen.add(userKey);
    pushInboxNotice(writes, userKey, {
      kind: noticeKind,
      requestId,
      requestDate: request.requestDate || doc.requestDate || '',
      counterDate: request.counterDate || doc.counterDate || '',
      noticeText
    });
  });

  await update(ref(database), writes);
  if (openDocumentId === requestId) {
    openDocumentId = '';
    els.docDialog?.close();
  }
}

async function handleRequesterCancelRequest(requestLike) {
  const requestId = requestLike?.id || requestLike?.requestId;
  if (!requestId) return;
  if (!window.confirm('Apagar este pedido de troca? As equipes deixarão de vê-lo e as contrapropostas pendentes serão canceladas.')) {
    return;
  }
  try {
    const requestSnap = await get(ref(database, `${TROCAS_REQUESTS_PATH}/${requestId}`));
    const request = requestSnap.val();
    if (!request) throw new Error('Pedido de troca não encontrado.');
    if (!isCurrentRequester(request)) throw new Error('Somente quem solicitou a troca pode apagar este pedido.');
    if (!isRequestStillEditable(request)) {
      throw new Error('Depois de aceitar uma contraproposta, somente o administrador pode excluir.');
    }
    const proposalsSnap = await get(ref(database, `${TROCAS_PROPOSALS_PATH}/${requestId}`));
    const notify = Object.values(proposalsSnap.val() || {})
      .map((proposal) => proposal?.proposalBy)
      .filter(Boolean);
    await wipeTrocaRecords(requestId, {
      notify,
      noticeKind: 'request-cancelled',
      noticeText: `${request.fromWarName || request.fromName || 'O solicitante'} cancelou o pedido de troca de ${formatDateBr(request.requestDate)}.`
    });
  } catch (error) {
    console.error(error);
    window.alert(error.message || 'Não foi possível apagar o pedido.');
  }
}

async function handleAdminDeleteTroca(requestId) {
  if (!requestId) return;
  if (!isCurrentAdmin()) {
    window.alert('Somente o administrador pode excluir uma troca após o aceite.');
    return;
  }
  if (!window.confirm('Excluir esta troca? O documento, as assinaturas e as mensagens relacionadas serão removidos. Esta ação não pode ser desfeita.')) {
    return;
  }
  try {
    const requestSnap = await get(ref(database, `${TROCAS_REQUESTS_PATH}/${requestId}`));
    const docSnap = await get(ref(database, `${TROCAS_DOCS_PATH}/${requestId}`));
    const request = requestSnap.val() || {};
    const doc = docSnap.val() || {};
    const notify = [
      request.fromUserKey,
      request.selectedBy,
      doc.partyA?.userKey,
      doc.partyB?.userKey
    ].filter(Boolean);
    await wipeTrocaRecords(requestId, {
      notify,
      noticeKind: 'troca-deleted',
      noticeText: 'Esta troca foi excluída pelo administrador.'
    });
  } catch (error) {
    console.error(error);
    window.alert(error.message || 'Não foi possível excluir a troca.');
  }
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
  if (els.proposalIntro) {
    els.proposalIntro.textContent = `${officerLine(requesterIdentity(message), 'O solicitante')} quer trocar ${formatDateBr(message.requestDate)}. Só os dias de serviço da Equipe ${userTeam(currentUser) || '—'} estão habilitados.`;
  }
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
  const proposer = currentUserIdentity();
  const proposerFields = proposerWriteFields(proposer);
  const proposal = {
    requestId: message.requestId,
    proposalId,
    requestDate: request.requestDate,
    counterDate,
    proposalBy: currentUserKey,
    ...proposerFields,
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
    ...proposerFields,
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
  await removeMessagesByPredicate((message) => (
    message?.requestId === requestId && message?.kind !== 'troca-tracking'
  ));
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

    const acceptedIdentity = proposerIdentity({
      ...selected,
      proposalBy: message.proposalBy || selected.proposalBy,
      proposalByName: message.proposalByName || selected.proposalByName
    });
    const selectedPatch = {
      selectedProposalId: message.proposalId,
      selectedBy: message.proposalBy || selected.proposalBy,
      selectedByName: acceptedIdentity.name || message.proposalByName || selected.proposalByName,
      selectedByWarName: acceptedIdentity.warName,
      selectedByRank: acceptedIdentity.rank,
      selectedByRe: acceptedIdentity.re,
      selectedByReMasked: acceptedIdentity.reMasked,
      selectedTeam: message.proposalTeam || selected.proposalTeam,
      counterDate: message.counterDate || selected.counterDate
    };

    const tx = await runTransaction(requestRef, (request) => {
      // Se ainda vier null (corrida rara), devolve o snapshot conhecido para forçar nova tentativa.
      if (request === null) {
        return {
          ...existing,
          status: 'selected',
          ...selectedPatch,
          selectedAt: Date.now(),
          updatedAt: Date.now()
        };
      }
      if (request.status !== 'open' || request.fromUserKey !== currentUserKey) return;
      return {
        ...request,
        status: 'selected',
        ...selectedPatch,
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
          ...selectedPatch,
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
    const requesterId = requesterIdentity(request);
    const selectedId = proposerIdentity(selectedFresh);
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
        name: requesterId.name || request.fromName || 'Solicitante',
        warName: requesterId.warName || request.fromWarName || '',
        rank: requesterId.rank || request.fromRank || '',
        re: requesterId.re || request.fromRe || '',
        reMasked: requesterId.reMasked || request.fromReMasked || '',
        team: request.fromTeam || '',
        role: 'requester',
        signature: null,
        signedAt: null
      },
      partyB: {
        userKey: selectedFresh.proposalBy,
        name: selectedId.name || selectedFresh.proposalByName || 'Interessado',
        warName: selectedId.warName || selectedFresh.proposalByWarName || '',
        rank: selectedId.rank || selectedFresh.proposalByRank || '',
        re: selectedId.re || selectedFresh.proposalByRe || '',
        reMasked: selectedId.reMasked || selectedFresh.proposalByReMasked || '',
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
      otherName: officerLine(proposerIdentity(selectedFresh), selectedFresh.proposalByWarName || selectedFresh.proposalByName || 'Interessado'),
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
    const savedDoc = (await get(ref(database, `${TROCAS_DOCS_PATH}/${documentId}`))).val() || doc;
    await upsertPartyTracking(savedDoc);
    await openDocument(documentId);
  } catch (error) {
    console.error(error);
    window.alert(error.message || 'Não foi possível aceitar esta proposta.');
  }
}

function stepCompletion(doc) {
  const teams = teamPair(doc);
  const step1 = Boolean(doc?.partyA?.signature && doc?.partyB?.signature);
  const step2 = !isStepDenied(doc, 2) && teams.length > 0 && teams.every((team) => Boolean(doc?.approvals?.supervisors?.[team]?.signature));
  const step3 = !isStepDenied(doc, 3) && teams.length > 0 && teams.every((team) => Boolean(doc?.approvals?.chiefs?.[team]?.signature));
  return { step1, step2, step3 };
}

function personLabel(person, fallback = '—') {
  return officerLine(pickIdentity(person || {}, person?.userKey || ''), fallback);
}

function teamSideLabel(doc, team) {
  if (team === doc?.fromTeam) return `Equipe ${team} · solicitante`;
  if (team === doc?.interestedTeam) return `Equipe ${team} · interessado`;
  return `Equipe ${team || '—'}`;
}

function stepPeopleStatus(doc) {
  const teams = teamPair(doc);
  const step1 = [
    {
      role: 'Interessado',
      name: personLabel(doc?.partyB, 'Interessado'),
      teamLabel: teamSideLabel(doc, doc?.partyB?.team || doc?.interestedTeam),
      done: Boolean(doc?.partyB?.signature),
      signedBy: doc?.partyB?.signature ? personLabel(doc.partyB) : ''
    },
    {
      role: 'Solicitante',
      name: personLabel(doc?.partyA, 'Solicitante'),
      teamLabel: teamSideLabel(doc, doc?.partyA?.team || doc?.fromTeam),
      done: Boolean(doc?.partyA?.signature),
      signedBy: doc?.partyA?.signature ? personLabel(doc.partyA) : ''
    }
  ];

  const step2 = teams.map((team) => {
    const approval = doc?.approvals?.supervisors?.[team];
    const missingCadastro = Number(doc?.approvalAvailability?.supervisor?.[team] || 0) === 0 && !approval?.signature && !isApprovalDenied(approval);
    return {
      role: 'Supervisor',
      name: approval?.warName || approval?.name || `Supervisor da Equipe ${team}`,
      teamLabel: teamSideLabel(doc, team),
      done: Boolean(approval?.signature),
      denied: isApprovalDenied(approval),
      signedBy: approval?.signature ? personLabel(approval) : '',
      deniedBy: isApprovalDenied(approval) ? personLabel(approval) : '',
      missingCadastro
    };
  });

  const step3 = teams.map((team) => {
    const approval = doc?.approvals?.chiefs?.[team];
    const missingCadastro = Number(doc?.approvalAvailability?.['operations-chief']?.[team] || 0) === 0 && !approval?.signature && !isApprovalDenied(approval);
    return {
      role: 'Chefe de Operações',
      name: approval?.warName || approval?.name || `Chefe de Operações da Equipe ${team}`,
      teamLabel: teamSideLabel(doc, team),
      done: Boolean(approval?.signature),
      denied: isApprovalDenied(approval),
      signedBy: approval?.signature ? personLabel(approval) : '',
      deniedBy: isApprovalDenied(approval) ? personLabel(approval) : '',
      missingCadastro
    };
  });

  return { step1, step2, step3 };
}

function formatPendingPeople(people) {
  return people
    .filter((person) => !person.done && !person.denied)
    .map((person) => {
      if (person.missingCadastro) return `${person.role} ${person.teamLabel} (sem cadastro)`;
      return `${person.role} ${person.name} (${person.teamLabel})`;
    })
    .join(' · ');
}

function pendingDetail(doc) {
  if (isStepDenied(doc, 2)) return 'Passo 2 indeferido';
  if (isStepDenied(doc, 3)) return 'Passo 3 indeferido';
  const done = stepCompletion(doc);
  const people = stepPeopleStatus(doc);
  if (!done.step1) {
    const pending = formatPendingPeople(people.step1);
    return pending ? `Passo 1 pendente: ${pending}` : 'Passo 1 pendente';
  }
  if (!done.step2) {
    const pending = formatPendingPeople(people.step2);
    return pending ? `Passo 2 pendente: ${pending}` : 'Passo 2 pendente';
  }
  if (!done.step3) {
    const pending = formatPendingPeople(people.step3);
    return pending ? `Passo 3 pendente: ${pending}` : 'Passo 3 pendente';
  }
  return 'OK · Todos os passos concluídos';
}

function isDocumentAdminView() {
  return currentUser?.profile === 'admin';
}

function publicStepStatus(doc) {
  const done = stepCompletion(doc);
  if (doc?.status === 'completed' || (done.step1 && done.step2 && done.step3)) {
    return 'OK · 3 passos concluídos';
  }
  const step2Text = isStepDenied(doc, 2) ? 'indeferido' : done.step2 ? 'concluído' : 'pendente';
  const step3Text = isStepDenied(doc, 3) ? 'indeferido' : isStepDenied(doc, 2) ? 'não iniciado' : done.step3 ? 'concluído' : 'pendente';
  return [
    `Passo 1 ${done.step1 ? 'concluído' : 'pendente'}`,
    `Passo 2 ${step2Text}`,
    `Passo 3 ${step3Text}`
  ].join(' · ');
}

function viewerStepStatus(doc) {
  return isDocumentAdminView() ? pendingDetail(doc) : publicStepStatus(doc);
}

function isOwnPartyBlock(doc, partyKey) {
  return Boolean(currentUserKey && doc?.[partyKey]?.userKey === currentUserKey);
}

function isOwnApprovalSlot(role, team) {
  return userProfile(currentUser) === role && userTeam(currentUser) === normalizeTeam(team);
}

function appendPersonStatusList(container, people) {
  const list = document.createElement('ul');
  list.className = 'timeline-people';
  people.forEach((person) => {
    const item = document.createElement('li');
    item.className = person.denied ? 'is-denied' : person.done ? 'is-done' : 'is-pending';
    const mark = document.createElement('strong');
    mark.textContent = person.denied ? 'INDEFERIDO' : person.done ? 'OK' : 'PENDENTE';
    const copy = document.createElement('span');
    if (person.denied) {
      copy.textContent = `${person.role}: ${person.deniedBy || person.name} indeferiu · ${person.teamLabel}`;
    } else if (person.done) {
      copy.textContent = `${person.role}: ${person.signedBy || person.name} · ${person.teamLabel}`;
    } else if (person.missingCadastro) {
      copy.textContent = `${person.role}: aguardando cadastro · ${person.teamLabel}`;
    } else {
      copy.textContent = `${person.role}: ${person.name} · ${person.teamLabel}`;
    }
    item.append(mark, copy);
    list.appendChild(item);
  });
  container.appendChild(list);
}

function renderTimeline(doc) {
  if (!els.docTimeline) return;
  els.docTimeline.replaceChildren();
  const full = isDocumentAdminView();
  const done = stepCompletion(doc);
  const people = stepPeopleStatus(doc);
  const data = [
    { n: 1, done: done.step1, denied: false, title: 'Partes (2 envolvidos)', people: people.step1 },
    { n: 2, done: done.step2, denied: isStepDenied(doc, 2), title: 'Supervisores (2 equipes)', people: people.step2 },
    { n: 3, done: done.step3, denied: isStepDenied(doc, 3), title: 'Chefes de Operações (2 equipes)', people: people.step3 }
  ];
  data.forEach((step) => {
    const item = document.createElement('article');
    const isCurrent = !step.denied && ((!done.step1 && step.n === 1)
      || (done.step1 && !done.step2 && !isStepDenied(doc, 2) && step.n === 2)
      || (done.step1 && done.step2 && !done.step3 && !isStepDenied(doc, 3) && step.n === 3));
    item.className = `timeline-step ${step.denied ? 'is-denied' : step.done ? 'is-complete' : 'is-pending'}${isCurrent ? ' is-current' : ''}`;
    const icon = document.createElement('span');
    icon.className = 'timeline-check';
    icon.textContent = step.denied ? '✕' : step.done ? '✓' : String(step.n);
    const copy = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = `Passo ${step.n} · ${step.title}`;
    const small = document.createElement('small');
    small.textContent = step.denied
      ? 'Indeferido'
      : step.done
        ? (full ? 'Concluído — os 2 envolvidos assinaram.' : 'Concluído')
        : (full ? `Pendentes: ${formatPendingPeople(step.people) || 'aguardando'}` : 'Aguardando conclusão');
    copy.append(strong, small);
    if (full) appendPersonStatusList(copy, step.people);
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
  heading.textContent = `Passo 1 · ${partyKey === 'partyA' ? 'Solicitante' : 'Interessado'} — ${officerLine(pickIdentity(party || {}, party?.userKey || ''), party.warName || party.name)}`;
  const role = document.createElement('p');
  role.className = 'troca-message-from';
  role.textContent = `${party.name || ''} · Equipe ${party.team || '—'}`;
  block.append(heading, role);
  if (!appendSignedImage(block, party)) {
    const allowed = partyKey === 'partyA' && party.userKey === currentUserKey && doc.status === 'step1-requester';
    if (allowed) {
      const canvas = document.createElement('canvas');
      canvas.className = 'troca-signature-canvas';
      canvas.setAttribute('aria-label', `Assine aqui, ${officerLine(pickIdentity(party || {}, party?.userKey || ''), party.warName || party.name)}`);
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
      waiting.textContent = `PENDENTE: ${partyKey === 'partyA' ? 'Solicitante' : 'Interessado'} ${personLabel(party)} · Equipe ${party.team || '—'}.`;
      block.appendChild(waiting);
    }
  }
  els.docSignAreas.appendChild(block);
}

function canCurrentUserApprove(doc, role, team) {
  if (isDocDenied(doc)) return false;
  const key = role === 'supervisor' ? 'supervisors' : 'chiefs';
  const existing = doc?.approvals?.[key]?.[normalizeTeam(team)];
  if (existing?.signature || isApprovalDenied(existing)) return false;
  return userProfile(currentUser) === role && userTeam(currentUser) === team && (
    (role === 'supervisor' && doc.status === 'step2-supervisors') ||
    (role === 'operations-chief' && doc.status === 'step3-chiefs')
  );
}

function renderApprovalGroup(doc, role) {
  const isSupervisor = role === 'supervisor';
  const key = isSupervisor ? 'supervisors' : 'chiefs';
  const step = isSupervisor ? 2 : 3;
  const full = isDocumentAdminView();
  teamPair(doc).forEach((team) => {
    if (!full && !isOwnApprovalSlot(role, team)) return;
    const approval = doc?.approvals?.[key]?.[team];
    const block = document.createElement('section');
    block.className = 'troca-sign-block approval-sign-block';
    const heading = document.createElement('h3');
    heading.textContent = `Passo ${step} · ${isSupervisor ? 'Supervisor' : 'Chefe de Operações'} — Equipe ${team}`;
    block.appendChild(heading);
    if (isApprovalDenied(approval) || isStepDenied(doc, step)) {
      const denied = document.createElement('p');
      denied.className = 'troca-denied-copy';
      if (isApprovalDenied(approval)) {
        denied.textContent = `INDEFERIDO por ${officerLine(pickIdentity(approval, approval.userKey), approval.warName || approval.name)}${approval.denyReason ? ` · Motivo: ${approval.denyReason}` : ''}.`;
      } else {
        denied.textContent = `Este passo foi indeferido.`;
      }
      block.appendChild(denied);
    } else if (!appendSignedImage(block, approval)) {
      const availability = Number(doc?.approvalAvailability?.[role]?.[team] || 0);
      if (canCurrentUserApprove(doc, role, team)) {
        const ciente = document.createElement('p');
        ciente.className = 'approval-ciente-copy';
        ciente.textContent = 'Após o aceite das duas partes, você pode dar ciência e assinar ou indeferir este passo.';
        const canvas = document.createElement('canvas');
        canvas.className = 'troca-signature-canvas';
        block.append(ciente, canvas);
        const actions = document.createElement('div');
        actions.className = 'troca-message-actions';
        addAction(actions, 'Limpar', 'close', () => clearSignatureCanvas(canvas));
        addAction(actions, 'Ciente e assinar', 'accept', () => saveApprovalSignature(role, team, canvas));
        addAction(actions, 'Indeferir', 'remove', () => denyApproval(role, team));
        block.appendChild(actions);
        requestAnimationFrame(() => bindSignaturePad(canvas));
      } else {
        const waiting = document.createElement('p');
        waiting.className = 'troca-inbox-empty';
        waiting.textContent = availability === 0
          ? `PENDENTE: não há ${isSupervisor ? 'Supervisor' : 'Chefe de Operações'} ativo cadastrado na Equipe ${team} (${teamSideLabel(doc, team)}).`
          : `PENDENTE: ${isSupervisor ? 'Supervisor' : 'Chefe de Operações'} da ${teamSideLabel(doc, team)}.`;
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
  const full = isDocumentAdminView();
  const rows = [
    ['Dia solicitado', formatDateBr(doc.requestDate)],
    ['Dia da contraproposta', formatDateBr(doc.counterDate)],
    ['Equipes', `Equipe ${doc.fromTeam || '—'} ↔ Equipe ${doc.interestedTeam || '—'}`],
    ['Solicitante', personLabel(doc.partyA, '—')],
    ['Interessado', personLabel(doc.partyB, '—')],
    ['Status', doc.status === 'completed' ? 'OK' : isDocDenied(doc) ? 'INDEFERIDO' : 'PENDENTE'],
    [full ? 'Quem está pendente' : 'Andamento', viewerStepStatus(doc)]
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
  if (full || isOwnPartyBlock(doc, 'partyB')) renderPartyBlock(doc, 'partyB');
  if (full || isOwnPartyBlock(doc, 'partyA')) renderPartyBlock(doc, 'partyA');
  renderApprovalGroup(doc, 'supervisor');
  renderApprovalGroup(doc, 'operations-chief');
  openDocumentCache = doc;
  if (els.docPdfActions) els.docPdfActions.hidden = doc.status !== 'completed';
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
    if (
      [doc.partyA?.userKey, doc.partyB?.userKey].includes(currentUserKey)
      && isWithinFulfillmentWindow(doc.requestDate, doc.counterDate)
    ) {
      upsertPartyTracking(doc).catch((error) => console.warn('[CivilOff] tracking:', error));
    }
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
    await upsertPartyTracking(refreshed);
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
    if (isDocDenied(doc)) throw new Error('Esta troca já foi indeferida.');
    if (doc.approvals?.[approvalKey]?.[normalizedTeam]?.signature) {
      throw new Error('A ciência desta equipe já foi registrada.');
    }
    if (isApprovalDenied(doc.approvals?.[approvalKey]?.[normalizedTeam])) {
      throw new Error('Esta equipe já indeferiu este passo.');
    }

    const signature = exportSignature(canvas);
    const now = Date.now();
    const me = currentUserIdentity();
    const approvalRecord = {
      userKey: currentUserKey,
      name: me.name || currentUser.name || userDisplayName(currentUser),
      warName: me.warName || currentUser.warName || '',
      rank: me.rank || currentUser.rank || '',
      re: me.re || '',
      reMasked: me.reMasked || '',
      team: normalizedTeam,
      profile: role,
      decision: 'approved',
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
      await notifyInvolvedUsers(refreshed, {
        kind: 'completed-notice',
        noticeText: 'Passos 1, 2 e 3 concluídos. Status da troca: OK. Você já pode ver ou baixar o PDF.'
      });
    }
    await upsertPartyTracking(refreshed);
    renderDocument(refreshed);
    requestAnimationFrame(() => {
      els.docSignAreas?.querySelectorAll('canvas.troca-signature-canvas').forEach((item) => bindSignaturePad(item));
    });
    setStatus(els.docStatus, refreshed.status === 'completed'
      ? 'Passo 3 concluído. Todos os passos estão ticados e o status é OK.'
      : isSupervisor && refreshed.status === 'step3-chiefs'
        ? 'Passo 2 concluído. Chefes de Operações das duas equipes receberam a solicitação.'
        : `Ciência registrada. ${viewerStepStatus(refreshed)}`, 'success');
  } catch (error) {
    console.error(error);
    setStatus(els.docStatus, error.message || 'Não foi possível registrar a ciência.', 'error');
  }
}

async function involvedUserKeys(doc) {
  const keys = new Set([doc?.partyA?.userKey, doc?.partyB?.userKey].filter(Boolean));
  Object.values(doc?.approvals?.supervisors || {}).forEach((item) => {
    if (item?.userKey) keys.add(item.userKey);
  });
  Object.values(doc?.approvals?.chiefs || {}).forEach((item) => {
    if (item?.userKey) keys.add(item.userKey);
  });
  try {
    const teams = teamPair(doc);
    const [supervisors, chiefs] = await Promise.all([
      findApprovers('supervisor', teams),
      findApprovers('operations-chief', teams)
    ]);
    supervisors.forEach((item) => keys.add(item.userKey));
    chiefs.forEach((item) => keys.add(item.userKey));
  } catch (error) {
    console.warn('[CivilOff] envolvidos da troca:', error);
  }
  return [...keys];
}

async function notifyInvolvedUsers(doc, { kind, noticeText, extra = {} }) {
  const keys = await involvedUserKeys(doc);
  const writes = {};
  keys.forEach((userKey) => {
    pushInboxNotice(writes, userKey, {
      kind,
      requestId: doc.requestId,
      documentId: doc.requestId || openDocumentId,
      requestDate: doc.requestDate,
      counterDate: doc.counterDate,
      noticeText,
      ...extra
    });
  });
  if (Object.keys(writes).length) await update(ref(database), writes);
}

async function denyApproval(role, team) {
  if (!openDocumentId || !currentUserKey) return;
  const normalizedTeam = normalizeTeam(team);
  const isSupervisor = role === 'supervisor';
  const approvalKey = isSupervisor ? 'supervisors' : 'chiefs';
  const step = isSupervisor ? 2 : 3;
  const expectedStatus = isSupervisor ? 'step2-supervisors' : 'step3-chiefs';
  if (userProfile(currentUser) !== role || userTeam(currentUser) !== normalizedTeam) {
    setStatus(els.docStatus, 'Seu perfil/equipe não permite indeferir este passo.', 'error');
    return;
  }
  if (!window.confirm(`Indeferir esta troca no Passo ${step}? O andamento será encerrado neste passo.`)) {
    return;
  }
  const reason = window.prompt('Informe o motivo do indeferimento (opcional):') ?? '';
  setStatus(els.docStatus, `Registrando indeferimento do Passo ${step}…`, 'loading');
  try {
    const docRef = ref(database, `${TROCAS_DOCS_PATH}/${openDocumentId}`);
    const snap = await get(docRef);
    const doc = snap.val();
    if (!doc) throw new Error('Documento não encontrado.');
    if (doc.status !== expectedStatus) throw new Error('Esta etapa ainda não está liberada ou já foi encerrada.');
    if (isDocDenied(doc)) throw new Error('Esta troca já foi indeferida.');
    if (doc.approvals?.[approvalKey]?.[normalizedTeam]?.signature || isApprovalDenied(doc.approvals?.[approvalKey]?.[normalizedTeam])) {
      throw new Error('Este passo já foi decidido pela sua equipe.');
    }

    const now = Date.now();
    const me = currentUserIdentity();
    const deniedStatus = isSupervisor ? 'step2-denied' : 'step3-denied';
    const approvalRecord = {
      userKey: currentUserKey,
      name: me.name || currentUser.name || userDisplayName(currentUser),
      warName: me.warName || currentUser.warName || '',
      rank: me.rank || currentUser.rank || '',
      re: me.re || '',
      reMasked: me.reMasked || '',
      team: normalizedTeam,
      profile: role,
      decision: 'denied',
      status: 'denied',
      ciente: false,
      denyReason: String(reason || '').trim(),
      deniedAt: now
    };
    await update(ref(database), {
      [`${TROCAS_DOCS_PATH}/${openDocumentId}/approvals/${approvalKey}/${normalizedTeam}`]: approvalRecord,
      [`${TROCAS_DOCS_PATH}/${openDocumentId}/steps/step${step}`]: {
        ...(doc.steps?.[`step${step}`] || {}),
        status: 'denied',
        deniedAt: now,
        deniedBy: currentUserKey,
        deniedByName: me.warName || me.name || '',
        denyReason: String(reason || '').trim()
      },
      [`${TROCAS_DOCS_PATH}/${openDocumentId}/status`]: deniedStatus,
      [`${TROCAS_DOCS_PATH}/${openDocumentId}/overallStatus`]: 'INDEFERIDO',
      [`${TROCAS_DOCS_PATH}/${openDocumentId}/pendingStep`]: null,
      [`${TROCAS_DOCS_PATH}/${openDocumentId}/updatedAt`]: now,
      [`${TROCAS_REQUESTS_PATH}/${doc.requestId}/status`]: deniedStatus,
      [`${TROCAS_REQUESTS_PATH}/${doc.requestId}/pendingStep`]: null,
      [`${TROCAS_REQUESTS_PATH}/${doc.requestId}/updatedAt`]: serverTimestamp()
    });

    await closeApprovalMessagesForRole(openDocumentId, role);
    const refreshed = (await get(docRef)).val() || doc;
    await upsertPartyTracking(refreshed);
    await notifyInvolvedUsers(refreshed, {
      kind: 'denied-notice',
      noticeText: `${officerLine(me)} indeferiu o Passo ${step}${approvalRecord.denyReason ? ` · Motivo: ${approvalRecord.denyReason}` : ''}.`,
      extra: { deniedStep: step }
    });
    renderDocument(refreshed);
    setStatus(els.docStatus, `Passo ${step} indeferido. A troca foi encerrada neste passo.`, 'success');
  } catch (error) {
    console.error(error);
    setStatus(els.docStatus, error.message || 'Não foi possível indeferir este passo.', 'error');
  }
}

async function closeApprovalMessagesForRole(documentId, approvalRole) {
  await removeMessagesByPredicate((message) => (
    message?.documentId === documentId && message?.kind === 'approval-request' && message?.approvalRole === approvalRole
  ));
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

function canDownloadCompletedPdf(doc) {
  return Boolean(doc && doc.status === 'completed' && canViewDocument(doc));
}

async function loadDocumentById(documentId) {
  if (!documentId) return null;
  if (openDocumentCache && (openDocumentCache.requestId === documentId || openDocumentCache.id === documentId)) {
    return openDocumentCache;
  }
  if (myDocsCache[documentId]) return { id: documentId, ...myDocsCache[documentId] };
  if (adminDocsCache[documentId]) return { id: documentId, ...adminDocsCache[documentId] };
  const snapshot = await get(ref(database, `${TROCAS_DOCS_PATH}/${documentId}`));
  const doc = snapshot.val();
  return doc ? { id: documentId, ...doc } : null;
}

async function buildDocumentPdf(doc) {
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
    `Status: ${doc.status === 'completed' ? 'OK — 3 passos concluídos' : isDocDenied(doc) ? `INDEFERIDO — ${publicStepStatus(doc)}` : pendingDetail(doc)}`,
    `Dia solicitado: ${formatDateBr(doc.requestDate)}`,
    `Dia da contraproposta: ${formatDateBr(doc.counterDate)}`,
    `Solicitante: ${officerLine(requesterIdentity(doc), doc.partyA?.name || '—')} — Equipe ${doc.fromTeam || '—'}`,
    `Interessado: ${officerLine(proposerIdentity(doc), doc.partyB?.name || '—')} — Equipe ${doc.interestedTeam || '—'}`
  ];
  lines.forEach((line) => { pdf.text(line, margin, y); y += 6; });
  y += 4;
  const addSignature = (label, signer) => {
    pdf.setFont('helvetica', 'bold');
    const denied = isApprovalDenied(signer);
    pdf.text(`${label}: ${denied ? `INDEFERIDO — ${officerLine(pickIdentity(signer || {}, signer?.userKey || ''), signer?.name || signer?.warName || '—')}` : officerLine(pickIdentity(signer || {}, signer?.userKey || ''), signer?.name || signer?.warName || 'Pendente')}`, margin, y);
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
  return pdf;
}

async function handleViewPdf(documentId) {
  try {
    const doc = await loadDocumentById(documentId);
    if (!canDownloadCompletedPdf(doc)) {
      window.alert('O PDF fica disponível para os envolvidos após a conclusão dos 3 passos.');
      return;
    }
    const pdf = await buildDocumentPdf(doc);
    const url = URL.createObjectURL(pdf.output('blob'));
    window.open(url, '_blank', 'noopener');
  } catch (error) {
    console.error(error);
    window.alert(error.message || 'Não foi possível abrir o PDF.');
  }
}

async function handleDownloadPdf(documentId) {
  try {
    const doc = typeof documentId === 'string' ? await loadDocumentById(documentId) : documentId;
    await downloadDocumentPdf(doc);
  } catch (error) {
    console.error(error);
    window.alert(error.message || 'Não foi possível baixar o PDF.');
  }
}

async function downloadDocumentPdf(doc) {
  if (!doc) return;
  if (!canDownloadCompletedPdf(doc)) {
    window.alert('O PDF fica disponível para os envolvidos após a conclusão dos 3 passos.');
    return;
  }
  try {
    const pdf = await buildDocumentPdf(doc);
    pdf.save(`troca_${String(doc.requestDate || '').replace(/-/g, '')}_${String(doc.counterDate || '').replace(/-/g, '')}.pdf`);
  } catch (error) {
    console.error(error);
    window.alert(error.message || 'Não foi possível gerar o PDF.');
  }
}

async function handleClose(message) {
  if (!currentUserKey || !message?.id) return;
  if (message.kind === 'troca-tracking' && isWithinFulfillmentWindow(message.requestDate, message.counterDate)) {
    window.alert('Esta troca permanece disponível para as partes até as datas de cumprimento, com o status atual.');
    return;
  }
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

function refreshTeamChoices(selectedTeams = []) {
  const mine = userTeam(currentUser);
  const selected = new Set((selectedTeams || []).map(normalizeTeam).filter(Boolean));
  els.teamChoices?.querySelectorAll('input[name="targetTeam"]').forEach((input) => {
    input.disabled = input.value === mine;
    input.checked = selected.has(input.value) && !input.disabled;
    input.closest('label')?.classList.toggle('is-disabled', input.disabled);
  });
}

function resetRequestDialogMode() {
  editingRequestId = '';
  if (els.requestTitle) els.requestTitle.textContent = 'Solicitar troca';
  if (els.requestIntro) {
    els.requestIntro.textContent = 'Escolha um dos seus dias de serviço e uma ou mais equipes que poderão receber o pedido.';
  }
  if (els.requestSubmit) els.requestSubmit.textContent = 'Enviar pedido';
}

function prepareRequestDialog({ requestId = '', requestDate = '', targetTeams = [] } = {}) {
  const mine = userTeam(currentUser);
  if (userProfile(currentUser) !== 'dispatcher') {
    window.alert('Somente Despachadores podem solicitar troca. Supervisores e Chefes de Operações atuam nas etapas de ciência.');
    return false;
  }
  if (!mine) {
    window.alert('Seu usuário ainda não possui equipe A–E. Peça ao administrador para vincular sua equipe.');
    return false;
  }
  editingRequestId = requestId || '';
  setStatus(els.requestStatus);
  if (els.requestDate) els.requestDate.value = requestDate || '';
  if (requestDate) {
    const selected = fromLocalISO(requestDate);
    requestVisibleMonth = selected
      ? new Date(selected.getFullYear(), selected.getMonth(), 1, 12)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
    if (els.requestSelectedDate) {
      els.requestSelectedDate.textContent = `Selecionado: ${formatDateBr(requestDate)} · Equipe ${mine} em serviço.`;
    }
  } else {
    requestVisibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
    if (els.requestSelectedDate) {
      els.requestSelectedDate.textContent = `Selecione um dia iluminado. Somente a Equipe ${mine} em serviço.`;
    }
  }
  if (editingRequestId) {
    if (els.requestTitle) els.requestTitle.textContent = 'Editar pedido de troca';
    if (els.requestIntro) {
      els.requestIntro.textContent = 'Altere o dia ou as equipes de destino. Isso só é possível enquanto você não aceitar nenhuma contraproposta.';
    }
    if (els.requestSubmit) els.requestSubmit.textContent = 'Salvar alterações';
  } else {
    resetRequestDialogMode();
  }
  refreshTeamChoices(targetTeams);
  renderRequestCalendar();
  return true;
}

function openRequestDialog() {
  if (!els.requestDialog) return;
  if (!prepareRequestDialog()) return;
  els.requestDialog.showModal();
}

function openRequestDialogForEdit(request) {
  if (!els.requestDialog) return;
  if (!isRequestStillEditable(request)) {
    window.alert('Não é possível editar depois de aceitar uma contraproposta. Somente o administrador pode excluir.');
    return;
  }
  if (!prepareRequestDialog({
    requestId: request.id || request.requestId,
    requestDate: request.requestDate || '',
    targetTeams: request.targetTeams || []
  })) return;
  els.requestDialog.showModal();
}

function openInboxDialog() {
  if (!els.inboxDialog) return;
  renderInboxPanel();
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
  setStatus(els.requestStatus, editingRequestId ? 'Salvando alterações…' : 'Enviando solicitação…', 'loading');
  try {
    const result = editingRequestId
      ? await updateOpenTrocaRequest(editingRequestId, requestDate, teams)
      : await createTrocaRequest(requestDate, teams);
    const prefix = editingRequestId ? 'Pedido atualizado' : 'Pedido enviado';
    setStatus(els.requestStatus, `${prefix} para ${result.recipientCount} Despachador(es) de ${targetTeamText(result.teams)}.`, 'success');
    window.setTimeout(() => {
      els.requestDialog?.close();
      setStatus(els.requestStatus);
    }, 1200);
  } catch (error) {
    console.error(error);
    setStatus(els.requestStatus, error.message || (editingRequestId ? 'Não foi possível salvar as alterações.' : 'Não foi possível enviar a solicitação.'), 'error');
  }
}

function bindEvents() {
  els.trocaButton?.addEventListener('click', openRequestDialog);
  els.inboxButton?.addEventListener('click', openInboxDialog);
  els.cancelRequest?.addEventListener('click', () => els.requestDialog?.close());
  els.requestDialog?.addEventListener('close', () => {
    resetRequestDialogMode();
    setStatus(els.requestStatus);
  });
  els.closeInbox?.addEventListener('click', () => els.inboxDialog?.close());
  els.closeDoc?.addEventListener('click', () => els.docDialog?.close());
  els.viewPdf?.addEventListener('click', () => handleViewPdf(openDocumentId || openDocumentCache?.requestId || openDocumentCache?.id));
  els.downloadPdf?.addEventListener('click', () => handleDownloadPdf(openDocumentId || openDocumentCache?.requestId || openDocumentCache?.id));
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
  subscribeUsersDirectory();
  subscribeInbox();
  subscribeAdminRequests();
});

bindEvents();
updateVisibility();
