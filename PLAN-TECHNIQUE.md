# Facture SN : plan technique

Ce document décrit comment passer du prototype (`demo.html`) à un vrai produit en ligne pour les freelances au Sénégal.

Deux contraintes guident tous les choix :

- **0 FCFA d'hébergement** tant qu'il n'y a pas de clients payants ;
- **rien à installer** sur l'ordinateur du fondateur : tout se gère depuis le navigateur.

## 1. Objectif de la version 1

Un freelance doit pouvoir, depuis son téléphone :

1. créer son compte et son profil ;
2. créer un devis, le transformer en facture, avec acompte éventuel ;
3. envoyer la facture sur WhatsApp avec un PDF et un lien de paiement Wave / Orange Money ;
4. voir la facture passer automatiquement à « payée » quand l'argent arrive ;
5. laisser partir les relances en cas de retard.

Tout le reste (dépenses, objectif de revenus, TVA, export) est déjà maquetté dans le prototype et vient en version 1.1.

## 2. Architecture

```
 Téléphone / ordinateur du freelance
            │
            ▼
 ┌──────────────────────────────┐      ┌──────────────────────────────┐
 │ Application web installable  │◄────►│ Supabase                     │
 │ (PWA) : HTML + JavaScript,    │      │ - PostgreSQL (données)       │
 │ sans étape de compilation     │      │ - Auth (e-mail, Google)      │
 │                              │      │ - Storage (PDF, reçus)       │
 │ Hébergée sur Cloudflare Pages │      │ - Edge Functions (serveur)   │
 │ (facture-sn.pages.dev)        │      │ - Cron (tâches planifiées)   │
 └──────────────────────────────┘      └──────────────┬───────────────┘
                                                      │
                          ┌───────────────────────────┼─────────────────┐
                          ▼                           ▼                 ▼
                 Agrégateur de paiement      WhatsApp Cloud API    E-mails
                 (PayDunya ou CinetPay)      (Meta, plus tard)     (Brevo)
```

- **L'application** est une PWA : un site qui s'installe sur l'écran d'accueil du téléphone et s'ouvre en plein écran comme une application. Un seul code pour Android, iPhone et ordinateur.
- **Pas d'outil de compilation** : des fichiers HTML, CSS et JavaScript (modules ES) servis tels quels. La bibliothèque Supabase est chargée depuis un CDN.
- **Supabase** fournit la base de données, la connexion, le stockage de fichiers et les fonctions serveur. Région : Europe (Paris ou Francfort). Tout se configure depuis son site web, y compris l'éditeur SQL et l'éditeur de fonctions.
- **Hébergement** : **Cloudflare Pages**, branché sur le dépôt GitHub : chaque envoi sur `main` est mis en ligne automatiquement sur https://facture-sn.pages.dev. L'usage commercial y est autorisé et l'offre gratuite suffit. Un nom de domaine (ex. `facturesn.com`) pourra y être relié plus tard. GitHub Pages reste actif comme copie, mais n'est pas l'adresse à partager.

## 3. Choix techniques

| Besoin | Choix | Pourquoi |
|---|---|---|
| Interface | HTML + JavaScript (modules ES), sans framework | Rien à installer, rien à compiler, rapide sur les petits téléphones |
| Style | CSS du prototype | Déjà conçu, thèmes clair et sombre |
| Base de données | PostgreSQL (Supabase) | Fiable, transactions pour la numérotation des factures |
| Connexion | Supabase Auth : e-mail + mot de passe, puis Google | Gratuit, contrairement au SMS |
| Sécurité des données | Row Level Security (RLS) PostgreSQL | Chaque freelance ne voit que ses propres données |
| Installation sur téléphone | Manifeste + service worker (PWA) | Icône sur l'écran d'accueil, sans passer par un store |
| PDF | Étape 2 : impression du navigateur (« Enregistrer en PDF »). Plus tard : génération dans une Edge Function | Gratuit et sans installation ; PDF stocké côté serveur quand l'envoi sera automatisé |
| Paiement | PayDunya ou CinetPay (Wave, Orange Money, Free Money, carte) | Agrégateurs agréés, pas d'abonnement, commission par paiement |
| WhatsApp | Bouton « Ouvrir WhatsApp » au lancement, WhatsApp Cloud API ensuite | Gratuit au départ, automatisation quand l'offre Pro rapporte |
| E-mails | Brevo (SMTP branché sur Supabase Auth) | Offre gratuite d'environ 300 e-mails par jour |
| Tâches planifiées | Supabase Cron + Edge Functions | Relances quotidiennes, rappels d'échéance |

## 4. Organisation du dépôt

```
index.html            Landing page
demo.html             Prototype avec données d'exemple (référence visuelle)
app/                  La vraie application
  index.html
  css/app.css
  js/config.js        Adresse et clé publique du projet Supabase
  js/db.js            Accès aux données (Supabase)
  js/app.js           Écrans et navigation
  manifest.webmanifest, sw.js, icons/   Installation sur téléphone
supabase/
  schema.sql          Tables, sécurité (RLS), déclencheurs
```

## 5. Modèle de données

Les tables de l'étape 1 sont dans `supabase/schema.sql`. Les autres arrivent aux étapes suivantes.

```
profiles         id (= auth.users.id), name, job, phone_pay, email, address, ninea,
                 tva_on, goal_xof, mentions, plan (free|pro)              [étape 1]
clients          id, user_id, name, contact, phone, email, address, ninea [étape 1]
catalog_items    id, user_id, name, unit, price_xof                       [étape 1]
documents        id, user_id, client_id, type (DEV|FAC), number, currency (XOF|EUR),
                 issue_date, due_date, discount_pct, deposit_pct, tva,
                 notes, status, sent_at, pdf_url, converted_to            [étape 2]
document_lines   id, document_id, position, description, qty, unit_price  [étape 2]
number_counters  user_id, type, year, last_value                          [étape 2]
payments         id, document_id, amount, method, paid_at,
                 provider, provider_ref                                   [étape 3]
payment_links    id, document_id, amount, provider, provider_token, url   [étape 3]
documents        + reminder_count, reminded_at, remind_after              [étape 4]
clients          + reminders_off                                          [étape 4]
expenses         id, user_id, date, label, supplier, category, amount_xof,
                 method, tva_recoverable, receipt_url                     [v1.1]
```

Règles importantes :

- **Montants** : stockés en entiers (FCFA) ou en centimes (euros), jamais en nombres à virgule.
- **Numérotation** : `FAC-2026-0001`, attribuée côté base dans une transaction sur `number_counters`, pour ne jamais créer de doublon ni de trou.
- **Facture envoyée = facture figée** : après envoi, on ne modifie plus une facture. Une erreur se corrige avec un avoir.
- **Totaux** : recalculés côté base à partir des lignes. Le navigateur ne fait qu'afficher.
- **Offre (free / pro)** : modifiable uniquement côté serveur, jamais par l'utilisateur.

## 6. Les parcours clés

### Paiement d'une facture

1. Le freelance clique sur « Envoyer ». Une Edge Function fige la facture, génère le PDF et crée un lien de paiement chez l'agrégateur, pour l'acompte ou pour le solde.
2. Le client ouvre le lien et paie par Wave ou Orange Money.
3. L'agrégateur appelle notre **webhook** (une Edge Function). Elle vérifie la signature, puis confirme le paiement auprès de l'agrégateur.
4. Le paiement est enregistré, le statut de la facture change, et le freelance est prévenu.

Le webhook doit être **idempotent** : si l'agrégateur l'appelle deux fois, le paiement n'est enregistré qu'une fois (contrainte unique sur `provider_ref`).

### Relances

- **Au lancement** : l'application liste les factures en retard et prépare le message ; le freelance l'envoie depuis son propre WhatsApp en un clic.
- **Plus tard** : une tâche planifiée chaque matin à 9 h (heure de Dakar, UTC+0) envoie un **message modèle WhatsApp** validé par Meta, avec le lien de paiement.

## 7. Sécurité et conformité

- **Isolation** : RLS activée sur toutes les tables. Chaque ligne porte l'identifiant de son propriétaire et seul lui peut la lire ou la modifier.
- **Clé publique** : la clé « anon » ou « publishable » de Supabase est faite pour être dans le navigateur. Elle ne donne accès qu'à ce que les règles RLS autorisent. La clé « service_role » ne doit **jamais** apparaître dans le code de l'application.
- **Chiffrement** : HTTPS partout, base chiffrée au repos par Supabase.
- **Sauvegardes** : l'offre gratuite de Supabase n'inclut pas de sauvegarde automatique. Pendant la bêta, export manuel chaque semaine depuis le tableau de bord ; au lancement payant, passage à l'offre Pro (sauvegardes quotidiennes).
- **Données personnelles** : déclaration du traitement à la **CDP** (Commission de Protection des Données Personnelles) avant le lancement. Les données étant hébergées en Europe, vérifier avec la CDP les formalités de transfert à l'étranger.
- **Export et suppression** : chaque utilisateur peut exporter ses données et supprimer son compte.
- **Paiements** : on ne détient jamais l'argent des clients. Il passe par l'agrégateur agréé, qui reverse au freelance.

## 8. Feuille de route

| Étape | Contenu | État |
|---|---|---|
| 0. Préparation | Projet Supabase, dépôt GitHub, landing page, prototype, Cloudflare Pages | ✅ fait |
| 1. Socle | Connexion, profil, clients, tarifs, installation sur téléphone | ✅ fait |
| 2. Documents | Devis, factures, acomptes, remises, euros, numérotation, aperçu, PDF par impression, envoi WhatsApp | ✅ fait |
| 3. Encaissement | Saisie des paiements ✅ fait ; liens de paiement et webhook à faire | en cours |
| 4. Relances et PDF | Relances préparées (calendrier, message WhatsApp prêt, report, désactivation par client) ✅ fait ; relances automatiques par e-mail à faire | en cours |
| 5. Bêta fermée | 20 à 30 freelances de la liste d'attente, corrections | à faire |
| 6. Lancement | Offre Pro, nom de domaine, connexion par téléphone (SMS ou WhatsApp), v1.1 | à faire |

## 9. Budget

| Poste | Bêta | Lancement payant |
|---|---|---|
| Hébergement de l'application | 0 (Cloudflare Pages) | 0 (Cloudflare Pages) + nom de domaine ≈ 7 000 à 15 000 F/an |
| Supabase | 0 (offre gratuite) | 0, puis environ 25 $/mois au-delà des limites ou pour les sauvegardes |
| E-mails | 0 (Brevo gratuit) | 0 |
| Connexion | 0 (e-mail, Google) | 0 |
| WhatsApp | 0 (bouton manuel) | selon le volume, si on automatise |
| Nom de domaine | 0 (sous-domaine gratuit) | environ 10 000 à 25 000 FCFA par an |
| Paiements | — | commission de l'agrégateur sur chaque paiement reçu |

Limites de l'offre gratuite Supabase à surveiller : 500 Mo de base de données, 1 Go de fichiers, mise en pause du projet après une semaine sans activité. Les tarifs sont à vérifier auprès de chaque fournisseur avant de fixer le prix de l'offre Pro.

## 10. Risques et parades

| Risque | Parade |
|---|---|
| Projet Supabase mis en pause pendant la bêta | Le relancer depuis le tableau de bord ; passer en Pro au lancement |
| Limite d'e-mails de Supabase (quelques e-mails par heure sans SMTP) | Brancher Brevo comme serveur d'e-mails avant d'inviter les bêta-testeurs |
| Validation des modèles WhatsApp par Meta plus longue que prévu | Garder le bouton « Ouvrir WhatsApp » manuel |
| Commissions de paiement trop élevées pour les petits montants | Laisser le freelance choisir qui paie les frais, ou la saisie manuelle |
| Connexion internet instable | Service worker : l'application s'ouvre même avec un réseau faible |
| Erreur de numérotation ou de montant | Calculs et numérotation côté base, tests à chaque étape |
| Obligations fiscales mal comprises | Faire valider documents et TVA par un expert-comptable avant le lancement |

## 11. Du prototype au produit

Le prototype `demo.html` sert de **référence visuelle et fonctionnelle** : écrans, textes, calculs (montant en lettres, acomptes, conversion euro au taux fixe de 655,957 FCFA). L'application `app/` reprend son style et ses fonctions de calcul, mais enregistre les données dans Supabase au lieu du navigateur.
