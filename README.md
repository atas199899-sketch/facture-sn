# Facture SN

Outil de facturation pour les freelances au Sénégal : devis et factures en FCFA ou en euros, acomptes, paiements Wave et Orange Money, relances WhatsApp.

- `index.html` : la page de présentation (landing page) avec la liste d'attente.
- `demo.html` : le prototype de démonstration, avec des données d'exemple (`app.html` y redirige).
- `app/` : la vraie application (PWA installable), reliée à Supabase.
- `supabase/schema.sql` : les tables et règles de sécurité à lancer dans Supabase.
- `PLAN-TECHNIQUE.md` : le plan technique.
- `docs/MACRODROID.md` : régler le téléphone passerelle pour la connexion par numéro (code remis par WhatsApp).

## En ligne

- Présentation : https://facture-sn.pages.dev/
- Démo : https://facture-sn.pages.dev/demo
- Application : https://facture-sn.pages.dev/app/

Hébergé sur Cloudflare Pages : chaque envoi sur `main` est publié automatiquement.

## État du projet

- **Démo** : les données restent dans le navigateur de chaque visiteur (`localStorage`).
- **Application** : compte (e-mail, ou numéro avec code WhatsApp), profil, clients, tarifs, devis et factures. Les paiements arrivent à l'étape 3.

## Mettre en route l'application

1. Dans Supabase, ouvrez **SQL Editor**, collez le contenu de `supabase/schema.sql` et lancez-le.
2. Dans **Authentication > URL Configuration**, mettez l'adresse de l'application en *Site URL* et en *Redirect URLs*.
3. Renseignez l'adresse du projet et la clé publique (*anon* ou *publishable*) dans `app/js/config.js`. Jamais la clé *service_role* ou *secret*.

## Lancer en local

```bash
python -m http.server 8000
```

Puis ouvrez http://localhost:8000/ (démo) ou http://localhost:8000/app/ (application).
