const db = require("../../../config/firebase");
const { decrypt } = require("../../../utils/encryption");

class StudentPortalController {
  constructor() {
    this.etudiantsCollection = db.collection("etudiants");
    this.paiementsCollection = db.collection("paiements");
    this.facturesCollection = db.collection("factures");
    this.boursesCollection = db.collection("bourses");
    this.tarifsCollection = db.collection("tarifs");
    this.classesCollection = db.collection("classes");
  }

  /**
   * Obtenir le tableau de bord de l'étudiant
   * GET /etudiants/portal/dashboard
   */
  async getStudentDashboard(req, res) {
    try {
      const userId = req.user.id; // ID de l'utilisateur connecté
      const userRole = req.user.role; // Rôle de l'utilisateur connecté
      
      let etudiantSnapshot;
      
      if (userRole === "parent") {
        // Pour un parent, trouver l'étudiant lié via etudiant_id dans le profil parent
        const usersCollection = db.collection("users");
        const parentDoc = await usersCollection.doc(userId).get();
        
        if (!parentDoc.exists) {
          return res.status(404).json({
            status: false,
            message: "Parent non trouvé"
          });
        }
        
        const parentData = parentDoc.data();
        const etudiantId = parentData.etudiant_id;
        
        if (!etudiantId) {
          return res.status(404).json({
            status: false,
            message: "Aucun étudiant lié à ce parent"
          });
        }
        
        // Récupérer l'étudiant lié directement par son ID de document
        const etudiantDoc = await this.etudiantsCollection.doc(etudiantId).get();
        if (!etudiantDoc.exists) {
          return res.status(404).json({
            status: false,
            message: "Étudiant lié non trouvé"
          });
        }
        
        etudiantSnapshot = { docs: [etudiantDoc] };
      } else {
        // Pour un étudiant, trouver l'étudiant correspondant à cet utilisateur
        etudiantSnapshot = await this.etudiantsCollection
          .where("user_id", "==", userId)
          .get();
      }

      if (etudiantSnapshot.empty) {
        return res.status(404).json({
          status: false,
          message: "Étudiant non trouvé pour cet utilisateur"
        });
      }

      const etudiantDoc = etudiantSnapshot.docs[0];
      const etudiantData = etudiantDoc.data();
      const etudiantId = etudiantDoc.id;

      // Récupérer les informations de la classe
      let classeInfo = null;
      if (etudiantData.classe_id) {
        const classeDoc = await this.classesCollection.doc(etudiantData.classe_id).get();
        if (classeDoc.exists) {
          classeInfo = { id: classeDoc.id, ...classeDoc.data() };
        }
      }

      // Récupérer les informations de la bourse
      let bourseInfo = null;
      if (etudiantData.bourse_id) {
        const bourseDoc = await this.boursesCollection.doc(etudiantData.bourse_id).get();
        if (bourseDoc.exists) {
          bourseInfo = { id: bourseDoc.id, ...bourseDoc.data() };
        }
      }

      // Calculer les frais totaux pour l'année courante
      const currentYear = new Date().getFullYear();
      const academicYear = `${currentYear}-${currentYear + 1}`;
      
      // Récupérer les tarifs pour l'année scolaire
      const tarifsSnapshot = await this.tarifsCollection
        .where("annee_scolaire", "==", academicYear)
        .where("isActive", "==", true)
        .get();

      let fraisTotal = 0;
      const tarifs = [];
      tarifsSnapshot.docs.forEach(doc => {
        const tarif = { id: doc.id, ...doc.data() };
        tarifs.push(tarif);
        fraisTotal += tarif.montant || 0;
      });

      // Appliquer la réduction de bourse si applicable
      let reductionBourse = 0;
      if (bourseInfo) {
        if (bourseInfo.isExempt) {
          reductionBourse = fraisTotal; // Exonération totale
        } else if (bourseInfo.pourcentage_remise) {
          reductionBourse = (fraisTotal * bourseInfo.pourcentage_remise) / 100;
        } else if (bourseInfo.montant_remise) {
          reductionBourse = bourseInfo.montant_remise;
        }
      }

      const fraisAvecReduction = Math.max(0, fraisTotal - reductionBourse);

      // Récupérer tous les paiements de l'étudiant
      let paiementsSnapshot = await this.paiementsCollection
        .where("etudiant_id", "==", etudiantId)
        .orderBy("date", "desc")
        .get();

      // Si aucun paiement trouvé, essayer avec l'ID standard
      if (paiementsSnapshot.docs.length === 0) {
        const stdId = `std-${etudiantData.prenom?.toLowerCase()}-${etudiantData.nom?.toLowerCase()}`;
        console.log("🔍 Dashboard - Essai avec ID standard:", stdId);
        
        try {
          paiementsSnapshot = await this.paiementsCollection
            .where("etudiant_id", "==", stdId)
            .orderBy("date", "desc")
            .get();
        } catch (orderByError) {
          // Si orderBy échoue, essayer sans orderBy
          paiementsSnapshot = await this.paiementsCollection
            .where("etudiant_id", "==", stdId)
            .get();
        }
      }

      const paiements = [];
      let totalPaye = 0;

      paiementsSnapshot.docs.forEach(doc => {
        const paiement = { id: doc.id, ...doc.data() };
        paiements.push(paiement);
        totalPaye += paiement.montantPaye || 0;
      });

      // Calculer le montant restant
      const montantRestant = Math.max(0, fraisAvecReduction - totalPaye);

      // Récupérer les factures de l'étudiant
      let facturesSnapshot = await this.facturesCollection
        .where("etudiant_id", "==", etudiantId)
        .orderBy("date_emission", "desc")
        .get();

      // Si aucune facture trouvée, essayer avec l'ID standard
      if (facturesSnapshot.docs.length === 0) {
        const stdId = `std-${etudiantData.prenom?.toLowerCase()}-${etudiantData.nom?.toLowerCase()}`;
        console.log("🔍 Dashboard - Factures - Essai avec ID standard:", stdId);
        
        try {
          facturesSnapshot = await this.facturesCollection
            .where("etudiant_id", "==", stdId)
            .orderBy("date_emission", "desc")
            .get();
        } catch (orderByError) {
          // Si orderBy échoue, essayer sans orderBy
          facturesSnapshot = await this.facturesCollection
            .where("etudiant_id", "==", stdId)
            .get();
        }
      }

      const factures = [];
      facturesSnapshot.docs.forEach(doc => {
        const facture = { id: doc.id, ...doc.data() };
        factures.push(facture);
      });

      // Calculer le statut de paiement
      let statutPaiement = "À jour";
      if (montantRestant > 0) {
        statutPaiement = "En retard";
      }

      // Déchiffrer les champs sensibles
      let telephoneDecrypted = etudiantData.telephone;
      let adresseDecrypted = etudiantData.adresse;
      
      try {
        if (etudiantData.telephone) {
          telephoneDecrypted = decrypt(etudiantData.telephone);
        }
        if (etudiantData.adresse) {
          adresseDecrypted = decrypt(etudiantData.adresse);
        }
      } catch (decryptError) {
        console.log("⚠️ Erreur lors du déchiffrement des données sensibles:", decryptError.message);
        // Continuer avec les données chiffrées si le déchiffrement échoue
      }

      // Préparer la réponse
      const dashboard = {
        etudiant: {
          id: etudiantId,
          nom: etudiantData.nom,
          prenom: etudiantData.prenom,
          email: etudiantData.email,
          telephone: telephoneDecrypted,
          adresse: adresseDecrypted,
          classe: classeInfo,
          bourse: bourseInfo
        },
        frais: {
          total: fraisTotal,
          reductionBourse: reductionBourse,
          totalAvecReduction: fraisAvecReduction,
          totalPaye: totalPaye,
          montantRestant: montantRestant,
          statut: statutPaiement
        },
        paiements: paiements,
        factures: factures,
        tarifs: tarifs,
        anneeScolaire: academicYear
      };

      return res.status(200).json({
        status: true,
        message: "Tableau de bord récupéré avec succès",
        data: dashboard
      });

    } catch (error) {
      console.error("Erreur lors de la récupération du tableau de bord:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la récupération du tableau de bord",
        error: error.message
      });
    }
  }

  /**
   * Obtenir l'historique des paiements de l'étudiant
   * GET /etudiants/portal/payments
   */
  async getStudentPayments(req, res) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      console.log("🔍 getStudentPayments - User ID:", userId, "Role:", userRole);
      
      let etudiantId, etudiantData;
      
      if (userRole === "parent") {
        // Pour un parent, trouver l'étudiant lié
        const usersCollection = db.collection("users");
        const parentDoc = await usersCollection.doc(userId).get();
        
        if (!parentDoc.exists) {
          return res.status(404).json({
            status: false,
            message: "Parent non trouvé"
          });
        }
        
        const parentData = parentDoc.data();
        const linkedEtudiantId = parentData.etudiant_id;
        
        if (!linkedEtudiantId) {
          return res.status(404).json({
            status: false,
            message: "Aucun étudiant lié à ce parent"
          });
        }
        
        const etudiantDoc = await this.etudiantsCollection.doc(linkedEtudiantId).get();
        if (!etudiantDoc.exists) {
          return res.status(404).json({
            status: false,
            message: "Étudiant lié non trouvé"
          });
        }
        
        etudiantId = etudiantDoc.id;
        etudiantData = etudiantDoc.data();
      } else {
        // Pour un étudiant, trouver l'étudiant correspondant à cet utilisateur
        const etudiantSnapshot = await this.etudiantsCollection
          .where("user_id", "==", userId)
          .get();

        if (etudiantSnapshot.empty) {
          console.log("❌ Aucun étudiant trouvé pour user_id:", userId);
          return res.status(404).json({
            status: false,
            message: "Étudiant non trouvé pour cet utilisateur"
          });
        }

        etudiantId = etudiantSnapshot.docs[0].id;
        etudiantData = etudiantSnapshot.docs[0].data();
      }
      console.log("✅ Étudiant trouvé - ID:", etudiantId, "Nom:", etudiantData.nom, etudiantData.prenom);

      // Récupérer les paiements avec pagination
      const { page = 1, limit = 10 } = req.query;
      const offset = (page - 1) * limit;

      // Récupérer les paiements
      let paiementsSnapshot = await this.paiementsCollection
        .where("etudiant_id", "==", etudiantId)
        .get();
        
      console.log("🔍 Paiements trouvés avec etudiant_id:", paiementsSnapshot.docs.length);
        
      // Si aucun paiement trouvé avec etudiant_id, essayer avec d'autres champs possibles
      if (paiementsSnapshot.docs.length === 0) {
        console.log("⚠️ Aucun paiement trouvé avec etudiant_id, essai avec d'autres méthodes...");
        
        // Essayer avec l'ID standard "std-fatima-zahra" (format utilisé dans les paiements)
        const stdId = `std-${etudiantData.prenom?.toLowerCase()}-${etudiantData.nom?.toLowerCase()}`;
        console.log("🔍 Essai avec ID standard:", stdId);
        
        const paiementsByStdId = await this.paiementsCollection
          .where("etudiant_id", "==", stdId)
          .get();
        
        console.log("🔍 Paiements trouvés avec ID standard:", paiementsByStdId.docs.length);
        if (paiementsByStdId.docs.length > 0) {
          paiementsSnapshot = paiementsByStdId;
        }
        // Essayer avec le nom de l'étudiant
        if (etudiantData.nom && etudiantData.prenom) {
          const nomComplet = `${etudiantData.prenom} ${etudiantData.nom}`;
          console.log("🔍 Recherche par nom complet:", nomComplet);
          
          const paiementsByName = await this.paiementsCollection
            .where("nom_etudiant", "==", nomComplet)
            .get();
          
          console.log("🔍 Paiements trouvés par nom:", paiementsByName.docs.length);
          if (paiementsByName.docs.length > 0) {
            paiementsSnapshot = paiementsByName;
          }
        }
        
        // Essayer avec l'email
        if (paiementsSnapshot.docs.length === 0 && etudiantData.email) {
          console.log("🔍 Recherche par email:", etudiantData.email);
          const paiementsByEmail = await this.paiementsCollection
            .where("email_etudiant", "==", etudiantData.email)
            .get();
          
          console.log("🔍 Paiements trouvés par email:", paiementsByEmail.docs.length);
          if (paiementsByEmail.docs.length > 0) {
            paiementsSnapshot = paiementsByEmail;
          }
        }
      }
      
      // Essayer de trier par date si on trouve des paiements
      if (paiementsSnapshot.docs.length > 0) {
        try {
          paiementsSnapshot = await this.paiementsCollection
            .where("etudiant_id", "==", etudiantId)
            .orderBy("date", "desc")
            .limit(parseInt(limit))
            .get();
        } catch (orderByError) {
          // Garder la requête simple si orderBy échoue
        }
      }

      const paiements = [];
      paiementsSnapshot.docs.forEach(doc => {
        const paiement = { id: doc.id, ...doc.data() };
        paiements.push(paiement);
      });

      console.log("✅ Total paiements à retourner:", paiements.length);

      // Compter le total des paiements
      const totalSnapshot = await this.paiementsCollection
        .where("etudiant_id", "==", etudiantId)
        .get();

      return res.status(200).json({
        status: true,
        message: "Paiements récupérés avec succès",
        data: {
          paiements: paiements,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: totalSnapshot.size,
            totalPages: Math.ceil(totalSnapshot.size / limit)
          }
        }
      });

    } catch (error) {
      console.error("Erreur lors de la récupération des paiements:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la récupération des paiements",
        error: error.message
      });
    }
  }

  /**
   * Obtenir les factures de l'étudiant
   * GET /etudiants/portal/invoices
   */
  async getStudentInvoices(req, res) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      
      let etudiantId;
      
      if (userRole === "parent") {
        // Pour un parent, trouver l'étudiant lié
        const usersCollection = db.collection("users");
        const parentDoc = await usersCollection.doc(userId).get();
        
        if (!parentDoc.exists) {
          return res.status(404).json({
            status: false,
            message: "Parent non trouvé"
          });
        }
        
        const parentData = parentDoc.data();
        const linkedEtudiantId = parentData.etudiant_id;
        
        if (!linkedEtudiantId) {
          return res.status(404).json({
            status: false,
            message: "Aucun étudiant lié à ce parent"
          });
        }
        
        const etudiantDoc = await this.etudiantsCollection.doc(linkedEtudiantId).get();
        if (!etudiantDoc.exists) {
          return res.status(404).json({
            status: false,
            message: "Étudiant lié non trouvé"
          });
        }
        
        etudiantId = etudiantDoc.id;
      } else {
        // Pour un étudiant, trouver l'étudiant correspondant à cet utilisateur
        const etudiantSnapshot = await this.etudiantsCollection
          .where("user_id", "==", userId)
          .get();

        if (etudiantSnapshot.empty) {
          return res.status(404).json({
            status: false,
            message: "Étudiant non trouvé pour cet utilisateur"
          });
        }
        
        etudiantId = etudiantSnapshot.docs[0].id;
      }

      // Récupérer les factures
      let facturesSnapshot = await this.facturesCollection
        .where("etudiant_id", "==", etudiantId)
        .orderBy("date_emission", "desc")
        .get();

      // Si aucune facture trouvée, essayer avec l'ID standard
      if (facturesSnapshot.docs.length === 0) {
        // Récupérer les données de l'étudiant pour construire l'ID standard
        const etudiantDoc = await this.etudiantsCollection.doc(etudiantId).get();
        if (etudiantDoc.exists) {
          const etudiantData = etudiantDoc.data();
          const stdId = `std-${etudiantData.prenom?.toLowerCase()}-${etudiantData.nom?.toLowerCase()}`;
          console.log("🔍 Invoices - Essai avec ID standard:", stdId);
          
          try {
            facturesSnapshot = await this.facturesCollection
              .where("etudiant_id", "==", stdId)
              .orderBy("date_emission", "desc")
              .get();
          } catch (orderByError) {
            // Si orderBy échoue, essayer sans orderBy
            facturesSnapshot = await this.facturesCollection
              .where("etudiant_id", "==", stdId)
              .get();
          }
        }
      }

      const factures = [];
      facturesSnapshot.docs.forEach(doc => {
        const facture = { id: doc.id, ...doc.data() };
        factures.push(facture);
      });

      return res.status(200).json({
        status: true,
        message: "Factures récupérées avec succès",
        data: factures
      });

    } catch (error) {
      console.error("Erreur lors de la récupération des factures:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la récupération des factures",
        error: error.message
      });
    }
  }
}

module.exports = new StudentPortalController();
