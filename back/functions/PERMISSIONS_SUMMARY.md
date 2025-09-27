# Résumé des Permissions - Rôles Admin et Sous-Admin

## 🔐 Permissions du Rôle `admin`

### ✅ Peut faire :
- **Gestion des utilisateurs** : Créer, modifier, supprimer tous les utilisateurs
- **Gestion des sous-admin** : Créer, modifier, supprimer des sous-admin
- **Notifications** : Voir toutes les notifications
- **Affectation de rôles** : Assigner tous les rôles (admin, sous-admin, etudiant, parent, etc.)
- **Gestion des étudiants** : Créer, modifier, supprimer des étudiants
- **Gestion des parents** : Créer, modifier, supprimer des parents
- **Gestion des classes** : Créer, modifier, supprimer des classes
- **Audit logs** : Voir tous les logs d'audit

## 🔐 Permissions du Rôle `sous-admin`

### ✅ Peut faire (mêmes privilèges qu'admin) :
- **Gestion des utilisateurs** : Créer, modifier, supprimer les utilisateurs (sauf admin/sous-admin)
- **Notifications** : Voir toutes les notifications
- **Affectation de rôles** : Assigner les rôles (etudiant, parent, enseignant, personnel, comptable)
- **Gestion des étudiants** : Créer, modifier, supprimer des étudiants
- **Gestion des parents** : Créer, modifier, supprimer des parents
- **Gestion des classes** : Créer, modifier, supprimer des classes
- **Audit logs** : Voir tous les logs d'audit

### ❌ Ne peut PAS faire :
- **Créer des sous-admin** : Seuls les admin peuvent créer des sous-admin
- **Modifier des admin** : Ne peut pas modifier les comptes admin
- **Modifier des sous-admin** : Ne peut pas modifier d'autres comptes sous-admin
- **Supprimer des admin** : Ne peut pas supprimer les comptes admin
- **Supprimer des sous-admin** : Ne peut pas supprimer d'autres comptes sous-admin
- **Assigner le rôle admin** : Ne peut pas créer ou promouvoir vers admin
- **Assigner le rôle sous-admin** : Ne peut pas créer d'autres sous-admin

## 🔐 Permissions du Rôle `comptable`

### ✅ Peut faire :
- **Gestion des utilisateurs** : Voir et modifier les utilisateurs (sauf admin/sous-admin)
- **Notifications** : Voir les notifications
- **Gestion financière** : Gérer les frais, paiements, etc.

## 📋 Endpoints avec Permissions

### Notifications (`/users/pending`)
- **Admin** : ✅ Accès complet
- **Sous-admin** : ✅ Accès complet
- **Comptable** : ✅ Accès complet
- **Autres** : ❌ Accès refusé

### Gestion des utilisateurs (`/users/*`)
- **Admin** : ✅ Accès complet
- **Sous-admin** : ✅ Accès complet (sauf gestion admin/sous-admin)
- **Comptable** : ✅ Accès limité
- **Autres** : ❌ Accès refusé

### Création de sous-admin (`/auth/create-sub-admin`)
- **Admin** : ✅ Accès complet
- **Sous-admin** : ❌ Accès refusé
- **Autres** : ❌ Accès refusé

## 🧪 Tests de Validation

Pour tester les permissions, exécutez :
```bash
cd back/functions
node test-subadmin-permissions.js
```

## 🔧 Configuration Technique

### Backend (`users/controllers/index.js`)
- ✅ Permissions mises à jour pour inclure `sous-admin`
- ✅ Fonctions `canManageSubAdmins()` et `hasAdminPrivileges()`
- ✅ Vérifications de permissions dans toutes les méthodes

### Backend (`auth/controllers/index.js`)
- ✅ Méthode `createSubAdmin()` : Seuls les admin peuvent créer des sous-admin
- ✅ Méthode `assignRole()` : Restrictions pour les sous-admin
- ✅ Vérifications de hiérarchie dans toutes les opérations

### Frontend (`NotificationDropdown.tsx`)
- ✅ Permissions mises à jour pour inclure `sous-admin`
- ✅ Gestion des erreurs d'authentification
- ✅ Vérification du token avant les requêtes
