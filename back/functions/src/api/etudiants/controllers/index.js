const Etudiant = require("../../../classes/Etudiant");
const db = require("../../../config/firebase");
const AuditLog = require("../../../classes/AuditLog");
const { sendWebhook } = require("../../../utils/webhookSender");
const { encrypt, decrypt } = require("../../../utils/encryption");

class EtudiantController {
  constructor() {
    this.collection = db.collection("etudiants");
    this.tarifsCollection = db.collection("tarifs");
    this.boursesCollection = db.collection("bourses");
    this.factureCollection = db.collection("factures");
    this.paiementCollection = db.collection("paiements");
    this.userCollection = db.collection("users");
    this.classesCollection = db.collection("classes");
    this.paymentPlansCollection = db.collection("payment_plans"); // Add this line
  }

  /**
   * Créer un nouvel étudiant
   * POST /etudiants
   */
  async create(req, res) {
    try {
      const {
        nom,
        prenom,
        date_naissance,
        classe_id,
        nationalite,
        bourse_id,
        exemptions,
        parentId,
        
        paymentPlanId,
        paymentOverride,
        overdueNotificationsMutedUntil,
      } = req.body;

      // Validation des données obligatoires
      if (!nom || !prenom || !date_naissance || !classe_id || !nationalite) {
        return res.status(400).json({
          status: false,
          message:
            "Le nom, prénom, date de naissance, classe et nationalité sont requis",
        });
      }

      // Validation du nom
      if (nom.trim().length < 2) {
        return res.status(400).json({
          status: false,
          message: "Le nom doit contenir au moins 2 caractères",
        });
      }

      // Validation du prénom
      if (prenom.trim().length < 2) {
        return res.status(400).json({
          status: false,
          message: "Le prénom doit contenir au moins 2 caractères",
        });
      }

      // Validation de la date de naissance
      const dateNaissance = new Date(date_naissance);
      if (isNaN(dateNaissance.getTime())) {
        return res.status(400).json({
          status: false,
          message: "Format de date invalide",
        });
      }

      // Calculer l'âge
      const aujourd = new Date();
      let age = aujourd.getFullYear() - dateNaissance.getFullYear();
      const moisDiff = aujourd.getMonth() - dateNaissance.getMonth();

      if (
        moisDiff < 0 ||
        (moisDiff === 0 && aujourd.getDate() < dateNaissance.getDate())
      ) {
        age--;
      }

      if (age < 3 || age > 25) {
        return res.status(400).json({
          status: false,
          message: "L'âge doit être entre 3 et 25 ans",
        });
      }

      // Vérifier si code_massar est unique si fourni
      if (code_massar) {
        const existingMassar = await db.collection("etudiants").where("code_massar", "==", code_massar).get();
        if (!existingMassar.empty) {
          return res.status(409).json({
            status: false,
            message: "Un étudiant avec ce code Massar existe déjà."
          });
        }
      }

      // Vérifier que la classe existe
      const classeRef = db.collection("classes").doc(classe_id);
      const classeDoc = await classeRef.get();
      if (!classeDoc.exists) {
        return res.status(400).json({
          status: false,
          message: "La classe spécifiée n'existe pas",
        });
      }

      // Si un user_id est fourni, vérifier qu'il existe et qu'il est eligible (role 'user')
      let linkedUserId = null;
      if (req.body.user_id) {
        // Autoriser seulement admin/sub-admin à lier un user existant
        if (
          !req.user ||
          (req.user.role !== "admin" && req.user.role !== "sub-admin")
        ) {
          return res.status(403).json({
            status: false,
            message: "Non autorisé à lier un utilisateur existant",
          });
        }

        const userDoc = await db
          .collection("users")
          .doc(req.body.user_id)
          .get();
        if (!userDoc.exists) {
          return res.status(404).json({
            status: false,
            message: "Utilisateur spécifié introuvable",
          });
        }
        const userData = userDoc.data();
        if (userData.role && userData.role !== "user") {
          return res.status(400).json({
            status: false,
            message:
              "Le compte utilisateur ne peut pas être transformé en étudiant (role invalide)",
          });
        }

        linkedUserId = userDoc.id;
      }

      // Vérifier que la bourse existe si elle est fournie et non vide
      if (bourse_id && bourse_id.trim() !== "") {
        const bourseRef = db.collection("bourses").doc(bourse_id);
        const bourseDoc = await bourseRef.get();
        if (!bourseDoc.exists) {
          return res.status(400).json({
            status: false,
            message: "La bourse spécifiée n'existe pas",
          });
        }
      }

      // Vérifier l'unicité nom + prénom + date de naissance
      const existingEtudiant = await db
        .collection("etudiants")
        .where("nom", "==", nom.trim())
        .where("prenom", "==", prenom.trim())
        .where("date_naissance", "==", date_naissance)
        .get();

      if (!existingEtudiant.empty) {
        return res.status(409).json({
          status: false,
          message: "Un étudiant avec ces informations existe déjà",
        });
      }

      // Récupérer le tarif correspondant
      const tarifsRef = db.collection("tarifs");
      let tarifQuery = tarifsRef
        .where("classe_id", "==", classe_id)
        .where("nationalite", "==", nationalite);

      if (bourse_id && bourse_id.trim() !== "") {
        tarifQuery = tarifQuery.where("bourse_id", "==", bourse_id);
      }

      const tarifSnapshot = await tarifQuery.get();
      let tarif = null;
      if (!tarifSnapshot.empty) {
        tarif = tarifSnapshot.docs[0].data();
        tarif.id = tarifSnapshot.docs[0].id;
      }

      // Calculer le montant final avec réduction
      let montantFinal = tarif ? tarif.montant : 0;
      let reductions = tarif && tarif.reductions ? tarif.reductions : [];
      reductions.forEach((r) => {
        if (r.type === "bourse" || r.type === "remise") {
          montantFinal -= r.valeur;
        }
      });
      if (montantFinal < 0) montantFinal = 0;

      // Calculer frais_payment : montant total des frais (scolarité + inscription)
      let fraisPayment = 0;
      
      // Récupérer les frais globaux pour l'année scolaire actuelle
      const currentYear = new Date().getFullYear();
      const academicYear = `${currentYear}-${currentYear + 1}`;
      
      // Récupérer les frais d'inscription (type "Scolarité" avec nom "Frais Inscription")
      const fraisInscriptionSnapshot = await db
        .collection("tarifs")
        .where("annee_scolaire", "==", academicYear)
        .where("isActive", "==", true)
        .where("type", "==", "Scolarité")
        .where("nom", "==", "Frais Inscription")
        .get();

      // Récupérer les frais de scolarité (type "Scolarité" avec nom "Frais scolaire")
      const fraisScolariteSnapshot = await db
        .collection("tarifs")
        .where("annee_scolaire", "==", academicYear)
        .where("isActive", "==", true)
        .where("type", "==", "Scolarité")
        .where("nom", "==", "Frais scolaire")
        .get();

      // Calculer le total des frais
      let montantInscription = 0;
      let montantScolarite = 0;
      
      if (!fraisInscriptionSnapshot.empty) {
        montantInscription = fraisInscriptionSnapshot.docs[0].data().montant || 0;
        fraisPayment += montantInscription;
        console.log(`Frais d'inscription trouvé: ${montantInscription} MAD`);
      } else {
        console.log('Aucun frais d\'inscription trouvé');
      }
      
      if (!fraisScolariteSnapshot.empty) {
        montantScolarite = fraisScolariteSnapshot.docs[0].data().montant || 0;
        fraisPayment += montantScolarite;
        console.log(`Frais de scolarité trouvé: ${montantScolarite} MAD`);
      } else {
        console.log('Aucun frais de scolarité trouvé');
      }
      
      console.log(`Total frais_payment calculé: ${fraisPayment} MAD (Inscription: ${montantInscription} + Scolarité: ${montantScolarite})`);

      // Appliquer la réduction de bourse si l'étudiant a une bourse
      if (bourse_id && bourse_id.trim() !== "") {
        const bourseDoc = await db.collection("bourses").doc(bourse_id).get();
        if (bourseDoc.exists) {
          const bourseData = bourseDoc.data();
          if (bourseData.pourcentage_remise) {
            // Réduction en pourcentage
            fraisPayment = fraisPayment * (1 - bourseData.pourcentage_remise / 100);
          } else if (bourseData.montant_remise) {
            // Réduction en montant fixe
            fraisPayment = Math.max(0, fraisPayment - bourseData.montant_remise);
          }
        }
      }

      // Créer le nouvel étudiant
      const etudiantData = {
        nom: nom.trim(),
        prenom: prenom.trim(),
        date_naissance: date_naissance,
        classe_id: classe_id,
        nationalite: nationalite.trim(),
        bourse_id: bourse_id && bourse_id.trim() !== "" ? bourse_id : null,
        exemptions: exemptions ? encrypt(JSON.stringify(exemptions)) : [], // Add exemptions, encrypt them
        parentId: parentId ? encrypt(parentId) : null, // Add parentId, encrypt it
        code_massar: code_massar || null,
        paymentPlanId: paymentPlanId || null,
        paymentOverride: paymentOverride || false,
        overdueNotificationsMutedUntil: overdueNotificationsMutedUntil || null,
        tarif_id: tarif ? tarif.id : null,
        montant_tarif: montantFinal,
        reductions: reductions,
        frais_payment: fraisPayment, // Montant total des frais avec réduction de bourse
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (linkedUserId) {
        etudiantData.user_id = linkedUserId;
      }

      const docRef = await this.collection.add(etudiantData);
      const newEtudiant = await docRef.get();

      // Si on a lié un user, mettre à jour son role en 'etudiant'
      if (linkedUserId) {
        await db
          .collection("users")
          .doc(linkedUserId)
          .update({ role: "etudiant", updatedAt: new Date() });
      }

      // Audit log
      const auditLog = new AuditLog({
        userId: req.user?.id || "system",
        action: "CREATE_ETUDIANT",
        entityType: "Etudiant",
        entityId: newEtudiant.id,
        details: { newEtudiantData: newEtudiant.data() },
      });
      await auditLog.save();

      // Send webhook notification
      await sendWebhook("student.created", {
        studentId: newEtudiant.id,
        ...newEtudiant.data(),
      });

      return res.status(201).json({
        status: true,
        message: "Étudiant créé avec succès",
        data: {
          id: newEtudiant.id,
          ...newEtudiant.data(),
        },
      });
    } catch (error) {
      console.error("Erreur lors de la création de l'étudiant:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur interne du serveur",
        error: error.message,
      });
    }
  }

  /**
   * Récupérer tous les étudiants
   * GET /etudiants
   */
  async getAll(req, res) {
    try {
      const {
        page = 1,
        limit = 10,
        search,
        classe_id,
        bourse_id,
        nationalite,
        user_id,
      } = req.query;
      const pageNumber = parseInt(page);
      const limitNumber = parseInt(limit);

      let query = this.collection.orderBy("createdAt", "desc");

      // Filtres
      if (classe_id) {
        query = query.where("classe_id", "==", classe_id);
      }

      if (bourse_id) {
        query = query.where("bourse_id", "==", bourse_id);
      }

      if (nationalite) {
        query = query.where("nationalite", "==", nationalite);
      }

      if (user_id) {
        query = query.where("user_id", "==", user_id);
      }

      // Recherche par nom ou prénom
      if (search && search.trim()) {
        const searchTerm = search.trim();
        // Note: Firestore ne supporte pas les recherches OR complexes
        // On utilise une approche simple avec le nom
        query = query
          .where("nom", ">=", searchTerm)
          .where("nom", "<=", searchTerm + "\uf8ff");
      }

      // Pagination
      const offset = (pageNumber - 1) * limitNumber;
      const snapshot = await query.limit(limitNumber).offset(offset).get();

      const etudiants = [];

      // Récupérer les données complètes avec les relations
      for (const doc of snapshot.docs) {
        const etudiantData = doc.data();

        // Récupérer les informations de la classe
        let classeInfo = null;
        if (etudiantData.classe_id) {
          const classeDoc = await db
            .collection("classes")
            .doc(etudiantData.classe_id)
            .get();
          if (classeDoc.exists) {
            classeInfo = { id: classeDoc.id, ...classeDoc.data() };
          }
        }

        // Récupérer les informations de la bourse
        let bourseInfo = null;
        if (etudiantData.bourse_id) {
          const bourseDoc = await db
            .collection("bourses")
            .doc(etudiantData.bourse_id)
            .get();
          if (bourseDoc.exists) {
            bourseInfo = { id: bourseDoc.id, ...bourseDoc.data() };
          }
        }

        // Decrypt sensitive fields
        if (etudiantData.exemptions && etudiantData.exemptions.length > 0) {
          try {
            etudiantData.exemptions = JSON.parse(
              decrypt(etudiantData.exemptions)
            );
          } catch (e) {
            console.error("Error decrypting exemptions for student", doc.id, e);
            etudiantData.exemptions = []; // Fallback to empty array on error
          }
        }
        if (etudiantData.parentId) {
          etudiantData.parentId = decrypt(etudiantData.parentId);
        }

        const currentYear = new Date().getFullYear();
        const paymentStatus = await this.getPaymentStatus(doc.id, currentYear);

        etudiants.push({
          id: doc.id,
          ...etudiantData,
          classe: classeInfo,
          bourse: bourseInfo,
          paymentStatus: paymentStatus, // Ajouter le statut de paiement
        });
      }

      // Compter le total des documents pour la pagination
      const totalSnapshot = await this.collection.get();
      const total = totalSnapshot.size;

      return res.status(200).json({
        status: true,
        data: etudiants,
        pagination: {
          page: pageNumber,
          limit: limitNumber,
          total,
          totalPages: Math.ceil(total / limitNumber),
        },
      });
    } catch (error) {
      console.error("Erreur lors de la récupération des étudiants:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la récupération des étudiants",
        error: error.message,
      });
    }
  }

  /**
   * Récupérer un étudiant par ID
   * GET /etudiants/:id
   */
  async getById(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          status: false,
          message: "ID de l'étudiant requis",
        });
      }

      // Vérifier les permissions
      const userRole = req.user.role;
      const userId = req.user.id;

      const etudiantDoc = await this.collection.doc(id).get();

      if (!etudiantDoc.exists) {
        return res.status(404).json({
          status: false,
          message: "Étudiant non trouvé",
        });
      }

      // Si c'est un étudiant, il ne peut accéder qu'à ses propres données
      if (userRole === "etudiant") {
        const etudiantData = etudiantDoc.data();
        if (etudiantData.user_id !== userId) {
          return res.status(403).json({
            status: false,
            message: "Accès refusé. Vous ne pouvez accéder qu'à vos propres données.",
          });
        }
      }

      const etudiantData = etudiantDoc.data();

      // Récupérer les informations de la classe
      let classeInfo = null;
      if (etudiantData.classe_id) {
        const classeDoc = await db
          .collection("classes")
          .doc(etudiantData.classe_id)
          .get();
        if (classeDoc.exists) {
          classeInfo = { id: classeDoc.id, ...classeDoc.data() };
        }
      }

      // Récupérer les informations de la bourse
      let bourseInfo = null;
      if (etudiantData.bourse_id) {
        const bourseDoc = await db
          .collection("bourses")
          .doc(etudiantData.bourse_id)
          .get();
        if (bourseDoc.exists) {
          bourseInfo = { id: bourseDoc.id, ...bourseDoc.data() };
        }
      }

      // Récupérer le parent si disponible (après déchiffrement plus bas)
      let parentInfo = null;

      // Decrypt sensitive fields
      if (etudiantData.exemptions && etudiantData.exemptions.length > 0) {
        try {
          etudiantData.exemptions = JSON.parse(
            decrypt(etudiantData.exemptions)
          );
        } catch (e) {
          console.error("Error decrypting exemptions for student", id, e);
          etudiantData.exemptions = []; // Fallback to empty array on error
        }
      }
      if (etudiantData.parentId) {
        let parentIds = [];
        
        // Gérer les tableaux de parents
        if (Array.isArray(etudiantData.parentId)) {
          // Si c'est un tableau, déchiffrer tous les IDs
          parentIds = etudiantData.parentId.map(id => decrypt(id));
        } else {
          // Si c'est une chaîne, la déchiffrer et créer un tableau
          parentIds = [decrypt(etudiantData.parentId)];
        }
        
        etudiantData.parentId = parentIds;
        
        // Récupérer les informations du premier parent (pour compatibilité)
        if (parentIds.length > 0) {
          try {
            const parentDoc = await db
              .collection("parents")
              .doc(parentIds[0])
              .get();
            if (parentDoc.exists) {
              const parentData = parentDoc.data();
              // Déchiffrer les données sensibles du parent
              parentInfo = { 
                id: parentDoc.id, 
                nom: parentData.nom,
                prenom: parentData.prenom,
                email: parentData.email ? decrypt(parentData.email) : null,
                telephone: parentData.telephone ? decrypt(parentData.telephone) : null,
                adresse: parentData.adresse ? decrypt(parentData.adresse) : null
              };
            }
          } catch (error) {
            console.error("Erreur lors de la récupération du parent:", error);
          }
        }
      }

      // Récupérer un éventuel tarif actif pour la classe (type Scolarité)
      let montantTarif = null;
      try {
        if (etudiantData.classe_id) {
          const tarifsSnap = await db
            .collection("tarifs")
            .where("classe_id", "==", etudiantData.classe_id)
            .where("isActive", "==", true)
            .where("type", "==", "Scolarité")
            .limit(1)
            .get();
          if (!tarifsSnap.empty) {
            const t = tarifsSnap.docs[0].data();
            if (typeof t.montant === "number") montantTarif = t.montant;
          }
        }
      } catch (_) {
        // ignore tarif lookup errors
      }

      // Récupérer les factures et paiements liés à cet étudiant
      const facturesSnapshot = await db
        .collection("factures")
        .where("student_id", "==", id)
        .get();
      const factures = facturesSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      const paiementsSnapshot = await this.paiementCollection
        .where("etudiant_id", "==", id)
        .get();
      const paiements = paiementsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // Calculer un statut de paiement cohérent à partir des factures/paiements
      const totalMontantDu = factures.reduce((sum, f) => {
        const mt =
          typeof f.montant_total === "number"
            ? f.montant_total
            : Number(f.montant_total) || 0;
        return sum + mt;
      }, 0);

      const totalPayeFromInvoices = factures.reduce((sum, f) => {
        const mp =
          typeof f.montant_paye === "number"
            ? f.montant_paye
            : Number(f.montant_paye) || 0;
        return sum + mp;
      }, 0);

      const totalPayeFromPayments = paiements.reduce((sum, p) => {
        const mp =
          typeof p.montantPaye === "number"
            ? p.montantPaye
            : Number(p.montantPaye) || 0;
        return sum + mp;
      }, 0);

      const totalPaid =
        totalPayeFromInvoices > 0
          ? totalPayeFromInvoices
          : totalPayeFromPayments;
      const remainingAmount = Math.max(0, totalMontantDu - totalPaid);
      let paymentWarningStatus = "OK";
      if (remainingAmount <= 0) {
        paymentWarningStatus = "Payée";
      } else if (totalMontantDu > 0 && totalPaid / totalMontantDu < 0.5) {
        paymentWarningStatus = "Avertissement: 1er Semestre (50%) non atteint";
      }
      const paymentStatus = {
        totalMontantDu,
        totalPaid,
        remainingAmount,
        paymentWarningStatus,
      };

      const etudiant = new Etudiant({
        id: etudiantDoc.id,
        ...etudiantData,
      });

      return res.status(200).json({
        status: true,
        data: {
          ...etudiant.toJSON(),
          classe: classeInfo,
          bourse: bourseInfo,
          factures,
          paiements,
          paymentStatus, // Statut de paiement calculé à partir des factures/paiements
          parent: parentInfo,
          montantTarif,
          
          paymentPlanId: etudiantData.paymentPlanId || null,
          paymentOverride: etudiantData.paymentOverride || false,
          overdueNotificationsMutedUntil: etudiantData.overdueNotificationsMutedUntil || null,
        },
      });
    } catch (error) {
      console.error("Erreur lors de la récupération de l'étudiant:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la récupération de l'étudiant",
        error: error.message,
      });
    }
  }

  /**
   * Mettre à jour un étudiant
   * PUT /etudiants/:id
   */
  async update(req, res) {
    try {
      const { id } = req.params;
      const {
        nom,
        prenom,
        date_naissance,
        classe_id,
        nationalite,
        bourse_id,
        exemptions,
        parentId,
        code_massar,
        paymentPlanId,
        paymentOverride,
        overdueNotificationsMutedUntil,
      } = req.body;

      if (!id) {
        return res.status(400).json({
          status: false,
          message: "ID de l'étudiant requis",
        });
      }

      // Vérifier si l'étudiant existe
      const etudiantRef = this.collection.doc(id);
      const etudiantDoc = await etudiantRef.get();

      if (!etudiantDoc.exists) {
        return res.status(404).json({
          status: false,
          message: "Étudiant non trouvé",
        });
      }

      const currentData = etudiantDoc.data();

      const oldEtudiantData = etudiantDoc.data(); // Get old data for audit log

      // Validation des données
      if (nom !== undefined && (!nom || nom.trim().length < 2)) {
        return res.status(400).json({
          status: false,
          message: "Le nom doit contenir au moins 2 caractères",
        });
      }

      if (prenom !== undefined && (!prenom || prenom.trim().length < 2)) {
        return res.status(400).json({
          status: false,
          message: "Le prénom doit contenir au moins 2 caractères",
        });
      }

      if (date_naissance !== undefined) {
        const birthDate = new Date(date_naissance);
        if (isNaN(birthDate.getTime())) {
          return res.status(400).json({
            status: false,
            message: "Format de date invalide",
          });
        }

        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const moisDiff = today.getMonth() - birthDate.getMonth();
        if (
          moisDiff < 0 ||
          (moisDiff === 0 && today.getDate() < birthDate.getDate())
        ) {
          age--;
        }

        if (age < 3 || age > 25) {
          return res.status(400).json({
            status: false,
            message: "L'âge doit être entre 3 et 25 ans",
          });
        }
      }

      // Vérifier que la classe existe si elle est mise à jour
      if (classe_id && classe_id !== currentData.classe_id) {
        const classeRef = db.collection("classes").doc(classe_id);
        const classeDoc = await classeRef.get();
        if (!classeDoc.exists) {
          return res.status(400).json({
            status: false,
            message: "La classe spécifiée n'existe pas",
          });
        }
      }

      // Vérifier que la bourse existe si elle est mise à jour
      if (bourse_id !== undefined && bourse_id !== currentData.bourse_id) {
        if (bourse_id) {
          const bourseRef = db.collection("bourses").doc(bourse_id);
          const bourseDoc = await bourseRef.get();
          if (!bourseDoc.exists) {
            return res.status(400).json({
              status: false,
              message: "La bourse spécifiée n'existe pas",
            });
          }
        }
      }

      // Vérifier l'unicité si le nom/prénom/date changent
      if (
        (nom && nom !== currentData.nom) ||
        (prenom && prenom !== currentData.prenom) ||
        (date_naissance && date_naissance !== currentData.date_naissance)
      ) {
        const searchNom = nom || currentData.nom;
        const searchPrenom = prenom || currentData.prenom;
        const searchDate = date_naissance || currentData.date_naissance;

        const existingStudent = await this.collection
          .where("nom", "==", searchNom.trim())
          .where("prenom", "==", searchPrenom.trim())
          .where("date_naissance", "==", searchDate)
          .get();

        // Vérifier qu'il n'y a pas d'autre étudiant avec ces informations
        const hasConflict = existingStudent.docs.some((doc) => doc.id !== id);
        if (hasConflict) {
          return res.status(409).json({
            status: false,
            message: "Un autre étudiant avec ces informations existe déjà",
          });
        }
      }

      // Préparer les données de mise à jour
      const updateData = {
        updatedAt: new Date(),
      };

      if (nom !== undefined) {
        updateData.nom = nom.trim();
      }

      if (prenom !== undefined) {
        updateData.prenom = prenom.trim();
      }

      if (date_naissance !== undefined) {
        updateData.date_naissance = date_naissance;
      }

      if (classe_id !== undefined) {
        updateData.classe_id = classe_id;
      }

      if (nationalite !== undefined) {
        updateData.nationalite = nationalite.trim();
      }

      if (bourse_id !== undefined) {
        updateData.bourse_id = bourse_id;
      }
      if (exemptions !== undefined) {
        updateData.exemptions = encrypt(JSON.stringify(exemptions));
      }
      if (parentId !== undefined) {
        updateData.parentId = encrypt(parentId);
      }
      if (code_massar !== undefined) {
        // Check for uniqueness if code_massar is being updated
        if (code_massar && code_massar !== currentData.code_massar) {
          const existingMassar = await db.collection("etudiants").where("code_massar", "==", code_massar).get();
          if (!existingMassar.empty) {
            return res.status(409).json({
              status: false,
              message: "Un autre étudiant avec ce code Massar existe déjà."
            });
          }
        }
        updateData.code_massar = code_massar;
      }
      if (paymentPlanId !== undefined) {
        updateData.paymentPlanId = paymentPlanId;
      }
      if (paymentOverride !== undefined) {
        updateData.paymentOverride = paymentOverride;
      }
      if (overdueNotificationsMutedUntil !== undefined) {
        updateData.overdueNotificationsMutedUntil = overdueNotificationsMutedUntil;
      }

      // Recalculer frais_payment si bourse_id ou classe_id change
      if (bourse_id !== undefined || classe_id !== undefined) {
        let fraisPayment = 0;
        
        // Récupérer les frais globaux pour l'année scolaire actuelle
        const currentYear = new Date().getFullYear();
        const academicYear = `${currentYear}-${currentYear + 1}`;
        
        // Récupérer les frais d'inscription (type "Scolarité" avec nom "Frais Inscription")
        const fraisInscriptionSnapshot = await db
          .collection("tarifs")
          .where("annee_scolaire", "==", academicYear)
          .where("isActive", "==", true)
          .where("type", "==", "Scolarité")
          .where("nom", "==", "Frais Inscription")
          .get();

        // Récupérer les frais de scolarité (type "Scolarité" avec nom "Frais scolaire")
        const fraisScolariteSnapshot = await db
          .collection("tarifs")
          .where("annee_scolaire", "==", academicYear)
          .where("isActive", "==", true)
          .where("type", "==", "Scolarité")
          .where("nom", "==", "Frais scolaire")
          .get();

        // Calculer le total des frais
        if (!fraisInscriptionSnapshot.empty) {
          fraisPayment += fraisInscriptionSnapshot.docs[0].data().montant || 0;
        }
        
        if (!fraisScolariteSnapshot.empty) {
          fraisPayment += fraisScolariteSnapshot.docs[0].data().montant || 0;
        }

        // Appliquer la réduction de bourse si l'étudiant a une bourse
        const finalBourseId = bourse_id !== undefined ? bourse_id : currentData.bourse_id;
        if (finalBourseId && finalBourseId.trim() !== "") {
          const bourseDoc = await db.collection("bourses").doc(finalBourseId).get();
          if (bourseDoc.exists) {
            const bourseData = bourseDoc.data();
            if (bourseData.pourcentage_remise) {
              // Réduction en pourcentage
              fraisPayment = fraisPayment * (1 - bourseData.pourcentage_remise / 100);
            } else if (bourseData.montant_remise) {
              // Réduction en montant fixe
              fraisPayment = Math.max(0, fraisPayment - bourseData.montant_remise);
            }
          }
        }

        updateData.frais_payment = fraisPayment;
      }

      // Mettre à jour l'étudiant
      await etudiantRef.update(updateData);

      // Récupérer l'étudiant mis à jour
      const updatedEtudiant = await etudiantRef.get();

      // Audit log
      const auditLog = new AuditLog({
        userId: req.user?.id || "system",
        action: "UPDATE_ETUDIANT",
        entityType: "Etudiant",
        entityId: id,
        details: { oldData: oldEtudiantData, newData: updatedEtudiant.data() },
      });
      await auditLog.save();

      // Send webhook notification
      await sendWebhook("student.updated", {
        studentId: id,
        oldData: oldEtudiantData,
        newData: updatedEtudiant.data(),
      });

      return res.status(200).json({
        status: true,
        message: "Étudiant mis à jour avec succès",
        data: {
          id: updatedEtudiant.id,
          ...updatedEtudiant.data(),
        },
      });
    } catch (error) {
      console.error("Erreur lors de la mise à jour de l'étudiant:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la mise à jour de l'étudiant",
        error: error.message,
      });
    }
  }

  /**
   * Lier un parent à un étudiant
   * POST /etudiants/:id/link-parent
   */
  async linkParent(req, res) {
    try {
      const { id } = req.params;
      const { parentId } = req.body;

      if (!parentId) {
        return res.status(400).json({
          status: false,
          message: "ID du parent requis"
        });
      }

      // Vérifier que l'étudiant existe
      const etudiantDoc = await this.collection.doc(id).get();
      if (!etudiantDoc.exists) {
        return res.status(404).json({
          status: false,
          message: "Étudiant non trouvé"
        });
      }

      // Vérifier que le parent existe
      const parentDoc = await db.collection("parents").doc(parentId).get();
      if (!parentDoc.exists) {
        return res.status(404).json({
          status: false,
          message: "Parent non trouvé"
        });
      }

      const etudiantData = etudiantDoc.data();
      const parentData = parentDoc.data();

      // Vérifier si déjà lié
      if (etudiantData.parentId === encrypt(parentId)) {
        return res.status(200).json({
          status: true,
          message: "Parent et étudiant déjà liés",
          data: {
            etudiant: {
              id: etudiantDoc.id,
              nom: etudiantData.nom,
              prenom: etudiantData.prenom
            },
            parent: {
              id: parentDoc.id,
              nom: parentData.nom,
              prenom: parentData.prenom
            }
          }
        });
      }

      // Mettre à jour l'étudiant avec l'ID du parent
      await this.collection.doc(id).update({
        parentId: encrypt(parentId),
        updatedAt: new Date()
      });

      // Mettre à jour le parent avec l'ID de l'étudiant
      await db.collection("parents").doc(parentId).update({
        etudiant_id: id,
        updatedAt: new Date()
      });

      // Audit log
      const auditLog = new AuditLog({
        userId: req.user?.id || 'system',
        action: 'LINK_PARENT_STUDENT',
        entityType: 'Etudiant',
        entityId: id,
        details: { 
          parentId,
          etudiantId: id,
          parentName: `${parentData.prenom} ${parentData.nom}`,
          studentName: `${etudiantData.prenom} ${etudiantData.nom}`
        },
      });
      await auditLog.save();

      return res.status(200).json({
        status: true,
        message: "Parent lié à l'étudiant avec succès",
        data: {
          etudiant: {
            id: etudiantDoc.id,
            nom: etudiantData.nom,
            prenom: etudiantData.prenom,
            parentId: parentId
          },
          parent: {
            id: parentDoc.id,
            nom: parentData.nom,
            prenom: parentData.prenom,
            etudiant_id: id
          }
        }
      });

    } catch (error) {
      console.error("Error linking parent to student:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la liaison parent-étudiant"
      });
    }
  }

  /**
   * Obtenir les informations du parent d'un étudiant
   * GET /etudiants/:id/parent
   */
  async getStudentParent(req, res) {
    try {
      const { id } = req.params;

      // Récupérer l'étudiant
      const etudiantDoc = await this.collection.doc(id).get();
      if (!etudiantDoc.exists) {
        return res.status(404).json({
          status: false,
          message: "Étudiant non trouvé"
        });
      }

      const etudiantData = etudiantDoc.data();

      if (!etudiantData.parentId) {
        return res.status(404).json({
          status: false,
          message: "Aucun parent assigné à cet étudiant"
        });
      }

      // Récupérer le parent
      const parentId = decrypt(etudiantData.parentId);
      const parentDoc = await db.collection("parents").doc(parentId).get();
      if (!parentDoc.exists) {
        return res.status(404).json({
          status: false,
          message: "Parent assigné non trouvé"
        });
      }

      const parentData = parentDoc.data();

      // Décrypter les données sensibles du parent
      const decryptedParent = {
        id: parentDoc.id,
        nom: parentData.nom,
        prenom: parentData.prenom,
        email: parentData.email,
        telephone: parentData.telephone ? decrypt(parentData.telephone) : null,
        adresse: parentData.adresse ? decrypt(parentData.adresse) : null,
        userId: parentData.userId,
        createdAt: parentData.createdAt,
        updatedAt: parentData.updatedAt
      };

      return res.status(200).json({
        status: true,
        data: decryptedParent
      });

    } catch (error) {
      console.error("Error getting student parent:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la récupération du parent"
      });
    }
  }

  /**
   * Dissocier un parent d'un étudiant
   * DELETE /etudiants/:id/unlink-parent
   */
  async unlinkParent(req, res) {
    try {
      const { id } = req.params;

      // Récupérer l'étudiant
      const etudiantDoc = await this.collection.doc(id).get();
      if (!etudiantDoc.exists) {
        return res.status(404).json({
          status: false,
          message: "Étudiant non trouvé"
        });
      }

      const etudiantData = etudiantDoc.data();

      if (!etudiantData.parentId) {
        return res.status(400).json({
          status: false,
          message: "Aucun parent assigné à cet étudiant"
        });
      }

      const parentId = decrypt(etudiantData.parentId);

      // Mettre à jour l'étudiant pour retirer l'ID du parent
      await this.collection.doc(id).update({
        parentId: null,
        updatedAt: new Date()
      });

      // Mettre à jour le parent pour retirer l'ID de l'étudiant
      await db.collection("parents").doc(parentId).update({
        etudiant_id: null,
        updatedAt: new Date()
      });

      // Audit log
      const auditLog = new AuditLog({
        userId: req.user?.id || 'system',
        action: 'UNLINK_PARENT_STUDENT',
        entityType: 'Etudiant',
        entityId: id,
        details: { 
          parentId,
          etudiantId: id
        },
      });
      await auditLog.save();

      return res.status(200).json({
        status: true,
        message: "Parent dissocié de l'étudiant avec succès"
      });

    } catch (error) {
      console.error("Error unlinking parent from student:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la dissociation parent-étudiant"
      });
    }
  }

  /**
   * Supprimer un étudiant
   * DELETE /etudiants/:id
   */
  async delete(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          status: false,
          message: "ID de l'étudiant requis",
        });
      }

      // Vérifier si l'étudiant existe
      const etudiantRef = this.collection.doc(id);
      const etudiantDoc = await etudiantRef.get();

      if (!etudiantDoc.exists) {
        return res.status(404).json({
          status: false,
          message: "Étudiant non trouvé",
        });
      }

      const deletedEtudiantData = etudiantDoc.data(); // Get data before deletion for audit log

      // Vérifier si l'étudiant a des factures
      const facturesRef = db.collection("factures");
      const facturesSnapshot = await facturesRef
        .where("student_id", "==", id)
        .get();

      if (!facturesSnapshot.empty) {
        return res.status(400).json({
          status: false,
          message:
            "Impossible de supprimer cet étudiant car il a des factures associées",
        });
      }

      // Vérifier si l'étudiant a des échéanciers
      const echeanciersRef = db.collection("echeanciers");
      const echeanciersSnapshot = await echeanciersRef
        .where("student_id", "==", id)
        .get();

      if (!echeanciersSnapshot.empty) {
        return res.status(400).json({
          status: false,
          message:
            "Impossible de supprimer cet étudiant car il a des échéanciers associés",
        });
      }

      // Supprimer l'étudiant
      await etudiantRef.delete();

      // Audit log
      const auditLog = new AuditLog({
        userId: req.user?.id || "system",
        action: "DELETE_ETUDIANT",
        entityType: "Etudiant",
        entityId: id,
        details: { deletedEtudiantData },
      });
      await auditLog.save();

      // Send webhook notification
      await sendWebhook("student.deleted", {
        studentId: id,
        deletedEtudiantData,
      });

      return res.status(200).json({
        status: true,
        message: "Étudiant supprimé avec succès",
      });
    } catch (error) {
      console.error("Erreur lors de la suppression de l'étudiant:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la suppression de l'étudiant",
        error: error.message,
      });
    }
  }

  // Nouvelle méthode pour calculer le statut d'avertissement de paiement
  async getPaymentStatus(studentId, currentYear) {
    const etudiantDoc = await this.collection.doc(studentId).get();
    if (!etudiantDoc.exists) {
      return {
        totalMontantDu: 0,
        totalPaid: 0,
        remainingAmount: 0,
        paymentWarningStatus: "Étudiant non trouvé",
        isOverdue: false,
        expectedPaidPercentage: 0,
      };
    }
    const etudiantData = etudiantDoc.data();

    // Check for payment override
    if (etudiantData.paymentOverride) {
      const mutedUntil = etudiantData.overdueNotificationsMutedUntil ? new Date(etudiantData.overdueNotificationsMutedUntil) : null;
      if (!mutedUntil || mutedUntil > new Date()) {
        return {
          totalMontantDu: 0,
          totalPaid: 0,
          remainingAmount: 0,
          paymentWarningStatus: "Paiement ignoré par comptable",
          isOverdue: false,
          expectedPaidPercentage: 0,
        };
      }
    }

    // Define default payment plan (if no specific plan assigned to student)
    const defaultPaymentPlan = {
      installments: [
        { percentage: 15, dueDateOffsetMonths: 0, description: "1ère tranche (Octobre)" }, // Oct
        { percentage: 35, dueDateOffsetMonths: 4, description: "2ème tranche (Février)" }, // Feb (15+35=50%)
        { percentage: 50, dueDateOffsetMonths: 8, description: "Solde (Juin)" },    // June (50+50=100%)
      ],
    };

    let paymentPlan = defaultPaymentPlan;
    if (etudiantData.paymentPlanId) {
      const planDoc = await this.paymentPlansCollection.doc(etudiantData.paymentPlanId).get();
      if (planDoc.exists) {
        paymentPlan = { ...planDoc.data(), id: planDoc.id };
      }
    }

    // Calculate total amount due (using the annual fee logic for simplicity for now)
    let totalMontantDu = etudiantData.montant_tarif || 0; // Assuming montant_tarif is the annual fee

    // If montant_tarif is not directly available, fallback to fixed values or a default calculation
    if (totalMontantDu === 0) {
      const annualSchoolFees = 59000;
      const annualRegistrationFees = 1800;
      totalMontantDu = annualSchoolFees + annualRegistrationFees;
    }

    if (etudiantData.bourse_id) {
      const bourseDoc = await this.boursesCollection
        .doc(etudiantData.bourse_id)
        .get();
      if (bourseDoc.exists) {
        const bourseData = bourseDoc.data();
        totalMontantDu -= bourseData.montant; // Deduct scholarship
      }
    }

    // Calculate total paid for the current academic year
    // Tenter de récupérer les paiements pour l'année courante (format "YYYY")
    let paymentsSnapshot = await this.paiementCollection
      .where("etudiant_id", "==", studentId)
      .where("anneeScolaire", "==", currentYear.toString())
      .get();

    // If no results, fallback on academic year formats "YYYY-YYYY" (Oct-Sept)
    if (paymentsSnapshot.empty) {
      const academicYearStart = new Date(`${currentYear}-10-01`); // Academic year starts in October
      const academicYearEnd = new Date(`${currentYear + 1}-09-30`); // Ends next September
      paymentsSnapshot = await this.paiementCollection
        .where("etudiant_id", "==", studentId)
        .where("date", ">=", academicYearStart.toISOString())
        .where("date", "<=", academicYearEnd.toISOString())
        .get()
        .catch(() => ({ empty: true, docs: [] }));
    }

    let totalPaid = 0;
    paymentsSnapshot.docs.forEach((doc) => {
      totalPaid += doc.data().montantPaye || 0;
    });

    const remainingAmount = Math.max(0, totalMontantDu - totalPaid);

    let paymentWarningStatus = "OK";
    let isOverdue = false;
    let expectedPaidPercentage = 0;

    const today = new Date();
    const academicYearStartDate = new Date(`${currentYear}-10-01`); // Assuming academic year starts in October

    // Calculate expected paid percentage based on current date and payment plan
    for (const inst of paymentPlan.installments) {
      const dueDate = new Date(academicYearStartDate);
      dueDate.setMonth(academicYearStartDate.getMonth() + inst.dueDateOffsetMonths);

      if (today >= dueDate) {
        expectedPaidPercentage += inst.percentage;
      }
    }

    const expectedPaidAmount = totalMontantDu * (expectedPaidPercentage / 100);

    if (remainingAmount <= 0) {
      paymentWarningStatus = "Payée";
      isOverdue = false;
    } else if (totalPaid < expectedPaidAmount) {
      paymentWarningStatus = `Avertissement: ${expectedPaidPercentage}% dû non atteint.`;
      isOverdue = true;
    }

    return {
      totalMontantDu,
      totalPaid,
      remainingAmount,
      paymentWarningStatus,
      isOverdue,
      expectedPaidPercentage,
    };
  }

  /**
   * Rechercher des étudiants
   * GET /etudiants/search?q=terme
   */
  async search(req, res) {
    try {
      const { q, classe_id, nationalite } = req.query;

      if (!q || q.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Terme de recherche requis",
        });
      }

      const searchTerm = q.trim();
      let query = this.collection;

      // Recherche par nom ou prénom
      if (searchTerm.length >= 2) {
        query = query
          .where("nom", ">=", searchTerm)
          .where("nom", "<=", searchTerm + "\uf8ff");
      }

      // Filtres additionnels
      if (classe_id) {
        query = query.where("classe_id", "==", classe_id);
      }

      if (nationalite) {
        query = query.where("nationalite", "==", nationalite);
      }

      const snapshot = await query.limit(20).get();

      const etudiants = [];

      // Récupérer les données avec relations
      for (const doc of snapshot.docs) {
        const etudiantData = doc.data();

        // Récupérer les informations de la classe
        let classeInfo = null;
        if (etudiantData.classe_id) {
          const classeDoc = await db
            .collection("classes")
            .doc(etudiantData.classe_id)
            .get();
          if (classeDoc.exists) {
            classeInfo = { id: classeDoc.id, ...classeDoc.data() };
          }
        }

        etudiants.push({
          id: doc.id,
          ...etudiantData,
          classe: classeInfo,
        });
      }

      return res.status(200).json({
        status: true,
        data: etudiants,
        searchTerm,
        count: etudiants.length,
      });
    } catch (error) {
      console.error("Erreur lors de la recherche des étudiants:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la recherche des étudiants",
        error: error.message,
      });
    }
  }

  /**
   * Obtenir les statistiques des étudiants
   * GET /etudiants/stats
   */
  async getStats(req, res) {
    try {
      const { classe_id, nationalite } = req.query;

      let query = this.collection;

      // Appliquer les filtres si spécifiés
      if (classe_id) {
        query = query.where("classe_id", "==", classe_id);
      }

      if (nationalite) {
        query = query.where("nationalite", "==", nationalite);
      }

      const snapshot = await query.get();
      const etudiants = snapshot.docs.map((doc) => doc.data());

      // Calculer les statistiques
      const stats = {
        total: etudiants.length,
        parClasse: {},
        parNationalite: {},
        avecBourse: 0,
        sansBourse: 0,
        moyenneAge: 0,
      };

      let totalAge = 0;
      let validAges = 0;

      etudiants.forEach((etudiant) => {
        // Statistiques par classe
        if (etudiant.classe_id) {
          stats.parClasse[etudiant.classe_id] =
            (stats.parClasse[etudiant.classe_id] || 0) + 1;
        }

        // Statistiques par nationalité
        if (etudiant.nationalite) {
          stats.parNationalite[etudiant.nationalite] =
            (stats.parNationalite[etudiant.nationalite] || 0) + 1;
        }

        // Statistiques des bourses
        if (etudiant.bourse_id) {
          stats.avecBourse++;
        } else {
          stats.sansBourse++;
        }

        // Calcul de l'âge moyen
        if (etudiant.date_naissance) {
          const birthDate = new Date(etudiant.date_naissance);
          const today = new Date();
          let age = today.getFullYear() - birthDate.getFullYear();
          const moisDiff = today.getMonth() - birthDate.getMonth();
          if (!isNaN(age) && age > 0 && age < 100 && moisDiff >= 0) {
            totalAge += age;
            validAges++;
          }
        }
      });

      stats.moyenneAge = validAges > 0 ? Math.round(totalAge / validAges) : 0;

      return res.status(200).json({
        status: true,
        data: stats,
      });
    } catch (error) {
      console.error("Erreur lors de la récupération des statistiques:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la récupération des statistiques",
        error: error.message,
      });
    }
  }

  /**
   * Recalculer les frais_payment pour tous les étudiants
   * POST /etudiants/recalculate-fees
   */
  async recalculateFees(req, res) {
    try {
      // Seuls admin et comptable peuvent utiliser cette route
      if (
        !req.user ||
        (req.user.role !== "admin" && req.user.role !== "comptable")
      ) {
        return res.status(403).json({
          status: false,
          message: "Non autorisé",
        });
      }

      const currentYear = new Date().getFullYear();
      const academicYear = `${currentYear}-${currentYear + 1}`;
      
      // Récupérer les frais globaux
      const fraisInscriptionSnapshot = await db
        .collection("tarifs")
        .where("annee_scolaire", "==", academicYear)
        .where("isActive", "==", true)
        .where("type", "==", "Scolarité")
        .where("nom", "==", "Frais Inscription")
        .get();

      const fraisScolariteSnapshot = await db
        .collection("tarifs")
        .where("annee_scolaire", "==", academicYear)
        .where("isActive", "==", true)
        .where("type", "==", "Scolarité")
        .where("nom", "==", "Frais scolaire")
        .get();

      let fraisGlobaux = 0;
      if (!fraisInscriptionSnapshot.empty) {
        fraisGlobaux += fraisInscriptionSnapshot.docs[0].data().montant || 0;
      }
      
      if (!fraisScolariteSnapshot.empty) {
        fraisGlobaux += fraisScolariteSnapshot.docs[0].data().montant || 0;
      }

      // Récupérer tous les étudiants
      const etudiantsSnapshot = await this.collection.get();
      let updatedCount = 0;
      let errorCount = 0;

      for (const doc of etudiantsSnapshot.docs) {
        try {
          const etudiantData = doc.data();
          let fraisPayment = fraisGlobaux;

          // Appliquer la réduction de bourse si l'étudiant a une bourse
          if (etudiantData.bourse_id && etudiantData.bourse_id.trim() !== "") {
            const bourseDoc = await db.collection("bourses").doc(etudiantData.bourse_id).get();
            if (bourseDoc.exists) {
              const bourseData = bourseDoc.data();
              if (bourseData.pourcentage_remise) {
                // Réduction en pourcentage
                fraisPayment = fraisPayment * (1 - bourseData.pourcentage_remise / 100);
              } else if (bourseData.montant_remise) {
                // Réduction en montant fixe
                fraisPayment = Math.max(0, fraisPayment - bourseData.montant_remise);
              }
            }
          }

          // Mettre à jour l'étudiant
          await doc.ref.update({
            frais_payment: fraisPayment,
            updatedAt: new Date(),
          });

          updatedCount++;
        } catch (error) {
          console.error(`Erreur lors de la mise à jour de l'étudiant ${doc.id}:`, error);
          errorCount++;
        }
      }

      return res.status(200).json({
        status: true,
        message: `Recalcul terminé. ${updatedCount} étudiants mis à jour, ${errorCount} erreurs.`,
        data: {
          updatedCount,
          errorCount,
          totalStudents: etudiantsSnapshot.size,
          fraisGlobaux,
          academicYear,
        },
      });
    } catch (error) {
      console.error("Erreur lors du recalcul des frais:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors du recalcul des frais",
        error: error.message,
      });
    }
  }

  /**
   * Obtenir les étudiants par classe
   * GET /etudiants/classe/:classe_id
   */
  async getByClasse(req, res) {
    try {
      const { classe_id } = req.params;
      const { page = 1, limit = 20 } = req.query;
      const pageNumber = parseInt(page);
      const limitNumber = parseInt(limit);

      if (!classe_id) {
        return res.status(400).json({
          status: false,
          message: "ID de la classe requis",
        });
      }

      // Vérifier que la classe existe
      const classeRef = db.collection("classes").doc(classe_id);
      const classeDoc = await classeRef.get();
      if (!classeDoc.exists) {
        return res.status(404).json({
          status: false,
          message: "Classe non trouvée",
        });
      }

      // Récupérer les étudiants de cette classe
      const snapshot = await this.collection
        .where("classe_id", "==", classe_id)
        .orderBy("nom")
        .orderBy("prenom")
        .limit(limitNumber)
        .offset((pageNumber - 1) * limitNumber)
        .get();

      const etudiants = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // Compter le total
      const totalSnapshot = await this.collection
        .where("classe_id", "==", classe_id)
        .get();
      const total = totalSnapshot.size;

      return res.status(200).json({
        status: true,
        data: etudiants,
        classe: { id: classeDoc.id, ...classeDoc.data() },
        pagination: {
          page: pageNumber,
          limit: limitNumber,
          total,
          totalPages: Math.ceil(total / limitNumber),
        },
      });
    } catch (error) {
      console.error(
        "Erreur lors de la récupération des étudiants par classe:",
        error
      );
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la récupération des étudiants par classe",
        error: error.message,
      });
    }
  }
}

module.exports = new EtudiantController();
