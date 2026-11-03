// Accès aux données : tout ce qui parle à Supabase passe par ce fichier.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.50.0/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const PROFILE_FIELDS = ['name', 'job', 'phone_pay', 'email', 'address', 'ninea', 'tva_on', 'goal_xof', 'mentions', 'due_days', 'quote_days', 'reminders_on', 'logo_img', 'signature_img', 'stamp_img', 'brand_color'];
const CLIENT_FIELDS = ['name', 'contact', 'phone', 'email', 'address', 'ninea', 'reminders_off'];
const ITEM_FIELDS = ['name', 'unit', 'price_xof'];

const pick = (obj, keys) => Object.fromEntries(keys.filter(k => k in obj).map(k => [k, obj[k]]));
const ok = ({data, error}) => { if (error) throw error; return data; };

/* ---------- Comptes ---------- */
// Adresse vers laquelle Supabase renvoie après un e-mail (confirmation, mot de passe oublié)
const backUrl = () => location.origin + location.pathname;

export const getSession = async () => ok(await sb.auth.getSession()).session;
export const onAuthChange = cb => sb.auth.onAuthStateChange(cb);
export const signUp = async (email, password) => ok(await sb.auth.signUp({email, password, options: {emailRedirectTo: backUrl()}}));
export const signIn = async (email, password) => ok(await sb.auth.signInWithPassword({email, password}));
// Déconnexion locale : réussit même si la session a déjà expiré côté serveur
export const signOut = async () => { await sb.auth.signOut({scope: 'local'}).catch(() => {}); };
// La session est-elle toujours reconnue par Supabase ? (hors ligne : on la garde)
export async function sessionValid() {
  const {data, error} = await sb.auth.getUser();
  if (!error) return Boolean(data.user);
  return !(error.status === 401 || error.status === 403 || /session missing|session_not_found|user.*not.*found/i.test(error.message));
}
// Suppression définitive du compte et de toutes ses données
export const deleteAccount = async () => ok(await sb.rpc('delete_my_account'));
export const sendReset = async email => ok(await sb.auth.resetPasswordForEmail(email, {redirectTo: backUrl()}));
export const setPassword = async password => ok(await sb.auth.updateUser({password}));
// Connexion par numéro : Supabase crée le code, la passerelle WhatsApp le remet (voir docs/MACRODROID.md)
export const sendPhoneCode = async phone => ok(await sb.auth.signInWithOtp({phone}));
export const verifyPhoneCode = async (phone, token) => ok(await sb.auth.verifyOtp({phone, token, type: 'sms'}));

/* ---------- Profil ---------- */
export async function getProfile(user) {
  const row = ok(await sb.from('profiles').select('*').eq('id', user.id).maybeSingle());
  if (row) return row;
  // Compte créé avant l'installation du schéma : on crée le profil maintenant
  return ok(await sb.from('profiles').insert({id: user.id, email: user.email || ''}).select().single());
}
export const saveProfile = async (id, fields) =>
  ok(await sb.from('profiles').update(pick(fields, PROFILE_FIELDS)).eq('id', id).select().single());

/* ---------- Clients ---------- */
export const listClients = async () => ok(await sb.from('clients').select('*').order('name'));
export const saveClient = async c => {
  const row = pick(c, CLIENT_FIELDS);
  return ok(c.id
    ? await sb.from('clients').update(row).eq('id', c.id).select().single()
    : await sb.from('clients').insert(row).select().single());
};
export const deleteClient = async id => ok(await sb.from('clients').delete().eq('id', id));

/* ---------- Tarifs ---------- */
export const listCatalog = async () => ok(await sb.from('catalog_items').select('*').order('name'));
export const saveItem = async it => {
  const row = pick(it, ITEM_FIELDS);
  return ok(it.id
    ? await sb.from('catalog_items').update(row).eq('id', it.id).select().single()
    : await sb.from('catalog_items').insert(row).select().single());
};
export const deleteItem = async id => ok(await sb.from('catalog_items').delete().eq('id', id));

/* ---------- Devis et factures ---------- */
// Montants en entiers : francs CFA, ou centimes pour les documents en euros.
// Numéro, état et totaux sont calculés par la base (voir supabase/schema.sql).
const DOC_SUMMARY = 'id, type, number, status, currency, client_id, issue_date, due_date, total_ttc, deposit_amount, paid_amount, converted_to, created_at, sent_at, reminder_count, reminded_at, remind_after';
export const listDocuments = async () => ok(await sb.from('documents').select(DOC_SUMMARY).order('created_at', {ascending: false}));
export const getDocument = async id => ok(await sb.from('documents').select('*, lines:document_lines(*), payments(*)').eq('id', id)
  .order('position', {referencedTable: 'document_lines'}).order('paid_at', {referencedTable: 'payments'}).single());
export const summaryOf = async id => ok(await sb.from('documents').select(DOC_SUMMARY).eq('id', id).single());
export const saveDocument = async (doc, lines) => ok(await sb.rpc('save_document', {p_doc: doc, p_lines: lines}));
export const finalizeDocument = async id => ok(await sb.rpc('finalize_document', {p_id: id}));
export const cancelDocument = async id => ok(await sb.rpc('cancel_document', {p_id: id}));
export const convertQuote = async id => ok(await sb.rpc('convert_quote', {p_id: id}));
export const deleteDocument = async id => ok(await sb.from('documents').delete().eq('id', id));

/* ---------- Paiements reçus ---------- */
// La base vérifie la facture et le reste à payer, puis met à jour documents.paid_amount.
const PAYMENT_FIELDS = ['document_id', 'amount', 'method', 'paid_at', 'note'];
export const addPayment = async p => ok(await sb.from('payments').insert(pick(p, PAYMENT_FIELDS)).select().single());
export const deletePayment = async id => ok(await sb.from('payments').delete().eq('id', id));
export const listPayments = async () => ok(await sb.from('payments').select('id, document_id, amount, paid_at'));

/* ---------- Export de toutes les données du compte ---------- */
export async function exportAll() {
  const [profile, clients, catalog, documents] = await Promise.all([
    sb.from('profiles').select('*').maybeSingle().then(ok),
    sb.from('clients').select('*').order('name').then(ok),
    sb.from('catalog_items').select('*').order('name').then(ok),
    sb.from('documents').select('*, lines:document_lines(*), payments(*)').order('created_at').then(ok)
  ]);
  return {exported_at: new Date().toISOString(), profile, clients, catalog, documents};
}

/* ---------- Formule Pro ---------- */
// Renvoie la date de fin du Pro (null : sans limite)
export const redeemProCode = async code => ok(await sb.rpc('redeem_pro_code', {p_code: code}));

/* ---------- Relances ---------- */
export const markReminded = async id => ok(await sb.rpc('mark_reminded', {p_id: id}));
export const snoozeReminder = async (id, until) => ok(await sb.rpc('snooze_reminder', {p_id: id, p_until: until}));

