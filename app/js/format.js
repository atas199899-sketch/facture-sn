// Mise en forme : échappement HTML, montants, dates, montant en lettres.
// Les montants arrivent en entiers : francs CFA, ou centimes pour les documents en euros.

export const EUR_XOF = 655.957; // parité fixe franc CFA / euro
export const TVA = 0.18;

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf = new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 0});
const nf2 = new Intl.NumberFormat('fr-FR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
export const num = n => nf.format(Math.round(n || 0));
export const money = n => num(n) + ' FCFA';
export const parseNum = v => parseFloat(String(v).replace(/[\s  ]/g, '').replace(',', '.')) || 0;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export const isEur = cur => cur === 'EUR';
// Montant entier stocké -> texte, dans la devise du document
export const amt = (cur, minor) => isEur(cur) ? nf2.format((minor || 0) / 100) + ' €' : money(minor);
export const amtShort = (cur, minor) => isEur(cur) ? nf2.format((minor || 0) / 100) + ' €' : num(minor);
// Saisie (euros avec décimales, ou francs) <-> entier stocké
export const toMinor = (cur, major) => Math.round(isEur(cur) ? major * 100 : major);
export const toMajor = (cur, minor) => isEur(cur) ? minor / 100 : minor;
export const toXOF = (cur, minor) => isEur(cur) ? Math.round(minor / 100 * EUR_XOF) : minor;
export const decimal = n => String(n).replace('.', ',');

export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const fmtDate = iso => iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('fr-FR', {day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'}) : '—';

// Même calcul que la base (document_totals) : sert à l'aperçu pendant la saisie
export function totals(doc, lines) {
  const subtotal = lines.reduce((a, l) => a + Math.round((+l.qty || 0) * (+l.unit_price || 0)), 0);
  const discount = Math.round(subtotal * (+doc.discount_pct || 0) / 100), ht = subtotal - discount;
  const tva = doc.tva ? Math.round(ht * TVA) : 0, ttc = ht + tva;
  return {subtotal, discount, ht, tva, ttc, deposit: Math.round(ttc * (+doc.deposit_pct || 0) / 100)};
}

/* ---------- Montant en lettres (« Arrêtée la présente facture à la somme de… ») ---------- */
const U = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const D = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];
function under100(n, final) {
  if (n < 20) return U[n];
  const t = Math.floor(n / 10), u = n % 10;
  if (t === 7) return n === 71 ? 'soixante et onze' : 'soixante-' + U[n - 60];
  if (t === 9) return 'quatre-vingt-' + U[n - 80];
  if (t === 8) return u === 0 ? (final ? 'quatre-vingts' : 'quatre-vingt') : 'quatre-vingt-' + U[u];
  if (u === 0) return D[t];
  return D[t] + (u === 1 ? ' et un' : '-' + U[u]);
}
function under1000(n, final) {
  const h = Math.floor(n / 100), r = n % 100;
  let s = '';
  if (h) s = h === 1 ? 'cent' : U[h] + ' cent' + (r === 0 && final ? 's' : '');
  if (r) s += (s ? ' ' : '') + under100(r, final);
  return s;
}
function enLettres(n) {
  if (n === 0) return 'zéro';
  const mrd = Math.floor(n / 1e9), mio = Math.floor(n / 1e6) % 1000, k = Math.floor(n / 1000) % 1000, r = n % 1000, p = [];
  if (mrd) p.push(under1000(mrd, true) + ' milliard' + (mrd > 1 ? 's' : ''));
  if (mio) p.push(under1000(mio, true) + ' million' + (mio > 1 ? 's' : ''));
  if (k) p.push(k === 1 ? 'mille' : under1000(k, false) + ' mille');
  if (r) p.push(under1000(r, true));
  return p.join(' ');
}
export function sommeEnLettres(cur, minor) {
  const ent = isEur(cur) ? Math.floor(minor / 100) : minor, cts = isEur(cur) ? minor % 100 : 0;
  const round = ent >= 1e6 && ent % 1e6 === 0; // « un million de francs », « deux millions d’euros »
  let s = enLettres(ent);
  if (isEur(cur)) {
    s += round ? ' d’euros' : ent > 1 ? ' euros' : ' euro';
    if (cts) s += ' et ' + enLettres(cts) + (cts > 1 ? ' centimes' : ' centime');
  } else s += round ? ' de francs CFA' : ent > 1 ? ' francs CFA' : ' franc CFA';
  return cap(s);
}
