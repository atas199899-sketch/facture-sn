// Facture SN : écrans et navigation de l'application connectée
// Étape 1 : compte, profil, clients, tarifs. Étape 2 : devis et factures. Étape 3 : paiements reçus.
import * as db from './db.js';
import {WHATSAPP_GATEWAY} from './config.js';
import {esc, num, parseNum, isEur, amt, amtShort, toMinor, toMajor, toXOF, decimal, today, addDays, fmtDate, totals, sommeEnLettres} from './format.js';

const $ = s => document.querySelector(s);

const state = {session: null, profile: null, clients: [], catalog: [], docs: [], payments: [], loaded: false, loadErr: ''};
const ui = {view: 'home', authMode: 'login', err: '', info: '', busy: false, clientDraft: null, catDraft: null, confirm: null, recovery: false,
  doc: null, draft: null, filter: 'all', q: '', share: false, back: null, phone: '', phoneStep: 1, pay: null, payDel: null};

/* ---------- Messages d'erreur lisibles ---------- */
function humanError(e) {
  const m = String(e?.message || e || '');
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou mot de passe incorrect.';
  if (/already registered|already exists/i.test(m)) return 'Un compte existe déjà avec cet e-mail. Connectez-vous.';
  if (/Email not confirmed/i.test(m)) return 'Confirmez d’abord votre adresse avec le lien reçu par e-mail.';
  if (/Token has expired or is invalid|otp.*(expired|invalid)/i.test(m)) return 'Code incorrect ou expiré. Redemandez un code.';
  if (/security purposes/i.test(m)) return 'Patientez quelques secondes avant de redemander un code.';
  if (/phone.*(disabled|provider)|Unsupported phone/i.test(m)) return 'La connexion par numéro n’est pas encore activée. Utilisez votre e-mail.';
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

/* ---------- Écrans hors connexion ---------- */
const brand = `<div class="brand"><span class="mark" aria-hidden="true">FS</span><div><b>Facture SN</b><small>Pour les freelances</small></div></div>`;
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
  const wa = `https://wa.me/${WHATSAPP_GATEWAY}?text=${encodeURIComponent('Bonjour Facture SN, je demande mon code de connexion.')}`;
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
    <a class="linkbtn" href="../demo.html">Voir la démo sans compte</a></form></div>`;
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
  const lateDocs = state.docs.filter(d => stOf(d) === 'late'), late = lateDocs.length, drafts = state.docs.filter(d => d.status === 'draft').length;
  const step = (done, title, sub, act) => `<div class="step ${done ? 'done' : ''}"><span class="dot">${done ? '✓' : '·'}</span>
    <div class="txt"><b>${title}</b><small>${sub}</small></div>${act || ''}</div>`;
  const started = Boolean(p.phone_pay && p.job) && nc > 0 && nt > 0 && nd > 0;
  return `<div class="head"><div><h1>Bonjour ${esc(p.name.split(' ')[0])}</h1><p>Votre espace Facture SN est prêt.</p></div>
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
    ${late ? `<section class="card"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h2>À relancer</h2><button class="btn ghost sm" data-act="filter" data-f="late" data-go="1">Tout voir</button></div>
      <div class="tablewrap">${docTable(lateDocs.slice(0, 5))}</div></section>` : ''}
    ${nd ? `<section class="card"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h2>Derniers documents</h2><button class="btn ghost sm" data-act="go" data-view="docs">Tout voir</button></div>
      <div class="tablewrap">${docTable(state.docs.slice(0, 5))}</div></section>` : ''}
    <p class="note">Bêta : les liens de paiement Wave / Orange Money et les relances automatiques arrivent aux prochaines étapes.</p>
  </div>`;
}

/* ---------- Liste des documents ---------- */
const FILTERS = [['all', 'Tous'], ['FAC', 'Factures'], ['DEV', 'Devis'], ['draft', 'Brouillons'], ['unpaid', 'À encaisser'], ['late', 'Échéance passée'], ['paid', 'Payées']];
function matchFilter(d, f) {
  if (f === 'all') return true;
  if (f === 'FAC' || f === 'DEV') return d.type === f;
  if (f === 'draft') return d.status === 'draft';
  if (f === 'unpaid') return restOf(d) > 0;
  return stOf(d) === f;
}
function docTable(list) {
  return `<table class="list"><thead><tr><th>N°</th><th>Client</th><th class="hide-sm">Date</th><th class="hide-sm">Échéance</th><th class="num">Montant</th><th class="num hide-sm">Reste dû</th><th>Statut</th></tr></thead>
    <tbody>${list.map(d => `<tr data-act="open" data-id="${d.id}" tabindex="0">
      <td class="mono">${esc(docLabel(d))}</td><td class="cl">${esc(cName(d.client_id))}</td>
      <td class="hide-sm">${fmtDate(d.issue_date)}</td><td class="hide-sm">${fmtDate(d.due_date)}</td>
      <td class="num">${amtShort(d.currency, d.total_ttc)}</td><td class="num hide-sm">${restOf(d) > 0 ? amtShort(d.currency, restOf(d)) : '—'}</td><td>${pill(stOf(d))}</td></tr>`).join('')}</tbody></table>`;
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
function documentText(d, co, c) {
  const dev = d.type === 'DEV';
  const dep = d.deposit_amount ? `\n\nPour démarrer, un acompte de ${d.deposit_pct} % est demandé, soit ${amt(d.currency, d.deposit_amount)}.` : '';
  const pay = isEur(d.currency) ? 'Règlement par virement bancaire.' : `Vous pouvez régler par Wave ou Orange Money au ${co.phone_pay || '[votre numéro]'}.`;
  return `Bonjour ${c.contact || c.name || ''},\n\nVoici ${dev ? 'mon devis' : 'ma facture'} ${d.number} d’un montant de ${amt(d.currency, d.total_ttc)}`
    + `${d.due_date ? (dev ? `, valable jusqu’au ${fmtDate(d.due_date)}` : `, à régler avant le ${fmtDate(d.due_date)}`) : ''}.${dep}\n\n${pay}\n\nMerci pour votre confiance,\n${co.name || ''}`;
}

function reminderText(d, co, c) {
  const rest = restOf(d), past = d.due_date && d.due_date < today();
  const pay = isEur(d.currency) ? 'Règlement par virement bancaire.' : `Vous pouvez régler par Wave ou Orange Money au ${co.phone_pay || '[votre numéro]'}.`;
  return `Bonjour ${c.contact || c.name || ''},\n\nPetit rappel concernant ma facture ${d.number} du ${fmtDate(d.issue_date)}, d’un montant de ${amt(d.currency, d.total_ttc)}`
    + `${d.due_date ? (past ? `, arrivée à échéance le ${fmtDate(d.due_date)}` : `, à régler avant le ${fmtDate(d.due_date)}`) : ''}.`
    + `${d.paid_amount > 0 ? ` Merci pour le règlement de ${amt(d.currency, d.paid_amount)} déjà reçu : il reste ${amt(d.currency, rest)} à payer.` : ''}`
    + `\n\n${pay}\n\nSi le paiement est déjà parti, merci de ne pas tenir compte de ce message.\n\nBien cordialement,\n${co.name || ''}`;
}

function paper(d, co, c) {
  const dev = d.type === 'DEV', cur = d.currency;
  return `<article class="paper" aria-label="Aperçu du document">
    ${d.status === 'draft' ? '<div class="watermark" aria-hidden="true">BROUILLON</div>' : ''}
    <div class="p-top">
      <div class="p-co"><b>${esc(co.name || 'Votre nom')}</b>${co.job ? `<div class="job">${esc(co.job)}</div>` : ''}
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
  </article>`;
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
      ${d.status === 'sent' ? `<button class="btn" data-act="print">Télécharger le PDF</button><button class="btn" data-act="share" data-mode="send">Envoyer par WhatsApp</button>` : ''}
      ${rest > 0 && (d.due_date && d.due_date < today() || d.paid_amount > 0) ? `<button class="btn" data-act="share" data-mode="remind">Relancer</button>` : ''}
      ${draft ? '' : `<button class="btn" data-act="dup">Dupliquer</button>`}
      ${draft ? `<button class="btn danger" data-act="askConfirm" data-c="del">Supprimer</button>` : ''}
      ${d.status === 'sent' && !(d.paid_amount > 0) ? `<button class="btn danger" data-act="askConfirm" data-c="cancel">Annuler</button>` : ''}
    </div></div>
  <div class="stack">
    ${confirm ? `<div class="panel alert noprint"><b>${confirm[0]}</b>
      <div class="row"><button class="btn ${confirm[3]}" data-act="${confirm[1]}" ${ui.busy ? 'disabled' : ''}>${confirm[2]}</button><button class="btn" data-act="cancelConfirm">Retour</button></div></div>` : ''}
    ${ui.err && !p ? `<div class="err noprint" role="alert">${esc(ui.err)}</div>` : ''}
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
      <div class="row"><a class="btn primary" id="walink" href="${esc(waLink(c.phone, msg))}" target="_blank" rel="noopener">Ouvrir WhatsApp</a>
        <button class="btn" data-act="copy">Copier le message</button><button class="btn ghost" data-act="closeShare">Fermer</button></div>
      <small class="muted">Destinataire : ${esc(c.phone || 'aucun numéro enregistré')}.${ui.share === 'remind' ? '' : ' Pensez à joindre le PDF téléchargé dans la conversation.'}</small></div>` : ''}
    ${paper(d, co, c)}
  </div>`;
}

/* ---------- Création et modification ---------- */
const blankLine = () => ({description: '', qty: 1, price: 0});
// Nouveau brouillon : vide, ou copié d'un document existant (src), avec d'éventuels réglages imposés (extra)
function startDraft(type, src, extra = {}) {
  const T = today(), p = state.profile;
  ui.draft = src
    ? {id: null, type: src.type, client_id: src.client_id, currency: src.currency, issue_date: T, due_date: addDays(T, src.type === 'DEV' ? 30 : 15),
       discount_pct: +src.discount_pct, deposit_pct: src.deposit_pct, tva: src.tva && p.tva_on, notes: src.notes,
       lines: src.lines.map(l => ({description: l.description, qty: +l.qty, price: toMajor(src.currency, l.unit_price)}))}
    : {id: null, type, client_id: state.clients.length === 1 ? state.clients[0].id : '', currency: 'XOF', issue_date: T, due_date: addDays(T, type === 'DEV' ? 30 : 15),
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

function vProfile() {
  const p = state.profile;
  const f = (k, l, ph = '', type = 'text') => `<label class="field">${l}<input type="${type}" id="s-${k}" value="${esc(p[k])}" placeholder="${ph}"></label>`;
  return `<div class="head"><div><h1>Mon profil</h1><p>Ces informations apparaissent sur vos devis et factures.</p></div></div>
  <div class="stack">
    <form id="profileform" class="card stack">
      <div class="fgrid">${f('name', 'Votre nom ou nom de marque', 'Ex. : Khady Sy')}${f('job', 'Votre métier', 'Ex. : Développeur web')}
        ${f('phone_pay', 'Téléphone Wave / Orange Money', '+221 77 000 00 00', 'tel')}${f('email', 'E-mail affiché sur les factures', '', 'email')}
        ${f('address', 'Ville ou quartier', 'Ex. : Liberté 6, Dakar')}${f('ninea', 'NINEA (facultatif)')}
        <label class="field">Objectif de revenus par mois (FCFA)<input type="text" id="s-goal_xof" inputmode="numeric" value="${p.goal_xof || ''}" placeholder="Ex. : 1 000 000"></label></div>
      <label class="check"><input type="checkbox" id="s-tva_on" ${p.tva_on ? 'checked' : ''}> Je suis assujetti à la TVA (18 %)</label>
      <label class="field">Conditions en bas de vos documents<textarea id="s-mentions" placeholder="Ex. : Paiement à réception. Acompte non remboursable une fois le projet démarré.">${esc(p.mentions)}</textarea></label>
      ${msgs()}
      <div class="row"><button type="submit" class="btn primary" ${ui.busy ? 'disabled' : ''}>Enregistrer</button></div>
    </form>
    <section class="card stack" style="gap:12px"><h2 style="margin:0">Compte</h2>
      <p class="muted" style="margin:0">Connecté avec ${esc(userLabel(state.session.user))}.</p>
      <div class="row"><button class="btn" data-act="logout">Se déconnecter</button></div>
    </section>
  </div>`;
}

const views = {home: vHome, docs: vDocs, doc: vDoc, edit: vEdit, clients: vClients, client: vClient, catalog: vCatalog, profile: vProfile};
const NAV = [['home', 'Accueil'], ['docs', 'Factures et devis'], ['clients', 'Clients'], ['catalog', 'Mes tarifs'], ['profile', 'Mon profil']];
const navOf = {home: 'home', docs: 'docs', doc: 'docs', edit: 'docs', clients: 'clients', client: 'clients', catalog: 'catalog', profile: 'profile'};

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
      <nav aria-label="Navigation">${NAV.map(([v, l]) => `<button data-act="go" data-view="${v}" ${navOf[ui.view] === v ? 'aria-current="page"' : ''}>${l}</button>`).join('')}</nav>
      <div class="side-cta"><span class="who">${esc(userLabel(state.session.user))}</span></div></aside>
    <main id="main">${views[ui.view]()}</main></div>`;
  if (scroll) window.scrollTo(0, 0);
}

function go(view, extra = {}) { Object.assign(ui, {view, err: '', info: '', confirm: null, catDraft: null, share: false, pay: null}, extra); render(true); }

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
    due_date: d.due_date, total_ttc: d.total_ttc, deposit_amount: d.deposit_amount, paid_amount: d.paid_amount, converted_to: d.converted_to, created_at: d.created_at};
  state.docs = state.docs.some(x => x.id === d.id) ? state.docs.map(x => x.id === d.id ? row : x) : [row, ...state.docs];
}

/* ---------- Actions ---------- */
const acts = {
  go: el => go(el.dataset.view),
  authMode: el => { ui.authMode = el.dataset.mode; ui.phoneStep = 1; ui.err = ''; ui.info = ''; render(); },
  phoneBack: () => { ui.phoneStep = 1; ui.err = ''; render(); },
  retry: () => { state.loadErr = ''; render(); loadAll(); },
  logout: () => run(async () => { await db.signOut(); }),

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
    const title = document.title; document.title = ui.doc.number || 'Facture SN';
    window.print(); document.title = title;
  },
  share: el => { ui.share = ui.share === el.dataset.mode ? false : el.dataset.mode; ui.pay = null; render(); },
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
  copy: () => {
    const ta = $('#relmsg');
    navigator.clipboard.writeText(ta.value).then(() => toast('Message copié')).catch(() => { ta.select(); toast('Texte sélectionné : copiez-le avec Ctrl+C'); });
  },

  clientNew: el => {
    if (el.dataset.back === 'edit') readDraft();
    ui.back = el.dataset.back || null;
    ui.clientDraft = {id: null, name: '', contact: '', phone: '', email: '', address: '', ninea: ''}; go('client');
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
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!db.configured) return render();
  db.onAuthChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') ui.recovery = true;
    const had = state.session?.user?.id, now = session?.user?.id;
    state.session = session;
    if (!now) { Object.assign(state, {profile: null, clients: [], catalog: [], docs: [], payments: [], loaded: false, loadErr: ''}); Object.assign(ui, {view: 'home', doc: null, draft: null}); render(); }
    else if (now !== had) { state.loaded = false; render(); loadAll(); }
  });
  try { state.session = await db.getSession(); } catch (e) { ui.err = humanError(e); }
  if (state.session && !state.loaded) loadAll(); else render();
}
boot();
