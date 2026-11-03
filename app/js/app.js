// Faybi SN : écrans et navigation de l'application connectée
// Étape 1 : compte, profil, clients, tarifs. Étape 2 : devis et factures. Étape 3 : paiements reçus. Étape 4 : relances.
// Formule Pro : factures illimitées, logo, couleur, signature et cachet ; PDF partagé dans WhatsApp.
import * as db from './db.js';
import {WHATSAPP_GATEWAY, PRO_PAY_NUMBER, PRO_WAVE_URL, PRO_OM_URL, SUPPORT_WHATSAPP} from './config.js';
import {esc, num, parseNum, isEur, amt, amtShort, toMinor, toMajor, toXOF, decimal, today, addDays, fmtDate, totals, sommeEnLettres} from './format.js';

const $ = s => document.querySelector(s);

const state = {session: null, profile: null, clients: [], catalog: [], docs: [], payments: [], loaded: false, loadErr: ''};
const ui = {view: 'home', authMode: 'login', err: '', info: '', busy: false, clientDraft: null, catDraft: null, confirm: null, recovery: false,
  doc: null, draft: null, filter: 'all', q: '', share: false, back: null, phone: '', phoneStep: 1, pay: null, payDel: null, delAsk: false, sigPad: false, imgKey: null, pdf: null};

/* ---------- Messages d'erreur lisibles ---------- */
function humanError(e) {
  const m = String(e?.message || e || '');
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou mot de passe incorrect.';
  if (/already registered|already exists/i.test(m)) return 'Un compte existe déjà avec cet e-mail. Connectez-vous.';
  if (/Email not confirmed/i.test(m)) return 'Confirmez d’abord votre adresse avec le lien reçu par e-mail.';
  if (/Token has expired or is invalid|otp.*(expired|invalid)/i.test(m)) return 'Code incorrect ou expiré. Redemandez un code.';
  if (/security purposes/i.test(m)) return 'Patientez quelques secondes avant de redemander un code.';
  if (/phone.*(disabled|provider)|Unsupported phone/i.test(m)) return 'La connexion par numéro n’est pas encore activée. Utilisez votre e-mail.';
  if (/Code Pro invalide/i.test(m)) return 'Ce code Pro n’est pas valable ou a déjà été utilisé. Vérifiez-le (format PRO-XXXX-XXXX).';
  if (/Password should be at least/i.test(m)) return 'Le mot de passe doit contenir au moins 6 caractères.';
  if (/rate limit|too many/i.test(m)) return 'Trop de tentatives. Patientez quelques minutes avant de réessayer.';
  if (/valid email|invalid email/i.test(m)) return 'Cette adresse e-mail n’est pas valide.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Connexion impossible. Vérifiez votre accès à internet.';
  if (/foreign key/i.test(m) && /client/i.test(m)) return 'Ce client a des devis ou des factures : il ne peut pas être supprimé.';
  if (/row-level security|permission denied/i.test(m)) return 'Action non autorisée sur ce document.';
  if (/relation .* does not exist|schema cache|Could not find the function/i.test(m)) return 'La base de données n’est pas à jour : lancez le script supabase/schema.sql dans Supabase.';
  return m || 'Une erreur est survenue.';
}

let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }

/* ---------- Chargement ---------- */
async function loadAll() {
  try {
    const [profile, clients, catalog, docs, payments] = await Promise.all([db.getProfile(state.session.user), db.listClients(), db.listCatalog(), db.listDocuments(), db.listPayments()]);
    Object.assign(state, {profile, clients, catalog, docs, payments, loaded: true, loadErr: ''});
    if (!profile.name) ui.view = 'onboarding';
  } catch (e) {
    state.loadErr = humanError(e);
  }
  render();
}

/* ---------- Devis et factures : état et libellés ---------- */
function stOf(d) {
  if (d.status === 'draft') return 'draft';
  if (d.status === 'cancelled') return 'cancelled';
  const past = d.due_date && d.due_date < today();
  if (d.type === 'DEV') return d.converted_to ? 'accepted' : past ? 'expired' : 'quote';
  if (restOf(d) <= 0) return 'paid';
  if (past) return 'late';
  if (d.paid_amount > 0) return d.deposit_amount && d.paid_amount >= d.deposit_amount ? 'deposit' : 'partial';
  return 'issued';
}
// Reste à payer d'une facture validée (0 pour un devis, un brouillon ou une facture annulée)
const restOf = d => d.type === 'FAC' && d.status === 'sent' ? d.total_ttc - (d.paid_amount || 0) : 0;
const ST = {draft: ['Brouillon', 'neutral'], issued: ['À encaisser', 'info'], late: ['Échéance passée', 'warn'], quote: ['Devis envoyé', 'info'],
  accepted: ['Devis accepté', 'good'], expired: ['Devis expiré', 'muted'], cancelled: ['Annulé', 'muted'],
  paid: ['Payée', 'good'], deposit: ['Acompte reçu', 'info'], partial: ['Payée en partie', 'info']};
const METHODS = ['Wave', 'Orange Money', 'Free Money', 'Virement', 'Espèces', 'Chèque', 'Carte'];
const pill = s => `<span class="pill ${ST[s][1]}">${ST[s][0]}</span>`;
const clientOf = id => state.clients.find(c => c.id === id);
const cName = id => clientOf(id)?.name || 'Client supprimé';
const docLabel = d => d.number || (d.type === 'DEV' ? 'Devis brouillon' : 'Facture brouillon');

/* ---------- Formule ---------- */
const FREE_INVOICES = 5;
// Pro actif : formule Pro sans date de fin, ou date de fin pas encore passée (Pro acheté par code)
const isPro = () => state.profile?.plan === 'pro' && (!state.profile.pro_until || state.profile.pro_until >= today());
const proLabel = () => isPro() ? `Pro${state.profile.pro_until ? ` jusqu’au ${fmtDate(state.profile.pro_until)}` : ''}` : 'Gratuit';
// Factures validées ce mois-ci (les annulées comptent aussi)
const monthInvoices = () => state.docs.filter(d => d.type === 'FAC' && d.status !== 'draft' && (d.sent_at || '').slice(0, 7) === today().slice(0, 7)).length;
const proRef = () => 'FSN-' + state.profile.id.slice(0, 6).toUpperCase();

/* ---------- Relances : calendrier ---------- */
// 3 jours avant l'échéance, le jour même, 7 et 15 jours après, puis tous les 15 jours
const REMIND_STEPS = [-3, 0, 7, 15];
const stepDay = k => k < REMIND_STEPS.length ? REMIND_STEPS[k] : 15 * (k - 2);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const lateDays = d => daysBetween(d.due_date || d.issue_date, today());
// Dernière étape atteinte (on ne relance jamais dans les 3 jours qui suivent la facture)
function remindStep(d) {
  if (restOf(d) <= 0) return null;
  const base = d.due_date || d.issue_date, late = lateDays(d);
  let k = -1;
  while (stepDay(k + 1) <= late) k++;
  if (k < 0) return null;
  const date = addDays(base, stepDay(k));
  return date < addDays(d.issue_date, 3) ? null : {k, date};
}
// Relance à faire aujourd'hui : étape atteinte, pas encore envoyée, ni reportée, ni désactivée pour ce client
function remindDue(d) {
  const s = remindStep(d);
  if (!s || state.profile?.reminders_on === false || clientOf(d.client_id)?.reminders_off) return null;
  if (d.reminded_at && d.reminded_at >= s.date) return null;
  if (d.remind_after && d.remind_after > today()) return null;
  return s;
}
// Date de la prochaine relance prévue (null si aucune)
function nextRemind(d) {
  if (restOf(d) <= 0 || state.profile?.reminders_on === false || clientOf(d.client_id)?.reminders_off) return null;
  if (remindDue(d)) return today();
  const s = remindStep(d), snoozed = d.remind_after && d.remind_after > today() ? d.remind_after : null;
  if (s && snoozed && !(d.reminded_at && d.reminded_at >= s.date)) return snoozed;
  const base = d.due_date || d.issue_date, min = addDays(d.issue_date, 3);
  let k = 0;
  while (addDays(base, stepDay(k)) <= today() || addDays(base, stepDay(k)) < min) k++;
  const next = addDays(base, stepDay(k));
  return snoozed && snoozed > next ? snoozed : next;
}
const remindWhen = d => { const n = lateDays(d); return n < 0 ? `échéance dans ${-n} j` : n === 0 ? 'échéance aujourd’hui' : `${n} j de retard`; };
const remindRank = d => d.reminder_count ? `${d.reminder_count + 1}ᵉ relance` : '1ʳᵉ relance';

/* ---------- Écrans hors connexion ---------- */
const brand = `<div class="brand"><span class="mark" aria-hidden="true">FS</span><div><b>Faybi SN</b><small>Pour les freelances</small></div></div>`;
const msgs = () => `${ui.err ? `<div class="err" role="alert">${esc(ui.err)}</div>` : ''}${ui.info ? `<div class="ok" role="status">${esc(ui.info)}</div>` : ''}`;

function vSetup() {
  return `<div class="auth"><div class="auth-card">${brand}<h1>Configuration requise</h1>
    <p class="muted" style="margin:0">L’application n’est pas encore reliée à sa base de données. Renseignez l’adresse et la clé publique du projet Supabase dans <code>app/js/config.js</code>.</p>
    <a class="btn" href="../demo.html">Voir la démo en attendant</a></div></div>`;
}

// Numéro saisi -> format international (+221 par défaut pour les numéros à 9 chiffres)
function normPhone(v) {
  let d = String(v).replace(/\D/g, '').replace(/^00/, '');
  if (d.length === 9) d = '221' + d;
  return d.length >= 11 && d.length <= 15 ? '+' + d : '';
}
const showPhone = p => p.replace(/^\+221(\d{2})(\d{3})(\d{2})(\d{2})$/, '+221 $1 $2 $3 $4');
const userLabel = u => u.email || (u.phone ? showPhone('+' + u.phone) : '');

function vPhone() {
  const wa = `https://wa.me/${WHATSAPP_GATEWAY}?text=${encodeURIComponent('Bonjour Faybi SN, je demande mon code de connexion.')}`;
  if (ui.phoneStep === 1) return `<div class="auth"><form class="auth-card" id="phoneform">${brand}<h1>Connexion avec votre numéro</h1>
    <p class="muted" style="margin:0">Vous recevrez un code par WhatsApp. Pas besoin de mot de passe. Votre compte est créé automatiquement la première fois.</p>
    <label class="field">Numéro WhatsApp<input type="tel" id="a-phone" value="${esc(ui.phone)}" placeholder="77 123 45 67" autocomplete="tel" required></label>
    ${msgs()}
    <button class="btn primary" type="submit" ${ui.busy ? 'disabled' : ''}>Recevoir mon code</button>
    <button class="linkbtn" type="button" data-act="authMode" data-mode="login">← Utiliser mon e-mail</button></form></div>`;
  return `<div class="auth"><form class="auth-card" id="codeform">${brand}<h1>Demandez votre code sur WhatsApp</h1>
    <ol class="muted" style="margin:0;padding-left:20px"><li>Appuyez sur le bouton vert : WhatsApp s’ouvre avec un message prêt.</li>
      <li>Envoyez-le <b>depuis le ${esc(showPhone(ui.phone))}</b>.</li><li>Vous recevez votre code en réponse : tapez-le ci-dessous.</li></ol>
    <a class="btn primary" href="${esc(wa)}" target="_blank" rel="noopener">Demander mon code sur WhatsApp</a>
    <label class="field">Code reçu<input type="text" id="a-code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required></label>
    ${msgs()}
    <button class="btn" type="submit" ${ui.busy ? 'disabled' : ''}>Se connecter</button>
    <button class="linkbtn" type="button" data-act="phoneBack">← Changer de numéro</button></form></div>`;
}

function vAuth() {
  const m = ui.authMode;
  if (m === 'phone') return vPhone();
  if (m === 'forgot') return `<div class="auth"><form class="auth-card" id="forgotform">${brand}<h1>Mot de passe oublié</h1>
    <p class="muted" style="margin:0">Indiquez votre e-mail : vous recevrez un lien pour choisir un nouveau mot de passe.</p>
    <label class="field">E-mail<input type="email" id="a-email" autocomplete="email" required></label>
    ${msgs()}
    <button class="btn primary" type="submit" ${ui.busy ? 'disabled' : ''}>Envoyer le lien</button>
    <button class="linkbtn" type="button" data-act="authMode" data-mode="login">← Retour à la connexion</button></form></div>`;
  return `<div class="auth"><form class="auth-card" id="authform">${brand}
    <div class="tabs" role="group" aria-label="Choix"><button type="button" data-act="authMode" data-mode="login" aria-pressed="${m === 'login'}">Se connecter</button>
      <button type="button" data-act="authMode" data-mode="signup" aria-pressed="${m === 'signup'}">Créer un compte</button></div>
    <h1>${m === 'signup' ? 'Créez votre compte gratuit' : 'Content de vous revoir'}</h1>
    <label class="field">E-mail<input type="email" id="a-email" autocomplete="email" required></label>
    <label class="field">Mot de passe<input type="password" id="a-pass" autocomplete="${m === 'signup' ? 'new-password' : 'current-password'}" minlength="6" required></label>
    ${m === 'signup' ? '<small class="muted">Au moins 6 caractères.</small>' : ''}
    ${msgs()}
    <button class="btn primary" type="submit" ${ui.busy ? 'disabled' : ''}>${m === 'signup' ? 'Créer mon compte' : 'Se connecter'}</button>
    ${m === 'login' ? '<button class="linkbtn" type="button" data-act="authMode" data-mode="forgot">Mot de passe oublié ?</button>' : ''}
    ${WHATSAPP_GATEWAY ? '<div class="or"><span>ou</span></div><button class="btn" type="button" data-act="authMode" data-mode="phone">Continuer avec mon numéro (WhatsApp)</button>' : ''}
    <a class="linkbtn" href="../demo.html">Voir la démo sans compte</a>
    <small class="muted" style="text-align:center">En continuant, vous acceptez les <a href="../conditions.html" target="_blank" rel="noopener">conditions d’utilisation</a> et la <a href="../confidentialite.html" target="_blank" rel="noopener">politique de confidentialité</a>.</small></form></div>`;
}

function vReset() {
  return `<div class="auth"><form class="auth-card" id="resetform">${brand}<h1>Nouveau mot de passe</h1>
    <label class="field">Nouveau mot de passe<input type="password" id="a-pass" autocomplete="new-password" minlength="6" required></label>
    ${msgs()}
    <button class="btn primary" type="submit" ${ui.busy ? 'disabled' : ''}>Enregistrer</button></form></div>`;
}

/* ---------- Écrans connectés ---------- */
function vOnboarding() {
  const p = state.profile;
  return `<div class="auth"><form class="auth-card" id="onboardform">${brand}<h1>Bienvenue ! Présentez-vous</h1>
    <p class="muted" style="margin:0">Ces informations apparaîtront sur vos devis et factures. Vous pourrez les modifier plus tard.</p>
    <label class="field">Votre nom ou nom de marque<input type="text" id="o-name" value="${esc(p.name)}" placeholder="Ex. : Khady Sy" required></label>
    <label class="field">Votre métier<input type="text" id="o-job" value="${esc(p.job)}" placeholder="Ex. : Développeur web"></label>
    <label class="field">Numéro Wave / Orange Money<input type="tel" id="o-phone" value="${esc(p.phone_pay || (state.session.user.phone ? showPhone('+' + state.session.user.phone) : ''))}" placeholder="+221 77 000 00 00"></label>
    ${msgs()}
    <button class="btn primary" type="submit" ${ui.busy ? 'disabled' : ''}>Continuer</button></form></div>`;
}

function vHome() {
  const p = state.profile, nc = state.clients.length, nt = state.catalog.length, nd = state.docs.length;
  const month = today().slice(0, 7);
  const billed = state.docs.filter(d => d.type === 'FAC' && d.status === 'sent' && d.issue_date.slice(0, 7) === month).reduce((a, d) => a + toXOF(d.currency, d.total_ttc), 0);
  const curOf = Object.fromEntries(state.docs.map(d => [d.id, d.currency]));
  const cashed = state.payments.filter(x => x.paid_at.slice(0, 7) === month).reduce((a, x) => a + toXOF(curOf[x.document_id], x.amount), 0);
  const due = state.docs.reduce((a, d) => a + toXOF(d.currency, restOf(d)), 0), unpaid = state.docs.filter(d => restOf(d) > 0).length;
  const late = state.docs.filter(d => stOf(d) === 'late').length, drafts = state.docs.filter(d => d.status === 'draft').length;
  const toRemind = state.docs.filter(remindDue);
  const step = (done, title, sub, act) => `<div class="step ${done ? 'done' : ''}"><span class="dot">${done ? '✓' : '·'}</span>
    <div class="txt"><b>${title}</b><small>${sub}</small></div>${act || ''}</div>`;
  const started = Boolean(p.phone_pay && p.job) && nc > 0 && nt > 0 && nd > 0;
  return `<div class="head"><div><h1>Bonjour ${esc(p.name.split(' ')[0])}</h1><p>Votre espace Faybi SN est prêt.</p></div>
    <div class="row"><button class="btn" data-act="new" data-type="DEV">+ Devis</button><button class="btn primary" data-act="new" data-type="FAC">+ Facture</button></div></div>
  <div class="stack">
    <div class="kpis">
      <div class="kpi"><span class="lbl">Facturé ce mois</span><span class="val">${num(billed)} <small>FCFA</small></span><span class="sub">${p.goal_xof ? `objectif ${num(p.goal_xof)} FCFA` : 'factures validées'}</span></div>
      <div class="kpi"><span class="lbl">Encaissé ce mois</span><span class="val">${num(cashed)} <small>FCFA</small></span><span class="sub">paiements enregistrés</span></div>
      <div class="kpi"><span class="lbl">Reste à encaisser</span><span class="val">${num(due)} <small>FCFA</small></span><span class="sub">${unpaid} facture${unpaid > 1 ? 's' : ''}${late ? ` · ${late} en retard` : ''}</span></div>
      <div class="kpi"><span class="lbl">Brouillons</span><span class="val">${drafts}</span><span class="sub">à valider</span></div>
    </div>
    ${started ? '' : `<section class="card"><h2>Pour bien démarrer</h2><div class="steps">
      ${step(true, 'Créer votre compte', 'C’est fait.')}
      ${step(Boolean(p.phone_pay && p.job), 'Compléter votre profil', 'Métier, numéro Wave ou Orange Money, NINEA si vous en avez un.', `<button class="btn sm" data-act="go" data-view="profile">Mon profil</button>`)}
      ${step(nc > 0, 'Ajouter votre premier client', nc ? `${nc} client${nc > 1 ? 's' : ''} enregistré${nc > 1 ? 's' : ''}.` : 'Nom, contact et numéro WhatsApp.', `<button class="btn sm" data-act="clientNew">+ Client</button>`)}
      ${step(nt > 0, 'Ajouter vos tarifs habituels', nt ? `${nt} prestation${nt > 1 ? 's' : ''} enregistrée${nt > 1 ? 's' : ''}.` : 'Leur prix se remplira tout seul dans vos factures.', `<button class="btn sm" data-act="catNew">+ Tarif</button>`)}
      ${step(nd > 0, 'Créer votre premier devis ou facture', nd ? 'C’est parti !' : 'Le numéro est attribué automatiquement à la validation.', `<button class="btn sm" data-act="new" data-type="DEV">+ Devis</button>`)}
    </div></section>`}
    ${toRemind.length ? `<section class="card"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h2>Relances du jour</h2>${toRemind.length > 5 ? `<button class="btn ghost sm" data-act="filter" data-f="remind" data-go="1">Tout voir (${toRemind.length})</button>` : ''}</div>
      <p class="muted" style="margin:0 0 10px">Le message est déjà écrit : WhatsApp s’ouvre, vous n’avez plus qu’à l’envoyer.</p>
      <div class="tablewrap">${remindTable(toRemind.slice(0, 5))}</div></section>` : ''}
    ${nd ? `<section class="card"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h2>Derniers documents</h2><button class="btn ghost sm" data-act="go" data-view="docs">Tout voir</button></div>
      <div class="tablewrap">${docTable(state.docs.slice(0, 5))}</div></section>` : ''}
    ${isPro() ? '' : `<p class="note">Formule gratuite : ${monthInvoices()} facture${monthInvoices() > 1 ? 's' : ''} validée${monthInvoices() > 1 ? 's' : ''} sur ${FREE_INVOICES} ce mois-ci. <a href="#" data-act="go" data-view="pro">Passer en Pro</a> pour des factures illimitées, votre logo, votre signature et votre cachet.</p>`}
    <p class="note">Bêta : les liens de paiement Wave / Orange Money et les relances automatiques par e-mail arrivent aux prochaines étapes.</p>
  </div>`;
}

/* ---------- Liste des documents ---------- */
const FILTERS = [['all', 'Tous'], ['FAC', 'Factures'], ['DEV', 'Devis'], ['draft', 'Brouillons'], ['unpaid', 'À encaisser'], ['remind', 'À relancer'], ['late', 'Échéance passée'], ['paid', 'Payées']];
function matchFilter(d, f) {
  if (f === 'all') return true;
  if (f === 'FAC' || f === 'DEV') return d.type === f;
  if (f === 'draft') return d.status === 'draft';
  if (f === 'unpaid') return restOf(d) > 0;
  if (f === 'remind') return Boolean(remindDue(d));
  return stOf(d) === f;
}
function docTable(list) {
  return `<table class="list"><thead><tr><th>N°</th><th>Client</th><th class="hide-sm">Date</th><th class="hide-sm">Échéance</th><th class="num">Montant</th><th class="num hide-sm">Reste dû</th><th>Statut</th></tr></thead>
    <tbody>${list.map(d => `<tr data-act="open" data-id="${d.id}" tabindex="0">
      <td class="mono">${esc(docLabel(d))}</td><td class="cl">${esc(cName(d.client_id))}</td>
      <td class="hide-sm">${fmtDate(d.issue_date)}</td><td class="hide-sm">${fmtDate(d.due_date)}</td>
      <td class="num">${amtShort(d.currency, d.total_ttc)}</td><td class="num hide-sm">${restOf(d) > 0 ? amtShort(d.currency, restOf(d)) : '—'}</td><td>${pill(stOf(d))}</td></tr>`).join('')}</tbody></table>`;
}
function remindTable(list) {
  return `<table class="list"><thead><tr><th>Client</th><th class="num">Reste dû</th><th class="num">Relance</th></tr></thead>
    <tbody>${list.map(d => { const c = clientOf(d.client_id) || {};
      return `<tr data-act="open" data-id="${d.id}" tabindex="0">
      <td class="cl"><b>${esc(cName(d.client_id))}</b><br><small class="muted"><span class="mono">${esc(d.number)}</span> · ${remindWhen(d)} · ${remindRank(d)}</small></td>
      <td class="num">${amtShort(d.currency, restOf(d))}</td>
      <td class="num"><div class="row" style="justify-content:flex-end;flex-wrap:nowrap">
        ${c.phone ? `<a class="btn sm primary" href="${esc(waLink(c.phone, reminderText(d, state.profile, c)))}" data-act="remindWa" data-id="${d.id}">WhatsApp</a>`
          : `<button class="btn sm primary" data-act="open" data-id="${d.id}" title="Ce client n’a pas de numéro">Voir</button>`}
        <button class="btn sm ghost" data-act="snooze" data-id="${d.id}" data-days="3" title="Reporter de 3 jours">Plus tard</button></div></td></tr>`; }).join('')}</tbody></table>`;
}
function docList() {
  const q = ui.q.trim().toLowerCase();
  const list = state.docs.filter(d => matchFilter(d, ui.filter) && (!q || (d.number || '').toLowerCase().includes(q) || cName(d.client_id).toLowerCase().includes(q)));
  if (!state.docs.length) return `<div class="card empty"><p>Aucun document pour l’instant.</p><button class="btn primary" data-act="new" data-type="FAC">Créer ma première facture</button></div>`;
  if (!list.length) return `<p class="empty">Aucun document ne correspond à cette recherche.</p>`;
  return `<div class="tablewrap">${docTable(list)}</div>`;
}
function vDocs() {
  const n = state.docs.length;
  return `<div class="head"><div><h1>Factures et devis</h1><p>${n} document${n > 1 ? 's' : ''} · montants sans symbole en FCFA</p></div>
    <div class="row"><button class="btn" data-act="new" data-type="DEV">+ Devis</button><button class="btn primary" data-act="new" data-type="FAC">+ Facture</button></div></div>
    <div class="toolbar"><div class="chips">${FILTERS.map(([k, l]) => `<button class="chip" data-act="filter" data-f="${k}" aria-pressed="${ui.filter === k}">${l}<b>${state.docs.filter(d => matchFilter(d, k)).length}</b></button>`).join('')}</div>
      <input type="search" id="q" class="search" placeholder="Rechercher un client ou un numéro" value="${esc(ui.q)}" aria-label="Rechercher"></div>
    <div id="doclist">${docList()}</div>`;
}

/* ---------- Un document : aperçu, actions, partage ---------- */
function waLink(phone, text) {
  let digits = (phone || '').replace(/\D/g, '');
  if (digits.length === 9) digits = '221' + digits;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
// Mention « Créé avec Faybi SN » sur les documents des comptes gratuits (retirée en Pro)
const MADE_URL = 'https://faybi-sn.pages.dev/?ref=facture';
const showMade = () => !isPro();
function documentText(d, co, c) {
  const dev = d.type === 'DEV';
  const dep = d.deposit_amount ? `\n\nPour démarrer, un acompte de ${d.deposit_pct} % est demandé, soit ${amt(d.currency, d.deposit_amount)}.` : '';
  const pay = isEur(d.currency) ? 'Règlement par virement bancaire.' : `Vous pouvez régler par Wave ou Orange Money au ${co.phone_pay || '[votre numéro]'}.`;
  return `Bonjour ${c.contact || c.name || ''},\n\nVoici ${dev ? 'mon devis' : 'ma facture'} ${d.number} d’un montant de ${amt(d.currency, d.total_ttc)}`
    + `${d.due_date ? (dev ? `, valable jusqu’au ${fmtDate(d.due_date)}` : `, à régler avant le ${fmtDate(d.due_date)}`) : ''}.${dep}\n\n${pay}\n\nMerci pour votre confiance,\n${co.name || ''}`
    + (showMade() ? `\n\n—\n${dev ? 'Devis créé' : 'Facture créée'} avec Faybi SN, gratuit pour les freelances : ${MADE_URL}` : '');
}

// Le ton change avec le retard : rappel aimable, jour de l'échéance, relance, relance ferme
function reminderText(d, co, c) {
  const rest = restOf(d), cur = d.currency, late = lateDays(d), ref = `ma facture ${d.number} du ${fmtDate(d.issue_date)}`;
  const due = d.due_date ? fmtDate(d.due_date) : '';
  const pay = isEur(cur) ? 'Règlement par virement bancaire.' : `Vous pouvez régler par Wave ou Orange Money au ${co.phone_pay || '[votre numéro]'}.`;
  const sum = d.paid_amount > 0 ? `Merci pour le règlement de ${amt(cur, d.paid_amount)} déjà reçu : il reste ${amt(cur, rest)} à payer.` : `Montant : ${amt(cur, d.total_ttc)}.`;
  const intro = !d.due_date ? `Petit rappel concernant ${ref}, qui n’a pas encore été réglée.`
    : late < 0 ? `Petit rappel amical : ${ref} arrive à échéance le ${due}.`
    : late === 0 ? `Je me permets de vous rappeler que ${ref} arrive à échéance aujourd’hui.`
    : late < 15 ? `Sauf erreur de ma part, ${ref}, arrivée à échéance le ${due}, n’a pas encore été réglée.`
    : `Je reviens vers vous au sujet de ${ref}, arrivée à échéance le ${due} : elle reste impayée après ${late} jours de retard${d.reminder_count ? ', malgré mes précédents rappels' : ''}.`;
  const ask = late >= 15 ? 'Merci de procéder au règlement dans les meilleurs délais. Si vous rencontrez une difficulté, dites-le-moi : nous trouverons une solution ensemble.'
    : 'Si le paiement est déjà parti, merci de ne pas tenir compte de ce message.';
  return `Bonjour ${c.contact || c.name || ''},\n\n${intro} ${sum}\n\n${pay}\n\n${ask}\n\nBien cordialement,\n${co.name || ''}`;
}

function paper(d, co, c) {
  const dev = d.type === 'DEV', cur = d.currency, P = state.profile || {}, pro = isPro();
  const logo = pro && P.logo_img, sig = pro && P.signature_img, stp = pro && P.stamp_img;
  return `<article class="paper" aria-label="Aperçu du document"${pro && P.brand_color ? ` style="--accent:${esc(P.brand_color)}"` : ''}>
    ${d.status === 'draft' ? '<div class="watermark" aria-hidden="true">BROUILLON</div>' : ''}
    <div class="p-top">
      <div class="p-co">${logo ? `<img src="${logo}" alt="" class="p-logo">` : ''}<b>${esc(co.name || 'Votre nom')}</b>${co.job ? `<div class="job">${esc(co.job)}</div>` : ''}
        <div>${esc(co.address)}${co.address ? '<br>' : ''}${esc(co.phone_pay)}${co.email ? ' · ' + esc(co.email) : ''}${co.ninea ? '<br>NINEA : ' + esc(co.ninea) : ''}</div></div>
      <div class="p-title"><h3>${dev ? 'DEVIS' : 'FACTURE'}</h3>
        <dl><dt>N°</dt><dd>${esc(d.number || 'attribué à la validation')}</dd><dt>Date</dt><dd>${fmtDate(d.issue_date)}</dd>
        ${d.due_date ? `<dt>${dev ? 'Valable jusqu’au' : 'Échéance'}</dt><dd>${fmtDate(d.due_date)}</dd>` : ''}</dl>
        ${d.status === 'cancelled' ? '<span class="stamp void">ANNULÉ</span>' : stOf(d) === 'paid' ? '<span class="stamp">PAYÉE</span>' : ''}</div>
    </div>
    <div class="p-mid"><div class="p-cl"><div class="lbl">${dev ? 'Destinataire' : 'Facturé à'}</div><b>${esc(c.name)}</b>
      <div>${c.contact ? 'À l’attention de ' + esc(c.contact) + '<br>' : ''}${esc(c.address || '')}${c.phone ? '<br>' + esc(c.phone) : ''}${c.ninea ? '<br>NINEA : ' + esc(c.ninea) : ''}</div></div></div>
    <div class="p-tablewrap"><table class="p-lines"><thead><tr><th>Prestation</th><th class="num">Qté</th><th class="num">Prix unitaire</th><th class="num">Montant</th></tr></thead>
      <tbody>${d.lines.map(l => `<tr><td>${esc(l.description)}</td><td class="num">${decimal(+l.qty)}</td><td class="num">${amt(cur, l.unit_price)}</td><td class="num">${amt(cur, l.amount)}</td></tr>`).join('')}</tbody></table></div>
    <div class="p-sum"><dl>
      ${d.discount_amount ? `<dt>Sous-total</dt><dd>${amt(cur, d.subtotal)}</dd><dt>Remise ${decimal(+d.discount_pct)} %</dt><dd>− ${amt(cur, d.discount_amount)}</dd>` : ''}
      ${d.tva ? `<dt>Total HT</dt><dd>${amt(cur, d.total_ht)}</dd><dt>TVA 18 %</dt><dd>${amt(cur, d.tva_amount)}</dd>` : ''}
      <dt class="ttc">${d.tva ? 'Total TTC' : 'Total'}</dt><dd class="ttc">${amt(cur, d.total_ttc)}</dd>
      ${d.deposit_amount ? `<dt>Acompte demandé (${d.deposit_pct} %)</dt><dd>${amt(cur, d.deposit_amount)}</dd>` : ''}
      ${d.paid_amount > 0 && d.status === 'sent' ? `<dt>Déjà réglé</dt><dd>${amt(cur, d.paid_amount)}</dd><dt class="due">Reste à payer</dt><dd class="due">${amt(cur, restOf(d))}</dd>` : ''}
    </dl></div>
    <p class="p-words">Arrêté${dev ? ' le présent devis' : 'e la présente facture'} à la somme de <b>${sommeEnLettres(cur, d.total_ttc)} (${amt(cur, d.total_ttc)})</b>${d.tva ? ' TTC' : ''}.${d.tva ? '' : ' TVA non applicable.'}</p>
    <div class="p-foot">
      <div class="p-sec"><div class="lbl">Paiement</div><ul>${isEur(cur) ? '<li>Virement bancaire (coordonnées sur demande)</li>' : `<li>Wave et Orange Money : ${esc(co.phone_pay || '—')}</li><li>Virement ou espèces</li>`}</ul></div>
      ${d.notes || co.mentions ? `<div class="p-sec"><div class="lbl">Conditions</div><div class="muted">${esc(d.notes)}${d.notes && co.mentions ? '<br>' : ''}${esc(co.mentions)}</div></div>` : ''}
    </div>
    ${sig || stp ? `<div class="p-sign"><div class="lbl">${stp && sig ? 'Cachet et signature' : stp ? 'Cachet' : 'Signature'}</div>
      <div class="p-sign-imgs">${stp ? `<img src="${stp}" alt="Cachet" class="p-stamp">` : ''}${sig ? `<img src="${sig}" alt="Signature" class="p-sig">` : ''}</div>
      <div>${esc(co.name || '')}</div></div>` : ''}
    ${showMade() ? `<p class="p-made">${dev ? 'Devis créé' : 'Facture créée'} avec <a href="${MADE_URL}" target="_blank" rel="noopener">Faybi SN</a> · facturation gratuite pour les freelances · faybi-sn.pages.dev</p>` : ''}
  </article>`;
}

// Encadré « Relances » d'une facture non soldée
function remindInfo(d, c) {
  const n = d.reminder_count, offAll = state.profile.reminders_on === false, off = offAll || clientOf(d.client_id)?.reminders_off, due = remindDue(d), next = nextRemind(d);
  const snoozed = d.remind_after && d.remind_after > today();
  const sent = n ? `${n} relance${n > 1 ? 's' : ''} envoyée${n > 1 ? 's' : ''}, la dernière le ${fmtDate(d.reminded_at)}` : 'Aucune relance envoyée';
  const plan = offAll ? 'relances désactivées dans vos paramètres' : off ? `relances désactivées pour ${esc(c.name)}` : due ? '<b>une relance est à faire aujourd’hui</b>' : next ? `prochaine relance le ${fmtDate(next)}${snoozed ? ' (reportée)' : ''}` : '';
  return `<div class="panel noprint remind"><div><b>Relances</b><br><small class="muted">${sent}${plan ? ' · ' + plan : ''}.</small></div>
    <div class="row">${due ? `<button class="btn sm primary" data-act="share" data-mode="remind">Préparer la relance</button>` : ''}
      ${off ? '' : `<button class="btn sm" data-act="snooze" data-id="${d.id}" data-days="7">Reporter d’une semaine</button>`}
      ${snoozed ? `<button class="btn sm ghost" data-act="snooze" data-id="${d.id}" data-days="0">Annuler le report</button>` : ''}</div></div>`;
}

function vDoc() {
  const d = ui.doc;
  if (!d) return ui.err ? `<div class="err" role="alert">${esc(ui.err)}</div>` : `<p class="boot">Chargement du document…</p>`;
  const s = stOf(d), dev = d.type === 'DEV', draft = d.status === 'draft';
  // Un document validé garde les coordonnées du jour de sa validation
  const co = d.snapshot?.company || state.profile, c = d.snapshot?.client || clientOf(d.client_id) || {name: 'Client supprimé'};
  const conv = d.converted_to && state.docs.find(x => x.id === d.converted_to);
  const from = state.docs.find(x => x.converted_to === d.id);
  const rest = restOf(d), pays = d.payments || [];
  const msg = !d.number ? '' : ui.share === 'remind' ? reminderText(d, co, c) : documentText(d, co, c);
  const confirm = {
    finalize: [`Valider ${dev ? 'ce devis' : 'cette facture'} ? ${dev ? 'Il' : 'Elle'} recevra son numéro définitif et ne pourra plus être modifié${dev ? '' : 'e'}.`, 'finalize', 'Oui, valider', 'primary'],
    del: ['Supprimer ce brouillon ? Cette action est définitive.', 'del', 'Oui, supprimer', 'danger solid'],
    cancel: [`Annuler ${esc(d.number)} ? ${dev ? 'Il' : 'Elle'} restera dans l’historique avec la mention « Annulé ».`, 'cancelDoc', 'Oui, annuler', 'danger solid'],
    pdel: ['Supprimer ce paiement ? Le reste à payer sera recalculé.', 'payDel', 'Oui, supprimer', 'danger solid']
  }[ui.confirm];
  const p = ui.pay;

  return `<div class="head noprint"><div><button class="btn ghost sm" data-act="go" data-view="docs">← Factures et devis</button>
      <h1 style="margin-top:8px"><span class="mono" style="font-size:.8em">${esc(docLabel(d))}</span></h1>
      <p>${esc(c.name)} · ${pill(s)}${conv ? ` · facture <a href="#" data-act="open" data-id="${conv.id}">${esc(docLabel(conv))}</a>` : ''}${from ? ` · issue du devis <a href="#" data-act="open" data-id="${from.id}">${esc(docLabel(from))}</a>` : ''}</p></div>
    <div class="actions">
      ${draft ? `<button class="btn primary" data-act="askConfirm" data-c="finalize">Valider et numéroter</button><button class="btn" data-act="edit">Modifier</button>` : ''}
      ${dev && d.status === 'sent' && !d.converted_to ? `<button class="btn primary" data-act="convert">Le client accepte : créer la facture</button>` : ''}
      ${rest > 0 ? `<button class="btn primary" data-act="payNew">Enregistrer un paiement</button>` : ''}
      ${d.status === 'sent' ? `<button class="btn" data-act="share" data-mode="send">Envoyer par WhatsApp</button><button class="btn" data-act="pdfDownload">Télécharger le PDF</button><button class="btn ghost hide-sm" data-act="print">Imprimer</button>` : ''}
      ${rest > 0 ? `<button class="btn" data-act="share" data-mode="remind">Relancer</button>` : ''}
      ${draft ? '' : `<button class="btn" data-act="dup">Dupliquer</button>`}
      ${draft ? `<button class="btn danger" data-act="askConfirm" data-c="del">Supprimer</button>` : ''}
      ${d.status === 'sent' && !(d.paid_amount > 0) ? `<button class="btn danger" data-act="askConfirm" data-c="cancel">Annuler</button>` : ''}
    </div></div>
  <div class="stack">
    ${confirm ? `<div class="panel alert noprint"><b>${confirm[0]}</b>
      <div class="row"><button class="btn ${confirm[3]}" data-act="${confirm[1]}" ${ui.busy ? 'disabled' : ''}>${confirm[2]}</button><button class="btn" data-act="cancelConfirm">Retour</button></div></div>` : ''}
    ${ui.err && !p ? `<div class="err noprint" role="alert">${esc(ui.err)}${/Passez en Pro/.test(ui.err) ? ` <a href="#" data-act="go" data-view="pro">Voir la formule Pro</a>` : ''}</div>` : ''}
    ${draft && !dev && !isPro() ? `<p class="note noprint">Formule gratuite : ${monthInvoices()} facture${monthInvoices() > 1 ? 's' : ''} validée${monthInvoices() > 1 ? 's' : ''} sur ${FREE_INVOICES} ce mois-ci.</p>` : ''}
    ${rest > 0 ? remindInfo(d, c) : ''}
    ${draft ? `<p class="note noprint">Brouillon : vous pouvez encore le modifier. Validez-le pour lui donner son numéro, puis téléchargez le PDF ou envoyez-le par WhatsApp.</p>` : ''}
    ${p ? `<form class="panel noprint" id="payform"><h2>Enregistrer un paiement</h2>
      <p class="muted" style="margin:0">Reste à payer : <b>${amt(d.currency, rest)}</b>${d.deposit_amount > d.paid_amount ? ` · acompte attendu : ${amt(d.currency, d.deposit_amount - d.paid_amount)}` : ''}</p>
      <div class="fgrid">
        <label class="field">Montant reçu (${isEur(d.currency) ? '€' : 'FCFA'})<input type="text" id="p-amount" inputmode="decimal" value="${esc(decimal(p.amount))}" required></label>
        <label class="field">Moyen de paiement<select id="p-method">${METHODS.map(m => `<option ${m === p.method ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="field">Date<input type="date" id="p-date" value="${esc(p.paid_at)}" max="${today()}"></label>
        <label class="field">Note (facultatif)<input type="text" id="p-note" value="${esc(p.note)}" placeholder="Ex. : référence Wave"></label>
      </div>
      ${ui.err ? `<div class="err" role="alert">${esc(ui.err)}</div>` : ''}
      <div class="row"><button type="submit" class="btn primary" ${ui.busy ? 'disabled' : ''}>Enregistrer</button><button type="button" class="btn" data-act="payCancel">Annuler</button></div></form>` : ''}
    ${pays.length ? `<section class="card noprint"><h2>Paiements reçus</h2><div class="tablewrap"><table class="list"><thead><tr><th>Date</th><th>Moyen</th><th class="hide-sm">Note</th><th class="num">Montant</th><th></th></tr></thead>
      <tbody>${pays.map(x => `<tr><td>${fmtDate(x.paid_at)}</td><td>${esc(x.method)}</td><td class="hide-sm">${esc(x.note)}</td><td class="num">${amt(d.currency, x.amount)}</td>
        <td class="num"><button class="btn ghost sm" data-act="payAskDel" data-id="${x.id}" aria-label="Supprimer ce paiement">Supprimer</button></td></tr>`).join('')}</tbody></table></div></section>` : ''}
    ${ui.share ? `<div class="panel noprint"><h2>${ui.share === 'remind' ? 'Message de relance' : 'Message d’envoi'}</h2>
      <textarea id="relmsg" class="relmsg" aria-label="Message">${esc(msg)}</textarea>
      <div class="row">${shareFiles() ? `<button class="btn ${ui.share === 'send' ? 'primary' : ''}" id="pdfsend" data-act="sendPdf" ${pdfReady(d) ? '' : 'disabled'}>${pdfReady(d) ? 'Envoyer avec le PDF' : 'Préparation du PDF…'}</button>` : ''}
        <a class="btn ${ui.share === 'remind' || !shareFiles() ? 'primary' : ''}" id="walink" href="${esc(waLink(c.phone, msg))}" ${ui.share === 'remind' ? `data-act="remindWa" data-id="${d.id}"` : 'target="_blank" rel="noopener"'}>${ui.share === 'remind' ? 'Ouvrir WhatsApp' : shareFiles() ? 'Message seul' : 'Ouvrir WhatsApp'}</a>
        <button class="btn" data-act="copy">Copier le message</button><button class="btn ghost" data-act="closeShare">Fermer</button></div>
      <small class="muted">Destinataire : ${esc(c.phone || 'aucun numéro enregistré')}.${shareFiles() ? ' « Envoyer avec le PDF » ouvre le partage du téléphone : choisissez WhatsApp, puis votre client. Le PDF et le message partent ensemble.' : ' Téléchargez le PDF, puis joignez-le dans la conversation WhatsApp.'}${ui.share === 'remind' ? ' La relance est notée dès l’envoi.' : ''}</small></div>` : ''}
    ${paper(d, co, c)}
  </div>`;
}

/* ---------- Création et modification ---------- */
const blankLine = () => ({description: '', qty: 1, price: 0});
// Nouveau brouillon : vide, ou copié d'un document existant (src), avec d'éventuels réglages imposés (extra)
const defaultDays = type => type === 'DEV' ? state.profile.quote_days ?? 30 : state.profile.due_days ?? 15;
function startDraft(type, src, extra = {}) {
  const T = today(), p = state.profile;
  ui.draft = src
    ? {id: null, type: src.type, client_id: src.client_id, currency: src.currency, issue_date: T, due_date: addDays(T, defaultDays(src.type)),
       discount_pct: +src.discount_pct, deposit_pct: src.deposit_pct, tva: src.tva && p.tva_on, notes: src.notes,
       lines: src.lines.map(l => ({description: l.description, qty: +l.qty, price: toMajor(src.currency, l.unit_price)}))}
    : {id: null, type, client_id: state.clients.length === 1 ? state.clients[0].id : '', currency: 'XOF', issue_date: T, due_date: addDays(T, defaultDays(type)),
       discount_pct: 0, deposit_pct: type === 'DEV' ? 50 : 0, tva: p.tva_on, notes: '', lines: [blankLine()]};
  Object.assign(ui.draft, extra);
  go('edit');
}
const draftLines = d => d.lines.map(l => ({qty: l.qty, unit_price: toMinor(d.currency, l.price)}));
function totalsBox(d) {
  const t = totals(d, draftLines(d)), cur = d.currency;
  return `${t.discount ? `<div><span>Sous-total</span><span>${amt(cur, t.subtotal)}</span></div><div><span>Remise</span><span>− ${amt(cur, t.discount)}</span></div>` : ''}
    ${d.tva ? `<div><span>Total HT</span><span>${amt(cur, t.ht)}</span></div><div><span>TVA</span><span>${amt(cur, t.tva)}</span></div>` : ''}
    <div class="big"><span>Total</span><span>${amt(cur, t.ttc)}</span></div>
    ${t.deposit ? `<div class="dep"><span>Acompte (${d.deposit_pct} %)</span><span>${amt(cur, t.deposit)}</span></div>` : ''}`;
}
function vEdit() {
  const d = ui.draft, dev = d.type === 'DEV', cur = d.currency;
  return `<div class="head"><div><button class="btn ghost sm" data-act="cancelEdit">← Annuler</button>
      <h1 style="margin-top:8px">${d.id ? 'Modifier le brouillon' : dev ? 'Nouveau devis' : 'Nouvelle facture'}</h1>
      <p>Le numéro sera attribué à la validation.</p></div></div>
  <form id="editor" class="stack">
    ${ui.err ? `<div class="err" role="alert">${esc(ui.err)}</div>` : ''}
    <section class="card"><h2>Informations</h2><div class="fgrid">
      <label class="field">Type<select id="f-type"><option value="FAC" ${!dev ? 'selected' : ''}>Facture</option><option value="DEV" ${dev ? 'selected' : ''}>Devis</option></select></label>
      <label class="field">Client<select id="f-client"><option value="">Choisir un client…</option>${state.clients.map(c => `<option value="${c.id}" ${c.id === d.client_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label class="field">Devise<select id="f-cur"><option value="XOF" ${!isEur(cur) ? 'selected' : ''}>Franc CFA (FCFA)</option><option value="EUR" ${isEur(cur) ? 'selected' : ''}>Euro (€)</option></select></label>
      <label class="field">Date<input type="date" id="f-date" value="${esc(d.issue_date)}"></label>
      <label class="field">${dev ? 'Valable jusqu’au' : 'Échéance'}<input type="date" id="f-due" value="${esc(d.due_date || '')}"></label>
    </div><div class="row" style="margin-top:12px"><button type="button" class="btn sm" data-act="clientNew" data-back="edit">+ Ajouter un client</button></div></section>

    <section class="card"><h2>Prestations</h2>
      <div class="lines">
        <div class="line h"><span>Prestation</span><span>Qté</span><span>Prix unitaire</span><span>Montant</span><span></span></div>
        ${d.lines.map((l, i) => `<div class="line">
          <input type="text" class="desc" id="l-${i}-desc" data-line="${i}" data-field="description" value="${esc(l.description)}" placeholder="Ex. : Création de site web" aria-label="Prestation" list="catlist" autocomplete="off">
          <input type="text" id="l-${i}-qty" data-line="${i}" data-field="qty" value="${esc(decimal(l.qty))}" inputmode="decimal" aria-label="Quantité">
          <input type="text" id="l-${i}-price" data-line="${i}" data-field="price" value="${l.price ? decimal(l.price) : ''}" placeholder="Prix (${isEur(cur) ? '€' : 'FCFA'})" inputmode="decimal" aria-label="Prix unitaire">
          <span class="amt" data-amt="${i}">${amtShort(cur, Math.round(l.qty * toMinor(cur, l.price)))}</span>
          <button type="button" class="x" data-act="delLine" data-i="${i}" aria-label="Supprimer la ligne">×</button></div>`).join('')}
      </div>
      <datalist id="catlist">${state.catalog.map(c => `<option value="${esc(c.name)}"></option>`).join('')}</datalist>
      <div class="row" style="margin-top:12px"><button type="button" class="btn sm" data-act="addLine">+ Ajouter une ligne</button>
        ${state.catalog.length && !isEur(cur) ? `<small class="muted">Tapez le début d’un de vos tarifs : le prix se remplit tout seul.</small>` : ''}</div>
    </section>

    <div class="editfoot">
      <section class="card stack" style="gap:14px">
        <div class="fgrid">
          <label class="field">Acompte à la commande<select id="f-dep">${[0, 30, 40, 50].map(p => `<option value="${p}" ${(+d.deposit_pct || 0) === p ? 'selected' : ''}>${p ? p + ' %' : 'Aucun'}</option>`).join('')}</select></label>
          <label class="field">Remise (%)<input type="text" id="f-disc" inputmode="decimal" value="${d.discount_pct ? decimal(d.discount_pct) : ''}" placeholder="0"></label>
        </div>
        ${state.profile.tva_on ? `<label class="check"><input type="checkbox" id="f-tva" ${d.tva ? 'checked' : ''}> Appliquer la TVA à 18 %</label>` : `<small class="muted">TVA non applicable. Activez-la dans votre profil si vous y êtes assujetti.</small>`}
        <label class="field">Conditions particulières<textarea id="f-notes" placeholder="Ex. : deux séries de corrections incluses">${esc(d.notes)}</textarea></label>
      </section>
      <div class="stack" style="gap:12px"><div class="tot" id="totals">${totalsBox(d)}</div>
        <button type="submit" class="btn primary" ${ui.busy ? 'disabled' : ''}>Enregistrer le brouillon</button></div>
    </div>
  </form>`;
}
function readDraft() {
  const d = ui.draft; if (!$('#editor')) return;
  d.type = $('#f-type').value; d.client_id = $('#f-client').value; d.currency = $('#f-cur').value;
  d.issue_date = $('#f-date').value || today(); d.due_date = $('#f-due').value;
  d.tva = state.profile.tva_on && !!$('#f-tva')?.checked; d.notes = $('#f-notes').value;
  d.deposit_pct = +$('#f-dep').value || 0;
  d.discount_pct = Math.min(100, Math.max(0, parseNum($('#f-disc').value)));
  document.querySelectorAll('[data-line]').forEach(el => {
    const l = d.lines[+el.dataset.line], k = el.dataset.field;
    l[k] = k === 'description' ? el.value : parseNum(el.value);
  });
}

/* ---------- Clients, tarifs, profil ---------- */
function vClients() {
  const rows = state.clients.map(c => `<tr data-act="clientEdit" data-id="${c.id}" tabindex="0"><td><b>${esc(c.name)}</b><br><small class="muted">${esc(c.contact)}</small></td>
    <td class="hide-sm">${esc(c.phone)}</td><td class="hide-sm">${esc(c.email)}</td><td class="hide-sm">${esc(c.address)}</td></tr>`).join('');
  return `<div class="head"><div><h1>Clients</h1><p>${state.clients.length} client${state.clients.length > 1 ? 's' : ''}</p></div>
    <button class="btn primary" data-act="clientNew">+ Nouveau client</button></div>
    ${state.clients.length ? `<div class="tablewrap"><table class="list"><thead><tr><th>Client</th><th class="hide-sm">Téléphone</th><th class="hide-sm">E-mail</th><th class="hide-sm">Adresse</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<div class="card empty"><p>Ajoutez votre premier client pour pouvoir lui faire un devis.</p><button class="btn primary" data-act="clientNew">+ Nouveau client</button></div>`}`;
}

function vClient() {
  const c = ui.clientDraft;
  const f = (k, l, type = 'text', ph = '') => `<label class="field">${l}<input type="${type}" id="k-${k}" value="${esc(c[k])}" placeholder="${ph}"></label>`;
  return `<div class="head"><div><button class="btn ghost sm" data-act="clientCancel">← ${ui.back === 'edit' ? 'Retour au document' : 'Clients'}</button><h1 style="margin-top:8px">${c.id ? 'Modifier le client' : 'Nouveau client'}</h1></div></div>
  <form id="clientform" class="card stack">
    <div class="fgrid">${f('name', 'Nom ou entreprise', 'text', 'Ex. : Boutique Keur Yaye')}${f('contact', 'Personne de contact')}${f('phone', 'Téléphone (WhatsApp)', 'tel', '+221 77 000 00 00')}
      ${f('email', 'E-mail', 'email')}${f('address', 'Adresse', 'text', 'Quartier, ville')}${f('ninea', 'NINEA (facultatif)')}</div>
    <label class="check"><input type="checkbox" id="k-reminders_off" ${c.reminders_off ? 'checked' : ''}> Ne pas me proposer de relances pour ce client</label>
    ${msgs()}
    ${ui.confirm === 'cdel' ? `<div class="panel alert"><b>Supprimer ce client ? Cette action est définitive.</b><div class="row"><button type="button" class="btn danger solid" data-act="clientDel">Oui, supprimer</button><button type="button" class="btn" data-act="cancelConfirm">Annuler</button></div></div>` : ''}
    <div class="row"><button type="submit" class="btn primary" ${ui.busy ? 'disabled' : ''}>Enregistrer</button>${c.id ? `<button type="button" class="btn danger" data-act="clientAskDel">Supprimer</button>` : ''}</div>
  </form>`;
}

function vCatalog() {
  const c = ui.catDraft;
  return `<div class="head"><div><h1>Mes tarifs</h1><p>Vos prestations habituelles et leur prix.</p></div>
    <button class="btn primary" data-act="catNew">+ Nouvelle prestation</button></div>
  <div class="stack">
    ${c ? `<form class="panel" id="catform"><h2>${c.id ? 'Modifier la prestation' : 'Nouvelle prestation'}</h2><div class="fgrid">
      <label class="field">Prestation<input type="text" id="g-name" value="${esc(c.name)}" placeholder="Ex. : Site web vitrine"></label>
      <label class="field">Unité<input type="text" id="g-unit" value="${esc(c.unit)}" placeholder="forfait, jour, mois, séance…"></label>
      <label class="field">Prix (FCFA)<input type="text" id="g-price" inputmode="numeric" value="${c.price_xof || ''}"></label></div>
      ${msgs()}
      <div class="row"><button type="submit" class="btn primary" ${ui.busy ? 'disabled' : ''}>Enregistrer</button><button type="button" class="btn" data-act="catCancel">Annuler</button>
        ${c.id ? `<button type="button" class="btn danger" data-act="catDel">Supprimer</button>` : ''}</div></form>` : ''}
    ${state.catalog.length ? `<div class="tablewrap"><table class="list"><thead><tr><th>Prestation</th><th class="hide-sm">Unité</th><th class="num">Prix (FCFA)</th></tr></thead>
      <tbody>${state.catalog.map(x => `<tr data-act="catEdit" data-id="${x.id}" tabindex="0"><td><b>${esc(x.name)}</b></td><td class="hide-sm">${esc(x.unit)}</td><td class="num">${num(x.price_xof)}</td></tr>`).join('')}</tbody></table></div>`
      : (c ? '' : `<div class="card empty"><p>Ajoutez vos prestations pour facturer plus vite.</p><button class="btn primary" data-act="catNew">+ Nouvelle prestation</button></div>`)}
  </div>`;
}

// Logo, couleur, signature et cachet : réservés au Pro (la base refuse aussi l'ajout en gratuit)
function brandCard(p) {
  const pro = isPro(), off = pro ? '' : 'disabled';
  const box = (k, label, acts) => `<div class="brand-box"><b>${label}</b>
    <div class="brand-show">${p[k] ? `<img src="${p[k]}" alt="${label}">` : '<span class="muted">Aucun élément</span>'}</div>
    <div class="row">${acts}${p[k] ? `<button class="btn sm ghost" data-act="imgDel" data-k="${k}" ${ui.busy ? 'disabled' : ''}>Retirer</button>` : ''}</div></div>`;
  const pick = k => `<button class="btn sm" data-act="imgPick" data-k="${k}" ${off}>Importer une image</button>`;
  return `<section class="card stack" style="gap:12px"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Logo, signature et cachet</h2>${pro ? '<span class="pill good">Pro</span>' : '<span class="pill neutral">Pro</span>'}</div>
    <p class="muted" style="margin:0">${pro ? 'Ils apparaissent sur vos devis et factures. Pour la signature et le cachet, une photo sur papier blanc suffit : le fond blanc est retiré automatiquement.'
      : 'Avec la formule Pro, ajoutez votre logo, votre couleur, votre signature et votre cachet sur vos devis et factures. <a href="#" data-act="go" data-view="pro">Passer en Pro</a>'}</p>
    <div class="brand-grid">
      ${box('logo_img', 'Logo', pick('logo_img'))}
      ${box('signature_img', 'Signature', `<button class="btn sm" data-act="sigDraw" ${off}>Signer à l’écran</button>${pick('signature_img')}`)}
      ${box('stamp_img', 'Cachet', pick('stamp_img'))}
      <div class="brand-box"><b>Couleur</b><div class="brand-show"><input type="color" id="s-color" value="${esc(p.brand_color || '#0A6B53')}" aria-label="Couleur des documents" ${off}></div>
        <div class="row">${p.brand_color ? `<button class="btn sm ghost" data-act="colorReset">Couleur d’origine</button>` : '<small class="muted">Titres et filets des documents</small>'}</div></div>
    </div>
    ${ui.sigPad ? `<div class="panel stack"><b>Signez dans le cadre, au doigt ou à la souris</b><canvas id="sigpad" class="sigpad" width="600" height="220"></canvas>
      <div class="row"><button class="btn primary sm" data-act="sigSave" ${ui.busy ? 'disabled' : ''}>Enregistrer la signature</button><button class="btn sm" data-act="sigClear">Effacer</button><button class="btn sm ghost" data-act="sigCancel">Annuler</button></div></div>` : ''}
    <input type="file" id="imgfile" accept="image/png,image/jpeg,image/webp" hidden>
  </section>`;
}

/* ---------- Formule Pro ---------- */
function vPro() {
  const pro = isPro(), used = monthInvoices(), ref = proRef();
  const li = a => `<ul class="ticks">${a.map(x => `<li>${x}</li>`).join('')}</ul>`;
  const waTo = SUPPORT_WHATSAPP || PRO_PAY_NUMBER;
  const wa = waTo && `https://wa.me/${waTo}?text=${encodeURIComponent(`Bonjour Faybi SN, je viens de payer la formule Pro. Référence : ${ref}`)}`;
  return `<div class="head"><div><button class="btn ghost sm" data-act="go" data-view="profile">← Paramètres</button><h1 style="margin-top:8px">Formule Pro</h1>
      <p>${pro ? `Votre compte est en ${proLabel()}. Merci pour votre confiance !` : `Formule gratuite : ${used} facture${used > 1 ? 's' : ''} validée${used > 1 ? 's' : ''} sur ${FREE_INVOICES} ce mois-ci.`}</p></div></div>
  <div class="stack">
    <div class="grid2">
      <section class="card plan-card"><h2>Gratuit</h2><div class="price">0 <small>FCFA</small></div>
        ${li([`${FREE_INVOICES} factures par mois`, 'Devis et clients illimités', 'Envoi sur WhatsApp avec le PDF', 'Paiements reçus et relances du jour', 'Mention « Créé avec Faybi SN »'])}</section>
      <section class="card plan-card hl"><h2>Pro</h2><div class="price">3 000 <small>FCFA / mois</small></div><p class="muted" style="margin:0">ou 30 000 FCFA par an, soit 2 mois offerts</p>
        ${li(['Factures illimitées', 'Votre logo et votre couleur', 'Votre signature et votre cachet', 'Sans la mention Faybi SN', 'Bientôt : liens de paiement Wave et relances par e-mail, sans supplément'])}</section>
    </div>
    ${pro ? '' : PRO_PAY_NUMBER ? `<section class="card stack"><h2 style="margin:0">Passer en Pro</h2>
      <ol class="olist">
        <li>Payez <b>3 000 FCFA</b> (un mois) ou <b>30 000 FCFA</b> (un an) avec un des boutons ci-dessous, ou par transfert au <b class="mono">${esc(showPhone('+' + PRO_PAY_NUMBER))}</b>.</li>
        <li>Indiquez la référence <b class="mono">${ref}</b> dans le paiement si l’application vous le propose.</li>
        <li>Appuyez sur « J’ai payé » pour nous prévenir sur WhatsApp : nous vous envoyons un <b>code Pro</b> dans la journée, sur WhatsApp ou par e-mail. Saisissez-le ci-dessous.</li></ol>
      <div class="row">${PRO_WAVE_URL ? `<a class="btn pay-wave" href="${esc(PRO_WAVE_URL)}" target="_blank" rel="noopener">Payer avec Wave</a>` : ''}${PRO_OM_URL ? `<a class="btn pay-om" href="${esc(PRO_OM_URL)}" target="_blank" rel="noopener">Payer avec Orange Money</a>` : ''}</div>
      <div class="row">${wa ? `<a class="btn primary" href="${esc(wa)}" target="_blank" rel="noopener">J’ai payé</a>` : ''}</div></section>`
      : `<section class="card"><h2 style="margin:0 0 6px">Bientôt disponible</h2><p class="muted" style="margin:0">Le paiement de la formule Pro ouvre très prochainement. Votre référence sera <b class="mono">${ref}</b>.</p></section>`}
    <form id="proform" class="card stack"><h2 style="margin:0">${pro ? 'Prolonger avec un code Pro' : 'J’ai un code Pro'}</h2>
      <div class="row"><input type="text" id="pro-code" placeholder="PRO-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" style="max-width:260px" aria-label="Code Pro">
        <button type="submit" class="btn primary" ${ui.busy ? 'disabled' : ''}>Activer</button></div>
      ${msgs()}</form>
  </div>`;
}

function vProfile() {
  const p = state.profile;
  const f = (k, l, ph = '', type = 'text') => `<label class="field">${l}<input type="${type}" id="s-${k}" value="${esc(p[k])}" placeholder="${ph}"></label>`;
  const plan = proLabel();
  return `<div class="head"><div><h1>Paramètres</h1><p>Votre profil, vos préférences et votre compte.</p></div></div>
  <div class="stack">
    <form id="profileform" class="card stack"><h2 style="margin:0">Mon profil</h2>
      <p class="muted" style="margin:0">Ces informations apparaissent sur vos devis et factures.</p>
      <div class="fgrid">${f('name', 'Votre nom ou nom de marque', 'Ex. : Khady Sy')}${f('job', 'Votre métier', 'Ex. : Développeur web')}
        ${f('phone_pay', 'Téléphone Wave / Orange Money', '+221 77 000 00 00', 'tel')}${f('email', 'E-mail affiché sur les factures', '', 'email')}
        ${f('address', 'Ville ou quartier', 'Ex. : Liberté 6, Dakar')}${f('ninea', 'NINEA (facultatif)')}
        <label class="field">Objectif de revenus par mois (FCFA)<input type="text" id="s-goal_xof" inputmode="numeric" value="${p.goal_xof || ''}" placeholder="Ex. : 1 000 000"></label></div>
      <label class="check"><input type="checkbox" id="s-tva_on" ${p.tva_on ? 'checked' : ''}> Je suis assujetti à la TVA (18 %)</label>
      <label class="field">Conditions en bas de vos documents<textarea id="s-mentions" placeholder="Ex. : Paiement à réception. Acompte non remboursable une fois le projet démarré.">${esc(p.mentions)}</textarea></label>
      ${msgs()}
      <div class="row"><button type="submit" class="btn primary" ${ui.busy ? 'disabled' : ''}>Enregistrer</button></div>
    </form>
    ${brandCard(p)}
    <form id="prefsform" class="card stack"><h2 style="margin:0">Préférences</h2>
      <div class="fgrid">
        <label class="field">Délai de paiement des factures (jours)<input type="number" id="s-due_days" min="0" max="365" value="${p.due_days ?? 15}"></label>
        <label class="field">Validité des devis (jours)<input type="number" id="s-quote_days" min="0" max="365" value="${p.quote_days ?? 30}"></label></div>
      <label class="check"><input type="checkbox" id="s-reminders_on" ${p.reminders_on === false ? '' : 'checked'}> Me proposer les relances du jour sur l’accueil</label>
      <div class="row"><button type="submit" class="btn primary" ${ui.busy ? 'disabled' : ''}>Enregistrer</button></div>
    </form>
    <section class="card stack" style="gap:12px"><h2 style="margin:0">Mes données</h2>
      <p class="muted" style="margin:0">Gardez une copie de vos factures : pour votre comptable, ou avant de supprimer votre compte.</p>
      <div class="row"><button class="btn" data-act="exportCsv">Exporter mes factures (Excel)</button><button class="btn" data-act="exportJson" ${ui.busy ? 'disabled' : ''}>Télécharger toutes mes données</button></div>
    </section>
    <section class="card stack" style="gap:12px"><h2 style="margin:0">Compte</h2>
      <p class="muted" style="margin:0">Connecté avec ${esc(userLabel(state.session.user))} · formule ${plan}${isPro() ? '' : ` · ${monthInvoices()} facture${monthInvoices() > 1 ? 's' : ''} sur ${FREE_INVOICES} ce mois-ci`}.</p>
      <div class="row">${isPro() ? `<button class="btn" data-act="go" data-view="pro">Ma formule Pro</button>` : `<button class="btn primary" data-act="go" data-view="pro">Passer en Pro</button>`}<button class="btn" data-act="logout">Se déconnecter</button></div>
      <p class="muted" style="margin:0"><a href="../confidentialite.html" target="_blank" rel="noopener">Politique de confidentialité</a> · <a href="../conditions.html" target="_blank" rel="noopener">Conditions d’utilisation</a></p>
    </section>
    <section class="card stack danger-zone" style="gap:12px"><h2 style="margin:0">Supprimer mon compte</h2>
      <p class="muted" style="margin:0">Votre compte, vos clients, vos tarifs, vos devis, vos factures et vos paiements seront effacés définitivement. Pensez à exporter vos factures avant : la loi vous demande de les conserver 10 ans.</p>
      ${ui.delAsk ? `<form id="delform" class="stack" style="gap:10px">
        <label class="field">Pour confirmer, tapez SUPPRIMER<input type="text" id="s-del" autocomplete="off" autocapitalize="characters"></label>
        ${ui.err ? `<div class="err" role="alert">${esc(ui.err)}</div>` : ''}
        <div class="row"><button type="submit" class="btn danger solid" ${ui.busy ? 'disabled' : ''}>Supprimer définitivement</button><button type="button" class="btn" data-act="delCancel">Annuler</button></div></form>`
        : `<div class="row"><button class="btn danger" data-act="delAsk">Supprimer mon compte…</button></div>`}
    </section>
  </div>`;
}

const views = {home: vHome, docs: vDocs, doc: vDoc, edit: vEdit, clients: vClients, client: vClient, catalog: vCatalog, profile: vProfile, pro: vPro};
const NAV = [['home', 'Accueil', 'Accueil'], ['docs', 'Factures et devis', 'Factures'], ['clients', 'Clients', 'Clients'], ['catalog', 'Mes tarifs', 'Tarifs'], ['profile', 'Paramètres', 'Réglages']];
const ico = d => `<svg class="ni" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  home: ico('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>'),
  docs: ico('<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>'),
  clients: ico('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.7 3 2.5 3.5 5.2"/>'),
  catalog: ico('<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
  profile: ico('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>')
};
const navOf = {home: 'home', docs: 'docs', doc: 'docs', edit: 'docs', clients: 'clients', client: 'clients', catalog: 'catalog', profile: 'profile', pro: 'profile'};

function render(scroll) {
  const root = $('#root');
  if (!db.configured) { root.innerHTML = vSetup(); return; }
  if (ui.recovery) { root.innerHTML = vReset(); return; }
  if (!state.session) { root.innerHTML = vAuth(); return; }
  if (!state.loaded) {
    root.innerHTML = state.loadErr
      ? `<div class="auth"><div class="auth-card">${brand}<div class="err">${esc(state.loadErr)}</div><button class="btn" data-act="retry">Réessayer</button><button class="linkbtn" data-act="logout">Se déconnecter</button></div></div>`
      : `<p class="boot">Chargement de votre espace…</p>`;
    return;
  }
  if (ui.view === 'onboarding') { root.innerHTML = vOnboarding(); return; }
  root.innerHTML = `<div class="app"><aside class="side">${brand}
      <nav aria-label="Navigation">${NAV.map(([v, l, s]) => `<button data-act="go" data-view="${v}" ${navOf[ui.view] === v ? 'aria-current="page"' : ''}>${ICONS[v]}<span class="nl">${l}</span><span class="ns">${s}</span></button>`).join('')}</nav>
      <div class="side-cta"><span class="who">${esc(userLabel(state.session.user))}</span></div></aside>
    <main id="main">${views[ui.view]()}</main></div>`;
  if (ui.sigPad) initSigPad();
  if (ui.view === 'doc' && ui.share) preparePdf();
  if (scroll) window.scrollTo(0, 0);
}

function go(view, extra = {}) { Object.assign(ui, {view, err: '', info: '', confirm: null, catDraft: null, share: false, pay: null, delAsk: false, sigPad: false}, extra); render(true); }

// Exécute une action réseau en affichant l'état « en cours » et les erreurs
async function run(fn) {
  if (ui.busy) return;
  ui.busy = true; ui.err = ''; ui.info = ''; render();
  try { await fn(); } catch (e) { ui.err = humanError(e); }
  ui.busy = false; render();
}

// Ouvre un document complet (avec ses lignes) et rafraîchit sa ligne dans la liste
async function openDoc(id) {
  go('doc', {doc: ui.doc?.id === id ? ui.doc : null});
  try {
    const d = await db.getDocument(id);
    if (ui.view !== 'doc') return;
    ui.doc = d; refreshSummary(d); render();
  } catch (e) { ui.err = humanError(e); render(); }
}
function refreshSummary(d) {
  const row = {id: d.id, type: d.type, number: d.number, status: d.status, currency: d.currency, client_id: d.client_id, issue_date: d.issue_date,
    due_date: d.due_date, total_ttc: d.total_ttc, deposit_amount: d.deposit_amount, paid_amount: d.paid_amount, converted_to: d.converted_to, created_at: d.created_at, sent_at: d.sent_at,
    reminder_count: d.reminder_count, reminded_at: d.reminded_at, remind_after: d.remind_after};
  state.docs = state.docs.some(x => x.id === d.id) ? state.docs.map(x => x.id === d.id ? row : x) : [row, ...state.docs];
}

/* ---------- Images : logo, signature, cachet ---------- */
const loadImage = file => new Promise((ok, ko) => {
  const img = new Image();
  img.onload = () => ok(img);
  img.onerror = () => ko(new Error('Image illisible. Choisissez une photo JPG ou PNG.'));
  img.src = URL.createObjectURL(file);
});
// Recadre au plus près du dessin (pixels non transparents)
function trimCanvas(cv) {
  const {width: w, height: h} = cv, px = cv.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 12) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return '';
  const pad = 6, out = document.createElement('canvas');
  out.width = x1 - x0 + 1 + pad * 2; out.height = y1 - y0 + 1 + pad * 2;
  out.getContext('2d').drawImage(cv, x0, y0, x1 - x0 + 1, y1 - y0 + 1, pad, pad, x1 - x0 + 1, y1 - y0 + 1);
  return out.toDataURL('image/png');
}
// Réduit l'image ; pour la signature et le cachet, le fond blanc devient transparent
function toPng(img, maxW, maxH, clearWhite) {
  for (let k = Math.min(1, maxW / img.width, maxH / img.height); ; k *= 0.75) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    if (clearWhite) {
      const im = ctx.getImageData(0, 0, cv.width, cv.height), a = im.data;
      for (let i = 0; i < a.length; i += 4) {
        const m = Math.min(a[i], a[i + 1], a[i + 2]);
        if (m > 205) a[i + 3] = 0; else if (m > 150) a[i + 3] = Math.round(a[i + 3] * (205 - m) / 55);
      }
      ctx.putImageData(im, 0, 0);
    }
    const url = clearWhite ? trimCanvas(cv) : cv.toDataURL('image/png');
    if (url.length <= 380000 || k < 0.1) return url;
  }
}
const IMG_SIZE = {logo_img: [480, 200, false], signature_img: [600, 240, true], stamp_img: [420, 420, true]};
const saveBrand = (fields, msg) => run(async () => { state.profile = await db.saveProfile(state.profile.id, fields); ui.pdf = null; toast(msg); });

// Zone de signature au doigt ou à la souris
function initSigPad() {
  const cv = $('#sigpad');
  if (!cv || cv.dataset.on) return;
  cv.dataset.on = '1';
  const ctx = cv.getContext('2d');
  Object.assign(ctx, {lineWidth: 3.2, lineCap: 'round', lineJoin: 'round', strokeStyle: '#1B2540'});
  let last = null;
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); last = pos(e); ctx.beginPath(); ctx.arc(...last, 1.4, 0, 7); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); });
  cv.addEventListener('pointermove', e => { if (!last) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke(); last = p; });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => cv.addEventListener(t, () => { last = null; }));
}

/* ---------- PDF : fichier prêt à joindre dans WhatsApp ---------- */
const PDF_LIB = 'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js';
let pdfLib = null;
const loadPdfLib = () => pdfLib ||= new Promise((ok, ko) => {
  const s = document.createElement('script');
  s.src = PDF_LIB;
  s.onload = () => ok(window.html2pdf);
  s.onerror = () => { pdfLib = null; ko(new Error('Impossible de préparer le PDF. Vérifiez votre connexion.')); };
  document.head.append(s);
});
// Le partage de fichiers (Android, iPhone, certains ordinateurs) permet de joindre le PDF dans WhatsApp
const shareFiles = () => { try { return Boolean(navigator.canShare?.({files: [new File(['x'], 'x.pdf', {type: 'application/pdf'})]})); } catch { return false; } };
const pdfKey = d => [d.id, d.status, d.paid_amount, isPro(), state.profile.brand_color, state.profile.logo_img.length, state.profile.signature_img.length, state.profile.stamp_img.length].join('|');
const pdfReady = d => ui.pdf?.key === pdfKey(d) && ui.pdf.file;
async function makePdf(d) {
  const html2pdf = await loadPdfLib();
  await document.fonts?.ready;
  const el = $('.paper');
  if (!el) throw new Error('Ouvrez le document pour préparer son PDF.');
  const blob = await html2pdf().set({
    margin: 10, image: {type: 'jpeg', quality: 0.95},
    html2canvas: {scale: 2, scrollX: 0, scrollY: 0, backgroundColor: '#ffffff', onclone: doc => { doc.documentElement.classList.add('pdfmode'); doc.documentElement.dataset.theme = 'light'; }},
    jsPDF: {unit: 'mm', format: 'a4', orientation: 'portrait'},
    pagebreak: {mode: ['css', 'legacy'], avoid: ['tr', '.p-sign', '.p-sum']}
  }).from(el).outputPdf('blob');
  return new File([blob], `${d.number || 'document'}.pdf`, {type: 'application/pdf'});
}
// Prépare le PDF dès l'ouverture du panneau d'envoi : le partage doit partir tout de suite après le clic
function preparePdf() {
  const d = ui.doc;
  if (!d || d.status !== 'sent' || !shareFiles()) return;
  const key = pdfKey(d);
  if (ui.pdf?.key === key) return;
  ui.pdf = {key, file: null};
  makePdf(d).then(file => {
    if (ui.pdf?.key !== key) return;
    ui.pdf.file = file;
    const b = $('#pdfsend'); if (b) { b.disabled = false; b.textContent = 'Envoyer avec le PDF'; }
  }).catch(e => {
    if (ui.pdf?.key === key) ui.pdf = null;
    const b = $('#pdfsend'); if (b) b.textContent = 'PDF indisponible';
    toast(humanError(e));
  });
}

// Fait télécharger un fichier créé dans le navigateur
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type}));
  a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Met à jour un document dans la liste et, s'il est ouvert, à l'écran
function patchDoc(id, patch) {
  state.docs = state.docs.map(x => x.id === id ? {...x, ...patch} : x);
  if (ui.doc?.id === id) Object.assign(ui.doc, patch);
}
async function markReminded(id) {
  try {
    const n = await db.markReminded(id);
    patchDoc(id, {reminder_count: n, reminded_at: today(), remind_after: null});
    ui.share = false; render(); toast('Relance notée');
  } catch (e) { toast(humanError(e)); }
}

/* ---------- Actions ---------- */
const acts = {
  go: el => go(el.dataset.view),
  authMode: el => { ui.authMode = el.dataset.mode; ui.phoneStep = 1; ui.err = ''; ui.info = ''; render(); },
  phoneBack: () => { ui.phoneStep = 1; ui.err = ''; render(); },
  retry: () => { state.loadErr = ''; render(); loadAll(); },
  logout: () => logout(),

  new: el => {
    if (!state.clients.length) { toast('Ajoutez d’abord un client'); acts.clientNew({dataset: {}}); return; }
    startDraft(el.dataset.type);
  },
  open: el => openDoc(el.dataset.id),
  filter: el => { ui.filter = el.dataset.f; el.dataset.go ? go('docs') : render(); },
  askConfirm: el => { ui.confirm = el.dataset.c; ui.err = ''; render(); },
  cancelConfirm: () => { ui.confirm = null; render(); },
  edit: () => { const d = ui.doc; startDraft(null, d, {id: d.id, issue_date: d.issue_date, due_date: d.due_date || '', tva: d.tva}); },
  dup: () => startDraft(null, ui.doc),
  cancelEdit: () => ui.draft?.id ? openDoc(ui.draft.id) : go('docs'),
  addLine: () => { readDraft(); ui.draft.lines.push(blankLine()); render(); $(`#l-${ui.draft.lines.length - 1}-desc`)?.focus(); },
  delLine: el => { readDraft(); ui.draft.lines.splice(+el.dataset.i, 1); if (!ui.draft.lines.length) ui.draft.lines.push(blankLine()); render(); },
  finalize: () => run(async () => {
    await db.finalizeDocument(ui.doc.id);
    ui.doc = await db.getDocument(ui.doc.id); refreshSummary(ui.doc); ui.confirm = null;
    toast(`${ui.doc.number} validé${ui.doc.type === 'FAC' ? 'e' : ''}`);
  }),
  del: () => run(async () => {
    await db.deleteDocument(ui.doc.id);
    state.docs = state.docs.filter(x => x.id !== ui.doc.id);
    ui.view = 'docs'; ui.doc = null; ui.confirm = null; toast('Brouillon supprimé');
  }),
  cancelDoc: () => run(async () => {
    await db.cancelDocument(ui.doc.id);
    ui.doc = await db.getDocument(ui.doc.id); refreshSummary(ui.doc); ui.confirm = null; toast(`${ui.doc.number} annulé`);
  }),
  convert: () => run(async () => {
    const quoteId = ui.doc.id, id = await db.convertQuote(quoteId);
    refreshSummary(await db.getDocument(quoteId));
    ui.doc = await db.getDocument(id); refreshSummary(ui.doc);
    toast('Facture créée en brouillon à partir du devis');
  }),
  print: () => {
    const title = document.title; document.title = ui.doc.number || 'Faybi SN';
    window.print(); document.title = title;
  },
  share: el => { ui.share = ui.share === el.dataset.mode ? false : el.dataset.mode; ui.pay = null; render(); if (ui.share) $('#relmsg')?.scrollIntoView({block: 'center'}); },
  payNew: () => {
    const d = ui.doc, rest = restOf(d), dep = d.deposit_amount - d.paid_amount;
    ui.pay = {amount: toMajor(d.currency, dep > 0 && dep < rest ? dep : rest), method: isEur(d.currency) ? 'Virement' : 'Wave', paid_at: today(), note: ''};
    ui.share = false; ui.confirm = null; ui.err = ''; render(); $('#p-amount')?.focus();
  },
  payCancel: () => { ui.pay = null; ui.err = ''; render(); },
  payAskDel: el => { ui.payDel = el.dataset.id; ui.confirm = 'pdel'; ui.pay = null; ui.err = ''; render(); window.scrollTo(0, 0); },
  payDel: () => run(async () => {
    await db.deletePayment(ui.payDel);
    state.payments = state.payments.filter(x => x.id !== ui.payDel);
    ui.doc = await db.getDocument(ui.doc.id); refreshSummary(ui.doc); ui.confirm = null; toast('Paiement supprimé');
  }),
  closeShare: () => { ui.share = false; render(); },
  delAsk: () => { ui.delAsk = true; ui.err = ''; render(); $('#s-del')?.focus(); },
  imgPick: el => { ui.imgKey = el.dataset.k; $('#imgfile').value = ''; $('#imgfile').click(); },
  imgDel: el => saveBrand({[el.dataset.k]: ''}, 'Élément retiré'),
  colorReset: () => saveBrand({brand_color: ''}, 'Couleur d’origine rétablie'),
  sigDraw: () => { ui.sigPad = true; render(); $('#sigpad')?.scrollIntoView({block: 'center'}); },
  sigClear: () => { const cv = $('#sigpad'); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); },
  sigCancel: () => { ui.sigPad = false; render(); },
  sigSave: () => {
    const url = trimCanvas($('#sigpad'));
    if (!url) { toast('Signez d’abord dans le cadre'); return; }
    ui.sigPad = false; saveBrand({signature_img: url}, 'Signature enregistrée');
  },
  // Partage du PDF avec le message (feuille de partage du téléphone : WhatsApp, puis le client)
  sendPdf: async () => {
    const d = ui.doc, file = pdfReady(d), text = $('#relmsg')?.value || '', remind = ui.share === 'remind';
    if (!file) return;
    navigator.clipboard?.writeText(text).catch(() => {});
    try {
      await navigator.share({files: [file], text});
      if (remind) markReminded(d.id);
    } catch (e) {
      if (e.name !== 'AbortError') { download(file.name, file, 'application/pdf'); toast('Partage impossible : le PDF est téléchargé, joignez-le dans WhatsApp.'); }
    }
  },
  pdfDownload: async () => {
    const d = ui.doc;
    toast('Préparation du PDF…');
    try {
      const file = pdfReady(d) || await makePdf(d);
      download(file.name, file, 'application/pdf');
    } catch (e) { toast(humanError(e)); window.print(); }
  },
  delCancel: () => { ui.delAsk = false; ui.err = ''; render(); },
  exportCsv: () => {
    const head = ['Type', 'Numéro', 'Client', 'Date', 'Échéance', 'Devise', 'Total TTC', 'Payé', 'Reste à payer', 'Statut'];
    const money = (cur, v) => String(toMajor(cur, v || 0)).replace('.', ',');
    const rows = state.docs.filter(d => d.number).map(d => [d.type === 'DEV' ? 'Devis' : 'Facture', d.number, cName(d.client_id), d.issue_date, d.due_date || '',
      d.currency === 'XOF' ? 'FCFA' : 'EUR', money(d.currency, d.total_ttc), money(d.currency, d.paid_amount), money(d.currency, restOf(d)), ST[stOf(d)][0]]);
    const cell = v => /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    download(`faybi-sn-${today()}.csv`, '\ufeff' + [head, ...rows].map(r => r.map(v => cell(String(v))).join(';')).join('\r\n'), 'text/csv');
  },
  exportJson: () => run(async () => {
    download(`faybi-sn-donnees-${today()}.json`, JSON.stringify(await db.exportAll(), null, 2), 'application/json');
    toast('Données téléchargées');
  }),
  // Ouvre WhatsApp avec le message, puis note la relance
  remindWa: el => { window.open(el.href, '_blank', 'noopener'); markReminded(el.dataset.id); },
  snooze: el => run(async () => {
    const days = +el.dataset.days, until = days ? addDays(today(), days) : null;
    await db.snoozeReminder(el.dataset.id, until);
    patchDoc(el.dataset.id, {remind_after: until});
    toast(until ? `Relance reportée au ${fmtDate(until)}` : 'Report annulé');
  }),
  copy: () => {
    const ta = $('#relmsg');
    navigator.clipboard.writeText(ta.value).then(() => toast('Message copié')).catch(() => { ta.select(); toast('Texte sélectionné : copiez-le avec Ctrl+C'); });
  },

  clientNew: el => {
    if (el.dataset.back === 'edit') readDraft();
    ui.back = el.dataset.back || null;
    ui.clientDraft = {id: null, name: '', contact: '', phone: '', email: '', address: '', ninea: '', reminders_off: false}; go('client');
  },
  clientEdit: el => { ui.back = null; ui.clientDraft = {...state.clients.find(c => c.id === el.dataset.id)}; go('client'); },
  clientCancel: () => ui.back === 'edit' ? go('edit') : go('clients'),
  clientAskDel: () => {
    if (state.docs.some(d => d.client_id === ui.clientDraft.id)) { toast('Ce client a des devis ou des factures : il ne peut pas être supprimé.'); return; }
    ui.confirm = 'cdel'; render();
  },
  clientDel: () => run(async () => {
    await db.deleteClient(ui.clientDraft.id);
    state.clients = state.clients.filter(c => c.id !== ui.clientDraft.id);
    ui.view = 'clients'; ui.confirm = null; toast('Client supprimé');
  }),
  catNew: () => { if (ui.view !== 'catalog') go('catalog'); ui.catDraft = {id: null, name: '', unit: '', price_xof: 0}; ui.err = ''; render(); $('#g-name')?.focus(); },
  catEdit: el => { ui.catDraft = {...state.catalog.find(x => x.id === el.dataset.id)}; ui.err = ''; render(); $('#g-name')?.focus(); },
  catCancel: () => { ui.catDraft = null; ui.err = ''; render(); },
  catDel: () => run(async () => {
    await db.deleteItem(ui.catDraft.id);
    state.catalog = state.catalog.filter(x => x.id !== ui.catDraft.id);
    ui.catDraft = null; toast('Prestation supprimée');
  })
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && acts[el.dataset.act]) { e.preventDefault(); acts[el.dataset.act](el, e); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('tr[data-act]')) e.target.click();
});
document.addEventListener('input', e => {
  if (e.target.id === 'q') { ui.q = e.target.value; $('#doclist').innerHTML = docList(); return; }
  if (e.target.id === 'relmsg') { const a = $('#walink'); if (a) a.href = waLink((ui.doc.snapshot?.client || clientOf(ui.doc.client_id) || {}).phone, e.target.value); return; }
  if (e.target.closest('#editor')) {
    readDraft();
    if (['f-type', 'f-cur', 'f-tva'].includes(e.target.id)) { render(); return; }
    const d = ui.draft;
    if (e.target.dataset.field === 'description' && !isEur(d.currency)) {
      const i = +e.target.dataset.line, l = d.lines[i], it = state.catalog.find(c => c.name === l.description);
      if (it && !l.price) { l.price = it.price_xof; const p = $(`#l-${i}-price`); if (p) p.value = it.price_xof; }
    }
    d.lines.forEach((l, i) => { const a = $(`[data-amt="${i}"]`); if (a) a.textContent = amtShort(d.currency, Math.round(l.qty * toMinor(d.currency, l.price))); });
    $('#totals').innerHTML = totalsBox(d);
  }
});

document.addEventListener('change', async e => {
  if (e.target.id === 'imgfile' && e.target.files[0] && ui.imgKey) {
    const k = ui.imgKey, [w, h, clear] = IMG_SIZE[k];
    try {
      const url = toPng(await loadImage(e.target.files[0]), w, h, clear);
      if (!url) { toast('L’image semble vide : essayez une photo plus contrastée.'); return; }
      saveBrand({[k]: url}, k === 'logo_img' ? 'Logo enregistré' : k === 'stamp_img' ? 'Cachet enregistré' : 'Signature enregistrée');
    } catch (err) { toast(humanError(err)); }
  }
  if (e.target.id === 's-color' && isPro()) saveBrand({brand_color: e.target.value.toUpperCase()}, 'Couleur enregistrée');
});

const val = id => $('#' + id)?.value.trim() ?? '';
const upsert = (list, row) => list.some(x => x.id === row.id) ? list.map(x => x.id === row.id ? row : x) : [...list, row];
const byName = (a, b) => a.name.localeCompare(b.name, 'fr');

document.addEventListener('submit', e => {
  e.preventDefault();
  const id = e.target.id;

  if (id === 'authform') {
    const email = val('a-email'), pass = $('#a-pass').value;
    run(async () => {
      if (ui.authMode === 'signup') {
        const {session} = await db.signUp(email, pass);
        if (!session) { ui.authMode = 'login'; ui.info = 'Compte créé. Ouvrez le lien de confirmation reçu par e-mail, puis connectez-vous.'; }
      } else await db.signIn(email, pass);
    });
  }
  if (id === 'phoneform') {
    const phone = normPhone(val('a-phone'));
    if (!phone) { ui.err = 'Numéro invalide. Exemple : 77 123 45 67, ou +33 6 12 34 56 78 depuis l’étranger.'; return render(); }
    ui.phone = phone;
    run(async () => { await db.sendPhoneCode(phone); ui.phoneStep = 2; });
  }
  if (id === 'codeform') {
    const code = val('a-code').replace(/\D/g, '');
    if (!code) { ui.err = 'Tapez le code reçu sur WhatsApp.'; return render(); }
    run(async () => { await db.verifyPhoneCode(ui.phone, code); });
  }
  if (id === 'forgotform') {
    const email = val('a-email');
    run(async () => { await db.sendReset(email); ui.info = 'Si un compte existe avec cet e-mail, un lien vient de vous être envoyé.'; });
  }
  if (id === 'resetform') {
    const pass = $('#a-pass').value;
    run(async () => { await db.setPassword(pass); ui.recovery = false; toast('Mot de passe modifié'); });
  }
  if (id === 'onboardform') {
    const fields = {name: val('o-name'), job: val('o-job'), phone_pay: val('o-phone')};
    if (!fields.name) { ui.err = 'Indiquez votre nom.'; return render(); }
    run(async () => { state.profile = await db.saveProfile(state.profile.id, fields); ui.view = 'home'; });
  }
  if (id === 'profileform') {
    const fields = {name: val('s-name'), job: val('s-job'), phone_pay: val('s-phone_pay'), email: val('s-email'), address: val('s-address'), ninea: val('s-ninea'),
      goal_xof: Math.max(0, Math.round(parseNum(val('s-goal_xof')))), tva_on: $('#s-tva_on').checked, mentions: val('s-mentions')};
    if (!fields.name) { ui.err = 'Indiquez votre nom.'; return render(); }
    run(async () => { state.profile = await db.saveProfile(state.profile.id, fields); toast('Profil enregistré'); });
  }
  if (id === 'proform') {
    const code = val('pro-code');
    if (!code) { ui.err = 'Tapez le code Pro reçu.'; return render(); }
    run(async () => {
      const until = await db.redeemProCode(code);
      state.profile = await db.getProfile(state.session.user); ui.pdf = null;
      toast(until ? `Pro activé jusqu’au ${fmtDate(until)}` : 'Pro activé');
    });
  }
  if (id === 'prefsform') {
    const days = k => Math.min(365, Math.max(0, Math.round(parseNum(val(k)) || 0)));
    const fields = {due_days: days('s-due_days'), quote_days: days('s-quote_days'), reminders_on: $('#s-reminders_on').checked};
    run(async () => { state.profile = await db.saveProfile(state.profile.id, fields); toast('Préférences enregistrées'); });
  }
  if (id === 'delform') {
    if (val('s-del').toUpperCase() !== 'SUPPRIMER') { ui.err = 'Tapez SUPPRIMER pour confirmer.'; return render(); }
    run(async () => { await db.deleteAccount(); ui.delAsk = false; await logout('Votre compte et toutes vos données ont été supprimés.'); });
  }
  if (id === 'editor') {
    readDraft();
    const d = ui.draft;
    d.lines = d.lines.filter(l => l.description.trim() || l.price > 0);
    if (!d.lines.length) d.lines = [blankLine()];
    const err = !d.client_id ? 'Choisissez un client, ou ajoutez-en un.'
      : d.lines.some(l => !l.description.trim()) ? 'Chaque ligne doit avoir une prestation.'
      : d.lines.some(l => !(l.qty > 0)) ? 'Chaque quantité doit être supérieure à zéro.'
      : totals(d, draftLines(d)).ttc <= 0 ? 'Ajoutez au moins une ligne avec un prix.' : '';
    if (err) { ui.err = err; return render(true); }
    const doc = {id: d.id, type: d.type, client_id: d.client_id, currency: d.currency, issue_date: d.issue_date, due_date: d.due_date || null,
      discount_pct: d.discount_pct, deposit_pct: d.deposit_pct, tva: d.tva, notes: d.notes.trim()};
    const lines = d.lines.map(l => ({description: l.description.trim(), qty: Math.round(l.qty * 100) / 100, unit_price: toMinor(d.currency, l.price)}));
    run(async () => {
      const docId = await db.saveDocument(doc, lines);
      ui.doc = await db.getDocument(docId); refreshSummary(ui.doc);
      ui.view = 'doc'; ui.draft = null; toast('Brouillon enregistré');
    });
  }
  if (id === 'payform') {
    const d = ui.doc, p = ui.pay;
    Object.assign(p, {amount: parseNum(val('p-amount')), method: val('p-method'), paid_at: val('p-date') || today(), note: val('p-note')});
    const amount = toMinor(d.currency, p.amount);
    if (!(amount > 0)) { ui.err = 'Indiquez le montant reçu.'; return render(); }
    if (amount > restOf(d)) { ui.err = `Le montant dépasse le reste à payer (${amt(d.currency, restOf(d))}).`; return render(); }
    run(async () => {
      const row = await db.addPayment({document_id: d.id, amount, method: p.method, paid_at: p.paid_at, note: p.note});
      state.payments = [...state.payments, row];
      ui.doc = await db.getDocument(d.id); refreshSummary(ui.doc); ui.pay = null;
      toast(restOf(ui.doc) > 0 ? 'Paiement enregistré' : 'Paiement enregistré : facture soldée');
    });
  }
  if (id === 'clientform') {
    const c = ui.clientDraft;
    ['name', 'contact', 'phone', 'email', 'address', 'ninea'].forEach(k => c[k] = val('k-' + k));
    c.reminders_off = $('#k-reminders_off').checked;
    if (!c.name) { ui.err = 'Le nom du client est obligatoire.'; return render(); }
    run(async () => {
      const row = await db.saveClient(c);
      state.clients = upsert(state.clients, row).sort(byName);
      toast('Client enregistré');
      if (ui.back === 'edit') { ui.draft.client_id = row.id; ui.back = null; ui.view = 'edit'; } else ui.view = 'clients';
    });
  }
  if (id === 'catform') {
    const c = ui.catDraft;
    c.name = val('g-name'); c.unit = val('g-unit'); c.price_xof = Math.max(0, Math.round(parseNum(val('g-price'))));
    if (!c.name) { ui.err = 'Le nom de la prestation est obligatoire.'; return render(); }
    run(async () => {
      const row = await db.saveItem(c);
      state.catalog = upsert(state.catalog, row).sort(byName);
      ui.catDraft = null; toast('Prestation enregistrée');
    });
  }
});

/* ---------- Démarrage ---------- */
/* ---------- Session : déconnexion après une longue absence ---------- */
const IDLE_DAYS = 7, IDLE_KEY = 'facturesn-last-active';
const lastActive = () => { try { return +localStorage.getItem(IDLE_KEY) || 0; } catch { return 0; } };
const markActive = () => { try { localStorage.setItem(IDLE_KEY, String(Date.now())); } catch {} };
function resetSession() {
  state.session = null;
  Object.assign(state, {profile: null, clients: [], catalog: [], docs: [], payments: [], loaded: false, loadErr: ''});
  Object.assign(ui, {view: 'home', doc: null, draft: null, pay: null, confirm: null, busy: false, err: '', delAsk: false});
  render();
}
async function logout(info = '') {
  await db.signOut();
  resetSession(); ui.info = info; render();
}
// Au démarrage et au retour sur l'application : trop longtemps sans activité, ou session refusée par Supabase
async function checkSession() {
  if (!state.session) return;
  const last = lastActive();
  if (last && Date.now() - last > IDLE_DAYS * 864e5) return logout(`Par sécurité, vous avez été déconnecté après ${IDLE_DAYS} jours sans utilisation. Reconnectez-vous.`);
  if (!(await db.sessionValid())) return logout('Votre session a expiré. Reconnectez-vous.');
  markActive();
}
let markT = 0;
['click', 'keydown'].forEach(t => document.addEventListener(t, () => { if (state.session && Date.now() - markT > 60e3) { markT = Date.now(); markActive(); } }, {passive: true}));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkSession(); });

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!db.configured) return render();
  db.onAuthChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') ui.recovery = true;
    const had = state.session?.user?.id, now = session?.user?.id;
    if (!now) { if (had) resetSession(); return; }
    state.session = session;
    if (now !== had) { if (event === 'SIGNED_IN') markActive(); state.loaded = false; render(); loadAll(); }
  });
  try { state.session = await db.getSession(); } catch (e) { ui.err = humanError(e); }
  await checkSession();
  if (state.session && !state.loaded) loadAll(); else render();
}
boot();
