// Facture SN : écrans et navigation de l'application connectée (étape 1 : compte, profil, clients, tarifs)
import * as db from './db.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf = new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 0});
const num = n => nf.format(Math.round(n || 0));
const money = n => num(n) + ' FCFA';
const parseNum = v => parseFloat(String(v).replace(/[\s  ]/g, '').replace(',', '.')) || 0;

const state = {session: null, profile: null, clients: [], catalog: [], loaded: false, loadErr: ''};
const ui = {view: 'home', authMode: 'login', err: '', info: '', busy: false, clientDraft: null, catDraft: null, confirm: null, recovery: false};

/* ---------- Messages d'erreur lisibles ---------- */
function humanError(e) {
  const m = String(e?.message || e || '');
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou mot de passe incorrect.';
  if (/already registered|already exists/i.test(m)) return 'Un compte existe déjà avec cet e-mail. Connectez-vous.';
  if (/Email not confirmed/i.test(m)) return 'Confirmez d’abord votre adresse avec le lien reçu par e-mail.';
  if (/Password should be at least/i.test(m)) return 'Le mot de passe doit contenir au moins 6 caractères.';
  if (/rate limit|too many/i.test(m)) return 'Trop de tentatives. Patientez quelques minutes avant de réessayer.';
  if (/valid email|invalid email/i.test(m)) return 'Cette adresse e-mail n’est pas valide.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Connexion impossible. Vérifiez votre accès à internet.';
  if (/relation .* does not exist|schema cache/i.test(m)) return 'La base de données n’est pas encore prête : lancez le script supabase/schema.sql dans Supabase.';
  return m || 'Une erreur est survenue.';
}

let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }

/* ---------- Chargement ---------- */
async function loadAll() {
  try {
    const [profile, clients, catalog] = await Promise.all([db.getProfile(state.session.user), db.listClients(), db.listCatalog()]);
    Object.assign(state, {profile, clients, catalog, loaded: true, loadErr: ''});
    if (!profile.name) ui.view = 'onboarding';
  } catch (e) {
    state.loadErr = humanError(e);
  }
  render();
}

/* ---------- Écrans hors connexion ---------- */
const brand = `<div class="brand"><span class="mark" aria-hidden="true">FS</span><div><b>Facture SN</b><small>Pour les freelances</small></div></div>`;
const msgs = () => `${ui.err ? `<div class="err" role="alert">${esc(ui.err)}</div>` : ''}${ui.info ? `<div class="ok" role="status">${esc(ui.info)}</div>` : ''}`;

function vSetup() {
  return `<div class="auth"><div class="auth-card">${brand}<h1>Configuration requise</h1>
    <p class="muted" style="margin:0">L’application n’est pas encore reliée à sa base de données. Renseignez l’adresse et la clé publique du projet Supabase dans <code>app/js/config.js</code>.</p>
    <a class="btn" href="../demo.html">Voir la démo en attendant</a></div></div>`;
}

function vAuth() {
  const m = ui.authMode;
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
    <label class="field">Numéro Wave / Orange Money<input type="tel" id="o-phone" value="${esc(p.phone_pay)}" placeholder="+221 77 000 00 00"></label>
    ${msgs()}
    <button class="btn primary" type="submit" ${ui.busy ? 'disabled' : ''}>Continuer</button></form></div>`;
}

function vHome() {
  const p = state.profile, nc = state.clients.length, nt = state.catalog.length;
  const step = (done, title, sub, act) => `<div class="step ${done ? 'done' : ''}"><span class="dot">${done ? '✓' : '·'}</span>
    <div class="txt"><b>${title}</b><small>${sub}</small></div>${act || ''}</div>`;
  return `<div class="head"><div><h1>Bonjour ${esc(p.name.split(' ')[0])}</h1><p>Votre espace Facture SN est prêt.</p></div></div>
  <div class="stack">
    <div class="kpis">
      <div class="kpi"><span class="lbl">Clients</span><span class="val">${nc}</span><span class="sub">enregistrés</span></div>
      <div class="kpi"><span class="lbl">Tarifs</span><span class="val">${nt}</span><span class="sub">prestations</span></div>
      <div class="kpi"><span class="lbl">Objectif mensuel</span><span class="val">${p.goal_xof ? num(p.goal_xof) + ' <small>FCFA</small>' : '—'}</span><span class="sub">à fixer dans votre profil</span></div>
      <div class="kpi"><span class="lbl">Offre</span><span class="val">${p.plan === 'pro' ? 'Pro' : 'Gratuite'}</span><span class="sub">bêta</span></div>
    </div>
    <section class="card"><h2>Pour bien démarrer</h2><div class="steps">
      ${step(true, 'Créer votre compte', 'C’est fait.')}
      ${step(Boolean(p.phone_pay && p.job), 'Compléter votre profil', 'Métier, numéro Wave ou Orange Money, NINEA si vous en avez un.', `<button class="btn sm" data-act="go" data-view="profile">Mon profil</button>`)}
      ${step(nc > 0, 'Ajouter votre premier client', nc ? `${nc} client${nc > 1 ? 's' : ''} enregistré${nc > 1 ? 's' : ''}.` : 'Nom, contact et numéro WhatsApp.', `<button class="btn sm" data-act="clientNew">+ Client</button>`)}
      ${step(nt > 0, 'Ajouter vos tarifs habituels', nt ? `${nt} prestation${nt > 1 ? 's' : ''} enregistrée${nt > 1 ? 's' : ''}.` : 'Leur prix se remplira tout seul dans vos factures.', `<button class="btn sm" data-act="catNew">+ Tarif</button>`)}
      ${step(false, 'Créer votre premier devis', 'Les devis et factures arrivent dans la prochaine version.')}
    </div></section>
    <p class="note">Bêta : vos données sont enregistrées en ligne de façon sécurisée. Pour voir à quoi ressembleront les factures, ouvrez la <a href="../demo.html">démo</a>.</p>
  </div>`;
}

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
  return `<div class="head"><div><button class="btn ghost sm" data-act="go" data-view="clients">← Clients</button><h1 style="margin-top:8px">${c.id ? 'Modifier le client' : 'Nouveau client'}</h1></div></div>
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
      <p class="muted" style="margin:0">Connecté avec ${esc(state.session.user.email)}.</p>
      <div class="row"><button class="btn" data-act="logout">Se déconnecter</button></div>
    </section>
  </div>`;
}

const views = {home: vHome, clients: vClients, client: vClient, catalog: vCatalog, profile: vProfile};
const NAV = [['home', 'Accueil'], ['clients', 'Clients'], ['catalog', 'Mes tarifs'], ['profile', 'Mon profil']];
const navOf = {home: 'home', clients: 'clients', client: 'clients', catalog: 'catalog', profile: 'profile'};

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
      <div class="side-cta"><span class="who">${esc(state.session.user.email)}</span></div></aside>
    <main id="main">${views[ui.view]()}</main></div>`;
  if (scroll) window.scrollTo(0, 0);
}

function go(view, extra = {}) { Object.assign(ui, {view, err: '', info: '', confirm: null, catDraft: null}, extra); render(true); }

// Exécute une action réseau en affichant l'état « en cours » et les erreurs
async function run(fn) {
  if (ui.busy) return;
  ui.busy = true; ui.err = ''; ui.info = ''; render();
  try { await fn(); } catch (e) { ui.err = humanError(e); }
  ui.busy = false; render();
}

/* ---------- Actions ---------- */
const acts = {
  go: el => go(el.dataset.view),
  authMode: el => { ui.authMode = el.dataset.mode; ui.err = ''; ui.info = ''; render(); },
  retry: () => { state.loadErr = ''; render(); loadAll(); },
  logout: () => run(async () => { await db.signOut(); }),
  clientNew: () => { ui.clientDraft = {id: null, name: '', contact: '', phone: '', email: '', address: '', ninea: ''}; go('client'); },
  clientEdit: el => { ui.clientDraft = {...state.clients.find(c => c.id === el.dataset.id)}; go('client'); },
  clientAskDel: () => { ui.confirm = 'cdel'; render(); },
  cancelConfirm: () => { ui.confirm = null; render(); },
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
  if (id === 'clientform') {
    const c = ui.clientDraft;
    ['name', 'contact', 'phone', 'email', 'address', 'ninea'].forEach(k => c[k] = val('k-' + k));
    if (!c.name) { ui.err = 'Le nom du client est obligatoire.'; return render(); }
    run(async () => {
      const row = await db.saveClient(c);
      state.clients = upsert(state.clients, row).sort(byName);
      ui.view = 'clients'; toast('Client enregistré');
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
    if (!now) { Object.assign(state, {profile: null, clients: [], catalog: [], loaded: false, loadErr: ''}); ui.view = 'home'; render(); }
    else if (now !== had) { state.loaded = false; render(); loadAll(); }
  });
  try { state.session = await db.getSession(); } catch (e) { ui.err = humanError(e); }
  if (state.session && !state.loaded) loadAll(); else render();
}
boot();
