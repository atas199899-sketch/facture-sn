// Accès aux données : tout ce qui parle à Supabase passe par ce fichier.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.50.0/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const PROFILE_FIELDS = ['name', 'job', 'phone_pay', 'email', 'address', 'ninea', 'tva_on', 'goal_xof', 'mentions'];
const CLIENT_FIELDS = ['name', 'contact', 'phone', 'email', 'address', 'ninea'];
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
export const signOut = async () => ok(await sb.auth.signOut());
export const sendReset = async email => ok(await sb.auth.resetPasswordForEmail(email, {redirectTo: backUrl()}));
export const setPassword = async password => ok(await sb.auth.updateUser({password}));

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
