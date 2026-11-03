// Faybi SN : espace d'administration (codes Pro), séparé de l'application des freelances.
// Session distincte (storageKey propre) : se connecter ici ne connecte pas /app/, et inversement.
// Toutes les données passent par les fonctions admin_* de supabase/schema.sql, qui refusent les autres comptes.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.50.0/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../app/js/config.js';
import { esc } from '../app/js/format.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {auth: {storageKey: 'facturesn-admin'}});
const ok = ({data, error}) => { if (error) throw error; return data; };
const rpc = async (fn, args) => ok(await sb.rpc(fn, args));

const $ = s => document.querySelector(s);
const state = {session: null, allowed: false, data: null};
const ui = {err: '', busy: false, fresh: []};

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
const brand = `<div class="brand"><span class="mark" aria-hidden="true">FS</span><div><b>Faybi SN</b><small>Administration</small></div></div>`;

/* ---------- Données ---------- */
async function load() {
  ui.err = '';
  try {
    state.data = {codes: await rpc('admin_codes')};
  } catch (e) { ui.err = humanError(e); }
  render();
}

/* ---------- Écrans ---------- */
function vLogin() {
  return `<div class="auth"><form class="auth-card" id="loginform">${brand}<h1>Espace administrateur</h1>
    <p class="muted" style="margin:0">Réservé aux comptes administrateurs de Faybi SN.</p>
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

// Codes Pro : générés ici, envoyés au freelance après son paiement, saisis dans l'onglet Abonnement
function vCodes() {
  const list = state.data.codes, fresh = ui.fresh;
  return `<div class="head"><div><h1>Codes Pro</h1><p>Après un paiement, générez un code et envoyez-le au freelance : il le saisit dans l’onglet Abonnement.</p></div><button class="btn" data-act="reload">Actualiser</button></div>
  <div class="stack">
    <form id="codeform" class="card stack"><h2 style="margin:0">Générer des codes</h2>
      <div class="fgrid">
        <label class="field">Durée<select id="c-months"><option value="1">1 mois (3 000 FCFA)</option><option value="12">12 mois (30 000 FCFA)</option><option value="3">3 mois</option><option value="6">6 mois</option></select></label>
        <label class="field">Nombre de codes<input type="number" id="c-count" min="1" max="50" value="1"></label>
        <label class="field">Note (facultatif)<input type="text" id="c-note" placeholder="Ex. : Wave de Awa, réf. FSN-1A2B3C"></label></div>
      <div class="row"><button class="btn primary" type="submit" ${ui.busy ? 'disabled' : ''}>Générer</button></div>
      ${fresh.length ? `<div class="panel stack"><b>${fresh.length > 1 ? `${fresh.length} nouveaux codes` : 'Nouveau code'}</b>
        <pre class="mono" style="margin:0;white-space:pre-wrap;font-size:16px">${fresh.map(esc).join('\n')}</pre>
        <div class="row"><button type="button" class="btn sm" data-act="copyCodes">Copier</button>
          ${fresh.length === 1 ? `<a class="btn sm" href="https://wa.me/?text=${encodeURIComponent(`Bonjour ! Voici votre code Pro Faybi SN : ${fresh[0]}\nSaisissez-le dans l’application, onglet Abonnement : https://faybi-sn.pages.dev/app/`)}" target="_blank" rel="noopener">Envoyer sur WhatsApp</a>` : ''}</div></div>` : ''}
    </form>
    <section class="card"><h2>Codes générés</h2><div class="tablewrap"><table class="list"><thead><tr><th>Code</th><th>Durée</th><th class="hide-sm">Note</th><th class="hide-sm">Créé</th><th>Utilisé par</th><th></th></tr></thead>
      <tbody>${list.map(c => `<tr><td class="mono">${esc(c.code)}</td><td>${c.months} mois</td><td class="hide-sm">${esc(c.note)}</td><td class="hide-sm">${when(c.created_at)}</td>
        <td>${c.redeemed_at ? `${esc(c.redeemed_name || c.redeemed_contact || 'Compte supprimé')}<br><small class="muted">${when(c.redeemed_at)}</small>` : '<span class="pill info">disponible</span>'}</td>
        <td class="num">${c.redeemed_at ? '' : `<button class="btn sm ghost" data-act="codeDel" data-code="${esc(c.code)}" ${ui.busy ? 'disabled' : ''}>Supprimer</button>`}</td></tr>`).join('')
        || '<tr><td colspan="6" class="muted">Aucun code pour l’instant.</td></tr>'}</tbody></table></div></section>
  </div>`;
}

function render() {
  const root = $('#root');
  if (!state.session) { root.innerHTML = vLogin(); return; }
  if (!state.allowed) { root.innerHTML = vDenied(); return; }
  const body = state.data ? vCodes() : ui.err ? '' : '<p class="boot">Chargement…</p>';
  root.innerHTML = `<div class="app"><aside class="side">${brand}
      <div class="side-cta"><span class="who">${esc(contact(state.session.user))}</span><button class="btn sm" data-act="logout">Se déconnecter</button></div></aside>
    <main id="main">${ui.err ? `<div class="err" role="alert">${esc(ui.err)}</div>` : ''}${body}</main></div>`;
}

/* ---------- Actions ---------- */
const acts = {
  reload: () => { state.data = null; render(); load(); },
  copyCodes: () => navigator.clipboard.writeText(ui.fresh.join('\n')).then(() => toast('Codes copiés')).catch(() => toast('Sélectionnez les codes pour les copier')),
  codeDel: async el => {
    if (ui.busy) return;
    ui.busy = true; render();
    try {
      await rpc('admin_delete_code', {p_code: el.dataset.code});
      state.data.codes = state.data.codes.filter(c => c.code !== el.dataset.code);
      toast('Code supprimé');
    } catch (e) { ui.err = humanError(e); }
    ui.busy = false; render();
  },
  logout: async () => { await sb.auth.signOut({scope: 'local'}).catch(() => {}); onSession(null); }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && acts[el.dataset.act]) { e.preventDefault(); acts[el.dataset.act](el); }
});
document.addEventListener('submit', async e => {
  e.preventDefault();
  if (e.target.id === 'codeform' && !ui.busy) {
    const p = {p_count: +$('#c-count').value || 1, p_months: +$('#c-months').value, p_note: $('#c-note').value};
    ui.busy = true; ui.err = ''; render();
    try {
      ui.fresh = await rpc('admin_create_codes', p);
      state.data.codes = await rpc('admin_codes');
      toast(ui.fresh.length > 1 ? `${ui.fresh.length} codes générés` : 'Code généré');
    } catch (err) { ui.err = humanError(err); }
    ui.busy = false; render(); return;
  }
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

// Espace sensible : déconnexion après 15 minutes sans utilisation
const IDLE_MS = 15 * 60e3, IDLE_KEY = 'facturesn-admin-last-active';
const stamp = () => { try { localStorage.setItem(IDLE_KEY, String(Date.now())); } catch {} };
async function checkIdle() {
  let last = 0; try { last = +localStorage.getItem(IDLE_KEY) || 0; } catch {}
  if (state.session && last && Date.now() - last > IDLE_MS) { await acts.logout(); ui.err = 'Déconnecté après une longue absence. Reconnectez-vous.'; render(); return; }
  stamp();
}
['click', 'keydown'].forEach(t => document.addEventListener(t, stamp, {passive: true}));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkIdle(); });
// Page restée ouverte sans y toucher : vérification chaque minute (sans compter comme une activité)
setInterval(() => {
  let last = 0; try { last = +localStorage.getItem(IDLE_KEY) || 0; } catch {}
  if (state.session && last && Date.now() - last > IDLE_MS) checkIdle();
}, 60e3);
