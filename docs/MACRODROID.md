# Passerelle WhatsApp : connexion par numéro avec MacroDroid

Les freelances peuvent se connecter avec leur numéro, sans mot de passe et sans SMS payant :

1. Dans l'application, le freelance tape son numéro et appuie sur « Recevoir mon code ». Supabase crée un code et le range dans la base.
2. L'application ouvre WhatsApp avec un message prêt pour le numéro de Faybi SN : « Bonjour Faybi SN, je demande mon code de connexion. »
3. Le téléphone passerelle reçoit le message. MacroDroid envoie le numéro de l'expéditeur à Supabase, qui renvoie le texte à répondre.
4. MacroDroid répond dans la conversation : « Votre code Faybi SN : 482913 ». Le freelance tape le code et il est connecté.

Côté Supabase, tout est déjà en place : hook « Send SMS », fournisseur « Phone » activé, code valable 10 minutes, fonction `claim_otp` (voir `supabase/schema.sql`).

## Ce qu'il faut

- Un téléphone Android qui reste **allumé, branché et connecté** (Wi-Fi de préférence). Un ancien téléphone suffit.
- Une **puce dédiée**, utilisée uniquement pour Faybi SN.
- **WhatsApp Business** (gratuit), installé avec cette puce. Nom du profil : « Faybi SN ».
- **MacroDroid** (gratuit, Play Store). Une seule macro suffit.

## 1. Préparer le téléphone

1. Installez WhatsApp Business avec la puce dédiée.
2. **N'enregistrez aucun freelance dans les contacts** de ce téléphone. MacroDroid lit le numéro dans la notification : pour un contact enregistré, WhatsApp affiche un nom et la connexion est refusée, ce qui est voulu par sécurité.
3. Paramètres Android > Applications > MacroDroid et WhatsApp Business : **désactivez l'optimisation de la batterie** et autorisez le démarrage automatique.
4. Laissez les notifications de WhatsApp Business activées, avec l'aperçu du message.

## 2. Récupérer la clé secrète

Dans Supabase > **SQL Editor** > **New query**, lancez :

```sql
select secret from public.gateway_secrets;
```

Copiez la valeur. **Elle ne doit être mise que dans MacroDroid** : ni dans le code, ni dans un message. Pour en changer (téléphone perdu, par exemple) :

```sql
update public.gateway_secrets set secret = encode(gen_random_bytes(24), 'hex');
```

## 3. Créer la macro dans MacroDroid

Ouvrez MacroDroid > **Ajouter une macro**, nommez-la « Codes Faybi SN ».

### Déclencheur

**Événements de l'appareil > Notification reçue** (Notification Received) :

- Application : **WhatsApp Business**
- Texte : **contient** `je demande mon code`
- Acceptez la demande d'**accès aux notifications** si MacroDroid la propose.

### Action 1 : appeler Supabase

**Connectivité > Requête HTTP** (HTTP Request) :

- Méthode : **POST**
- URL : `https://ltbedqounvmpqlgwodmm.supabase.co/rest/v1/rpc/claim_otp`
- En-têtes :
  - `apikey` : `sb_publishable_pd1kEQE6eQMEvz1gb2UwPw_C2Y1ITrl` (clé publique, sans danger)
  - `Content-Type` : `application/json`
  - `Accept` : `text/plain`
- Corps (Body), type JSON :

  ```json
  {"p_secret": "COLLEZ_ICI_LA_CLÉ_SECRÈTE", "p_phone": "[not_title]"}
  ```

  `[not_title]` est le texte magique « titre de la notification » : insérez-le avec le bouton « … » de MacroDroid plutôt que de le taper.
- Réponse : **enregistrer dans une variable locale** de type texte, nommée `reponse`.

  Tapez `[not_title]` à la main. Selon la version, le bouton « … » insère `[notification]{not_title}`, qui envoie le texte du message collé au titre : la connexion est alors refusée.

### Action 2 : ne répondre que si Supabase a renvoyé un texte

**Conditions/Boucles > Si (If)** : Variables locales › `reponse` › **Contient** › `Faybi SN`.

Supabase renvoie un texte vide pour nos propres réponses (notifications « Vous ») et pour une deuxième demande du même numéro dans la minute : sans cette condition, MacroDroid enverrait un message vide ou répondrait en boucle.

### Action 3 : répondre sur WhatsApp

**Notification > Répondre à la notification** (Notification Reply), placée entre « Si » et « Fin du Si » :

- Texte : la variable `reponse` (texte magique `[lv=reponse]`).

Enregistrez la macro et vérifiez qu'elle est **activée**.

## 4. Mettre le numéro dans l'application

Envoyez le numéro de la puce dédiée à Claude, qui le renseigne dans `app/js/config.js` (`WHATSAPP_GATEWAY`, format `2217XXXXXXXX`). Le bouton « Continuer avec mon numéro (WhatsApp) » apparaît alors sur l'écran de connexion.

## 5. Tester

1. Depuis **votre téléphone personnel**, ouvrez https://faybi-sn.pages.dev/app/ et choisissez « Continuer avec mon numéro ».
2. Tapez votre numéro, puis appuyez sur « Demander mon code sur WhatsApp » et envoyez le message.
3. Vous devez recevoir le code en quelques secondes. Tapez-le : vous êtes connecté.

## Réponses possibles et dépannage

| Réponse reçue sur WhatsApp | Cause | Solution |
|---|---|---|
| « Votre code Faybi SN : … » | Tout fonctionne | — |
| « Pour recevoir un code, saisissez d'abord votre numéro… » | Pas de code demandé pour ce numéro depuis 10 minutes, ou numéro différent | Redemander le code dans l'application, puis écrire depuis le même numéro |
| « Nous n'avons pas pu lire votre numéro… » | Le titre de la notification est un nom (contact enregistré) | Supprimer ce contact du téléphone passerelle |
| Aucune réponse | Macro désactivée, téléphone hors ligne, ou batterie qui coupe MacroDroid | Vérifier la connexion, l'optimisation de batterie et le journal de MacroDroid |
| Réponse « Clé de la passerelle invalide » dans le journal | Clé mal copiée | Recopier la clé (étape 2) |

## Limites à connaître

- Si le téléphone passerelle est éteint, la connexion par numéro ne marche plus. La connexion par e-mail reste toujours disponible.
- WhatsApp peut limiter les comptes qui répondent automatiquement en grand nombre. Pour quelques dizaines de codes par jour, le risque est faible. N'utilisez jamais votre numéro personnel.
- Au-delà de quelques centaines de connexions par jour, prévoir l'API officielle WhatsApp Cloud ou un fournisseur de SMS.
