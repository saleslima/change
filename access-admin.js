import {
  get,
  onValue,
  ref,
  serverTimestamp,
  set,
  update
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';
import { database, firebaseConfig } from './firebase-config.js';

'use strict';

// Caminhos no root do RTDB (fáceis de ver no console do Firebase)
const DATABASE_ROOT = 'civiloff/v1';
const USERS_PATH = `${DATABASE_ROOT}/users`;
const EMAIL_INDEX_PATH = `${DATABASE_ROOT}/emailIndex`;
const META_PATH = 'civiloff/meta';
const SESSION_KEY = 'civilOffAccessSession:v1';
const PBKDF2_ITERATIONS = 120000;
const INITIAL_ADMIN = Object.freeze({
  name: 'Sales',
  cpf: '22509781820',
  email: 'stqcopomsp@gmail.com',
  password: '101010',
  profile: 'admin',
  shiftId: '',
  team: ''
});

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

const PROFILE_LABELS = Object.freeze({
  dispatcher: 'Despachador',
  supervisor: 'Supervisor',
  'operations-chief': 'Chefe de Operações',
  admin: 'Administração',
  common: 'Despachador'
});

const PROFILE_BY_RANK = Object.freeze({
  SD_PM: 'dispatcher',
  CB_PM: 'dispatcher',
  '3SGT_PM': 'supervisor',
  '2SGT_PM': 'supervisor',
  '1SGT_PM': 'supervisor',
  SUBTEN_PM: 'supervisor',
  '2TEN_PM': 'operations-chief',
  '1TEN_PM': 'operations-chief',
  CAP_PM: 'operations-chief'
});

const encoder = new TextEncoder();

const elements = {
  authScreen: document.querySelector('#authScreen'),
  authLoading: document.querySelector('#authLoading'),
  loginPanel: document.querySelector('#loginPanel'),
  loginForm: document.querySelector('#loginForm'),
  loginCpf: document.querySelector('#loginCpf'),
  loginPassword: document.querySelector('#loginPassword'),
  loginStatus: document.querySelector('#loginStatus'),
  forgotPasswordButton: document.querySelector('#forgotPasswordButton'),
  appShell: document.querySelector('#appShell'),
  sessionBar: document.querySelector('#sessionBar'),
  currentUserName: document.querySelector('#currentUserName'),
  currentUserMeta: document.querySelector('#currentUserMeta'),
  adminButton: document.querySelector('#adminButton'),
  logoutButton: document.querySelector('#logoutButton'),
  forgotPasswordDialog: document.querySelector('#forgotPasswordDialog'),
  forgotPasswordForm: document.querySelector('#forgotPasswordForm'),
  forgotEmail: document.querySelector('#forgotEmail'),
  forgotStatus: document.querySelector('#forgotStatus'),
  cancelForgotPassword: document.querySelector('#cancelForgotPassword'),
  adminDialog: document.querySelector('#adminDialog'),
  closeAdminButton: document.querySelector('#closeAdminButton'),
  adminTabs: Array.from(document.querySelectorAll('[data-admin-tab]')),
  adminPanels: Array.from(document.querySelectorAll('[data-admin-panel]')),
  emailConfigNotice: document.querySelector('#emailConfigNotice'),
  userForm: document.querySelector('#userForm'),
  userName: document.querySelector('#userName'),
  userWarName: document.querySelector('#userWarName'),
  userRank: document.querySelector('#userRank'),
  userRe: document.querySelector('#userRe'),
  userEmail: document.querySelector('#userEmail'),
  userShift: document.querySelector('#userShift'),
  userCpaBlock: document.querySelector('#userCpaBlock'),
  userCpa: document.querySelector('#userCpa'),
  userProfile: document.querySelector('#userProfile'),
  profileRuleHint: document.querySelector('#profileRuleHint'),
  userFormStatus: document.querySelector('#userFormStatus'),
  userList: document.querySelector('#userList'),
  userCountAdmin: document.querySelector('#userCountAdmin')
};

let currentUser = null;
let currentUserKey = '';
let usersCache = {};
let unsubscribeUsers = null;
let usersLoaded = false;
let initializing = true;

function normalizeCpf(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 11);
}

function formatCpf(value) {
  const digits = normalizeCpf(value);
  return digits
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}

function isValidCpf(value) {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split('').map(Number);
  for (let position = 9; position <= 10; position += 1) {
    let sum = 0;
    for (let index = 0; index < position; index += 1) {
      sum += digits[index] * (position + 1 - index);
    }
    let verifier = (sum * 10) % 11;
    if (verifier === 10) verifier = 0;
    if (digits[position] !== verifier) return false;
  }
  return true;
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

function isValidRe(value) {
  return /^\d{6}[0-9AB]$/.test(normalizeRe(value));
}

function rankLabel(rank) {
  return RANK_LABELS[rank] || (rank === 'ADMIN' ? 'Administrador' : rank || 'Posto/graduação não informado');
}

function allowedProfileForRank(rank) {
  return PROFILE_BY_RANK[rank] || '';
}

function rankAllowsCpa(rank) {
  return ['SD_PM', 'CB_PM', '3SGT_PM', '2SGT_PM', '1SGT_PM', 'SUBTEN_PM'].includes(rank);
}

function clearCpaFields() {
  if (elements.userCpa) elements.userCpa.value = '';
}

function refreshCpaVisibility() {
  const allowed = rankAllowsCpa(elements.userRank?.value || '');
  if (elements.userCpaBlock) elements.userCpaBlock.hidden = !allowed;
  if (elements.userCpa) elements.userCpa.required = allowed;
  if (!allowed) clearCpaFields();
}

function userIdentifier(user) {
  if (isValidRe(user?.re)) return { type: 're', raw: normalizeRe(user.re), masked: user.reMasked || formatRe(user.re) };
  const cpf = normalizeCpf(user?.cpf);
  if (isValidCpf(cpf)) return { type: 'cpf', raw: cpf, masked: user.cpfMasked || formatCpf(cpf) };
  return { type: '', raw: '', masked: 'Sem identificador' };
}

async function userStorageKey(user) {
  const identifier = userIdentifier(user);
  if (identifier.type === 're') return sha256(`re:${identifier.raw}`);
  if (identifier.type === 'cpf') return sha256(identifier.raw);
  throw new Error('Usuário sem RE/CPF válido.');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLocaleLowerCase('pt-BR');
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(normalizeEmail(value));
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return bytesToHex(new Uint8Array(digest));
}

function createSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes);
}

async function derivePasswordHash(password, saltBase64, iterations = PBKDF2_ITERATIONS) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(password)),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: base64ToBytes(saltBase64),
    iterations: Number(iterations) || PBKDF2_ITERATIONS
  }, keyMaterial, 256);
  return bytesToHex(new Uint8Array(bits));
}

async function createPasswordCredential(password) {
  const normalized = normalizePassword(password);
  const salt = createSalt();
  const credential = {
    passwordSalt: salt,
    passwordHash: await derivePasswordHash(normalized, salt, PBKDF2_ITERATIONS),
    passwordIterations: PBKDF2_ITERATIONS
  };
  // Garante que a senha gerada realmente valida antes de gravar/enviar.
  if (!(await verifyPassword(normalized, credential))) {
    throw new Error('Falha interna ao gerar credencial de senha.');
  }
  return credential;
}

async function verifyPassword(password, user) {
  if (!user?.passwordSalt || !user?.passwordHash) return false;
  const normalized = normalizePassword(password);
  if (!/^\d{6}$/.test(normalized)) return false;
  const calculated = await derivePasswordHash(
    normalized,
    user.passwordSalt,
    user.passwordIterations || PBKDF2_ITERATIONS
  );
  return calculated === String(user.passwordHash || '').toLowerCase();
}

function normalizePassword(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

function generateSixDigitPassword() {
  // Evita zero à esquerda (ex.: 012345), que costuma ser perdido no e-mail/cópia.
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(100000 + (values[0] % 900000));
}

/**
 * Gera UMA senha, grava o hash no Firebase e só devolve se a senha
 * conferir com o registro salvo. Essa mesma string vai para e-mail e tela.
 * mode: 'create' | 'replace'
 */
async function issueAccessPassword(userKey, { mode, userRecord, previousCredential } = {}) {
  const password = generateSixDigitPassword();
  const credential = await createPasswordCredential(password);

  if (mode === 'create') {
    const record = {
      ...userRecord,
      passwordSalt: credential.passwordSalt,
      passwordHash: credential.passwordHash,
      passwordIterations: credential.passwordIterations,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    Object.keys(record).forEach((key) => {
      if (record[key] === undefined) delete record[key];
    });
    await set(ref(database, `${USERS_PATH}/${userKey}`), record);
  } else {
    await update(ref(database, `${USERS_PATH}/${userKey}`), {
      passwordSalt: credential.passwordSalt,
      passwordHash: credential.passwordHash,
      passwordIterations: credential.passwordIterations,
      updatedAt: serverTimestamp(),
      passwordChangedAt: serverTimestamp()
    });
  }

  const savedUser = (await get(ref(database, `${USERS_PATH}/${userKey}`))).val();
  if (!savedUser || !(await verifyPassword(password, savedUser))) {
    if (mode === 'replace' && previousCredential) {
      try {
        await update(ref(database, `${USERS_PATH}/${userKey}`), {
          ...previousCredential,
          updatedAt: serverTimestamp()
        });
      } catch (rollbackError) {
        console.error('Falha ao restaurar senha após inconsistência:', rollbackError);
      }
    }
    const error = new Error('A senha gravada no Firebase não confere com a senha gerada.');
    error.code = 'PASSWORD_MISMATCH';
    throw error;
  }

  return { password, savedUser };
}

function setStatus(element, message = '', type = '') {
  if (!element) return;
  element.textContent = message;
  element.dataset.type = type;
  element.hidden = !message;
}

function setBusy(form, busy) {
  if (!form) return;
  Array.from(form.elements).forEach((field) => {
    field.disabled = Boolean(busy);
  });
  form.setAttribute('aria-busy', String(Boolean(busy)));
}

function getEmailConfig() {
  return window.CIVILOFF_EMAIL_CONFIG || {};
}

function isEmailConfigured() {
  const config = getEmailConfig();
  return Boolean(config.publicKey && config.serviceId && config.templateId && config.endpoint);
}

function buildPasswordEmailContent({ user, password, purpose }) {
  const identifier = userIdentifier(user);
  const profile = profileLabel(user.profile);
  const teamText = teamLabel(userTeam(user));
  const config = getEmailConfig();
  const senderEmail = config.fromAddress || config.senderEmail || 'stqcopomsp@gmail.com';
  const fromName = config.fromName || 'CivilOff';
  const subject = `${purpose} — CivilOff`;
  const loginLabel = identifier.type === 're' ? 'RE' : 'CPF';
  const message = [
    `Olá, ${user.warName || user.name}.`,
    '',
    `Seu acesso ao CivilOff foi ${purpose === 'Cadastro de usuário' ? 'criado' : 'atualizado'}.`,
    `${loginLabel}: ${identifier.masked}`,
    `SENHA DE ACESSO: ${password}`,
    `Posto/graduação: ${rankLabel(user.rank)}`,
    `Perfil: ${profile}`,
    `Equipe: ${teamText}`,
    '',
    `Use seu ${loginLabel} e a senha acima para entrar no sistema.`,
    'Por segurança, não compartilhe esta senha.',
    '',
    `— ${fromName}`
  ].join('\n');

  const templateParams = {
    to_email: user.email,
    email: user.email,
    recipient_email: user.email,
    user_email: user.email,
    to: user.email,
    to_name: user.warName || user.name,
    name: user.name,
    user_name: user.name,
    from_name: fromName,
    password: String(password),
    passcode: String(password),
    code: String(password),
    senha: String(password),
    re: user.reMasked || formatRe(user.re),
    user_re: user.reMasked || formatRe(user.re),
    cpf: user.cpfMasked || formatCpf(user.cpf),
    user_cpf: user.cpfMasked || formatCpf(user.cpf),
    profile,
    perfil: profile,
    rank: rankLabel(user.rank),
    posto_graduacao: rankLabel(user.rank),
    team: teamText,
    equipe: teamText,
    purpose,
    app_name: 'CivilOff',
    from_email: senderEmail,
    reply_to: senderEmail,
    subject,
    title: subject,
    message
  };

  return { subject, message, senderEmail, fromName, identifier, templateParams };
}

async function sendPasswordEmailViaSdk(config, templateParams) {
  const emailjs = window.emailjs;
  if (!emailjs || typeof emailjs.send !== 'function') return null;

  if (typeof emailjs.init === 'function') {
    emailjs.init({
      publicKey: config.publicKey,
      ...(config.privateKey ? { privateKey: config.privateKey } : {})
    });
  }

  const options = { publicKey: config.publicKey };
  if (config.privateKey) options.privateKey = config.privateKey;
  if (config.accessToken) options.privateKey = config.accessToken;

  try {
    const result = await emailjs.send(
      config.serviceId,
      config.templateId,
      templateParams,
      options
    );
    return { ok: true, detail: result?.text || 'OK', via: 'sdk' };
  } catch (error) {
    const normalized = new Error(
      `Falha no envio do e-mail${error?.text ? `: ${error.text}` : error?.message ? `: ${error.message}` : '.'}`
    );
    normalized.code = 'EMAIL_SEND_FAILED';
    normalized.detail = error?.text || error?.message || '';
    normalized.status = error?.status;
    throw normalized;
  }
}

async function sendPasswordEmailViaFetch(config, templateParams) {
  const payload = {
    service_id: config.serviceId,
    template_id: config.templateId,
    user_id: config.publicKey,
    template_params: templateParams
  };
  if (config.privateKey || config.accessToken) {
    payload.accessToken = config.privateKey || config.accessToken;
  }

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const detail = await response.text().catch(() => '');
  if (!response.ok) {
    const error = new Error(`Falha no envio do e-mail${detail ? `: ${detail}` : '.'}`);
    error.code = 'EMAIL_SEND_FAILED';
    error.detail = detail;
    throw error;
  }

  return { ok: true, detail: detail || 'OK', via: 'fetch' };
}

async function sendPasswordEmailViaFormSubmit({ to, subject, message, replyTo }) {
  const response = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(to)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      name: 'CivilOff',
      email: replyTo || 'noreply@civiloff.app',
      _replyto: replyTo || '',
      _subject: subject,
      message,
      _template: 'table',
      _captcha: 'false'
    })
  });

  const raw = await response.text().catch(() => '');
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { message: raw };
  }

  const failed = !response.ok
    || data.success === false
    || data.success === 'false';
  if (failed) {
    const error = new Error(`Falha no FormSubmit${data.message ? `: ${data.message}` : raw ? `: ${raw}` : '.'}`);
    error.code = 'EMAIL_SEND_FAILED';
    error.detail = data.message || raw;
    throw error;
  }

  return { ok: true, detail: data.message || 'OK', via: 'formsubmit' };
}

async function sendPasswordEmail({ user, password, purpose }) {
  const config = getEmailConfig();
  const recipient = normalizeEmail(user?.email);
  if (!isValidEmail(recipient)) {
    const error = new Error('E-mail do usuário inválido para envio da senha.');
    error.code = 'EMAIL_INVALID';
    throw error;
  }

  const accessPassword = normalizePassword(password);
  if (!/^\d{6}$/.test(accessPassword)) {
    const error = new Error('Senha inválida para envio.');
    error.code = 'EMAIL_INVALID';
    throw error;
  }

  // Confere de novo contra o que está no banco antes de enviar o e-mail.
  const userKey = await userStorageKey(user);
  const savedSnap = await get(ref(database, `${USERS_PATH}/${userKey}`));
  const savedUser = savedSnap.val();
  if (!savedUser || !(await verifyPassword(accessPassword, savedUser))) {
    const error = new Error('A senha não confere com o hash gravado no Firebase. Nada foi enviado por e-mail.');
    error.code = 'PASSWORD_MISMATCH';
    throw error;
  }

  const { subject, message, senderEmail, fromName } = buildPasswordEmailContent({
    user: { ...savedUser, email: recipient },
    password: accessPassword,
    purpose
  });

  // A senha do e-mail é sempre accessPassword (já validada no banco).
  const emailPayload = {
    to_email: recipient,
    email: recipient,
    user_email: recipient,
    to_name: savedUser.name || user.name || '',
    name: savedUser.name || user.name || '',
    from_name: fromName,
    subject,
    title: subject,
    message,
    reply_to: senderEmail,
    from_email: senderEmail,
    app_name: 'CivilOff',
    purpose,
    password: accessPassword,
    passcode: accessPassword,
    senha: accessPassword,
    code: accessPassword
  };

  const successes = [];
  const failures = [];

  // Um único canal por vez evita dois e-mails com conteúdos diferentes.
  try {
    successes.push(await sendPasswordEmailViaFormSubmit({
      to: recipient,
      subject,
      message,
      replyTo: senderEmail
    }));
  } catch (error) {
    console.warn('FormSubmit falhou:', error);
    failures.push(error);
  }

  if (!successes.length && isEmailConfigured()) {
    try {
      const sdkResult = await sendPasswordEmailViaSdk(config, emailPayload);
      if (sdkResult?.ok) {
        successes.push(sdkResult);
      } else {
        successes.push(await sendPasswordEmailViaFetch(config, emailPayload));
      }
    } catch (sdkError) {
      console.warn('EmailJS SDK falhou, tentando API REST…', sdkError);
      try {
        successes.push(await sendPasswordEmailViaFetch(config, emailPayload));
      } catch (fetchError) {
        console.warn('EmailJS REST falhou:', fetchError);
        failures.push(fetchError);
      }
    }
  }

  if (!successes.length) {
    const error = failures[0] || new Error('Não foi possível enviar a senha por e-mail.');
    error.code = error.code || 'EMAIL_SEND_FAILED';
    throw error;
  }

  return { ok: true, via: successes.map((item) => item.via).join('+'), detail: successes[0].detail, password: accessPassword };
}

function describeEmailError(error) {
  if (!error) return 'Não foi possível enviar a senha por e-mail.';
  if (error.code === 'EMAIL_NOT_CONFIGURED') {
    return 'Configure o EmailJS em email-config.js.';
  }
  if (error.code === 'EMAIL_INVALID') {
    return 'Informe um e-mail válido para receber a senha.';
  }
  if (error.code === 'PASSWORD_MISMATCH') {
    return 'Inconsistência entre senha e banco. Gere uma nova senha pelo admin.';
  }
  const detail = String(error.detail || error.text || error.message || '').toLowerCase();
  if (detail.includes('recipient') || detail.includes('address is empty')) {
    return 'Falha no EmailJS: no template, o campo "To Email" deve ser {{to_email}} (ou {{email}}).';
  }
  if (detail.includes('rate') || detail.includes('too many')) {
    return 'Limite de envio atingido. Aguarde alguns segundos e tente novamente.';
  }
  if (detail.includes('template')) {
    return 'Template do EmailJS inválido ou não encontrado. Verifique templateId.';
  }
  if (detail.includes('service')) {
    return 'Serviço do EmailJS inválido. Verifique serviceId e a conexão do Gmail.';
  }
  if (detail.includes('confirm') || detail.includes('activate') || detail.includes('activation')) {
    return 'O destinatário precisa confirmar o primeiro e-mail (FormSubmit). Depois use "Nova senha".';
  }
  return 'Não foi possível enviar a senha por e-mail. Verifique a conexão e tente novamente.';
}

function profileLabel(profile) {
  return PROFILE_LABELS[profile] || 'Despachador';
}

function normalizeTeam(value) {
  const team = String(value || '').trim().toUpperCase();
  return ['A', 'B', 'C', 'D', 'E'].includes(team) ? team : '';
}

function userTeam(user) {
  return normalizeTeam(user?.team) || normalizeTeam(user?.shiftId);
}

function teamLabel(team) {
  const normalized = normalizeTeam(team);
  return normalized ? `Equipe ${normalized}` : 'Sem equipe';
}

function normalizeCpa(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'ESPECIAL') return 'ESPECIAL';
  const match = raw.match(/^M-?(\d{1,2})$/);
  if (!match) return '';
  const num = Number(match[1]);
  if (num < 1 || num > 12) return '';
  return `M-${String(num).padStart(2, '0')}`;
}

function cpaLabel(cpa) {
  const normalized = normalizeCpa(cpa);
  if (!normalized) return '';
  return normalized === 'ESPECIAL' ? 'Especial' : normalized;
}

function updateSessionBar() {
  if (!currentUser) return;
  elements.currentUserName.textContent = currentUser.warName || currentUser.name;
  elements.currentUserMeta.textContent = `${rankLabel(currentUser.rank)} • ${profileLabel(currentUser.profile)} • ${teamLabel(userTeam(currentUser))}`;
  elements.adminButton.hidden = currentUser.profile !== 'admin';
}

function showLogin() {
  currentUser = null;
  currentUserKey = '';
  sessionStorage.removeItem(SESSION_KEY);
  elements.appShell.hidden = true;
  elements.authScreen.hidden = false;
  elements.authLoading.hidden = true;
  elements.loginPanel.hidden = false;
  elements.loginForm.reset();
  setStatus(elements.loginStatus);
  elements.loginCpf.focus();
  if (unsubscribeUsers) {
    unsubscribeUsers();
    unsubscribeUsers = null;
    usersLoaded = false;
  }
  document.dispatchEvent(new CustomEvent('civiloff:authchange', {
    detail: { userKey: '', user: null }
  }));
}

function showApp(userKey, user) {
  currentUserKey = userKey;
  currentUser = user;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userKey }));
  elements.authScreen.hidden = true;
  elements.appShell.hidden = false;
  elements.sessionBar.hidden = false;
  updateSessionBar();
  document.dispatchEvent(new CustomEvent('civiloff:authchange', {
    detail: { userKey, user: { ...user } }
  }));
}

async function restoreSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (!saved?.userKey || !/^[a-f0-9]{64}$/.test(saved.userKey)) return false;
    const snapshot = await get(ref(database, `${USERS_PATH}/${saved.userKey}`));
    const user = snapshot.val();
    if (!user || user.active === false) return false;
    showApp(saved.userKey, user);
    return true;
  } catch {
    return false;
  }
}

async function ensureDatabaseReady() {
  const bootRef = ref(database, `${META_PATH}/lastBoot`);
  const marker = `boot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await set(bootRef, {
    marker,
    projectId: firebaseConfig.projectId,
    databaseURL: firebaseConfig.databaseURL,
    at: serverTimestamp()
  });

  const verify = await get(bootRef);
  const saved = verify.val();
  if (!verify.exists() || saved?.marker !== marker) {
    const error = new Error(
      `Firebase não gravou dados em ${firebaseConfig.projectId}. Publique as regras do Realtime Database e confira a databaseURL.`
    );
    error.code = 'WRITE_NOT_CONFIRMED';
    throw error;
  }
}

async function seedInitialData() {
  await ensureDatabaseReady();

  const adminKey = await sha256(INITIAL_ADMIN.cpf);
  const adminEmailKey = await sha256(INITIAL_ADMIN.email);
  const adminRef = ref(database, `${USERS_PATH}/${adminKey}`);
  const adminSnap = await get(adminRef);

  if (!adminSnap.exists()) {
    const credential = await createPasswordCredential(INITIAL_ADMIN.password);
    const adminRecord = {
      name: INITIAL_ADMIN.name,
      warName: INITIAL_ADMIN.name,
      rank: 'ADMIN',
      cpf: INITIAL_ADMIN.cpf,
      cpfMasked: formatCpf(INITIAL_ADMIN.cpf),
      email: INITIAL_ADMIN.email,
      emailNormalized: INITIAL_ADMIN.email,
      profile: INITIAL_ADMIN.profile,
      shiftId: INITIAL_ADMIN.shiftId || null,
      active: true,
      ...credential,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    await set(adminRef, adminRecord);

    const confirmAdmin = await get(adminRef);
    if (!confirmAdmin.exists()) {
      const error = new Error('Falha ao gravar o administrador inicial no Firebase.');
      error.code = 'WRITE_NOT_CONFIRMED';
      throw error;
    }
  }

  const emailIndexRef = ref(database, `${EMAIL_INDEX_PATH}/${adminEmailKey}`);
  const emailIndexSnap = await get(emailIndexRef);
  if (!emailIndexSnap.exists()) {
    await set(emailIndexRef, adminKey);
  }

  await update(ref(database), {
    [`${META_PATH}/seededAt`]: serverTimestamp(),
    [`${META_PATH}/projectId`]: firebaseConfig.projectId
  });
}

function bindCpfMask(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    const formatted = formatCpf(input.value);
    if (input.value !== formatted) input.value = formatted;
  });
  input.addEventListener('paste', (event) => {
    const text = event.clipboardData?.getData('text') || '';
    if (!text) return;
    event.preventDefault();
    input.value = formatCpf(text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function bindLoginIdentifier(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    let value = String(input.value || '').toUpperCase().replace(/[^0-9AB.\-]/g, '');
    if (/[AB]/.test(value)) value = formatRe(value);
    else if (value.replace(/\D/g, '').length >= 9) value = formatCpf(value);
    input.value = value.slice(0, 14);
  });
}

function bindReMask(input) {
  if (!input) return;
  const apply = () => {
    const formatted = formatRe(input.value);
    if (input.value !== formatted) input.value = formatted;
  };
  input.addEventListener('input', apply);
  input.addEventListener('paste', (event) => {
    const text = event.clipboardData?.getData('text') || '';
    if (!text) return;
    event.preventDefault();
    input.value = formatRe(text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function handleLogin(event) {
  event.preventDefault();
  setStatus(elements.loginStatus);
  const typed = String(elements.loginCpf.value || '').trim();
  const reValue = normalizeRe(typed);
  const cpf = normalizeCpf(typed);
  const isRe = isValidRe(reValue) && (typed.includes('-') || typed.length <= 8 || /[AB]/i.test(typed));
  const isCpf = isValidCpf(cpf);
  const password = normalizePassword(elements.loginPassword.value);

  if (!isRe && !isCpf) {
    setStatus(elements.loginStatus, 'Informe um RE válido no formato 000000-0.', 'error');
    elements.loginCpf.focus();
    return;
  }
  if (!/^\d{6}$/.test(password)) {
    setStatus(elements.loginStatus, 'A senha deve conter exatamente 6 números.', 'error');
    elements.loginPassword.focus();
    return;
  }

  elements.loginPassword.value = password;
  setBusy(elements.loginForm, true);
  setStatus(elements.loginStatus, 'Validando acesso…', 'loading');
  try {
    const candidateKeys = [];
    if (isRe) candidateKeys.push(await sha256(`re:${reValue}`), await sha256(reValue));
    if (isCpf) candidateKeys.push(await sha256(cpf));
    let userKey = '';
    let user = null;
    for (const key of [...new Set(candidateKeys)]) {
      const snapshot = await get(ref(database, `${USERS_PATH}/${key}`));
      const candidate = snapshot.val();
      if (candidate && candidate.active !== false && await verifyPassword(password, candidate)) {
        userKey = key;
        user = candidate;
        break;
      }
    }
    if (!user || !userKey) {
      setStatus(elements.loginStatus, 'RE ou senha inválidos.', 'error');
      return;
    }
    showApp(userKey, user);
  } catch (error) {
    console.error(error);
    setStatus(elements.loginStatus, 'Não foi possível entrar. Verifique a conexão.', 'error');
  } finally {
    setBusy(elements.loginForm, false);
  }
}

function openForgotPassword() {
  elements.forgotPasswordForm.reset();
  setStatus(elements.forgotStatus);
  elements.forgotPasswordDialog.showModal();
  window.setTimeout(() => elements.forgotEmail.focus(), 50);
}

async function replaceUserPassword(userKey, user, purpose, options = {}) {
  const keepOnEmailFailure = options.keepOnEmailFailure !== false;
  const previousCredential = {
    passwordHash: user.passwordHash,
    passwordSalt: user.passwordSalt,
    passwordIterations: user.passwordIterations || PBKDF2_ITERATIONS
  };

  const { password, savedUser } = await issueAccessPassword(userKey, {
    mode: 'replace',
    previousCredential
  });

  try {
    const sent = await sendPasswordEmail({
      user: { ...user, ...savedUser },
      password,
      purpose
    });
    // Sempre devolve a senha que foi validada no banco e usada no e-mail.
    return { password: sent.password || password, emailed: true };
  } catch (error) {
    error.password = password;
    error.emailed = false;

    if (!keepOnEmailFailure) {
      try {
        await update(ref(database, `${USERS_PATH}/${userKey}`), {
          ...previousCredential,
          updatedAt: serverTimestamp()
        });
        delete error.password;
      } catch (rollbackError) {
        console.error('Falha ao restaurar senha anterior:', rollbackError);
      }
    }

    throw error;
  }
}

async function handleForgotPassword(event) {
  event.preventDefault();
  setStatus(elements.forgotStatus);
  const email = normalizeEmail(elements.forgotEmail.value);
  if (!isValidEmail(email)) {
    setStatus(elements.forgotStatus, 'Informe um e-mail válido.', 'error');
    return;
  }

  setBusy(elements.forgotPasswordForm, true);
  setStatus(elements.forgotStatus, 'Verificando cadastro…', 'loading');
  try {
    const emailKey = await sha256(email);
    const indexSnapshot = await get(ref(database, `${EMAIL_INDEX_PATH}/${emailKey}`));
    const userKey = indexSnapshot.val();
    if (!userKey) {
      setStatus(elements.forgotStatus, 'E-mail não possui cadastro.', 'error');
      return;
    }

    const userSnapshot = await get(ref(database, `${USERS_PATH}/${userKey}`));
    const user = userSnapshot.val();
    if (!user || normalizeEmail(user.email) !== email) {
      setStatus(elements.forgotStatus, 'E-mail não possui cadastro.', 'error');
      return;
    }

    setStatus(elements.forgotStatus, 'Gerando e enviando nova senha…', 'loading');
    await replaceUserPassword(userKey, user, 'Redefinição de senha', {
      keepOnEmailFailure: false
    });
    setStatus(elements.forgotStatus, 'Nova senha enviada ao e-mail cadastrado.', 'success');
    elements.forgotEmail.value = '';
  } catch (error) {
    console.error(error);
    setStatus(elements.forgotStatus, describeEmailError(error), 'error');
  } finally {
    setBusy(elements.forgotPasswordForm, false);
  }
}

function renderShiftSelect() {
  const selected = normalizeTeam(elements.userShift.value);
  const fragment = document.createDocumentFragment();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Selecione uma equipe';
  fragment.appendChild(placeholder);

  ['A', 'B', 'C', 'D', 'E'].forEach((team) => {
    const option = document.createElement('option');
    option.value = team;
    option.textContent = `Equipe ${team}`;
    fragment.appendChild(option);
  });
  elements.userShift.replaceChildren(fragment);
  if (selected) elements.userShift.value = selected;
}

function renderUserList() {
  const users = Object.entries(usersCache)
    .map(([key, user]) => ({ key, ...user }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
  elements.userCountAdmin.textContent = String(users.length);
  const fragment = document.createDocumentFragment();

  users.forEach((user) => {
    const item = document.createElement('article');
    item.className = 'admin-list-card user-card';

    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = user.warName ? `${user.warName} — ${user.name || ''}` : (user.name || 'Usuário');
    const detail = document.createElement('span');
    const identifier = userIdentifier(user);
    detail.textContent = `${identifier.masked} • ${user.email || 'sem e-mail'}`;
    const tags = document.createElement('div');
    tags.className = 'admin-tags';
    const rankTag = document.createElement('small');
    rankTag.textContent = rankLabel(user.rank);
    const profileTag = document.createElement('small');
    profileTag.textContent = profileLabel(user.profile);
    profileTag.dataset.profile = user.profile || 'common';
    const teamTag = document.createElement('small');
    teamTag.textContent = teamLabel(userTeam(user));
    tags.append(rankTag, profileTag, teamTag);
    if (user.cpa) {
      const cpaTag = document.createElement('small');
      cpaTag.textContent = cpaLabel(user.cpa);
      tags.appendChild(cpaTag);
    }
    info.append(title, detail, tags);

    const actions = document.createElement('div');
    actions.className = 'admin-list-actions';

    const teamSelect = document.createElement('select');
    teamSelect.className = 'admin-team-select';
    teamSelect.setAttribute('aria-label', `Equipe de ${user.name || 'usuário'}`);
    const emptyTeam = document.createElement('option');
    emptyTeam.value = '';
    emptyTeam.textContent = 'Sem equipe';
    teamSelect.appendChild(emptyTeam);
    ['A', 'B', 'C', 'D', 'E'].forEach((team) => {
      const option = document.createElement('option');
      option.value = team;
      option.textContent = `Equipe ${team}`;
      teamSelect.appendChild(option);
    });
    teamSelect.value = userTeam(user);
    teamSelect.addEventListener('change', () => updateUserTeam(user, teamSelect.value));
    actions.append(teamSelect);

    if (user.profile !== 'admin') {
      const roleSelect = document.createElement('select');
      roleSelect.className = 'admin-team-select';
      roleSelect.setAttribute('aria-label', `Perfil de ${user.name || 'usuário'}`);
      [['dispatcher','Despachador'],['supervisor','Supervisor'],['operations-chief','Chefe de Operações']].forEach(([value,label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        roleSelect.appendChild(option);
      });
      roleSelect.value = user.profile === 'common' ? 'dispatcher' : (user.profile || 'dispatcher');
      roleSelect.addEventListener('change', () => updateUserProfile(user, roleSelect.value));
      actions.append(roleSelect);
    }

    const resendButton = document.createElement('button');
    resendButton.type = 'button';
    resendButton.className = 'admin-action';
    resendButton.textContent = 'Nova senha';
    resendButton.addEventListener('click', () => resendUserPassword(user));
    actions.append(resendButton);

    if (user.cpf !== INITIAL_ADMIN.cpf && user.key !== currentUserKey) {
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'admin-action danger';
      removeButton.textContent = 'Excluir';
      removeButton.addEventListener('click', () => deleteUser(user));
      actions.append(removeButton);
    }

    item.append(info, actions);
    fragment.appendChild(item);
  });
  elements.userList.replaceChildren(fragment);
}

async function updateUserTeam(user, teamValue) {
  if (currentUser?.profile !== 'admin' || !user?.key) return;
  const team = normalizeTeam(teamValue);
  try {
    await update(ref(database, `${USERS_PATH}/${user.key}`), {
      team: team || null,
      updatedAt: serverTimestamp(),
      updatedBy: currentUserKey
    });
    if (user.key === currentUserKey) {
      currentUser = { ...currentUser, team };
      updateSessionBar();
      document.dispatchEvent(new CustomEvent('civiloff:authchange', {
        detail: { userKey: currentUserKey, user: { ...currentUser } }
      }));
    }
  } catch (error) {
    console.error(error);
    setStatus(elements.userFormStatus, 'Não foi possível atualizar a equipe do usuário.', 'error');
    renderUserList();
  }
}


async function updateUserProfile(user, profileValue) {
  if (currentUser?.profile !== 'admin' || !user?.key || user.profile === 'admin') return;
  const profile = ['dispatcher', 'supervisor', 'operations-chief'].includes(profileValue) ? profileValue : '';
  if (!profile) return;
  const expected = allowedProfileForRank(user.rank);
  if (expected && expected !== profile) {
    setStatus(elements.userFormStatus, `${rankLabel(user.rank)} deve usar o perfil ${profileLabel(expected)}.`, 'error');
    renderUserList();
    return;
  }
  try {
    await update(ref(database, `${USERS_PATH}/${user.key}`), {
      profile,
      updatedAt: serverTimestamp(),
      updatedBy: currentUserKey
    });
  } catch (error) {
    console.error(error);
    setStatus(elements.userFormStatus, 'Não foi possível atualizar o perfil do usuário.', 'error');
    renderUserList();
  }
}

function subscribeUsersForAdmin() {
  if (unsubscribeUsers || currentUser?.profile !== 'admin') return;
  unsubscribeUsers = onValue(ref(database, USERS_PATH), (snapshot) => {
    usersCache = snapshot.val() || {};
    usersLoaded = true;
    renderUserList();
  }, (error) => {
    console.error(error);
    setStatus(elements.userFormStatus, 'Não foi possível carregar os usuários.', 'error');
  });
}

function selectAdminTab(tabName) {
  elements.adminTabs.forEach((button) => {
    const active = button.dataset.adminTab === tabName;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  elements.adminPanels.forEach((panel) => {
    panel.hidden = panel.dataset.adminPanel !== tabName;
  });
}

function openAdmin() {
  if (currentUser?.profile !== 'admin') return;
  subscribeUsersForAdmin();
  selectAdminTab('users');
  setStatus(elements.userFormStatus);
  const hint = document.querySelector('#firebaseProjectHint');
  if (hint) {
    hint.textContent = `Firebase: ${firebaseConfig.projectId}`;
  }
  elements.adminDialog.showModal();
}

async function handleCreateUser(event) {
  event.preventDefault();
  if (currentUser?.profile !== 'admin') return;
  setStatus(elements.userFormStatus);

  const name = elements.userName.value.trim().replace(/\s+/g, ' ');
  const warName = elements.userWarName.value.trim().replace(/\s+/g, ' ');
  const rank = elements.userRank.value;
  const reValue = normalizeRe(elements.userRe.value);
  const email = normalizeEmail(elements.userEmail.value);
  const team = normalizeTeam(elements.userShift.value);
  const allowsCpa = rankAllowsCpa(rank);
  const cpa = allowsCpa ? normalizeCpa(elements.userCpa?.value) : '';
  const profile = elements.userProfile.value;
  const expectedProfile = allowedProfileForRank(rank);

  if (name.length < 3) { setStatus(elements.userFormStatus, 'Informe o nome completo.', 'error'); return; }
  if (warName.length < 2) { setStatus(elements.userFormStatus, 'Informe o nome de guerra.', 'error'); return; }
  if (!RANK_LABELS[rank]) { setStatus(elements.userFormStatus, 'Selecione o posto/graduação.', 'error'); return; }
  if (!isValidRe(reValue)) { setStatus(elements.userFormStatus, 'Informe o RE no formato 000000-0. O último caractere pode ser número, A ou B.', 'error'); return; }
  if (!isValidEmail(email)) { setStatus(elements.userFormStatus, 'Informe um e-mail válido.', 'error'); return; }
  if (!team) { setStatus(elements.userFormStatus, 'Selecione uma equipe.', 'error'); return; }
  if (allowsCpa && !cpa) { setStatus(elements.userFormStatus, 'Selecione a CPA.', 'error'); return; }
  if (!expectedProfile) {
    setStatus(elements.userFormStatus, `${rankLabel(rank)} está disponível no cadastro, mas não possui perfil operacional definido nesta regra (Despachador até Cb, Supervisor até Subten, Chefe de Operações até Cap).`, 'error');
    return;
  }
  if (profile !== expectedProfile) {
    setStatus(elements.userFormStatus, `${rankLabel(rank)} deve usar o perfil ${profileLabel(expectedProfile)}.`, 'error');
    return;
  }

  setBusy(elements.userForm, true);
  setStatus(elements.userFormStatus, 'Validando cadastro…', 'loading');
  let userKey = '';
  let emailKey = '';
  try {
    [userKey, emailKey] = await Promise.all([sha256(`re:${reValue}`), sha256(email)]);
    const [userSnapshot, emailSnapshot] = await Promise.all([
      get(ref(database, `${USERS_PATH}/${userKey}`)),
      get(ref(database, `${EMAIL_INDEX_PATH}/${emailKey}`))
    ]);

    const reJaCadastrado = userSnapshot.exists() || Object.values(usersCache).some((item) => normalizeRe(item.re) === reValue);
    const emailJaCadastrado = emailSnapshot.exists() || Object.values(usersCache).some((item) => normalizeEmail(item.email) === email);
    if (reJaCadastrado && emailJaCadastrado) { setStatus(elements.userFormStatus, 'RE e e-mail já cadastrados.', 'error'); return; }
    if (reJaCadastrado) { setStatus(elements.userFormStatus, 'Este RE já está cadastrado.', 'error'); return; }
    if (emailJaCadastrado) { setStatus(elements.userFormStatus, 'Este e-mail já está cadastrado.', 'error'); return; }

    setStatus(elements.userFormStatus, 'Gerando senha…', 'loading');
    const { password, savedUser } = await issueAccessPassword(userKey, {
      mode: 'create',
      userRecord: {
        name,
        warName,
        rank,
        re: reValue,
        reMasked: formatRe(reValue),
        email,
        emailNormalized: email,
        team,
        cpa: cpa || null,
        shiftId: null,
        profile,
        active: true,
        createdBy: currentUserKey
      }
    });

    await set(ref(database, `${EMAIL_INDEX_PATH}/${emailKey}`), userKey);
    setStatus(elements.userFormStatus, 'Enviando senha por e-mail…', 'loading');
    let emailed = false;
    let issuedPassword = password;
    try {
      const sent = await sendPasswordEmail({ user: savedUser, password, purpose: 'Cadastro de usuário' });
      issuedPassword = sent.password || password;
      emailed = true;
    } catch (emailError) {
      console.error(emailError);
      resetUserForm();
      showIssuedPassword({
        target: elements.userFormStatus,
        email,
        password: issuedPassword,
        emailed: false,
        identifier: formatRe(reValue),
        prefix: `Usuário cadastrado. Use esta senha (o e-mail falhou): ${describeEmailError(emailError)}`
      });
      return;
    }

    resetUserForm();
    showIssuedPassword({
      target: elements.userFormStatus,
      email,
      password: issuedPassword,
      emailed,
      identifier: formatRe(reValue),
      prefix: 'Usuário cadastrado e senha enviada por e-mail.'
    });
  } catch (error) {
    console.error(error);
    setStatus(elements.userFormStatus, describeEmailError(error), 'error');
  } finally {
    setBusy(elements.userForm, false);
  }
}

function refreshProfileOptions() {
  if (!elements.userProfile) return;
  const rank = elements.userRank?.value || '';
  const expected = allowedProfileForRank(rank);
  elements.userProfile.replaceChildren();
  const option = document.createElement('option');
  if (expected) {
    option.value = expected;
    option.textContent = profileLabel(expected);
    elements.userProfile.appendChild(option);
    elements.userProfile.value = expected;
    if (elements.profileRuleHint) elements.profileRuleHint.textContent = `${rankLabel(rank)} → ${profileLabel(expected)}.`;
  } else {
    option.value = '';
    option.textContent = rank ? 'Sem perfil operacional definido' : 'Selecione o posto/graduação primeiro';
    elements.userProfile.appendChild(option);
    if (elements.profileRuleHint) elements.profileRuleHint.textContent = rank
      ? 'Maj PM, Ten Cel PM e Cel PM estão disponíveis no campo de posto/graduação, mas a regra informada não atribui perfil operacional acima de Cap PM.'
      : 'Despachador: Sd PM–Cb PM · Supervisor: 3º Sgt PM–Subten PM · Chefe de Operações: 2º Ten PM–Cap PM.';
  }
  refreshCpaVisibility();
}

function resetUserForm() {
  elements.userForm.reset();
  renderShiftSelect();
  refreshProfileOptions();
  refreshCpaVisibility();
}

function showIssuedPassword({ target, email, password, emailed, prefix, identifier = '' }) {
  if (!target) return;
  const accessPassword = normalizePassword(password);
  target.hidden = false;
  target.dataset.type = emailed ? 'success' : 'error';
  target.replaceChildren();

  const title = document.createElement('div');
  title.className = 'password-issue-title';
  title.textContent = prefix;
  target.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'password-issue-meta';
  meta.textContent = `Destinatário: ${email}`;
  target.appendChild(meta);

  const secret = document.createElement('div');
  secret.className = 'password-issue-secret';
  secret.textContent = `Senha: ${accessPassword}`;
  target.appendChild(secret);

  const hint = document.createElement('div');
  hint.className = 'password-issue-hint';
  hint.textContent = emailed
    ? 'A senha do e-mail é a mesma desta tela e a que está no banco (hash).'
    : 'Copie a senha abaixo e informe ao usuário. Depois use "Nova senha" para reenviar o e-mail.';
  target.appendChild(hint);

  const actions = document.createElement('div');
  actions.className = 'password-actions';

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'password-action-btn';
  copyButton.textContent = 'Copiar senha';
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(accessPassword);
      copyButton.textContent = 'Senha copiada';
      window.setTimeout(() => {
        copyButton.textContent = 'Copiar senha';
      }, 1800);
    } catch {
      copyButton.textContent = 'Falha ao copiar';
    }
  });
  actions.appendChild(copyButton);

  const shareText = [
    'Acesso CivilOff',
    identifier ? `RE: ${identifier}` : '',
    `E-mail: ${email}`,
    `Senha: ${accessPassword}`
  ].filter(Boolean).join('\n');

  const whatsapp = document.createElement('a');
  whatsapp.className = 'password-action-btn password-action-link';
  whatsapp.href = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  whatsapp.target = '_blank';
  whatsapp.rel = 'noopener noreferrer';
  whatsapp.textContent = 'Enviar no WhatsApp';
  actions.appendChild(whatsapp);

  target.appendChild(actions);
}

async function resendUserPassword(user) {
  if (currentUser?.profile !== 'admin') return;
  if (!window.confirm(`Gerar e enviar uma nova senha para ${user.name}?`)) return;
  setStatus(elements.userFormStatus, `Enviando nova senha para ${user.name}…`, 'loading');
  try {
    const result = await replaceUserPassword(user.key, user, 'Nova senha gerada pelo administrador');
    showIssuedPassword({
      target: elements.userFormStatus,
      email: user.email,
      password: result.password,
      emailed: true,
      identifier: userIdentifier(user).masked,
      prefix: `Nova senha enviada para ${user.email}.`
    });
  } catch (error) {
    console.error(error);
    if (error.password) {
      showIssuedPassword({
        target: elements.userFormStatus,
        email: user.email,
        password: error.password,
        emailed: false,
        identifier: userIdentifier(user).masked,
        prefix: `Senha atualizada, mas o e-mail falhou. ${describeEmailError(error)}`
      });
      return;
    }
    setStatus(elements.userFormStatus, describeEmailError(error), 'error');
  }
}

async function deleteUser(user) {
  if (currentUser?.profile !== 'admin' || user.cpf === INITIAL_ADMIN.cpf || user.key === currentUserKey) return;
  if (!window.confirm(`Excluir o usuário ${user.name}?`)) return;
  try {
    const emailKey = await sha256(normalizeEmail(user.email));
    await update(ref(database), {
      [`${USERS_PATH}/${user.key}`]: null,
      [`${EMAIL_INDEX_PATH}/${emailKey}`]: null
    });
    setStatus(elements.userFormStatus, 'Usuário excluído.', 'success');
  } catch (error) {
    console.error(error);
    setStatus(elements.userFormStatus, 'Não foi possível excluir o usuário.', 'error');
  }
}

function bindEvents() {
  bindLoginIdentifier(elements.loginCpf);
  bindReMask(elements.userRe);
  elements.userRank?.addEventListener('change', refreshProfileOptions);
  refreshProfileOptions();
  refreshCpaVisibility();
  elements.loginPassword?.addEventListener('input', () => {
    elements.loginPassword.value = elements.loginPassword.value.replace(/\D/g, '').slice(0, 6);
  });
  elements.loginForm?.addEventListener('submit', handleLogin);
  elements.forgotPasswordButton?.addEventListener('click', openForgotPassword);
  elements.forgotPasswordForm?.addEventListener('submit', handleForgotPassword);
  elements.cancelForgotPassword?.addEventListener('click', () => elements.forgotPasswordDialog.close());
  elements.logoutButton?.addEventListener('click', showLogin);
  elements.adminButton?.addEventListener('click', openAdmin);
  elements.closeAdminButton?.addEventListener('click', () => elements.adminDialog.close());
  elements.adminTabs.forEach((button) => {
    button.addEventListener('click', () => selectAdminTab(button.dataset.adminTab));
  });
  elements.userForm?.addEventListener('submit', handleCreateUser);
}

async function initialize() {
  if (elements.authLoading) {
    elements.authLoading.innerHTML = '<span class="loading-ring" aria-hidden="true"></span><span>Conectando ao Firebase…</span>';
  }

  try {
    bindEvents();
  } catch (error) {
    console.error(error);
    if (elements.authLoading) {
      elements.authLoading.dataset.type = 'error';
      elements.authLoading.innerHTML = '<strong>Falha ao iniciar a interface.</strong><span>Recarregue a página com Ctrl+F5 para limpar o cache.</span>';
    }
    initializing = false;
    return;
  }

  if (!window.crypto?.subtle || !window.crypto?.getRandomValues) {
    elements.authLoading.textContent = 'Este navegador não oferece os recursos de segurança necessários. Use HTTPS (GitHub Pages) ou localhost.';
    return;
  }

  if (elements.authLoading) {
    elements.authLoading.innerHTML = `<span class="loading-ring" aria-hidden="true"></span><span>Conectando ao Firebase (${firebaseConfig.projectId})…</span>`;
  }

  try {
    await seedInitialData();
    renderShiftSelect();

    const restored = await restoreSession();
    if (!restored) showLogin();
  } catch (error) {
    console.error('CivilOff Firebase error:', error);
    const permissionDenied = error?.code === 'PERMISSION_DENIED' || error?.code === 'permission-denied';
    const writeFailed = error?.code === 'WRITE_NOT_CONFIRMED';
    let detail = 'Verifique a internet e a configuração do Firebase. Depois recarregue a página.';
    if (permissionDenied) {
      detail = 'Permissão negada no Realtime Database. No Firebase (civilcop-ec5b1) → Realtime Database → Regras, cole as regras de database.rules.json e clique em Publicar (não basta salvar o rascunho).';
    } else if (writeFailed) {
      detail = error.message;
    } else if (error?.message) {
      detail = error.message;
    }
    elements.authLoading.innerHTML = `<strong>Não foi possível iniciar o acesso.</strong><span>${detail}</span>`;
    elements.authLoading.dataset.type = 'error';
  } finally {
    initializing = false;
  }
}

initialize();
