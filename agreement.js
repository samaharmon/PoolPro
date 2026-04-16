import { db, doc, getDoc, setDoc, serverTimestamp } from './firebase.js';

export const AGREEMENT_VERSION = 'poolpro-user-agreement-v2-2025-07-01';
export const AGREEMENT_EFFECTIVE_DATE = 'July 1, 2025';

const AGREEMENT_TITLE = 'PoolPro User Agreement';
const AGREEMENT_TEXT = String.raw`POOLPRO
Daily Operations Portal
User Agreement, Terms of Use & Data Privacy Notice
Upstate Pool Management Group | Capital City Aquatics

Effective Date: July 1, 2025
Review Cycle: Annually (each July 1) or upon material update

IMPORTANT: Please read this entire agreement before using PoolPro. By checking the acknowledgment box during your first login, you confirm that you have read, understood, and agree to be bound by these terms. If you are under 18 years of age, parental or guardian consent may be required as described herein.

1. Introduction & Purpose
PoolPro (the "Portal") is a proprietary web application independently designed, developed, and owned by Samuel Harmon (the "Developer"). PoolPro is licensed for internal operational use by Upstate Pool Management Group and Capital City Aquatics (collectively referred to herein as "the Company"). The Portal is deployed to support day-to-day aquatics workforce management and is used exclusively for internal employment-related functions, including but not limited to:
• Scheduling and enrollment in required lifeguard and safety training sessions;
• Recording and tracking job performance data, including audit results and training completion;
• Submission of job-related forms and operational documentation, including facility inspection records;
• Submission of facility condition images depicting aquatic equipment and physical facility components;
• Recording supply inventory levels, water quality and clarity measurements, and other operational condition data;
• Maintaining employee rosters accessible only to supervisory and administrative personnel.
The Portal is not a public-facing platform. Access is restricted to current employees of the Company and authorized supervisory and administrative staff. Use of the Portal constitutes acceptance of these terms.

2. Scope of Application
This Agreement applies to all employees of Upstate Pool Management Group and Capital City Aquatics who access the Portal, regardless of age, position, or employment status (full-time, part-time, or seasonal). The Portal is available only to individuals who are actively employed and have been granted access credentials by the Company.
Minimum Age: No individual under the age of fifteen (15) years may be granted access to the Portal. Employees who are at least fifteen (15) but under eighteen (18) years of age ("Minor Employees") are subject to additional protections described in Section 8 of this Agreement.

3. Proprietary Software & Intellectual Property
PoolPro is proprietary software independently created and owned by the Developer, Samuel Harmon. All design elements, source code, features, workflows, and intellectual property comprising PoolPro are the exclusive property of the Developer. The Company has been granted a limited, non-exclusive license to deploy and use PoolPro solely for its internal workforce management purposes as described in this Agreement.
Users of PoolPro are granted a limited, personal, non-transferable right to access and use the Portal solely within the scope described in Section 2 of this Agreement. The following uses are expressly prohibited:
• Copying, reproducing, reverse-engineering, decompiling, or disassembling any part of PoolPro;
• Distributing, sublicensing, selling, transferring, or otherwise making PoolPro available to any individual or entity not expressly authorized under this Agreement;
• Modifying, adapting, or creating derivative works based on PoolPro without the express written consent of the Developer;
• Using PoolPro for any commercial purpose, or for the benefit of any organization other than the Company, without the Developer’s prior written consent;
• Accessing or using PoolPro after your employment with the Company has ended.
Any unauthorized use of PoolPro may constitute infringement of the Developer’s intellectual property rights and may result in civil and/or criminal liability under applicable federal and South Carolina law, including but not limited to the South Carolina Computer Crime Act (S.C. Code Ann. § 16-16-10 et seq.) and applicable federal copyright and computer fraud statutes. Violation of this section may also result in disciplinary action, up to and including termination of employment.

4. Data Collected
In order to operate the Portal and fulfill its workforce management functions, the Company collects and processes the following categories of employee data.

4.1 Directly Collected Data
The following information is provided directly by the employee or the Company at the time of account creation:
• Legal first and last name;
• Company-assigned employee identification number (Employee ID);
• Email address (used for Firebase Authentication sign-in);
• Phone number.

4.2 Indirectly Collected Data
The following data is generated automatically through your use of the Portal:
• Training enrollment records, including the name, address, date, and time of each training session for which you register;
• Timestamp records for each job-related form you submit through the Portal;
• Job performance data, including which training types you have attended, which operational audits you have completed, and which specific audit items you passed or failed.

4.3 Facility Inspection & Operational Condition Data
As part of facility inspection and operational reporting functions, the Portal collects the following categories of operational data submitted by employees:
• Photographs of aquatic facility components and equipment (for example, pool decks, filtration systems, safety equipment, and signage) submitted for inspection documentation purposes;
• Supply inventory records, including quantities of cleaning agents, safety supplies, and other operational materials;
• Water quality and condition measurements, including but not limited to water clarity, cleanliness assessments, and chemical balance records.

IMAGE SUBMISSION POLICY: Employees are strictly prohibited from submitting any photograph or image that depicts any person, including co-workers, supervisors, patrons, minors, or any other individual, whether intentionally or incidentally. Images must depict only physical facility components, aquatic equipment, environmental conditions, or supply items. Video submissions are not supported and will not be accepted by the Portal. Submission of non-compliant images violates this Agreement and may result in immediate account suspension and disciplinary action up to and including termination of employment. If you have any doubt about whether an image complies with this policy, do not submit it. Consult your supervisor first.

4.4 Authentication Data
PoolPro uses Firebase Email Authentication to manage user access. When signing in, your email address is submitted to Google Firebase, which sends a secure, one-time sign-in link to that address. Upon clicking the link, Firebase issues an authenticated session token that persists for ten (10) calendar days, after which re-authentication is required. Your email address is processed through Google Firebase’s secure authentication infrastructure solely to verify your identity and is not used for any other purpose, including marketing or external communication.

4.5 No Additional Data Collection
Beyond what is described in Sections 4.1 through 4.4, the Company does not collect financial information, Social Security numbers, health or medical records, biometric data, precise geolocation data, or any other sensitive personal information through the Portal. No browsing habits, device identifiers, or tracking cookies are collected beyond what is technically necessary to maintain your authenticated session. Email addresses are used solely for authentication and are not used for marketing, newsletters, or any non-operational communication.

5. How Your Data Is Used
All data collected through the Portal is used exclusively for internal employment and operational purposes. Specifically, your data may be used to:
• Verify your identity and manage your Portal account;
• Register you for and track your attendance at required safety and lifeguard training sessions;
• Maintain training rosters accessible only to supervisory and administrative staff;
• Document and evaluate job performance as part of normal employment oversight;
• Generate internal records of form submissions and operational audit outcomes;
• Record, review, and download (by supervisors and administrators only) facility inspection data, including supply levels, water quality measurements, and condition photographs of aquatic equipment and facility components, for internal operational and compliance purposes;
• Ensure compliance with applicable aquatics industry safety standards and regulations;
• Fulfill any legal, regulatory, or internal audit obligations of the Company.
Your data will not be used for marketing, sold to third parties, shared with external organizations, or used for any purpose unrelated to your employment with the Company.

6. Data Storage, Security & Retention
6.1 Storage Platform
All Portal data is stored using Google Firebase services operated by Google LLC. Structured data (employee records, training enrollment, audit results, inspection records, and operational measurements) is stored in Google Firestore. Facility inspection photographs are stored in Google Firebase Storage. Both services are within Google’s secure cloud infrastructure and are subject to Google’s security certifications, including SOC 2, ISO 27001, and FedRAMP compliance standards. By using the Portal, you acknowledge that your employment data and any submitted images will be stored in these cloud environments.

6.2 Access Controls
Access to Portal data is strictly limited by role-based security rules enforced through Firebase Authentication, Firestore Security Rules, and Firebase Storage Security Rules. The following access tiers apply:
• Employees: May view only their own profile information and training enrollment status, and may submit facility inspection images and operational data through assigned forms;
• Supervisors and Administrators: May access training rosters, form submission records, performance data, and facility inspection submissions, including the ability to view and download facility inspection photographs, for employees within their assigned department only;
• No employee’s personal data or submitted inspection images are accessible to peers, non-supervisory co-workers, or individuals outside the Company under any circumstance.
Image Download Notice: Facility inspection photographs downloaded by supervisors or administrators remain subject to all terms of this Agreement. Downloaded images may be used only for internal operational, compliance, or safety purposes and may not be shared externally or stored outside of Company-authorized systems.

6.3 Data Retention
The Company retains Portal data in accordance with the following schedule:
• Active employee data, including submitted facility inspection images stored in Firebase Storage, is retained for the duration of the current fiscal year and permanently deleted at the conclusion of that fiscal year;
• Data associated with employees who separate from the Company (voluntary resignation, termination, or otherwise) is permanently deleted within fourteen (14) calendar days of the effective date of separation;
• Your acknowledgment of this Agreement (including timestamp and method of acceptance) is retained separately as a compliance record for a period consistent with applicable South Carolina recordkeeping requirements, which may extend beyond the general data retention period.

6.4 Security Measures
The Company and Developer employ reasonable technical and organizational safeguards to protect Portal data from unauthorized access, disclosure, alteration, or destruction. These measures include Firebase Authentication for identity verification, role-based Firestore Security Rules and Firebase Storage Security Rules enforcing data access tiers by role, Firestore audit logging to detect unauthorized access attempts, and the broader security infrastructure provided by Google Firebase. However, no electronic system can guarantee absolute security, and neither the Developer nor the Company can warrant against all possible data security incidents.

7. Data Breach Notification
In the event of a confirmed data security breach affecting personal information stored in PoolPro, the Company and Developer will respond in accordance with the following procedures and applicable law, including the South Carolina Identity Theft Protection Act (S.C. Code Ann. § 39-1-90):
• Notification Timeline: Affected employees will be notified as expeditiously as possible and no later than forty-five (45) calendar days after the breach is confirmed, unless a shorter timeframe is required by applicable law or law enforcement requests delay;
• Notification Method: Notification will be provided through the Portal, by phone, or by other direct communication to affected individuals, and will describe the nature of the breach, the categories of data involved, and the steps being taken to address it;
• Scope of Notification: Notification obligations apply to breaches affecting personal information as defined under S.C. Code Ann. § 39-1-90, including combinations of name with Employee ID or phone number;
• Regulatory Notification: Where required by law, appropriate regulatory bodies and/or law enforcement will be notified in conjunction with individual notifications;
• Remediation: In the event of a breach, the Developer will take prompt steps to investigate, contain, and remediate the incident, and will cooperate with the Company in responding to affected employees.
You may report suspected unauthorized access to your Portal account at any time by contacting your direct supervisor or a Portal administrator immediately.

8. Data Sharing & Third Parties
The Company does not sell, rent, lease, or otherwise share your personal data with any third parties for any purpose. Your information is not disclosed to:
• Other employees who are not your supervisors or assigned administrators;
• Partner companies, vendors, or service providers, except Google LLC solely in its capacity as the cloud infrastructure and authentication host, subject to Google’s applicable data processing terms;
• Government agencies, law enforcement, or regulatory bodies, except as required by applicable law or valid legal process.
In the event the Company receives a lawful subpoena, court order, or legal demand requiring disclosure of your data, the Company will, to the extent permitted by law, notify you before complying.

9. Minor Employee Protections
The Company recognizes that a portion of its workforce consists of employees between the ages of fifteen (15) and seventeen (17). The following additional protections apply to Minor Employees:
• The Portal collects only the minimum data necessary for operational purposes. No data beyond what is described in Section 4 of this Agreement is collected from or about Minor Employees;
• Minor Employees’ performance data, audit records, and training histories are visible only to supervisors and administrators, consistent with the access controls described in Section 6.2;
• The Company does not use the Portal to collect, store, or process sensitive categories of information (health, location, biometric, etc.) from Minor Employees;
• Where required by applicable South Carolina law or federal law, including but not limited to the Children’s Online Privacy Protection Act and applicable labor statutes, parental or guardian consent may be obtained prior to Portal access being granted to employees under the age of 16;
• Minor Employees retain the same rights to request information about their data as adult employees, as described in Section 11.
The Company is committed to operating in compliance with South Carolina Code of Laws Title 41 (Labor and Employment) as it pertains to minor workers, and with all applicable federal protections.

10. Employee Responsibilities & Acceptable Use
By using the Portal, you agree to:
• Provide accurate and truthful information when creating your account or submitting forms;
• Keep your login credentials confidential and not share your account access with any other person;
• Use the Portal solely for its intended employment-related purposes;
• Promptly report any suspected unauthorized access to your account or any security concern to your supervisor or an administrator;
• Not attempt to access data belonging to other employees or to exceed your authorized access level;
• Not attempt to alter, copy, export, or reproduce Portal data outside of normal use.
Misuse of the Portal, including unauthorized access attempts or intentional submission of false information, may result in disciplinary action up to and including termination of employment, consistent with Company policy.

11. Your Rights Regarding Your Data
Subject to applicable law, you have the following rights with respect to your personal data stored in the Portal:
• Right to Access: You may request a summary of the personal data the Company holds about you through the Portal;
• Right to Correction: You may request correction of inaccurate personal data, for example a misspelled name or incorrect phone number, by contacting your supervisor or a Portal administrator;
• Right to Deletion: Your data will be deleted in accordance with the retention schedule in Section 6.3. You may also request early deletion upon separation from the Company;
• Right to Know: You may request information about how your data is used, stored, and protected.
To exercise any of these rights, please contact your direct supervisor or a Company administrator. The Company will respond to all data inquiries within a reasonable timeframe.
Please note: South Carolina has not enacted a comprehensive consumer data privacy statute as of the effective date of this Agreement. However, the Company is committed to honoring the rights described above as a matter of internal policy and good-faith employment practice. This Agreement will be updated in the event that applicable South Carolina or federal privacy legislation changes.

12. Workplace Monitoring Disclosure
In accordance with applicable law, the Company discloses that the Portal collects data related to your job performance and form submission activity in the ordinary course of employment oversight. This includes audit results, training completion records, and form submission timestamps. This data may be reviewed by supervisors and administrators for the purposes described in Section 5.
This disclosure serves as written notice, consistent with South Carolina employment law principles, that certain work-related activities conducted through the Portal are recorded and may be reviewed by management.

13. Agreement Updates & Re-Acceptance
The Developer and Company reserve the right to modify this Agreement at any time. Updates will be made in the following circumstances:
• Annually, at the start of each fiscal year (on or around July 1), all employees with active Portal accounts will be required to review and re-accept the Agreement as a condition of continued access;
• Upon any material update to the Portal that changes the scope of data collected, the purpose for which data is used, how data is stored or shared, or the rights of users under this Agreement;
• As required by changes in applicable law or regulation.
You will be notified of material updates through the Portal at the time of your next login. Continued use of the Portal following such notification constitutes your acceptance of the revised Agreement. If you do not accept the revised terms, you must notify your supervisor and discontinue use of the Portal.
Records of each acceptance, including date, version, and method of acceptance, are logged in Firestore as a compliance record.

14. Developer Obligations & Company Protections
In recognition of the Developer’s privileged access to PoolPro’s infrastructure and the employee data processed therein, the Developer, Samuel Harmon, expressly commits to the following obligations for the benefit of the Company and its employees. These obligations are binding on the Developer and are enforceable by the Company.

14.1 Developer Data Use Restrictions
• The Developer will not access, use, copy, export, share, or disclose any employee personal data stored in PoolPro except as strictly necessary to maintain, debug, or improve the Portal’s technical functionality;
• The Developer will not use employee data for any personal, commercial, or research purpose outside the scope of Portal operations;
• The Developer will not share access credentials, administrative keys, or Firebase console access with any unauthorized third party;
• Any access by the Developer to production data for maintenance or debugging purposes will be limited to the minimum necessary and will not involve retention or copying of employee records outside the Firebase environment.

14.2 Developer System Integrity Obligations
• The Developer will maintain PoolPro in good working order and will not intentionally introduce defects, backdoors, unauthorized data collection mechanisms, or malicious code into the Portal;
• The Developer will promptly notify the Company of any known security vulnerability, data breach, or technical failure that could affect employee data or Portal availability;
• The Developer will not alter, delete, or tamper with employee records, audit logs, agreement acceptance records, inspection images in Firebase Storage, or other data within the Portal’s Firebase infrastructure except as directed by the Company for legitimate maintenance purposes;
• The Developer will not unilaterally modify the scope of data collected by the Portal without updating this Agreement and obtaining re-acceptance from affected users.

14.3 Company Remedies for Developer Breach
In the event the Developer materially violates the obligations set forth in this Section, the Company shall have the right to:
• Immediately suspend or terminate the Company’s use of PoolPro and revoke the Developer’s administrative access to all Firebase and Firestore resources associated with the Company’s deployment;
• Seek appropriate legal remedies under applicable South Carolina and federal law, including but not limited to claims for breach of contract, unauthorized access under the South Carolina Computer Crime Act (S.C. Code Ann. § 16-16-10 et seq.), and violations of applicable federal computer fraud and privacy statutes;
• Notify affected employees of any Developer breach that resulted in unauthorized access to or misuse of their personal data, consistent with the breach notification obligations in Section 7.
Nothing in this Section limits any other legal or equitable remedy available to the Company or to individual employees under applicable law.

15. Governing Law & Dispute Resolution
This Agreement is governed by the laws of the State of South Carolina, without regard to its conflict of laws principles. Any dispute arising out of or related to this Agreement or your use of the Portal shall be resolved in accordance with the Company’s applicable employment policies and, where necessary, through appropriate legal channels in the State of South Carolina.

16. Disclaimer of Warranties & Limitation of Liability
PoolPro is provided on an "as-is" and "as-available" basis for internal employment use. Neither the Developer nor the Company warrants that the Portal will be error-free, uninterrupted, or completely secure. To the fullest extent permitted by applicable law, the Developer’s and Company’s combined liability for any claim arising out of your use of the Portal is limited to the minimum extent required by law.

17. Contact Information
If you have questions about this Agreement, your data, or the Portal, please contact the appropriate party listed below. For questions specifically regarding PoolPro’s proprietary software, intellectual property, technical operations, or Developer obligations under Section 14, please contact the Developer directly.
Organization: Upstate Pool Management Group | Capital City Aquatics
Contact Method: Please contact your direct supervisor or a designated Portal administrator.
Developer: Samuel Harmon
Developer Contact: [Developer contact method or designated reporting channel]

EMPLOYEE ACKNOWLEDGMENT & CONSENT
By selecting the acknowledgment checkbox on the Portal during your first login, or upon any re-acceptance required under Section 13, you confirm and agree that:
• You have read and understood this User Agreement, Terms of Use & Data Privacy Notice in its entirety;
• You voluntarily consent to the collection, storage, and use of your data as described in this Agreement, including the collection of your email address for authentication purposes and the submission of facility inspection images and operational data;
• You have read and agree to comply with the Image Submission Policy in Section 4.3, and understand that submitting images of identifiable persons is prohibited;
• If you are a Minor Employee (under 18 years of age), you represent that you have reviewed these terms and, where required, that parental or guardian consent has been obtained;
• You understand that your acknowledgment will be recorded with a timestamp in the Company’s Firestore database as a compliance record;
• You agree to be bound by all terms of this Agreement, including the acceptable use requirements in Section 10;
• You understand this Agreement must be re-accepted annually and upon material updates as described in Section 13.
■ I have read, understood, and agree to the terms of this Agreement.`;

const modalState = {
  ready: false,
  resolve: null,
  context: null,
  options: null,
  nodes: {},
};

function normalizeText(value) {
  return (value || '').toString().trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeUserContext(context = {}) {
  const email = (context.email || '').toString().trim().toLowerCase();
  const username = (context.username || '').toString().trim().toLowerCase();
  const firstName = (context.firstName || '').toString().trim();
  const lastName = (context.lastName || '').toString().trim();
  const displayName = (context.displayName || `${firstName} ${lastName}`).trim();
  const employeeId = (context.employeeId || email || username || '').toString().trim();
  const role = (context.role || 'user').toString().trim().toLowerCase();
  const agreementId = email ? `email:${email}` : `${role}:${username || employeeId || 'unknown-user'}`;

  return {
    ...context,
    role,
    email,
    username,
    firstName,
    lastName,
    displayName,
    employeeId,
    agreementId,
  };
}

function isAgreementAccepted(data) {
  return !!(data && data.acknowledged && data.agreementVersion === AGREEMENT_VERSION);
}

function ensureStyles() {
  if (document.getElementById('poolproAgreementStyles')) return;
  const style = document.createElement('style');
  style.id = 'poolproAgreementStyles';
  style.textContent = `
    .agreement-modal {
      position: fixed;
      inset: 0;
      z-index: 5000;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: rgba(8, 13, 18, 0.76);
      opacity: 0;
      transition: opacity 0.25s ease;
      backdrop-filter: blur(4px);
    }
    .agreement-modal.visible {
      display: flex;
      opacity: 1;
    }
    .agreement-dialog {
      width: min(980px, 100%);
      max-height: min(92vh, 900px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: linear-gradient(180deg, rgba(24, 29, 36, 0.98), rgba(14, 18, 24, 0.98));
      color: #eef1f6;
      box-shadow: 0 28px 70px rgba(0, 0, 0, 0.42);
      transform: translateY(16px);
      transition: transform 0.25s ease;
    }
    .agreement-modal.visible .agreement-dialog {
      transform: translateY(0);
    }
    .agreement-header {
      padding: 22px 24px 18px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      background: linear-gradient(135deg, rgba(105, 20, 14, 0.92), rgba(32, 40, 52, 0.92));
    }
    .agreement-header h2 {
      margin: 0;
      font-size: 1.7rem;
      letter-spacing: 0.02em;
    }
    .agreement-header p {
      margin: 8px 0 0;
      color: rgba(255, 255, 255, 0.84);
      line-height: 1.5;
    }
    .agreement-user-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 14px;
    }
    .agreement-user-chip {
      padding: 7px 12px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(255, 255, 255, 0.08);
      font-size: 0.92rem;
      color: #f4f7fb;
    }
    .agreement-body {
      padding: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-height: 0;
      flex: 1;
    }
    .agreement-scroll {
      padding: 22px 24px 0;
      overflow-y: auto;
      min-height: 0;
      flex: 1;
      background:
        radial-gradient(circle at top left, rgba(105, 20, 14, 0.16), transparent 28%),
        linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0));
    }
    .agreement-kicker {
      margin: 0 0 16px;
      color: #dfe6ee;
      line-height: 1.55;
      font-size: 0.98rem;
    }
    .agreement-document {
      padding: 18px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(4, 7, 11, 0.34);
      color: #f0f3f8;
      white-space: pre-wrap;
      line-height: 1.6;
      font-size: 0.95rem;
    }
    .agreement-actions {
      padding: 18px 24px 24px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(10, 13, 18, 0.96);
    }
    .agreement-form-row {
      display: grid;
      grid-template-columns: minmax(240px, 1fr) auto;
      gap: 16px;
      align-items: end;
    }
    .agreement-field label {
      display: block;
      margin-bottom: 8px;
      font-weight: 700;
      color: #f7f9fc;
    }
    .agreement-field input[type="text"] {
      width: 100%;
      padding: 12px 14px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      background: rgba(255, 255, 255, 0.06);
      color: #fff;
      font-size: 1rem;
      outline: none;
      transition: border-color 0.2s ease, background 0.2s ease;
    }
    .agreement-field input[type="text"]:focus {
      border-color: rgba(147, 197, 253, 0.95);
      background: rgba(255, 255, 255, 0.1);
    }
    .agreement-checkbox {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      margin-top: 14px;
      color: #eef3fa;
      line-height: 1.45;
    }
    .agreement-checkbox input {
      margin-top: 3px;
      width: 18px;
      height: 18px;
      accent-color: #a73f33;
      flex: 0 0 auto;
    }
    .agreement-button-row {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 16px;
      flex-wrap: wrap;
    }
    .agreement-btn {
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(255, 255, 255, 0.08);
      color: #f3f6fb;
      padding: 12px 18px;
      font-size: 0.96rem;
      cursor: pointer;
      transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
    }
    .agreement-btn:hover {
      transform: translateY(-1px);
      background: rgba(255, 255, 255, 0.14);
    }
    .agreement-btn.primary {
      background: linear-gradient(135deg, #8f2319, #be594a);
      border-color: rgba(255, 255, 255, 0.18);
      box-shadow: 0 10px 24px rgba(143, 35, 25, 0.28);
    }
    .agreement-btn.primary:hover {
      background: linear-gradient(135deg, #a22b1f, #d06d5f);
    }
    .agreement-message {
      margin-top: 12px;
      min-height: 20px;
      color: #f5d5d0;
      font-size: 0.94rem;
    }
    .agreement-message.success {
      color: #c8f2d2;
    }
    .agreement-hint {
      margin-top: 8px;
      font-size: 0.88rem;
      color: rgba(236, 242, 249, 0.72);
    }
    body.agreement-open {
      overflow: hidden;
    }
    @media (max-width: 720px) {
      .agreement-modal {
        padding: 12px;
      }
      .agreement-header,
      .agreement-scroll,
      .agreement-actions {
        padding-left: 16px;
        padding-right: 16px;
      }
      .agreement-form-row {
        grid-template-columns: 1fr;
      }
      .agreement-dialog {
        max-height: 95vh;
      }
    }
  `;
  document.head.appendChild(style);
}

function ensureModal() {
  if (modalState.ready) return;
  ensureStyles();

  const modal = document.createElement('div');
  modal.id = 'poolproAgreementModal';
  modal.className = 'agreement-modal';
  modal.innerHTML = `
    <div class="agreement-dialog" role="dialog" aria-modal="true" aria-labelledby="agreementTitle">
      <div class="agreement-header">
        <h2 id="agreementTitle">${AGREEMENT_TITLE}</h2>
        <p>Review and accept this agreement before using PoolPro. Your signed acknowledgment will be saved to Firebase as a compliance record.</p>
        <div class="agreement-user-row" id="agreementUserRow"></div>
      </div>
      <div class="agreement-body">
        <div class="agreement-scroll">
          <p class="agreement-kicker">This copy reflects <strong>PoolPro_User_Agreement_v2</strong> with an effective date of <strong>${AGREEMENT_EFFECTIVE_DATE}</strong>.</p>
          <div class="agreement-document" id="agreementDocument"></div>
        </div>
        <div class="agreement-actions">
          <form id="agreementForm">
            <div class="agreement-form-row">
              <div class="agreement-field">
                <label for="agreementSignatureInput">Type your full name as your signature</label>
                <input id="agreementSignatureInput" type="text" autocomplete="name" />
                <div class="agreement-hint" id="agreementSignatureHint"></div>
              </div>
            </div>
            <label class="agreement-checkbox">
              <input id="agreementCheckbox" type="checkbox" />
              <span>I have read, understand, and agree to the PoolPro User Agreement, Terms of Use, and Data Privacy Notice.</span>
            </label>
            <div class="agreement-button-row">
              <button type="button" class="agreement-btn" id="agreementDeclineBtn">Cancel</button>
              <button type="submit" class="agreement-btn primary">Sign and Continue</button>
            </div>
            <div class="agreement-message" id="agreementMessage" aria-live="polite"></div>
          </form>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modalState.nodes = {
    modal,
    userRow: modal.querySelector('#agreementUserRow'),
    document: modal.querySelector('#agreementDocument'),
    form: modal.querySelector('#agreementForm'),
    signatureInput: modal.querySelector('#agreementSignatureInput'),
    signatureHint: modal.querySelector('#agreementSignatureHint'),
    checkbox: modal.querySelector('#agreementCheckbox'),
    declineBtn: modal.querySelector('#agreementDeclineBtn'),
    message: modal.querySelector('#agreementMessage'),
  };

  modalState.nodes.document.textContent = AGREEMENT_TEXT;
  modalState.nodes.form.addEventListener('submit', handleAgreementSubmit);
  modalState.nodes.declineBtn.addEventListener('click', handleAgreementDecline);

  modalState.ready = true;
}

function setAgreementMessage(text, isError = false) {
  const el = modalState.nodes.message;
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('success', !!text && !isError);
}

function openModal(context, options) {
  ensureModal();
  modalState.context = context;
  modalState.options = options || {};

  const { modal, userRow, signatureInput, signatureHint, checkbox } = modalState.nodes;

  userRow.innerHTML = '';
  [
    context.displayName && `Name: ${context.displayName}`,
    context.role && `Role: ${context.role[0].toUpperCase()}${context.role.slice(1)}`,
    context.email && `Email: ${context.email}`,
    context.username && context.username !== context.email && `Username: ${context.username}`,
  ].filter(Boolean).forEach((label) => {
    const chip = document.createElement('div');
    chip.className = 'agreement-user-chip';
    chip.textContent = label;
    userRow.appendChild(chip);
  });

  signatureInput.value = '';
  checkbox.checked = false;
  signatureHint.textContent = context.displayName
    ? `Signature must match the name on file: ${context.displayName}`
    : 'Use your normal full name as your electronic signature.';
  setAgreementMessage('');

  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('visible'));
  document.body.classList.add('agreement-open');
  signatureInput.focus();

  return new Promise((resolve) => {
    modalState.resolve = resolve;
  });
}

function closeModal(result) {
  const { modal } = modalState.nodes;
  if (!modal) return;
  modal.classList.remove('visible');
  document.body.classList.remove('agreement-open');
  setTimeout(() => {
    modal.style.display = 'none';
  }, 220);

  const resolver = modalState.resolve;
  modalState.resolve = null;
  modalState.context = null;
  modalState.options = null;
  if (resolver) resolver(result);
}

async function handleAgreementDecline() {
  const onDecline = modalState.options?.onDecline;
  if (typeof onDecline === 'function') {
    await onDecline();
  }
  closeModal(false);
}

async function handleAgreementSubmit(event) {
  event.preventDefault();
  const context = modalState.context;
  if (!context) return;

  const signatureName = modalState.nodes.signatureInput.value.trim();
  if (!signatureName) {
    setAgreementMessage('Type your full name to sign the agreement.', true);
    return;
  }
  if (!modalState.nodes.checkbox.checked) {
    setAgreementMessage('Check the acknowledgment box to continue.', true);
    return;
  }
  if (context.displayName && normalizeText(signatureName) !== normalizeText(context.displayName)) {
    setAgreementMessage(`Your signature must match "${context.displayName}".`, true);
    return;
  }

  setAgreementMessage('Saving your signed acknowledgment...');

  try {
    await setDoc(doc(db, 'userAgreements', context.agreementId), {
      acknowledged: true,
      acceptanceMethod: 'typed-signature-checkbox',
      agreementVersion: AGREEMENT_VERSION,
      agreementTitle: AGREEMENT_TITLE,
      effectiveDate: AGREEMENT_EFFECTIVE_DATE,
      signatureName,
      email: context.email || '',
      username: context.username || '',
      role: context.role || '',
      employeeId: context.employeeId || '',
      displayName: context.displayName || '',
      firstName: context.firstName || '',
      lastName: context.lastName || '',
      acceptedAt: serverTimestamp(),
      acceptedAtIso: new Date().toISOString(),
      userAgent: navigator.userAgent,
      acceptedPath: window.location.pathname,
      acceptedUrl: window.location.href,
    }, { merge: true });

    setAgreementMessage('Agreement saved.', false);
    closeModal(true);
  } catch (error) {
    console.error('Failed to save agreement acceptance:', error);
    setAgreementMessage(error?.message || 'Could not save your agreement acknowledgment. Please try again.', true);
  }
}

export async function requireUserAgreement(context, options = {}) {
  const normalized = normalizeUserContext(context);
  if (!normalized.agreementId || (!normalized.email && !normalized.username && !normalized.employeeId)) {
    return true;
  }

  const agreementRef = doc(db, 'userAgreements', normalized.agreementId);
  const snap = await getDoc(agreementRef);
  if (snap.exists() && isAgreementAccepted(snap.data())) {
    return true;
  }

  return openModal(normalized, options);
}
