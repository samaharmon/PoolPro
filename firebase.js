// firebase.js

// Shared Firebase initialization + pool helpers for ChemLog (ES modules)

import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  writeBatch,
  deleteDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';

// ✅ REAL project config from your previous firebaseInit.js
const firebaseConfig = {
  apiKey: "AIzaSyCRxSL2uuH6O5MFvbq0FS02zF2K_lXGvqI",
  authDomain: "chemlog-43c08.firebaseapp.com",
  projectId: "chemlog-43c08",
  storageBucket: "chemlog-43c08.appspot.com",
  messagingSenderId: "554394202059",
  appId: "1:554394202059:web:a8d5824a1d7ccdd871d04e",
  measurementId: "G-QF5ZQ88VS2"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

console.log('[Firebase] Initialized project:', firebaseConfig.projectId);

// ---------- Pools collection helpers ----------

function poolsCollectionRef() {
  return collection(db, 'pools');
}

export async function getPools() {
  const snap = await getDocs(collection(db, 'pools'));
  return snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data()
  }));
}

export function listenPools(callback) {
  const q = collection(db, 'pools');
  return onSnapshot(
    q,
    (snap) => {
      const pools = snap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      callback(pools);
    },
    (err) => {
      console.error('Error listening to pools collection:', err);
      callback([]);
    }
  );
}

async function savePool(poolIdOrNull, poolData) {
  try {
    const colRef = poolsCollectionRef();
    let docRef;

    if (poolIdOrNull) {
      // Existing pool – keep same id
      docRef = doc(colRef, poolIdOrNull);
    } else if (poolData && poolData.id) {
      // Caller supplied id
      docRef = doc(colRef, poolData.id);
    } else {
      // Brand‑new pool
      docRef = doc(colRef);
      if (poolData) {
        poolData.id = docRef.id;
      }
    }

    await setDoc(docRef, poolData || {}, { merge: true });
    console.log('Pool saved with ID:', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('Error saving pool:', error);
    return null;
  }
}

export async function savePoolDoc(poolIdOrNull, poolData) {
  return savePool(poolIdOrNull, poolData);
}

async function deletePool(poolId) {
  try {
    await deleteDoc(doc(poolsCollectionRef(), poolId));
    console.log('Pool deleted with ID:', poolId);
    return true;
  } catch (error) {
    console.error('Error deleting pool:', error);
    return false;
  }
}

export async function deletePoolDoc(poolId) {
  return deletePool(poolId);
}

// ---------- Re‑export Firebase primitives for script.js + newRules.js ----------

export {
  app,
  db,
  auth,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  serverTimestamp,
  writeBatch,
  deleteDoc,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential
};
