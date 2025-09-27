// const User = require('../../../classes/user'); // eslint-disable-line no-unused-vars
const db = require("../../../config/firebase");
const jwt = require("jsonwebtoken"); // eslint-disable-line no-unused-vars
const bcrypt = require("bcrypt");
const AuditLog = require("../../../classes/AuditLog");
const { decrypt } = require("../../../utils/encryption");
// const sendEmail = require('../../../utils/sendmail'); // eslint-disable-line no-unused-vars

class UserController {
  constructor() {
    this.collection = db.collection("users");
  }

  // Register a new user
  async register(req, res) {
    try {
      const { email, password, nom, prenom, role, telephone, adresse } = req.body;

      if (!email || !password || !nom || !prenom) {
        return res
          .status(400)
          .json({ message: "Missing required fields", status: false });
      }

      // Check if email already exists
      const existingUser = await db
        .collection("users")
        .where("email", "==", email)
        .get();
      if (!existingUser.empty) {
        return res
          .status(400)
          .json({ message: "L'email existe déjà", status: false });
      }

      // Hash the password before saving
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create the new user object - sans rôle par défaut (sera null/pending)
      const newUser = {
        email,
        password: hashedPassword,
        nom,
        prenom,
        role: role && role.trim() ? role : "user", // "user" par défaut pour les nouvelles inscriptions
        status: "pending", // En attente d'affectation de rôle
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: false, // Compte inactif jusqu'à validation admin
        ...(telephone && { telephone }), // Ajouter telephone si fourni
        ...(adresse && { adresse }), // Ajouter adresse si fourni
      };

      // Add user to Firestore
      const docRef = await db.collection("users").add(newUser);

      // Audit log
      const auditLog = new AuditLog({
        userId: docRef.id,
        action: "USER_REGISTER",
        entityType: "User",
        entityId: docRef.id,
        details: { email, nom, prenom, status: "pending" },
      });
      await auditLog.save();

      return res.status(200).json({
        message:
          "Inscription réussie. En attente d'affectation de rôle par un administrateur.",
        status: true,
        data: {
          id: docRef.id,
          email,
          nom,
          prenom,
          status: "pending",
          ...(telephone && { telephone }),
          ...(adresse && { adresse }),
        },
      });
    } catch (error) {
      console.error("Error in register method:", error);
      return res
        .status(500)
        .json({ message: "Erreur lors de l'inscription", status: false });
    }
  }

  // Login d'un utilisateur
  async login(req, res) {
    try {
      const { email, password } = req.body;
      const ipAddress = req.headers["x-forwarded-for"] || req.ip || "unknown";
      if (!email || !password) {
        return res
          .status(400)
          .json({ message: "Email et mot de passe requis", status: false });
      }
      // Chercher l'utilisateur par email
      const userSnapshot = await this.collection
        .where("email", "==", email)
        .get();
      if (userSnapshot.empty) {
        // Audit log for failed login attempt (email not found)
        const auditLog = new AuditLog({
          userId: null,
          action: "USER_LOGIN_FAILURE",
          entityType: "User",
          entityId: null,
          details: { email, reason: "Email not found", ipAddress },
        });
        await auditLog.save();
        return res
          .status(401)
          .json({ message: "Email ou mot de passe incorrect", status: false });
      }
      const userDoc = userSnapshot.docs[0];
      const user = userDoc.data();
      // Vérifier le mot de passe
      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        // Audit log for failed login attempt (incorrect password)
        const auditLog = new AuditLog({
          userId: userDoc.id,
          action: "USER_LOGIN_FAILURE",
          entityType: "User",
          entityId: userDoc.id,
          details: { email, reason: "Incorrect password", ipAddress },
        });
        await auditLog.save();
        return res
          .status(401)
          .json({ message: "Email ou mot de passe incorrect", status: false });
      }

      // Vérifier si le compte est actif
      if (user.isActive === false) {
        // Audit log for failed login attempt (inactive account)
        const auditLog = new AuditLog({
          userId: userDoc.id,
          action: "USER_LOGIN_FAILURE",
          entityType: "User",
          entityId: userDoc.id,
          details: { email, reason: "Account inactive", ipAddress },
        });
        await auditLog.save();
        return res
          .status(403)
          .json({ 
            message: "Votre compte a été désactivé. Veuillez contacter l'administrateur.", 
            status: false,
            code: "ACCOUNT_INACTIVE"
          });
      }
      // Générer un token (optionnel, ici simple exemple)
      // const token = jwt.sign({ id: userDoc.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "1d" });
      // Pour l'exemple, on retourne juste un indicateur de succès
      const accessToken = jwt.sign(
        { id: userDoc.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: "30m" }
      );

      const refreshToken = jwt.sign(
        { id: userDoc.id, email: user.email, role: user.role },
        process.env.REFRESH_TOKEN_SECRET,
        { expiresIn: "7d" }
      );

      // Audit log for successful login
      const auditLog = new AuditLog({
        userId: userDoc.id,
        action: "USER_LOGIN_SUCCESS",
        entityType: "User",
        entityId: userDoc.id,
        details: { email: user.email, role: user.role, ipAddress },
      });
      await auditLog.save();

      return res.status(200).json({
        status: true,
        message: "Connexion réussie",
        user: {
          id: userDoc.id,
          email: user.email,
          nom: user.nom,
          prenom: user.prenom,
          role: user.role || "",
        },
        token: accessToken,
        refreshToken: refreshToken,
      });
    } catch (error) {
      console.error("Erreur lors du login:", error);
      return res.status(500).json({ message: "Erreur serveur", status: false });
    }
  }

  // Envoi d'email de réinitialisation du mot de passe
  async sendPasswordReset(req, res) {
    // À compléter : logique d'envoi d'email
    return res.status(501).json({ message: "Non implémenté", status: false });
  }

  async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res
          .status(400)
          .json({ message: "Refresh token required", status: false });
      }

      let decoded;
      try {
        decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
      } catch (jwtError) {
        // Audit log for invalid/expired refresh token
        const auditLog = new AuditLog({
          userId: null,
          action: "TOKEN_REFRESH_FAILURE",
          entityType: "User",
          entityId: null,
          details: {
            refreshToken,
            reason: "Invalid or expired refresh token",
            ipAddress: req.headers["x-forwarded-for"] || req.ip || "unknown",
            error: jwtError.message,
          },
        });
        await auditLog.save();
        return res
          .status(403)
          .json({ message: "Invalid or expired refresh token", status: false });
      }

      const userSnapshot = await this.collection.doc(decoded.id).get();
      if (!userSnapshot.exists) {
        // Audit log for invalid refresh token (user not found)
        const auditLog = new AuditLog({
          userId: decoded.id,
          action: "TOKEN_REFRESH_FAILURE",
          entityType: "User",
          entityId: decoded.id,
          details: {
            refreshToken,
            reason: "User not found for refresh token",
            ipAddress: req.headers["x-forwarded-for"] || req.ip || "unknown",
          },
        });
        await auditLog.save();
        return res
          .status(401)
          .json({ message: "Invalid refresh token", status: false });
      }

      const user = userSnapshot.data();

      const newAccessToken = jwt.sign(
        { id: userSnapshot.id, email: user?.email, role: user?.role },
        process.env.JWT_SECRET,
        { expiresIn: "30m" }
      );

      const newRefreshToken = jwt.sign(
        { id: userSnapshot.id, email: user?.email, role: user?.role },
        process.env.REFRESH_TOKEN_SECRET,
        { expiresIn: "7d" }
      );

      // Audit log for successful token refresh
      const auditLog = new AuditLog({
        userId: userSnapshot.id,
        action: "TOKEN_REFRESH_SUCCESS",
        entityType: "User",
        entityId: userSnapshot.id,
        details: {
          email: user.email,
          role: user.role,
          ipAddress: req.headers["x-forwarded-for"] || req.ip || "unknown",
        },
      });
      await auditLog.save();

      return res.status(200).json({
        status: true,
        message: "Token refreshed successfully",
        data: {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
        },
      });
    } catch (error) {
      console.error("Error refreshing token:", error);
      return res
        .status(403)
        .json({ message: "Invalid or expired refresh token", status: false });
    }
  }

  async me(req, res) {
    try {
      // Assuming authMiddleware has already set req.user with user ID
      const userId = req.user.id;
      const userDoc = await this.collection.doc(userId).get();

      if (!userDoc.exists) {
        return res
          .status(404)
          .json({ message: "User not found", status: false });
      }

      const user = userDoc.data();
      
      // Déchiffrer les champs sensibles
      if (user.telephone) user.telephone = decrypt(user.telephone);
      if (user.adresse) user.adresse = decrypt(user.adresse);

      return res.status(200).json({
        status: true,
        message: "User data retrieved successfully",
        data: {
          id: userDoc.id,
          email: user.email,
          nom: user.nom,
          prenom: user.prenom,
          role: user.role || "",
          telephone: user.telephone || "",
          adresse: user.adresse || "",
          isActive: user.isActive,
          emailNotifications: user.emailNotifications,
          smsNotifications: user.smsNotifications,
          status: user.status || "pending",
          createdBy: user.createdBy,
          assignedAt: user.assignedAt,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      });
    } catch (error) {
      console.error("Error in me method:", error);
      return res.status(500).json({ message: "Server error", status: false });
    }
  }

  // Créer un sous-admin (seulement par admin principal)
  async createSubAdmin(req, res) {
    try {
      const { email, password, nom, prenom, telephone, adresse } = req.body;

      // Vérifier que l'utilisateur connecté est admin
      if (!req.user || req.user.role !== "admin") {
        return res.status(403).json({
          message: "Seul un admin principal peut créer des sous-admins",
          status: false,
        });
      }

      if (!email || !password || !nom || !prenom) {
        return res.status(400).json({
          message: "Email, mot de passe, nom et prénom sont requis",
          status: false,
        });
      }

      // Vérifier si l'email existe déjà
      const existingUser = await this.collection
        .where("email", "==", email)
        .get();
      if (!existingUser.empty) {
        return res.status(400).json({
          message: "L'email existe déjà",
          status: false,
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const newSubAdmin = {
        email,
        password: hashedPassword,
        nom,
        prenom,
        telephone: telephone || null,
        adresse: adresse || null,
        role: "sous-admin",
        status: "active",
        createdBy: req.user.id,
        assignedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: true,
      };

      const docRef = await this.collection.add(newSubAdmin);
      const newUser = await docRef.get();

      // Audit log
      const auditLog = new AuditLog({
        userId: req.user.id,
        action: "CREATE_SUB_ADMIN",
        entityType: "User",
        entityId: docRef.id,
        details: {
          newSubAdminData: { ...newUser.data(), password: "[REDACTED]" },
          createdBy: req.user.id,
        },
      });
      await auditLog.save();

      return res.status(201).json({
        status: true,
        message: "Sous-admin créé avec succès",
        data: {
          id: docRef.id,
          email: newUser.data().email,
          nom: newUser.data().nom,
          prenom: newUser.data().prenom,
          role: newUser.data().role,
          status: newUser.data().status,
        },
      });
    } catch (error) {
      console.error("Erreur création sous-admin:", error);
      return res.status(500).json({
        message: "Erreur serveur",
        status: false,
      });
    }
  }

  // Affecter un rôle à un utilisateur et créer l'entité correspondante
  async assignRole(req, res) {
    try {
      const { userId } = req.params;
      const { role, additionalData } = req.body;

      // Vérifier que l'utilisateur connecté peut affecter des rôles
      if (
        !req.user ||
        (req.user.role !== "admin" && req.user.role !== "sous-admin")
      ) {
        return res.status(403).json({
          message: "Non autorisé à affecter des rôles",
          status: false,
        });
      }

      // Récupérer l'utilisateur cible
      const userDoc = await this.collection.doc(userId).get();
      if (!userDoc.exists) {
        return res.status(404).json({
          message: "Utilisateur non trouvé",
          status: false,
        });
      }

      const userData = userDoc.data();

      // Vérifier les permissions selon la hiérarchie
      if (req.user.role === "sous-admin") {
        if (role === "admin" || role === "sous-admin") {
          return res.status(403).json({
            message: "Un sous-admin ne peut pas créer d'admin ou de sous-admin",
            status: false,
          });
        }
        if (userData.role === "admin" || userData.role === "sous-admin") {
          return res.status(403).json({
            message:
              "Un sous-admin ne peut pas modifier un admin ou sous-admin",
            status: false,
          });
        }
      }

      const allowedRoles = [
        "etudiant",
        "parent",
        "enseignant",
        "personnel",
        "comptable",
      ];
      if (req.user.role === "admin") {
        allowedRoles.push("sous-admin");
      }

      if (!allowedRoles.includes(role)) {
        return res.status(400).json({
          message: `Rôle non autorisé: ${role}`,
          status: false,
        });
      }

      // Mettre à jour l'utilisateur
      await this.collection.doc(userId).update({
        role,
        status: "active",
        assignedAt: new Date(),
        createdBy: req.user.id,
        updatedAt: new Date(),
      });

      // Créer l'entité correspondante selon le rôle
      let entityId = null;
      try {
        console.log("[assignRole] prepare to create entity", {
          userId,
          role,
          additionalDataPreview: additionalData || {},
        });

        entityId = await this.createRoleEntity(
          userId,
          userData,
          role,
          additionalData || {}
        );
      } catch (entityError) {
        console.error("Erreur création entité:", entityError);
        console.error(
          entityError && entityError.stack ? entityError.stack : "no stack"
        );
        // Rollback du rôle si création entité échoue
        await this.collection.doc(userId).update({
          role: userData.role || null,
          status: userData.status || "pending",
          updatedAt: new Date(),
        });
        // Return more detailed error information for debugging (local/dev)
        return res.status(500).json({
          message: `Erreur lors de la création de l'entité ${role}: ${
            entityError.message || String(entityError)
          }`,
          detail: entityError.message || String(entityError),
          detailStack:
            entityError && entityError.stack ? entityError.stack : null,
          status: false,
        });
      }

      // Audit log
      const auditLog = new AuditLog({
        userId: req.user.id,
        action: "ASSIGN_ROLE",
        entityType: "User",
        entityId: userId,
        details: {
          oldRole: userData.role,
          newRole: role,
          entityId,
          assignedBy: req.user.id,
          additionalData,
        },
      });
      await auditLog.save();

      return res.status(200).json({
        status: true,
        message: `Rôle ${role} affecté avec succès`,
        data: {
          userId,
          role,
          entityId,
          assignedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("Erreur affectation rôle:", error);
      return res.status(500).json({
        message: "Erreur serveur",
        detail: error && error.message ? error.message : String(error),
        status: false,
      });
    }
  }

  // Méthode utilitaire pour créer les entités selon le rôle
  async createRoleEntity(userId, userData, role, additionalData) {
    const User = require("../../../classes/User");
    const user = new User({ id: userId, ...userData });

    switch (role) {
      case "etudiant": {
        const Etudiant = require("../../../classes/Etudiant");
        const etudiant = await Etudiant.fromUser(user, additionalData);
        const docRef = await db.collection("etudiants").add(etudiant.toJSON());
        return docRef.id;
      }
      case "parent": {
        const Parent = require("../../../classes/Parent");
        const parent = Parent.fromUser(user, additionalData);
        const docRef = await db.collection("parents").add(parent.toJSON());
        return docRef.id;
      }
      case "enseignant": {
        const Enseignant = require("../../../classes/Enseignant");
        const enseignant = Enseignant.fromUser(user, additionalData);
        const docRef = await db
          .collection("enseignants")
          .add(enseignant.toJSON());
        return docRef.id;
      }
      case "personnel":
      case "comptable":
        // Pour le personnel et comptable, on peut juste mettre à jour le rôle sans créer d'entité séparée
        return null;
      default:
        throw new Error(`Rôle non supporté pour la création d'entité: ${role}`);
    }
  }
}

module.exports = new UserController();
