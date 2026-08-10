import { database as db, firebaseApp } from './firebase-config.js';
import { getAnalytics, isSupported as isAnalyticsSupported } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js';
import {
  ref,
  onValue,
  get,
  set,
  update
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';


const DEVICE_ID_KEY = 'civilOffDeviceId:v2';
const DEVICES_ROOT = 'civiloff/devices';

const userCountElement = document.querySelector('#userCount');
const userCounterElement = userCountElement?.closest('.user-counter');

function safeRandomId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();

  if (window.crypto?.getRandomValues) {
    const values = new Uint32Array(4);
    window.crypto.getRandomValues(values);
    return Array.from(values, (value) => value.toString(36)).join('-');
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function normalizeFirebaseKey(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 140);
}

function loadOrCreateDeviceId() {
  try {
    const saved = normalizeFirebaseKey(localStorage.getItem(DEVICE_ID_KEY));
    if (saved.startsWith('device_')) return saved;

    const created = normalizeFirebaseKey(`device_${safeRandomId()}`);
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    return normalizeFirebaseKey(`device_session_${safeRandomId()}`);
  }
}

function countDirectChildren(snapshot) {
  let total = 0;
  snapshot.forEach(() => {
    total += 1;
  });
  return total;
}

function renderCount(value, status = 'ok') {
  if (!userCountElement) return;

  const count = Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
  userCountElement.textContent = String(count);

  if (!userCounterElement) return;
  userCounterElement.dataset.counterStatus = status;
  userCounterElement.setAttribute(
    'aria-label',
    `${count} ${count === 1 ? 'dispositivo único cadastrado' : 'dispositivos únicos cadastrados'}`
  );
  userCounterElement.setAttribute(
    'title',
    `${count} ${count === 1 ? 'dispositivo único já abriu esta página' : 'dispositivos únicos já abriram esta página'}`
  );
}

function renderUnavailable() {
  if (!userCountElement) return;
  userCountElement.textContent = '—';

  if (!userCounterElement) return;
  userCounterElement.dataset.counterStatus = 'unavailable';
  userCounterElement.setAttribute('aria-label', 'Contador de dispositivos indisponível');
  userCounterElement.setAttribute('title', 'Verifique a conexão, o Firebase Realtime Database e as regras do banco.');
}


isAnalyticsSupported()
  .then((supported) => {
    if (supported) getAnalytics(firebaseApp);
  })
  .catch(() => {});

try {
  const deviceId = loadOrCreateDeviceId();
  const devicesRef = ref(db, DEVICES_ROOT);
  const currentDeviceRef = ref(db, `${DEVICES_ROOT}/${deviceId}`);

  onValue(devicesRef, (snapshot) => {
    renderCount(countDirectChildren(snapshot));
  }, () => {
    renderUnavailable();
  });

  get(currentDeviceRef)
    .then((snapshot) => {
      const now = Date.now();
      if (snapshot.exists() && typeof snapshot.val() === 'object') {
        return update(currentDeviceRef, {
          deviceKey: deviceId,
          lastSeenAt: now,
          userAgent: navigator.userAgent || 'unknown'
        });
      }
      return set(currentDeviceRef, {
        deviceKey: deviceId,
        firstSeenAt: now,
        lastSeenAt: now,
        userAgent: navigator.userAgent || 'unknown'
      });
    })
    .catch(() => {
      renderUnavailable();
    });
} catch {
  renderUnavailable();
}
