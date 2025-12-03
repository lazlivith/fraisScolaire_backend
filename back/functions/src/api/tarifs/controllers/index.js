const Tarif = require("../../../classes/Tarif");
const db = require("../../../config/firebase");
const AuditLog = require("../../../classes/AuditLog");
const { getCurrentAcademicYear } = require("../../../utils/dateUtils");
const { calculateScholarshipDiscount } = require("../../../utils/scholarshipUtils");

class TarifController {
  constructor() {
    this.collection = db.collection("tarifs");
  }

  /**
   * Calculer les frais totaux pour un étudiant
   * GET /tarifs/calculate/:etudiant_id
   */
  async calculateStudentFees(req, res) {
    try {
      const { etudiant_id } = req.params;
      const { annee_scolaire } = req.query;

      if (!etudiant_id) {
        return res.status(400).json({
          status: false,
          message: "ID de l'étudiant requis",
        });
      }

      // Récupérer les informations de l'étudiant
      const etudiantRef = db.collection("etudiants").doc(etudiant_id);
      const etudiantDoc = await etudiantRef.get();

      if (!etudiantDoc.exists) {
        return res.status(404).json({
          status: false,
          message: "Étudiant non trouvé",
        });
      }

      const etudiantData = etudiantDoc.data();
      const currentYear = annee_scolaire || getCurrentAcademicYear();

      // Récupérer les tarifs pour l'année scolaire
      const tarifsQuery = this.collection
        .where("annee_scolaire", "==", currentYear)
        .where("isActive", "==", true)
        .where("type", "in", ["Scolarité", "Inscription"]);

      const tarifsSnapshot = await tarifsQuery.get();
      const tarifs = tarifsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Calculer les frais de base
      let fraisInscription = 0;
      let fraisScolarite = 0;

      tarifs.forEach(tarif => {
        if (tarif.type === "Inscription") {
          fraisInscription = tarif.montant;
        } else if (tarif.type === "Scolarité") {
          fraisScolarite = tarif.montant;
        }
      });

      const fraisTotal = fraisInscription + fraisScolarite;

      // Vérifier si l'étudiant a une bourse
      let reductionBourse = 0;
      let bourseInfo = null;

      if (etudiantData.bourse_id) {
        const bourseRef = db.collection("bourses").doc(etudiantData.bourse_id);
        const bourseDoc = await bourseRef.get();

        if (bourseDoc.exists) {
          bourseInfo = bourseDoc.data();
          const tauxBourse = bourseInfo.taux || 0;
          reductionBourse = calculateScholarshipDiscount(fraisTotal, tauxBourse);
        }
      }

      const montantFinal = fraisTotal - reductionBourse;

      return res.status(200).json({
        status: true,
        data: {
          etudiant: {
            id: etudiant_id,
            nom: etudiantData.nom,
            prenom: etudiantData.prenom,
            bourse_id: etudiantData.bourse_id
          },
          annee_scolaire: currentYear,
          calcul: {
            frais_inscription: fraisInscription,
            frais_scolarite: fraisScolarite,
            frais_total: fraisTotal,
            reduction_bourse: reductionBourse,
            montant_final: montantFinal
          },
          bourse: bourseInfo ? {
            nom: bourseInfo.nom,
            taux: bourseInfo.taux,
            description: bourseInfo.description
          } : null
        }
      });

    } catch (error) {
      console.error("Erreur lors du calcul des frais:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors du calcul des frais",
        error: error.message,
      });
    }
  }

  /**
   * Créer un nouveau tarif
   * POST /tarifs
   */
  async create(req, res) {
    try {
      const { nom, classe_id, montant, annee_scolaire, nationalite, bourse_id, reductions, type } = req.body;

      // Validation des données obligatoires
      if (!nom || montant === undefined || !annee_scolaire || !type) {
        return res.status(400).json({
          status: false,
          message: "Nom, montant, année scolaire et type sont requis",
        });
      }

      if (typeof montant !== "number" || montant < 0) {
        return res.status(400).json({
          status: false,
          message: "Le montant doit être un nombre positif",
        });
      }

      // Check if an active tariff with the same criteria exists
      let existingTarifQuery = this.collection
        .where("annee_scolaire", "==", annee_scolaire)
        .where("type", "==", type)
        .where("isActive", "==", true);

      // Add optional filters
      if (nationalite) {
        existingTarifQuery = existingTarifQuery.where("nationalite", "==", nationalite);
      } else {
        existingTarifQuery = existingTarifQuery.where("nationalite", "==", null);
      }

      // Vérifier s'il existe déjà un tarif identique actif
      const existingTarifSnapshot = await existingTarifQuery.get();

      if (!existingTarifSnapshot.empty) {
        // Vérifier si c'est exactement le même tarif
        const existingTarif = existingTarifSnapshot.docs[0].data();
        const isIdentical = 
          existingTarif.nom === nom &&
          existingTarif.montant === Number(montant) &&
          existingTarif.type === type &&
          existingTarif.annee_scolaire === annee_scolaire &&
          existingTarif.nationalite === (nationalite || null);

        if (isIdentical) {
          return res.status(400).json({
            status: false,
            message: "Un tarif identique existe déjà",
            data: { existingTarif: existingTarifSnapshot.docs[0].id }
          });
        }
        // Si ce n'est pas identique, on peut créer le nouveau tarif sans désactiver l'ancien
      }

      // Create the new tariff
      const tarifData = {
        nom,
        montant: Number(montant),
        annee_scolaire,
        nationalite: nationalite || null,
        reductions: Array.isArray(reductions) ? reductions : [],
        type,
        isActive: true,
        endDate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const docRef = await this.collection.add(tarifData);
      const newTarif = await docRef.get();

      // Audit log for new tariff creation
      const createAuditLog = new AuditLog({
        userId: req.user?.id || 'system',
        action: 'CREATE_TARIF',
        entityType: 'Tarif',
        entityId: newTarif.id,
        details: { newTarifData: newTarif.data() },
      });
      await createAuditLog.save();

      return res.status(201).json({
        status: true,
        message: "Tarif créé avec succès",
        data: {
          id: newTarif.id,
          ...newTarif.data(),
        },
      });
    } catch (error) {
      console.error("Erreur lors de la création du tarif:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur interne du serveur",
        error: error.message,
      });
    }
  }

  /**
   * Récupérer tous les tarifs
   * GET /tarifs
   */
  async getAll(req, res) {
    try {
      const { page, limit, search } = req.query;
      
      // Si pas de paramètres de pagination, récupérer tous les tarifs (actifs et inactifs)
      if (!page && !limit) {
        let query = this.collection.orderBy("createdAt", "desc");

        // Recherche par nom si le paramètre search est fourni
        if (search && search.trim()) {
          query = query
            .where("nom", ">=", search.trim())
            .where("nom", "<=", search.trim() + "\uf8ff");
        }

        const snapshot = await query.get();
        const tarifs = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        return res.status(200).json({
          status: true,
          data: tarifs,
        });
      }

      // Pagination si les paramètres sont fournis
      const pageNumber = parseInt(page) || 1;
      const limitNumber = parseInt(limit) || 10;

      let query = this.collection.orderBy("createdAt", "desc");

      // Recherche par nom si le paramètre search est fourni
      if (search && search.trim()) {
        query = query
          .where("nom", ">=", search.trim())
          .where("nom", "<=", search.trim() + "\uf8ff");
      }

      // Pagination
      const offset = (pageNumber - 1) * limitNumber;
      const snapshot = await query.limit(limitNumber).offset(offset).get();

      const tarifs = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // Compter le total des documents pour la pagination
      const totalSnapshot = await this.collection.get();
      const total = totalSnapshot.size;

      return res.status(200).json({
        status: true,
        data: tarifs,
        pagination: {
          page: pageNumber,
          limit: limitNumber,
          total,
          totalPages: Math.ceil(total / limitNumber),
        },
      });
    } catch (error) {
      console.error("Erreur lors de la récupération des tarifs:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la récupération des tarifs",
        error: error.message,
      });
    }
  }

  /**
   * Récupérer un tarif par ID
   * GET /tarifs/:id
   */
  async getById(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          status: false,
          message: "ID du tarif requis",
        });
      }

      const tarifDoc = await this.collection.doc(id).get();

      if (!tarifDoc.exists) {
        return res.status(404).json({
          status: false,
          message: "Tarif non trouvé",
        });
      }

      const tarifData = tarifDoc.data();
      const tarif = new Tarif({
        id: tarifDoc.id,
        ...tarifData,
      });

      return res.status(200).json({
        status: true,
        data: tarif.toJSON(),
      });
    } catch (error) {
      console.error("Erreur lors de la récupération du tarif:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la récupération du tarif",
        error: error.message,
      });
    }
  }

  /**
   * Mettre à jour un tarif
   * PUT /tarifs/:id
   */
  async update(req, res) {
    try {
      const { id } = req.params;
      const { nom, classe_id, montant, annee_scolaire, nationalite, bourse_id, reductions, type } = req.body;

      if (!id) {
        return res.status(400).json({
          status: false,
          message: "ID du tarif requis",
        });
      }

      // Vérifier si le tarif existe et est actif
      const tarifRef = this.collection.doc(id);
      const tarifDoc = await tarifRef.get();

      if (!tarifDoc.exists || !tarifDoc.data().isActive) {
        return res.status(404).json({
          status: false,
          message: "Tarif non trouvé ou inactif",
        });
      }

      const oldTarifData = tarifDoc.data();

      // Mettre à jour directement le tarif existant
      const updatedTarifData = {
        nom: nom !== undefined ? nom : oldTarifData.nom,
        montant: montant !== undefined ? Number(montant) : oldTarifData.montant,
        annee_scolaire: annee_scolaire !== undefined ? annee_scolaire : oldTarifData.annee_scolaire,
        nationalite: nationalite !== undefined ? (nationalite || null) : (oldTarifData.nationalite || null),
        reductions: reductions !== undefined ? (Array.isArray(reductions) ? reductions : []) : oldTarifData.reductions,
        type: type !== undefined ? type : oldTarifData.type,
        isActive: req.body.isActive !== undefined ? req.body.isActive : oldTarifData.isActive,
        endDate: req.body.endDate !== undefined ? req.body.endDate : oldTarifData.endDate,
        createdAt: oldTarifData.createdAt, // Keep original creation date
        updatedAt: new Date(),
      };

      // Mettre à jour le tarif existant
      await tarifRef.update(updatedTarifData);
      const updatedTarif = await tarifRef.get();

      // Audit log for tariff update
      const updateAuditLog = new AuditLog({
        userId: req.user?.id || 'system',
        action: 'UPDATE_TARIF',
        entityType: 'Tarif',
        entityId: id,
        details: { oldData: oldTarifData, newData: updatedTarifData },
      });
      await updateAuditLog.save();

      return res.status(200).json({
        status: true,
        message: "Tarif mis à jour avec succès",
        data: {
          id: id,
          ...updatedTarif.data(),
        },
      });
    } catch (error) {
      console.error("Erreur lors de la mise à jour du tarif:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la mise à jour du tarif",
        error: error.message,
      });
    }
  }

  /**
   * Supprimer un tarif
   * DELETE /tarifs/:id
   */
  async delete(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          status: false,
          message: "ID du tarif requis",
        });
      }

      // Vérifier si le tarif existe et est actif
      const tarifRef = this.collection.doc(id);
      const tarifDoc = await tarifRef.get();

      if (!tarifDoc.exists || !tarifDoc.data().isActive) {
        return res.status(404).json({
          status: false,
          message: "Tarif non trouvé ou déjà inactif",
        });
      }

      const deletedTarifData = tarifDoc.data(); // Get data before soft deletion

      // Perform soft delete
      await tarifRef.update({
        isActive: false,
        endDate: new Date(),
        updatedAt: new Date(),
      });

      // Audit log for soft deletion
      const auditLog = new AuditLog({
        userId: req.user?.id || 'system',
        action: 'SOFT_DELETE_TARIF',
        entityType: 'Tarif',
        entityId: id,
        details: { oldData: deletedTarifData, newData: { ...deletedTarifData, isActive: false, endDate: new Date() } },
      });
      await auditLog.save();

      return res.status(200).json({
        status: true,
        message: "Tarif supprimé (désactivé) avec succès",
      });
    } catch (error) {
      console.error("Erreur lors de la suppression du tarif:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la suppression du tarif",
        error: error.message,
      });
    }
  }

  /**
   * Rechercher des tarifs par nom
   * GET /tarifs/search?q=terme
   */
  async search(req, res) {
    try {
      const { q } = req.query;

      if (!q || q.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Terme de recherche requis",
        });
      }

      const searchTerm = q.trim();
      const snapshot = await this.collection
        .where("isActive", "==", true) // Search only active tariffs
        .where("nationalite", ">=", searchTerm)
        .where("nationalite", "<=", searchTerm + "\uf8ff")
        .orderBy("nationalite") // Order by the field being searched for efficient queries
        .limit(20)
        .get();

      const tarifs = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return res.status(200).json({
        status: true,
        data: tarifs,
        searchTerm,
        count: tarifs.length,
      });
    } catch (error) {
      console.error("Erreur lors de la recherche des tarifs:", error);
      return res.status(500).json({
        status: false,
        message: "Erreur lors de la recherche des tarifs",
        error: error.message,
      });
    }
  }

  /**
   * Obtenir les statistiques des tarifs
   * GET /tarifs/stats
   */
  async getStats(req, res) {
    try {
      const snapshot = await this.collection.where("isActive", "==", true).get(); // Stats only for active tariffs
      const tarifs = snapshot.docs.map((doc) => doc.data());

      const stats = {
        total: tarifs.length,
        totalMontant: tarifs.reduce((sum, tarif) => sum + tarif.montant, 0),
        moyenneMontant:
          tarifs.length > 0
            ? (
                tarifs.reduce((sum, tarif) => sum + tarif.montant, 0) /
                tarifs.length
              ).toFixed(2)
            : 0,
        tarifMaxMontant:
          tarifs.length > 0 ? Math.max(...tarifs.map((t) => t.montant)) : 0,
        tarifMinMontant:
          tarifs.length > 0 ? Math.min(...tarifs.map((t) => t.montant)) : 0,
      };

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
}

module.exports = new TarifController();
