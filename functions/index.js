// Cloud Functions for PoolPro

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const SITE_DEVELOPER_EMAIL = 'samaharmon@icloud.com';
const allowedOrigins = new Set([
  'https://poolpro1.vercel.app',
]);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (allowedOrigins.has(origin)) return true;
  return /^https:\/\/poolpro1-[a-z0-9-]+\.vercel\.app$/i.test(origin) ||
    /^http:\/\/localhost:\d+$/i.test(origin) ||
    /^http:\/\/127\.0\.0\.1:\d+$/i.test(origin);
}

function setCors(req, res) {
  const origin = req.headers.origin || '';
  if (isAllowedOrigin(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
  }
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Max-Age', '3600');
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

async function requireAccountManager(req) {
  const authHeader = req.get('authorization') || req.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const err = new Error('Sign in before deleting accounts.');
    err.status = 401;
    throw err;
  }

  const decoded = await admin.auth().verifyIdToken(match[1]);
  const email = normalize(decoded.email);
  if (email === SITE_DEVELOPER_EMAIL) return decoded;

  const roleSnap = await admin.firestore().collection('settings').doc('rolesPermissions').get();
  const roles = roleSnap.exists ? roleSnap.data().roles || {} : {};
  const supervisors = Array.isArray(roles.supervisor)
    ? roles.supervisor.map(normalize).filter(Boolean)
    : [];
  if (supervisors.includes(email)) return decoded;

  const err = new Error('Supervisor access is required to delete accounts.');
  err.status = 403;
  throw err;
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
    await requireAccountManager(req);

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
    res.status(err.status || 500).json({ error: err.message || 'Unable to delete Firebase Auth user.' });
  }
});
