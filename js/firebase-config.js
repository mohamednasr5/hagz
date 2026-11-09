/**
 * firebase-config.js - Firebase Modular Initialization
 * Ahmadiah Pitch Manager - Sole Database: Firebase Realtime Database
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { 
  getDatabase, 
  ref, 
  set, 
  get, 
  onValue, 
  update, 
  remove, 
  push, 
  runTransaction 
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

export const firebaseConfig = {
  apiKey: "AIzaSyDHj1IlCxQdnoUFKN9QwfJFGRKAfN7zq44",
  authDomain: "hagz-a49fa.firebaseapp.com",
  databaseURL: "https://hagz-a49fa-default-rtdb.firebaseio.com",
  projectId: "hagz-a49fa",
  storageBucket: "hagz-a49fa.firebasestorage.app",
  messagingSenderId: "588957426440",
  appId: "1:588957426440:web:e17412d6371ff9ba0442bd",
  measurementId: "G-EKBRK9Q1X8"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

// Database References Helper
export const dbRefs = {
  settings: () => ref(db, 'settings'),
  bookings: (date) => date ? ref(db, `bookings/${date}`) : ref(db, 'bookings'),
  bookingItem: (date, id) => ref(db, `bookings/${date}/${id}`),
  expenses: (date) => date ? ref(db, `expenses/${date}`) : ref(db, 'expenses'),
  expenseItem: (date, id) => ref(db, `expenses/${date}/${id}`),
  payments: () => ref(db, 'payments'),
  telegramSubscribers: () => ref(db, 'telegramSubscribers'),
  auditLogs: () => ref(db, 'auditLogs'),
  adminUsers: () => ref(db, 'adminUsers')
};

export {
  ref,
  set,
  get,
  onValue,
  update,
  remove,
  push,
  runTransaction,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
};
