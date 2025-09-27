const db = require("../../../config/firebase");
const sendEmail = require("../../../utils/sendmail"); // import corrigé
const AuditLog = require("../../../classes/AuditLog");
const { sendWebhook } = require("../../../utils/webhookSender");
const { encrypt, decrypt } = require("../../../utils/encryption");

class UsersController {
  constructor() {
    this.collection = db.collection("users");
  }

  // Vérifier si l'utilisateur peut gérer les sous-admin (seuls les admin peuvent le faire)
  canManageSubAdmins(user) {
    return user && user.role === "admin";
  }

  // Vérifier si l'utilisateur a des privilèges admin (admin ou sous-admin)
  hasAdminPrivileges(user) {
    return user && ["admin", "sous-admin"].includes(user.role);
  }

  // Récupérer tous les utilisateurs
  async getAll(req, res) {
    try {
      // Vérifier que l'utilisateur connecté peut voir les utilisateurs
      if (
        !req.user ||
        !["admin", "sous-admin", "comptable"].includes(req.user.role)
      ) {
        return res.status(403).json({
          message: "Non autorisé à voir les utilisateurs",
          status: false,
        });
      }

      const { status, role } = req.query;
      let query = this.collection;

      if (status) {
        query = query.where("status", "==", status);
      }
      if (role) {
        query = query.where("role", "==", role);
      }

      const snapshot = await query.get();
      const users = snapshot.docs.map((doc) => {
        const userData = doc.data();
        if (userData.telephone)
          userData.telephone = decrypt(userData.telephone);
        if (userData.adresse) userData.adresse = decrypt(userData.adresse);
        // Ne pas retourner le mot de passe
        delete userData.password;
        return { id: doc.id, ...userData };
      });
      return res.status(200).json({ status: true, data: users });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la récupération des utilisateurs",
        error: error.message,
      });
    }
  }

  // Récupérer les nouveaux utilisateurs créés récemment
  async getPendingUsers(req, res) {
    try {
      // Vérifier que l'utilisateur connecté peut voir les notifications
      if (
        !req.user ||
        !["admin", "sous-admin"].includes(req.user.role)
      ) {
        return res.status(403).json({
          message: "Non autorisé à voir les notifications",
          status: false,
        });
      }

      // Chercher les nouveaux utilisateurs créés dans les 7 derniers jours
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const snapshot = await this.collection
        .where("createdAt", ">=", sevenDaysAgo)
        .orderBy("createdAt", "desc")
        .limit(20) // Limiter à 20 notifications récentes
        .get();

      const newUsers = snapshot.docs.map((doc) => {
        const userData = doc.data();
        if (userData.telephone)
          userData.telephone = decrypt(userData.telephone);
        if (userData.adresse) userData.adresse = decrypt(userData.adresse);
        // Ne pas retourner le mot de passe
        delete userData.password;
        return { 
          id: doc.id, 
          ...userData,
          type: 'new_user', // Type de notification
          createdAt: userData.createdAt
        };
      });

      return res.status(200).json({
        status: true,
        data: newUsers,
        message: `${newUsers.length} nouveau(x) utilisateur(s) créé(s)`,
      });
    } catch (error) {
      console.error("Erreur lors de la récupération des nouveaux utilisateurs:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la récupération des nouveaux utilisateurs",
        error: error.message,
      });
    }
  }

  // Récupérer les users disponibles pour création de fiche étudiant
  async getAvailableUsersForStudent(req, res) {
    try {
      // Seuls admin, sous-admin et sub-admin peuvent utiliser cette route
      if (
        !req.user ||
        !["admin", "sous-admin", "sub-admin"].includes(req.user.role)
      ) {
        return res.status(403).json({ status: false, message: "Non autorisé" });
      }

      // Chercher tous les users avec role 'user' (comptes standards)
      const usersSnapshot = await this.collection
        .where("role", "==", "user")
        .get();
      const users = [];

      for (const doc of usersSnapshot.docs) {
        const u = { id: doc.id, ...doc.data() };
        // Vérifier si une fiche etudiant existe pour ce user
        const etuSnapshot = await db
          .collection("etudiants")
          .where("user_id", "==", doc.id)
          .limit(1)
          .get();
        // Toujours renvoyer le user, mais indiquer s'il a déjà une fiche etudiant
        u.hasEtudiant = !etuSnapshot.empty;
        // Ne pas retourner le mot de passe
        delete u.password;
        if (u.telephone) u.telephone = decrypt(u.telephone);
        if (u.adresse) u.adresse = decrypt(u.adresse);
        users.push(u);
      }

      return res.status(200).json({
        status: true,
        data: users,
        message: `${users.length} utilisateur(s) disponibles pour création d'étudiant`,
      });
    } catch (error) {
      console.error("Erreur getAvailableUsersForStudent:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur serveur",
        error: error.message,
      });
    }
  }

  // Récupérer un utilisateur par ID
  async getById(req, res) {
    try {
      // Vérifier que l'utilisateur connecté peut voir les utilisateurs
      if (
        !req.user ||
        !["admin", "sous-admin", "comptable"].includes(req.user.role)
      ) {
        return res.status(403).json({
          message: "Non autorisé à voir les utilisateurs",
          status: false,
        });
      }

      const { id } = req.params;
      if (!id)
        return res.status(400).json({ status: false, message: "ID requis" });
      let userDoc = await this.collection.doc(id).get();

      // Fallback: si l'ID fourni correspond potentiellement à un étudiant, résoudre vers son user_id
      if (!userDoc.exists) {
        try {
          const etuDoc = await db.collection("etudiants").doc(id).get();
          if (etuDoc.exists) {
            const etuData = etuDoc.data() || {};
            const linkedUserId = etuData.user_id || etuData.userId;
            if (linkedUserId) {
              const maybeUserDoc = await this.collection
                .doc(linkedUserId)
                .get();
              if (maybeUserDoc.exists) {
                userDoc = maybeUserDoc;
              }
            }
          }
        } catch (fallbackErr) {
          // Ne pas interrompre, on renverra 404 si rien trouvé
        }
      }

      if (!userDoc.exists)
        return res
          .status(404)
          .json({ status: false, message: "Utilisateur non trouvé" });

      const userData = userDoc.data();
      if (userData.telephone) userData.telephone = decrypt(userData.telephone);
      if (userData.adresse) userData.adresse = decrypt(userData.adresse);

      return res
        .status(200)
        .json({ status: true, data: { id: userDoc.id, ...userData } });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la récupération de l'utilisateur",
        error: error.message,
      });
    }
  }

  // Créer un nouvel utilisateur
  async create(req, res) {
    try {
      // Vérifier que l'utilisateur connecté peut créer des utilisateurs
      if (
        !req.user ||
        !["admin", "sous-admin"].includes(req.user.role)
      ) {
        return res.status(403).json({
          message: "Non autorisé à créer des utilisateurs",
          status: false,
        });
      }

      const { email, nom, prenom, password, role, telephone, adresse } =
        req.body;
      if (!email || !nom || !password || !role)
        return res.status(400).json({
          status: false,
          message: "Email, nom, mot de passe et rôle requis",
        });

      const newUser = new (require("../../../classes/User"))({
        email,
        nom,
        prenom,
        password,
        role,
        telephone,
        adresse,
      });
      await newUser.hashPassword(); // Hash the password

      const userData = {
        email: newUser.email,
        nom: newUser.nom,
        prenom: newUser.prenom,
        password: newUser.password,
        role: newUser.role,
        telephone: newUser.telephone,
        adresse: newUser.adresse,
        createdAt: newUser.createdAt,
        updatedAt: newUser.updatedAt,
      };

      // Encrypt sensitive fields before saving
      if (userData.telephone) userData.telephone = encrypt(userData.telephone);
      if (userData.adresse) userData.adresse = encrypt(userData.adresse);

      const docRef = await this.collection.add(userData);
      const createdUser = await docRef.get();

      // Audit log
      const auditLog = new AuditLog({
        userId: req.user?.id || "system",
        action: "CREATE_USER",
        entityType: "User",
        entityId: createdUser.id,
        details: { newUserData: createdUser.data() },
      });
      await auditLog.save();

      // Send webhook notification
      await sendWebhook("user.created", {
        userId: createdUser.id,
        ...createdUser.data(),
      });

      return res.status(201).json({
        status: true,
        message: "Utilisateur créé",
        data: { id: createdUser.id, ...createdUser.data() },
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la création de l'utilisateur",
        error: error.message,
      });
    }
  }

  // Mettre à jour un utilisateur
  async update(req, res) {
    try {
      const { id } = req.params;
      const {
        email,
        nom,
        prenom,
        role,
        telephone,
        adresse,
        isActive,
        emailNotifications,
        smsNotifications,
      } = req.body;
      if (!id)
        return res.status(400).json({ status: false, message: "ID requis" });
      const userRef = this.collection.doc(id);
      const userDoc = await userRef.get();
      if (!userDoc.exists)
        return res
          .status(404)
          .json({ status: false, message: "Utilisateur non trouvé" });

      const oldUserData = userDoc.data(); // Get old data for audit log

      const updateData = { updatedAt: new Date() };
      if (email !== undefined) updateData.email = email.trim();
      if (nom !== undefined) updateData.nom = nom.trim();
      if (prenom !== undefined) updateData.prenom = prenom.trim();
      if (role !== undefined) updateData.role = role.trim();
      if (telephone !== undefined)
        updateData.telephone = encrypt(telephone.trim());
      if (adresse !== undefined) updateData.adresse = encrypt(adresse.trim());
      if (isActive !== undefined) updateData.isActive = isActive;
      if (emailNotifications !== undefined)
        updateData.emailNotifications = emailNotifications;
      if (smsNotifications !== undefined)
        updateData.smsNotifications = smsNotifications;

      await userRef.update(updateData);
      const updatedUser = await userRef.get();

      // Si c'est un étudiant, synchroniser avec la table etudiants
      if (updatedUser.data().role === 'etudiant') {
        try {
          // Rechercher l'étudiant correspondant par user_id
          const etudiantsCollection = db.collection("etudiants");
          const etudiantSnapshot = await etudiantsCollection
            .where("user_id", "==", id)
            .get();

          if (!etudiantSnapshot.empty) {
            const etudiantDoc = etudiantSnapshot.docs[0];
            const etudiantData = etudiantDoc.data();
            
            // Préparer les données à synchroniser
            const etudiantUpdateData = {
              updatedAt: new Date()
            };
            
            // Synchroniser les champs communs
            if (nom !== undefined) etudiantUpdateData.nom = nom.trim();
            if (prenom !== undefined) etudiantUpdateData.prenom = prenom.trim();
            if (telephone !== undefined) etudiantUpdateData.telephone = encrypt(telephone.trim());
            if (adresse !== undefined) etudiantUpdateData.adresse = encrypt(adresse.trim());
            
            // Mettre à jour l'étudiant
            await etudiantDoc.ref.update(etudiantUpdateData);
            
            console.log(`✅ Synchronisation réussie: Utilisateur ${id} -> Étudiant ${etudiantDoc.id}`);
          } else {
            console.log(`⚠️ Aucun étudiant trouvé pour l'utilisateur ${id}`);
          }
        } catch (syncError) {
          console.error("❌ Erreur lors de la synchronisation avec la table etudiants:", syncError);
          // Ne pas faire échouer la requête principale, juste logger l'erreur
        }
      }

      // Audit log
      const auditLog = new AuditLog({
        userId: req.user?.id || "system",
        action: "UPDATE_USER",
        entityType: "User",
        entityId: id,
        details: { oldData: oldUserData, newData: updatedUser.data() },
      });
      await auditLog.save();

      // Send webhook notification
      await sendWebhook("user.updated", {
        userId: id,
        oldData: oldUserData,
        newData: updatedUser.data(),
      });

      return res.status(200).json({
        status: true,
        message: "Utilisateur mis à jour",
        data: { id: updatedUser.id, ...updatedUser.data() },
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la mise à jour de l'utilisateur",
        error: error.message,
      });
    }
  }

  // Supprimer un utilisateur
  async delete(req, res) {
    try {
      const { id } = req.params;
      if (!id)
        return res.status(400).json({ status: false, message: "ID requis" });
      const userRef = this.collection.doc(id);
      const userDoc = await userRef.get();
      if (!userDoc.exists)
        return res
          .status(404)
          .json({ status: false, message: "Utilisateur non trouvé" });

      const deletedUserData = userDoc.data(); // Get data before deletion for audit log

      await userRef.delete();

      // Audit log
      const auditLog = new AuditLog({
        userId: req.user?.id || "system",
        action: "DELETE_USER",
        entityType: "User",
        entityId: id,
        details: { deletedUserData },
      });
      await auditLog.save();

      // Send webhook notification
      await sendWebhook("user.deleted", { userId: id, deletedUserData });

      return res
        .status(200)
        .json({ status: true, message: "Utilisateur supprimé" });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la suppression de l'utilisateur",
        error: error.message,
      });
    }
  }

  // Activer un utilisateur
  async activateUser(req, res) {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ status: false, message: "ID requis" });
      }
      const userRef = this.collection.doc(id);
      const userDoc = await userRef.get();
      if (!userDoc.exists) {
        return res
          .status(404)
          .json({ status: false, message: "Utilisateur non trouvé" });
      }

      const oldUserData = userDoc.data(); // Get old data for audit log

      await userRef.update({ isActive: true, updatedAt: new Date() });
      const updatedUser = await userRef.get();

      // Audit log
      const auditLog = new AuditLog({
        userId: req.user?.id || "system",
        action: "ACTIVATE_USER",
        entityType: "User",
        entityId: id,
        details: { oldData: oldUserData, newData: updatedUser.data() },
      });
      await auditLog.save();

      // Send webhook notification
      await sendWebhook("user.activated", {
        userId: id,
        oldData: oldUserData,
        newData: updatedUser.data(),
      });

      return res.status(200).json({
        status: true,
        message: "Utilisateur activé",
        data: { id: updatedUser.id, ...updatedUser.data() },
      });
    } catch (error) {
      console.error("Error in activateUser:", error);
      return res.status(500).json({
        message: "Erreur lors de l'activation de l'utilisateur",
        status: false,
      });
    }
  }

  // Désactiver un utilisateur
  async deactivateUser(req, res) {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ status: false, message: "ID requis" });
      }
      const userRef = this.collection.doc(id);
      const userDoc = await userRef.get();
      if (!userDoc.exists) {
        return res
          .status(404)
          .json({ status: false, message: "Utilisateur non trouvé" });
      }

      const oldUserData = userDoc.data(); // Get old data for audit log

      await userRef.update({ isActive: false, updatedAt: new Date() });
      const updatedUser = await userRef.get();

      // Audit log
      const auditLog = new AuditLog({
        userId: req.user?.id || "system",
        action: "DEACTIVATE_USER",
        entityType: "User",
        entityId: id,
        details: { oldData: oldUserData, newData: updatedUser.data() },
      });
      await auditLog.save();

      // Send webhook notification
      await sendWebhook("user.deactivated", {
        userId: id,
        oldData: oldUserData,
        newData: updatedUser.data(),
      });

      return res.status(200).json({
        status: true,
        message: "Utilisateur désactivé",
        data: { id: updatedUser.id, ...updatedUser.data() },
      });
    } catch (error) {
      console.error("Error in deactivateUser:", error);
      return res.status(500).json({
        message: "Erreur lors de la désactivation de l'utilisateur",
        status: false,
      });
    }
  }

  // Mettre à jour les préférences de notification d'un utilisateur
  async updateNotificationPreferences(req, res) {
    try {
      const { id } = req.params;
      const { emailNotifications, smsNotifications } = req.body;

      if (!id) {
        return res.status(400).json({ status: false, message: "ID requis" });
      }

      if (emailNotifications === undefined && smsNotifications === undefined) {
        return res.status(400).json({
          status: false,
          message: "Au moins une préférence de notification est requise",
        });
      }

      const userRef = this.collection.doc(id);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        return res
          .status(404)
          .json({ status: false, message: "Utilisateur non trouvé" });
      }

      const oldUserData = userDoc.data(); // Get old data for audit log

      const updateData = { updatedAt: new Date() };
      if (emailNotifications !== undefined) {
        updateData.emailNotifications = emailNotifications;
      }
      if (smsNotifications !== undefined) {
        updateData.smsNotifications = smsNotifications;
      }

      await userRef.update(updateData);
      const updatedUser = await userRef.get();

      // Audit log
      const auditLog = new AuditLog({
        userId: req.user?.id || "system",
        action: "UPDATE_NOTIFICATION_PREFERENCES",
        entityType: "User",
        entityId: id,
        details: { oldData: oldUserData, newData: updatedUser.data() },
      });
      await auditLog.save();

      return res.status(200).json({
        status: true,
        message: "Préférences de notification mises à jour",
        data: { id: updatedUser.id, ...updatedUser.data() },
      });
    } catch (error) {
      console.error("Error in updateNotificationPreferences:", error);
      return res.status(500).json({
        message:
          "Erreur lors de la mise à jour des préférences de notification",
        status: false,
      });
    }
  }

  // Envoi d'email de réinitialisation du mot de passe
  async sendPasswordReset(req, res) {
    try {
      const { email } = req.body;
      if (!email) {
        return res
          .status(400)
          .json({ message: "Adresse email requise", status: false });
      }
      const users = await db
        .collection("users")
        .where("email", "==", email)
        .get();
      if (users.empty) {
        return res
          .status(404)
          .json({ message: "Aucun utilisateur trouvé", status: false });
      }
      const resetToken = "dummy-token"; // placeholder si JWT non utilisé pour l'instant
      const resetLink = `http://127.0.0.1:5001/reset-password?token=${resetToken}`;
      await sendEmail({
        to: email,
        subject: "Réinitialisation de votre mot de passe",
        template: "verificationForPassword",
        context: { resetLink, email, expiresIn: "15 minutes" },
      });
      return res
        .status(200)
        .json({ status: true, message: "Email de réinitialisation envoyé" });
    } catch (error) {
      console.error("Error in sendPasswordReset:", error);
      return res
        .status(500)
        .json({ message: "Erreur lors de l'envoi de l'email", status: false });
    }
  }

  // Approuver un utilisateur (changer le rôle et activer le compte)
  async approveUser(req, res) {
    try {
      const { id } = req.params;
      const { role = "etudiant" } = req.body;

      // Vérifier que l'utilisateur connecté peut approuver
      if (
        !req.user ||
        !["admin", "sous-admin", "comptable"].includes(req.user.role)
      ) {
        return res.status(403).json({
          status: false,
          message: "Accès refusé. Seuls les administrateurs peuvent approuver les utilisateurs.",
        });
      }

      const userRef = this.collection.doc(id);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        return res.status(404).json({
          status: false,
          message: "Utilisateur non trouvé",
        });
      }

      const userData = userDoc.data();
      if (userData.role !== "user" || userData.isActive !== false) {
        return res.status(400).json({
          status: false,
          message: "Cet utilisateur n'est pas en attente d'approbation",
        });
      }

      // Mettre à jour l'utilisateur
      await userRef.update({
        role: role,
        isActive: true,
        approvedBy: req.user.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      });

      // Envoyer un email de confirmation d'activation
      try {
        const loginUrl = process.env.FRONTEND_URL || "http://localhost:8080/login";
        await sendEmail({
          to: userData.email,
          subject: "🎉 Votre compte YNOV Campus a été activé !",
          template: "account-activated",
          context: {
            prenom: userData.prenom,
            nom: userData.nom,
            email: userData.email,
            role: role,
            loginUrl: loginUrl
          }
        });
        console.log(`Email d'activation envoyé à ${userData.email}`);
      } catch (emailError) {
        console.error("Erreur lors de l'envoi de l'email d'activation:", emailError);
        // Ne pas faire échouer la requête si l'email échoue
      }

      return res.status(200).json({
        status: true,
        message: "Utilisateur approuvé avec succès et email d'activation envoyé",
        data: { id, role, isActive: true },
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Erreur lors de l'approbation de l'utilisateur",
        error: error.message,
      });
    }
  }

  // Rejeter un utilisateur (supprimer le compte)
  async rejectUser(req, res) {
    try {
      const { id } = req.params;

      // Vérifier que l'utilisateur connecté peut rejeter
      if (
        !req.user ||
        !["admin", "sous-admin", "comptable"].includes(req.user.role)
      ) {
        return res.status(403).json({
          status: false,
          message: "Accès refusé. Seuls les administrateurs peuvent rejeter les utilisateurs.",
        });
      }

      const userRef = this.collection.doc(id);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        return res.status(404).json({
          status: false,
          message: "Utilisateur non trouvé",
        });
      }

      const userData = userDoc.data();
      if (userData.role !== "user" || userData.isActive !== false) {
        return res.status(400).json({
          status: false,
          message: "Cet utilisateur n'est pas en attente d'approbation",
        });
      }

      // Supprimer l'utilisateur
      await userRef.delete();

      return res.status(200).json({
        status: true,
        message: "Utilisateur rejeté avec succès",
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Erreur lors du rejet de l'utilisateur",
        error: error.message,
      });
    }
  }

  // Changer le mot de passe d'un utilisateur
  async changePassword(req, res) {
    try {
      const { id } = req.params;
      const { oldPassword, newPassword } = req.body;

      // Vérifier que l'utilisateur connecté peut changer le mot de passe
      if (!req.user || (req.user.id !== id && !["admin", "sous-admin", "comptable"].includes(req.user.role))) {
        return res.status(403).json({
          status: false,
          message: "Accès refusé. Vous ne pouvez changer que votre propre mot de passe.",
        });
      }

      if (!oldPassword || !newPassword) {
        return res.status(400).json({
          status: false,
          message: "L'ancien mot de passe et le nouveau mot de passe sont requis.",
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          status: false,
          message: "Le nouveau mot de passe doit contenir au moins 6 caractères.",
        });
      }

      // Récupérer l'utilisateur
      const userDoc = await this.collection.doc(id).get();
      if (!userDoc.exists) {
        return res.status(404).json({
          status: false,
          message: "Utilisateur non trouvé.",
        });
      }

      const userData = userDoc.data();

      // Vérifier l'ancien mot de passe
      const bcrypt = require("bcrypt");
      const isOldPasswordValid = await bcrypt.compare(oldPassword, userData.password);
      if (!isOldPasswordValid) {
        return res.status(400).json({
          status: false,
          message: "L'ancien mot de passe est incorrect.",
        });
      }

      // Hasher le nouveau mot de passe
      const saltRounds = 10;
      const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

      // Mettre à jour le mot de passe
      await this.collection.doc(id).update({
        password: hashedNewPassword,
        updatedAt: new Date(),
      });

      return res.status(200).json({
        status: true,
        message: "Mot de passe modifié avec succès.",
      });
    } catch (error) {
      console.error("Error in changePassword:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors du changement de mot de passe.",
        error: error.message,
      });
    }
  }

  // Récupérer les classes disponibles pour le profil étudiant
  async getAvailableClasses(req, res) {
    try {
      // Vérifier que l'utilisateur est connecté
      if (!req.user) {
        return res.status(401).json({
          status: false,
          message: "Authentification requise.",
        });
      }

      // Autoriser admin, sous-admin et étudiants
      const allowedRoles = ["admin", "sous-admin", "etudiant"];
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          status: false,
          message: "Accès refusé. Rôle non autorisé.",
        });
      }

      // Récupérer toutes les classes actives
      const classesSnapshot = await db.collection("classes")
        .where("isActive", "==", true)
        .orderBy("niveau")
        .orderBy("nom")
        .get();

      const classes = classesSnapshot.docs.map((doc) => ({
        id: doc.id,
        nom: doc.data().nom,
        niveau: doc.data().niveau,
        description: doc.data().description,
        capacite: doc.data().capacite,
        annee_scolaire: doc.data().annee_scolaire,
      }));

      return res.status(200).json({
        status: true,
        message: "Classes récupérées avec succès.",
        data: classes,
      });
    } catch (error) {
      console.error("Error in getAvailableClasses:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la récupération des classes.",
        error: error.message,
      });
    }
  }
}

module.exports = new UsersController();
