# Facture SN : plan technique

Ce document décrit comment passer du prototype (`app.html`) à un vrai produit en ligne pour les freelances au Sénégal.

## 1. Objectif de la version 1

Un freelance doit pouvoir, depuis son téléphone :

1. créer son compte et son profil ;
2. créer un devis, le transformer en facture, avec acompte éventuel ;
3. envoyer la facture sur WhatsApp avec un PDF et un lien de paiement Wave / Orange Money ;
4. voir la facture passer automatiquement à « payée » quand l'argent arrive ;
5. laisser partir les relances automatiques en cas de retard.

Tout le reste (dépenses, objectif de revenus, TVA, export) est déjà maquetté dans le prototype et vient en version 1.1.

## 2. Architecture

```
 Téléphone / ordinateur du freelance
            │
            ▼
 ┌─────────────────────────┐      ┌──────────────────────────────┐
 │ Application web (PWA)   │◄────►│ Supabase                     │
 │ Next.js, hébergée sur   │      │ - PostgreSQL (données)       │
 │ Vercel                  │      │ - Auth (connexion par SMS     │
 └──────────┬──────────────┘      │   ou e-mail)                 │
            │                     │ - Storage (PDF, reçus)       │
            ▼                     │ - Edge Functions (tâches)    │
 ┌─────────────────────────┐      └──────────────┬───────────────┘
 │ API serveur (routes      │                     │
 │ Next.js)                 │──── webhooks ◄──────┤
 └──┬───────────┬───────────┘                     │
    │           │                                 │
    ▼           ▼                                 ▼
 Agrégateur   WhatsApp Cloud API            Tâches planifiées
 de paiement  (Meta)                        (relances, rappels)
 (PayDunya ou
 CinetPay)
```

- **Une seule application web**, installable sur l'écran d'accueil (PWA). Pas d'application Android ou iOS au départ.
- **Supabase** fournit la base de données, la connexion, le stockage de fichiers et les fonctions planifiées. Région : Europe (Francfort ou Paris).
- **Vercel** héberge l'application et les routes d'API.

## 3. Choix techniques

| Besoin | Choix | Pourquoi |
|---|---|---|
| Interface | Next.js + React + TypeScript | Standard, beaucoup de développeurs au Sénégal le connaissent |
| Style | Tailwind CSS | Rapide à écrire, reprend les couleurs du prototype |
| Base de données | PostgreSQL (Supabase) | Fiable, transactions pour la numérotation des factures |
| Connexion | Supabase Auth : code par SMS ou lien par e-mail | Les freelances ont tous un téléphone |
| Sécurité des données | Row Level Security (RLS) PostgreSQL | Chaque freelance ne voit que ses propres données |
| PDF | Génération côté serveur (`@react-pdf/renderer`) | Même rendu partout, PDF stocké et non modifiable |
| Paiement | PayDunya ou CinetPay (Wave, Orange Money, Free Money, carte) | Agrégateurs agréés, une seule intégration pour tous les moyens |
| WhatsApp | WhatsApp Cloud API (Meta) | Envoi de documents et de messages modèles validés |
| E-mails | Resend ou Brevo | Envoi des factures aux clients étrangers |
| Tâches planifiées | Supabase Cron + Edge Functions | Relances quotidiennes, rappels d'échéance |
| Suivi des erreurs | Sentry | Voir les bugs avant les utilisateurs |

## 4. Modèle de données

```
users            id, phone, email, created_at
profiles         user_id, name, job, address, phone_pay, email, ninea,
                 tva_on, goal_xof, mentions, logo_url, plan (free|pro)
clients          id, user_id, name, contact, phone, email, address, ninea
catalog_items    id, user_id, name, unit, price_xof
documents        id, user_id, client_id, type (DEV|FAC), number, currency (XOF|EUR),
                 issue_date, due_date, discount_pct, deposit_pct, tva,
                 notes, status, sent_at, pdf_url, converted_to (document_id)
document_lines   id, document_id, position, description, qty, unit_price
payments         id, document_id, amount, method, paid_at,
                 provider, provider_ref (null si saisi à la main)
payment_links    id, document_id, amount, provider, provider_token, url, status
expenses         id, user_id, date, label, supplier, category, amount_xof,
                 method, tva_recoverable, receipt_url
reminders        id, document_id, scheduled_for, sent_at, channel, status
number_counters  user_id, type, year, last_value
```

Règles importantes :

- **Montants** : stockés en entiers (FCFA) ou en centimes (euros), jamais en nombres à virgule.
- **Numérotation** : `FAC-2026-0001`, attribuée dans une transaction sur `number_counters` pour ne jamais créer de doublon ni de trou.
- **Facture envoyée = facture figée** : après envoi, on ne modifie plus une facture. Une erreur se corrige avec un avoir, comme l'exige la pratique comptable.
- **Totaux** : recalculés côté serveur à partir des lignes. Le navigateur ne fait qu'afficher.

## 5. Les parcours clés

### Paiement d'une facture

1. Le freelance clique sur « Envoyer ». Le serveur fige la facture, génère le PDF et crée un lien de paiement chez l'agrégateur, pour l'acompte ou pour le solde.
2. Le client ouvre le lien et paie par Wave ou Orange Money.
3. L'agrégateur appelle notre **webhook**. Le serveur vérifie la signature, puis confirme le paiement auprès de l'agrégateur.
4. Le paiement est enregistré, le statut de la facture change, et le freelance reçoit une notification.

Le webhook doit être **idempotent** : si l'agrégateur l'appelle deux fois, le paiement n'est enregistré qu'une fois (contrainte unique sur `provider_ref`).

### Relances automatiques

- Une tâche tourne chaque matin à 9 h (heure de Dakar, UTC+0).
- Elle sélectionne les factures non payées dont l'échéance est passée de 1, 7 ou 15 jours.
- Elle envoie un **message modèle WhatsApp** validé par Meta, avec le lien de paiement.
- Le freelance peut désactiver les relances pour un client.

### Envoi WhatsApp

- Meta impose des **modèles de message** validés à l'avance pour écrire en premier à un client. On en prévoit trois : envoi de facture, envoi de devis, relance.
- Chaque message envoyé est facturé par Meta. Ce coût est intégré au prix de l'offre Pro.
- **Solution de secours** au lancement : le bouton « Ouvrir WhatsApp » du prototype, qui utilise le WhatsApp du freelance (gratuit, mais manuel).

## 6. Sécurité et conformité

- **Isolation** : RLS activée sur toutes les tables, avec des tests automatiques qui vérifient qu'un utilisateur ne lit jamais les données d'un autre.
- **Connexion** : code à usage unique par SMS, sans mot de passe à retenir.
- **Chiffrement** : HTTPS partout, base chiffrée au repos par Supabase.
- **Sauvegardes** : quotidiennes, avec un test de restauration chaque mois.
- **Données personnelles** : déclaration du traitement à la **CDP** (Commission de Protection des Données Personnelles) avant le lancement. Les données étant hébergées en Europe, vérifier avec la CDP les formalités de transfert à l'étranger.
- **Export et suppression** : chaque utilisateur peut exporter toutes ses données et supprimer son compte.
- **Paiements** : on ne détient jamais l'argent des clients. Il passe par l'agrégateur agréé, qui reverse au freelance.

## 7. Feuille de route

| Étape | Durée | Contenu |
|---|---|---|
| 0. Préparation | 2 semaines | Compte agrégateur de paiement, compte WhatsApp Business, déclaration CDP, nom de domaine |
| 1. Socle | 3 semaines | Projet Next.js, Supabase, connexion par SMS, profil, clients, tarifs |
| 2. Documents | 3 semaines | Devis, factures, acomptes, remises, euros, numérotation, PDF |
| 3. Encaissement | 3 semaines | Liens de paiement, webhook, statuts, saisie manuelle des paiements |
| 4. WhatsApp | 2 semaines | Envoi des documents, relances automatiques |
| 5. Bêta fermée | 3 semaines | 20 à 30 freelances de la liste d'attente, corrections |
| 6. Lancement | — | Offre Pro payante, version 1.1 (dépenses, objectif, TVA, export) |

Total : environ **4 mois** avec un développeur à plein temps, ou **2 à 3 mois** avec deux développeurs.

## 8. Budget mensuel d'hébergement

| Poste | Lancement | Environ 500 utilisateurs |
|---|---|---|
| Vercel | 0 | environ 20 $ |
| Supabase | 0 | environ 25 $ |
| E-mails | 0 | 0 à 20 $ |
| SMS de connexion | quelques milliers de FCFA | selon le volume |
| Messages WhatsApp | selon le volume | selon le volume |
| Nom de domaine | environ 10 000 à 25 000 FCFA par an | idem |

Les commissions de l'agrégateur de paiement sont prélevées sur chaque paiement reçu. Les tarifs exacts sont à vérifier auprès de chaque fournisseur avant de fixer le prix de l'offre Pro.

## 9. Risques et parades

| Risque | Parade |
|---|---|
| Validation des modèles WhatsApp par Meta plus longue que prévu | Lancer avec le bouton « Ouvrir WhatsApp » manuel |
| Commissions de paiement trop élevées pour les petits montants | Laisser le freelance choisir qui paie les frais, ou proposer la saisie manuelle |
| Connexion internet instable chez les utilisateurs | PWA avec cache hors ligne pour consulter les factures |
| Erreur de numérotation ou de montant | Calculs et numérotation uniquement côté serveur, tests automatiques |
| Obligations fiscales mal comprises | Faire valider les documents et la TVA par un expert-comptable avant le lancement |

## 10. Passage du prototype au produit

Le prototype `app.html` sert de **référence visuelle et fonctionnelle** : écrans, textes, calculs (montant en lettres, acomptes, conversion euro au taux fixe de 655,957 FCFA). Son code n'est pas réutilisé tel quel. Les fonctions de calcul (`totals`, `enLettres`, `sommeEnLettres`) peuvent être reprises en TypeScript avec des tests unitaires.
