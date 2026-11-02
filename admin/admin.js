// Facture SN : espace d'administration, séparé de l'application des freelances.
// Session distincte (storageKey propre) : se connecter ici ne connecte pas /app/, et inversement.
// Toutes les données passent par les fonctions admin_* de supabase/schema.sql, qui refusent les autres comptes.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.50.0/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../app/js/config.js';
import { esc, num } from '../app/js/format.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {auth: {storageKey: 'facturesn-admin'}});
const ok = ({data, error}) => { if (error) throw error; return data; };
const rpc = async (fn, args) => ok(await sb.rpc(fn, args));

const $ = s => document.querySelector(s);
const state = {session: null, allowed: false, data: null};
const ui = {view: 'dash', err: '', busy: false, q: '', plan: 'all'};

function humanError(e) {
  const m = String(e?.message || e || '');
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou mot de passe incorrect.';
  if (/Email not confirmed/i.test(m)) return 'Confirmez d’abord votre adresse avec le lien reçu par e-mail.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Connexion impossible. Vérifiez votre accès à internet.';
  if (/Could not find the function|schema cache/i.test(m)) return 'La base n’est pas à jour : lancez supabase/schema.sql dans Supabase.';
  return m || 'Une erreur est survenue.';
}
let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }

const showPhone = p => ('+' + String(p || '').replace(/^\+/, '')).replace(/^\+221(\d{2})(\d{3})(\d{2})(\d{2})$/, '+221 $1 $2 $3 $4');
const when = ts => ts ? new Date(ts).toLocaleString('fr-FR', {day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit'}) : '—';
const contact = u => u.email || (u.phone ? showPhone(u.phone) : '');
const brand = `<div class="brand"><span class="mark" aria-hidden="true">FS</span><div><b>Facture SN</b><small>Administration</small></div></div>`;

/* ---------- Données ---------- */
async function load() {
  ui.err = '';
  try {
    const [overview, users, gateway] = await Promise.all([rpc('admin_overview'), rpc('admin_users'), rpc('admin_gateway')]);
    state.data = {overview, users, gateway};
  } catch (e) { ui.err = humanError(e); }
  render();
}

/* ---------- Écrans ---------- */
function vLogin() {
  return `<div class="auth"><form class="auth-card" id="loginform">${brand}<h1>Espace administrateur</h1>
    <p class="muted" style="margin:0">Réservé aux comptes administrateurs de Facture SN.</p>
    <label class="field">E-mail<input type="email" id="a-email" autocomplete="email" required></label>
    <label class="field">Mot de passe<input type="password" id="a-pass" autocomplete="current-password" required></label>
    ${ui.err ? `<div class="err" role="alert">${esc(ui.err)}</div>` : ''}
    <button class="btn primary" type="submit" ${ui.busy ? 'disabled' : ''}>Se connecter</button>
    <a class="linkbtn" href="../app/">Aller à l’application</a></form></div>`;
}
function vDenied() {
  return `<div class="auth"><div class="auth-card">${brand}<h1>Accès refusé</h1>
    <p class="muted" style="margin:0">Le compte ${esc(contact(state.session.user))} n’est pas administrateur.</p>
    <button class="btn" data-act="logout">Se déconnecter</button><a class="linkbtn" href="../app/">Aller à l’application</a></div></div>`;
}

const kpi = (l, v, sub) => `<div class="kpi"><span class="lbl">${l}</span><span class="val">${v}</span><span class="sub">${sub}</span></div>`;
function usersTable(list, full = true) {
  if (!list.length) return `<p class="empty">Aucun compte ne correspond.</p>`;
  return `<div class="tablewrap"><table class="list"><thead><tr><th>Compte</th><th class="hide-sm">Inscrit</th><th class="hide-sm">Dernière connexion</th>
    ${full ? '<th class="num hide-sm">Clients</th>' : ''}<th class="num">Factures</th>${full ? '<th class="num hide-sm">Facturé</th><th class="num hide-sm">Encaissé</th>' : ''}<th>Formule</th></tr></thead>
    <tbody>${list.map(u => `<tr><td><b>${esc(u.name || 'Profil non rempli')}</b>${u.confirmed ? '' : ' <span class="pill warn">non confirmé</span>'}
        <br><small class="muted">${esc(contact(u))}${u.job ? ' · ' + esc(u.job) : ''}</small></td>
      <td class="hide-sm">${when(u.created_at)}</td><td class="hide-sm">${when(u.last_sign_in_at)}</td>
      ${full ? `<td class="num hide-sm">${u.clients}</td>` : ''}<td class="num">${u.invoices}<small class="muted"> / ${u.documents}</small></td>
      ${full ? `<td class="num hide-sm">${num(u.billed_xof)}</td><td class="num hide-sm">${num(u.paid_xof)}</td>` : ''}
      <td>${full ? `<button class="btn sm ${u.plan === 'pro' ? 'primary' : ''}" data-act="plan" data-id="${u.id}" data-plan="${u.plan === 'pro' ? 'free' : 'pro'}"
        title="${u.plan === 'pro' ? 'Repasser en gratuit' : 'Passer en Pro'}" ${ui.busy ? 'disabled' : ''}>${u.plan === 'pro' ? 'Pro' : 'Gratuit'}</button>`
        : `<span class="pill ${u.plan === 'pro' ? 'good' : 'neutral'}">${u.plan === 'pro' ? 'Pro' : 'Gratuit'}</span>`}</td></tr>`).join('')}</tbody></table></div>`;
}

function vDash() {
  const o = state.data.overview;
  return `<div class="head"><div><h1>Tableau de bord</h1><p>Tous les comptes Facture SN.</p></div><button class="btn" data-act="reload">Actualiser</button></div>
    <div class="stack">
      <div class="kpis">
        ${kpi('Comptes', o.users, `+${o.users_7d} cette semaine · ${o.by_phone} par numéro`)}
        ${kpi('Actifs (7 jours)', o.active_7d, `${o.pro} en Pro`)}
        ${kpi('Factures validées', o.invoices, `${o.documents} documents au total`)}
        ${kpi('Facturé', `${num(o.billed_xof)} <small>FCFA</small>`, `${num(o.paid_xof)} FCFA encaissés`)}
      </div>
      <section class="card"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h2>Derniers inscrits</h2>
        <button class="btn ghost sm" data-act="go" data-view="users">Tous les comptes</button></div>${usersTable(state.data.users.slice(0, 5), false)}</section>
      <section class="card"><h2>Passerelle WhatsApp</h2>
        <p class="muted" style="margin:0">24 dernières heures : ${o.otp_24h} code${o.otp_24h > 1 ? 's' : ''} demandé${o.otp_24h > 1 ? 's' : ''}, ${o.otp_claimed_24h} remis par WhatsApp.
        <button class="linkbtn" data-act="go" data-view="gateway">Voir le détail</button></p></section>
    </div>`;
}

const PLANS = [['all', 'Tous'], ['free', 'Gratuit'], ['pro', 'Pro'], ['unconfirmed', 'Non confirmés']];
function filteredUsers() {
  const q = ui.q.trim().toLowerCase();
  return state.data.users.filter(u => (ui.plan === 'all' || (ui.plan === 'unconfirmed' ? !u.confirmed : u.plan === ui.plan))
    && (!q || [u.name, u.email, u.phone, u.job].some(v => (v || '').toLowerCase().includes(q))));
}
function vUsers() {
  const n = state.data.users.length;
  return `<div class="head"><div><h1>Comptes</h1><p>${n} compte${n > 1 ? 's' : ''} · montants convertis en FCFA</p></div><button class="btn" data-act="reload">Actualiser</button></div>
    <div class="toolbar"><div class="chips">${PLANS.map(([k, l]) => `<button class="chip" data-act="plans" data-f="${k}" aria-pressed="${ui.plan === k}">${l}</button>`).join('')}</div>
      <input type="search" id="q" class="search" placeholder="Nom, e-mail ou numéro" value="${esc(ui.q)}" aria-label="Rechercher un compte"></div>
    <div id="userlist">${usersTable(filteredUsers())}</div>`;
}

function vGateway() {
  const g = state.data.gateway, codes = g.filter(x => x.kind === 'code'), msgs = g.filter(x => x.kind === 'message');
  return `<div class="head"><div><h1>Passerelle WhatsApp</h1><p>Codes de connexion et messages reçus par MacroDroid (30 derniers).</p></div><button class="btn" data-act="reload">Actualiser</button></div>
    <div class="grid2">
      <section class="card"><h2>Codes demandés</h2><div class="tablewrap"><table class="list"><thead><tr><th>Numéro</th><th>Demandé</th><th>Remis</th></tr></thead>
        <tbody>${codes.map(x => `<tr><td class="mono">${esc(showPhone(x.label))}</td><td>${when(x.created_at)}</td><td>${x.claimed_at ? when(x.claimed_at) : '<span class="pill warn">non</span>'}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Aucun code.</td></tr>'}</tbody></table></div></section>
      <section class="card"><h2>Titres reçus</h2><div class="tablewrap"><table class="list"><thead><tr><th>Titre de la notification</th><th>Heure</th></tr></thead>
        <tbody>${msgs.map(x => `<tr><td>${esc(x.label.slice(0, 80))}</td><td>${when(x.created_at)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">Aucun message.</td></tr>'}</tbody></table></div>
        <small class="muted">Un titre qui n’est pas un numéro (nom de contact, « Vous ») ne reçoit pas de code.</small></section>
    </div>`;
}

const views = {dash: vDash, users: vUsers, gateway: vGateway};
const NAV = [['dash', 'Tableau de bord'], ['users', 'Comptes'], ['gateway', 'Passerelle WhatsApp']];

function render() {
  const root = $('#root');
  if (!state.session) { root.innerHTML = vLogin(); return; }
  if (!state.allowed) { root.innerHTML = vDenied(); return; }
  const body = state.data ? views[ui.view]() : ui.err ? '' : '<p class="boot">Chargement…</p>';
  root.innerHTML = `<div class="app"><aside class="side">${brand}
      <nav aria-label="Navigation">${NAV.map(([v, l]) => `<button data-act="go" data-view="${v}" ${ui.view === v ? 'aria-current="page"' : ''}>${l}</button>`).join('')}</nav>
      <div class="side-cta"><span class="who">${esc(contact(state.session.user))}</span><button class="btn sm" data-act="logout">Se déconnecter</button></div></aside>
    <main id="main">${ui.err ? `<div class="err" role="alert">${esc(ui.err)}</div>` : ''}${body}</main></div>`;
}

/* ---------- Actions ---------- */
const acts = {
  go: el => { ui.view = el.dataset.view; render(); window.scrollTo(0, 0); },
  reload: () => { state.data = null; render(); load(); },
  plans: el => { ui.plan = el.dataset.f; render(); },
  logout: async () => { await sb.auth.signOut({scope: 'local'}).catch(() => {}); onSession(null); },
  plan: async el => {
    if (ui.busy) return;
    ui.busy = true; render();
    try {
      await rpc('admin_set_plan', {p_user: el.dataset.id, p_plan: el.dataset.plan});
      state.data.users = state.data.users.map(u => u.id === el.dataset.id ? {...u, plan: el.dataset.plan} : u);
      toast(el.dataset.plan === 'pro' ? 'Compte passé en Pro' : 'Compte repassé en gratuit');
    } catch (e) { ui.err = humanError(e); }
    ui.busy = false; render();
  }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && acts[el.dataset.act]) { e.preventDefault(); acts[el.dataset.act](el); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'q') { ui.q = e.target.value; $('#userlist').innerHTML = usersTable(filteredUsers()); }
});
document.addEventListener('submit', async e => {
  e.preventDefault();
  if (e.target.id !== 'loginform' || ui.busy) return;
  ui.busy = true; ui.err = '';
  const email = $('#a-email').value.trim(), password = $('#a-pass').value;
  render();
  try { ok(await sb.auth.signInWithPassword({email, password})); } catch (err) { ui.err = humanError(err); }
  ui.busy = false; render();
});

/* ---------- Démarrage ---------- */
async function onSession(session, event) {
  const had = state.session?.user?.id;
  state.session = session;
  if (!session) { Object.assign(state, {allowed: false, data: null}); render(); return; }
  if (session.user.id === had) return;
  if (event === 'INITIAL_SESSION') await checkIdle(); else stamp();
  if (!state.session) return;
  state.allowed = await rpc('is_admin').catch(() => false);
  render();
  if (state.allowed) load();
}
sb.auth.onAuthStateChange((event, session) => { setTimeout(() => onSession(session, event)); });

// Espace sensible : déconnexion après 12 heures sans utilisation
const IDLE_MS = 12 * 3600e3, IDLE_KEY = 'facturesn-admin-last-active';
const stamp = () => { try { localStorage.setItem(IDLE_KEY, String(Date.now())); } catch {} };
async function checkIdle() {
  let last = 0; try { last = +localStorage.getItem(IDLE_KEY) || 0; } catch {}
  if (state.session && last && Date.now() - last > IDLE_MS) { await acts.logout(); ui.err = 'Déconnecté après une longue absence. Reconnectez-vous.'; render(); return; }
  stamp();
}
['click', 'keydown'].forEach(t => document.addEventListener(t, stamp, {passive: true}));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkIdle(); });
