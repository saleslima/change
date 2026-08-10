import { getApp, getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';

export const firebaseConfig = Object.freeze({
  apiKey: 'AIzaSyDbS8RtrN3bPsXHhxvOb_MqJT9SLjjggDY',
  authDomain: 'civilcop-ec5b1.firebaseapp.com',
  databaseURL: 'https://civilcop-ec5b1-default-rtdb.firebaseio.com',
  projectId: 'civilcop-ec5b1',
  storageBucket: 'civilcop-ec5b1.firebasestorage.app',
  messagingSenderId: '919454039618',
  appId: '1:919454039618:web:d1af1b085f0238fc37f7db',
  measurementId: 'G-FRJN4YDK4V'
});

const APP_NAME = 'civilcop-ec5b1';

export const firebaseApp = getApps().some((app) => app.name === APP_NAME)
  ? getApp(APP_NAME)
  : initializeApp(firebaseConfig, APP_NAME);

// URL explícita evita conectar no banco errado / default vazio.
export const database = getDatabase(firebaseApp, firebaseConfig.databaseURL);

if (typeof console !== 'undefined') {
  console.info('[CivilOff] Firebase:', firebaseConfig.projectId, firebaseConfig.databaseURL);
}
