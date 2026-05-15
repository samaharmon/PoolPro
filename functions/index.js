const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { Resend } = require('resend');

admin.initializeApp();
setGlobalOptions({ region: 'us-central1' });

const RESEND_KEY = defineSecret('RESEND_KEY');

exports.sendVerificationEmail = onCall(
  { secrets: [RESEND_KEY] },
  async (request) => {
    const { email, continueUrl } = request.data;

    if (!email || typeof email !== 'string') {
      throw new HttpsError('invalid-argument', 'Missing email.');
    }

    const actionCodeSettings = {
      url: continueUrl || 'https://poolpro.app',
      handleCodeInApp: false,
    };

    let verificationLink;
    try {
      verificationLink = await admin
        .auth()
        .generateEmailVerificationLink(email, actionCodeSettings);
    } catch (err) {
      console.error('generateEmailVerificationLink failed:', err);
      throw new HttpsError('internal', 'Could not generate verification link.');
    }

    const resend = new Resend(RESEND_KEY.value());

    try {
      await resend.emails.send({
        from: 'PoolPro <onboarding@resend.dev>',
        to: email,
        subject: 'Verify your PoolPro email address',
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
            <h2 style="color:#1a73e8">Verify your email</h2>
            <p>Click the button below to verify your email address and activate your PoolPro account.</p>
            <a href="${verificationLink}"
               style="display:inline-block;padding:12px 24px;background:#1a73e8;color:#fff;
                      border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">
              Verify Email
            </a>
            <p style="color:#666;font-size:13px">
              If you didn't request this, ignore this email.<br>
              This link expires in 24 hours.
            </p>
          </div>
        `,
      });
    } catch (err) {
      console.error('Resend sendMail failed:', err);
      throw new HttpsError('internal', 'Failed to send verification email.');
    }

    return { success: true };
  }
);
