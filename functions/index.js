// Cloud Functions for PoolPro

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const allowedOrigins = new Set([
  'https://poolpro1.vercel.app',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
]);

function setCors(req, res) {
  const origin = req.headers.origin || '';
  if (allowedOrigins.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
  }
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

exports.deleteAuthUserByEmail = functions.https.onRequest(async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return;
  }

  try {
    const email = normalize(req.body?.email);
    const username = normalize(req.body?.username);
    if (!email || !username) {
      res.status(400).json({ error: 'Email and username are required.' });
      return;
    }

    const accountSnap = await admin.firestore().collection('lifeguardAccounts').doc(username).get();
    if (!accountSnap.exists) {
      res.status(404).json({ error: 'Lifeguard account was not found.' });
      return;
    }

    const account = accountSnap.data() || {};
    const accountEmails = [
      account.authEmail,
      account.employeeEmail,
      account.email,
      account.id,
    ].map(normalize).filter(Boolean);

    if (!accountEmails.includes(email)) {
      res.status(403).json({ error: 'Account email does not match username.' });
      return;
    }

    try {
      const user = await admin.auth().getUserByEmail(email);
      await admin.auth().deleteUser(user.uid);
      res.status(200).json({ ok: true, deleted: true });
    } catch (err) {
      if (err?.code === 'auth/user-not-found') {
        res.status(200).json({ ok: true, deleted: false });
        return;
      }
      throw err;
    }
  } catch (err) {
    console.error('deleteAuthUserByEmail failed:', err);
    res.status(500).json({ error: 'Unable to delete Firebase Auth user.' });
  }
});
