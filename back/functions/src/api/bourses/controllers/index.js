const Bourse = require('../../../classes/Bourse');
const db = require('../../../config/firebase');

class BourseController {
  constructor() {
    this.collection = db.collection('bourses');
  }

  /**
   * Créer une nouvelle bourse
   * POST /bourses
   */
  async create(req, res) {
    try {
      const { nom, pourcentage_remise, description, criteres, status, montant_remise, isExempt } = req.body;

      // Validation des données
      if (!nom) {
        return res.status(400).json({
          status: false,
          message: 'Le nom est requis',
        });
      }

      // Validation du pourcentage (doit être entre 0 et 100) si fourni
      if (pourcentage_remise !== undefined && (pourcentage_remise < 0 || pourcentage_remise > 100)) {
        return res.status(400).json({
          status: false,
          message: 'Le pourcentage de remise doit être entre 0 et 100',
        });
      }

      // Validation du montant de remise (doit être positif) si fourni
      if (montant_remise !== undefined && montant_remise < 0) {
        return res.status(400).json({
          status: false,
          message: 'Le montant de remise doit être positif',
        });
      }

      // Vérifier si une bourse avec le même nom existe déjà
      const existingBourse = await this.collection
        .where('nom', '==', nom)
        .get();

      if (!existingBourse.empty) {
        return res.status(409).json({
          status: false,
          message: 'Une bourse avec ce nom existe déjà',
        });
      }

      // Créer la nouvelle bourse
      const bourseData = {
        nom: nom.trim(),
        description: description || null,
        criteres: criteres || null,
        status: status || 'active',
        pourcentage_remise: pourcentage_remise !== undefined ? Number(pourcentage_remise) : null,
        montant_remise: montant_remise !== undefined ? Number(montant_remise) : null,
        isExempt: isExempt || false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const docRef = await this.collection.add(bourseData);
      const newBourse = await docRef.get();

      return res.status(201).json({
        status: true,
        message: 'Bourse créée avec succès',
        data: {
          id: newBourse.id,
          ...newBourse.data(),
        },
      });
    } catch (error) {
      console.error('Erreur lors de la création de la bourse:', error);
      return res.status(500).json({
        status: false,
        message: 'Erreur interne du serveur',
        error: error.message,
      });
    }
  }

  /**
   * Récupérer toutes les bourses
   * GET /bourses
   */
  async getAll(req, res) {
    try {
      const { page = 1, limit = 10, search } = req.query;
      const pageNumber = parseInt(page);
      const limitNumber = parseInt(limit);

      let query = this.collection.orderBy('createdAt', 'desc');

      // Recherche par nom si le paramètre search est fourni
      if (search && search.trim()) {
        query = query.where('nom', '>=', search.trim())
          .where('nom', '<=', search.trim() + '\uf8ff');
      }

      // Pagination
      const offset = (pageNumber - 1) * limitNumber;
      const snapshot = await query.limit(limitNumber).offset(offset).get();

      const bourses = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // Compter le total des documents pour la pagination
      const totalSnapshot = await this.collection.get();
      const total = totalSnapshot.size;

      return res.status(200).json({
        status: true,
        data: bourses,
        pagination: {
          page: pageNumber,
          limit: limitNumber,
          total,
          totalPages: Math.ceil(total / limitNumber),
        },
      });
    } catch (error) {
      console.error('Erreur lors de la récupération des bourses:', error);
      return res.status(500).json({
        status: false,
        message: 'Erreur lors de la récupération des bourses',
        error: error.message,
      });
    }
  }

  /**
   * Récupérer une bourse par ID
   * GET /bourses/:id
   */
  async getById(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          status: false,
          message: 'ID de la bourse requis',
        });
      }

      const bourseDoc = await this.collection.doc(id).get();

      if (!bourseDoc.exists) {
        return res.status(404).json({
          status: false,
          message: 'Bourse non trouvée',
        });
      }

      const bourseData = bourseDoc.data();
      const bourse = new Bourse({
        id: bourseDoc.id,
        ...bourseData,
      });

      return res.status(200).json({
        status: true,
        data: bourse.toJSON(),
      });
    } catch (error) {
      console.error('Erreur lors de la récupération de la bourse:', error);
      return res.status(500).json({
        status: false,
        message: 'Erreur lors de la récupération de la bourse',
        error: error.message,
      });
    }
  }

  /**
   * Mettre à jour une bourse
   * PUT /bourses/:id
   */
  async update(req, res) {
    try {
      const { id } = req.params;
      const { nom, pourcentage_remise, description, criteres, status, montant_remise, isExempt } = req.body;

      if (!id) {
        return res.status(400).json({
          status: false,
          message: 'ID de la bourse requis',
        });
      }

      // Vérifier si la bourse existe
      const bourseRef = this.collection.doc(id);
      const bourseDoc = await bourseRef.get();

      if (!bourseDoc.exists) {
        return res.status(404).json({
          status: false,
          message: 'Bourse non trouvée',
        });
      }

      // Validation des données
      if (nom !== undefined && (!nom || nom.trim() === '')) {
        return res.status(400).json({
          status: false,
          message: 'Le nom ne peut pas être vide',
        });
      }

      if (pourcentage_remise !== undefined && (pourcentage_remise < 0 || pourcentage_remise > 100)) {
        return res.status(400).json({
          status: false,
          message: 'Le pourcentage de remise doit être entre 0 et 100',
        });
      }

      if (montant_remise !== undefined && montant_remise < 0) {
        return res.status(400).json({
          status: false,
          message: 'Le montant de remise doit être positif',
        });
      }

      // Vérifier si le nouveau nom n'existe pas déjà (sauf pour la bourse actuelle)
      if (nom && nom.trim() !== bourseDoc.data().nom) {
        const existingBourse = await this.collection
          .where('nom', '==', nom.trim())
          .get();

        if (!existingBourse.empty) {
          return res.status(409).json({
            status: false,
            message: 'Une bourse avec ce nom existe déjà',
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

      if (description !== undefined) {
        updateData.description = description;
      }

      if (criteres !== undefined) {
        updateData.criteres = criteres;
      }

      if (status !== undefined) {
        updateData.status = status;
      }

      if (pourcentage_remise !== undefined) {
        updateData.pourcentage_remise = Number(pourcentage_remise);
      }

      if (montant_remise !== undefined) {
        updateData.montant_remise = Number(montant_remise);
      }

      if (isExempt !== undefined) {
        updateData.isExempt = isExempt;
      }

      // Mettre à jour la bourse
      await bourseRef.update(updateData);

      // Récupérer la bourse mise à jour
      const updatedBourse = await bourseRef.get();

      return res.status(200).json({
        status: true,
        message: 'Bourse mise à jour avec succès',
        data: {
          id: updatedBourse.id,
          ...updatedBourse.data(),
        },
      });
    } catch (error) {
      console.error('Erreur lors de la mise à jour de la bourse:', error);
      return res.status(500).json({
        status: false,
        message: 'Erreur lors de la mise à jour de la bourse',
        error: error.message,
      });
    }
  }

  /**
   * Supprimer une bourse
   * DELETE /bourses/:id
   */
  async delete(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          status: false,
          message: 'ID de la bourse requis',
        });
      }

      // Vérifier si la bourse existe
      const bourseRef = this.collection.doc(id);
      const bourseDoc = await bourseRef.get();

      if (!bourseDoc.exists) {
        return res.status(404).json({
          status: false,
          message: 'Bourse non trouvée',
        });
      }

      // Vérifier si la bourse est utilisée par des étudiants
      const etudiantsRef = db.collection('etudiants');
      const etudiantsSnapshot = await etudiantsRef
        .where('bourse_id', '==', id)
        .get();

      if (!etudiantsSnapshot.empty) {
        return res.status(400).json({
          status: false,
          message: 'Impossible de supprimer cette bourse car elle est attribuée à des étudiants',
        });
      }

      // Supprimer la bourse
      await bourseRef.delete();

      return res.status(200).json({
        status: true,
        message: 'Bourse supprimée avec succès',
      });
    } catch (error) {
      console.error('Erreur lors de la suppression de la bourse:', error);
      return res.status(500).json({
        status: false,
        message: 'Erreur lors de la suppression de la bourse',
        error: error.message,
      });
    }
  }

  /**
   * Rechercher des bourses par nom
   * GET /bourses/search?q=terme
   */
  async search(req, res) {
    try {
      const { q } = req.query;

      if (!q || q.trim() === '') {
        return res.status(400).json({
          status: false,
          message: 'Terme de recherche requis',
        });
      }

      const searchTerm = q.trim();
      const snapshot = await this.collection
        .where('nom', '>=', searchTerm)
        .where('nom', '<=', searchTerm + '\uf8ff')
        .orderBy('nom')
        .limit(20)
        .get();

      const bourses = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return res.status(200).json({
        status: true,
        data: bourses,
        searchTerm,
        count: bourses.length,
      });
    } catch (error) {
      console.error('Erreur lors de la recherche des bourses:', error);
      return res.status(500).json({
        status: false,
        message: 'Erreur lors de la recherche des bourses',
        error: error.message,
      });
    }
  }

  /**
   * Obtenir les statistiques des bourses
   * GET /bourses/stats
   */
  async getStats(req, res) {
    try {
      const snapshot = await this.collection.get();
      const bourses = snapshot.docs.map((doc) => doc.data());

      const stats = {
        total: bourses.length,
        totalRemise: bourses.reduce((sum, bourse) => sum + bourse.pourcentage_remise, 0),
        moyenneRemise: bourses.length > 0 ? (bourses.reduce((sum, bourse) => sum + bourse.pourcentage_remise, 0) / bourses.length).toFixed(2) : 0,
        bourseMaxRemise: bourses.length > 0 ? Math.max(...bourses.map(b => b.pourcentage_remise)) : 0,
        bourseMinRemise: bourses.length > 0 ? Math.min(...bourses.map(b => b.pourcentage_remise)) : 0,
      };

      return res.status(200).json({
        status: true,
        data: stats,
      });
    } catch (error) {
      console.error('Erreur lors de la récupération des statistiques:', error);
      return res.status(500).json({
        status: false,
        message: 'Erreur lors de la récupération des statistiques',
        error: error.message,
      });
    }
  }

  /**
   * Obtenir les pourcentages de réduction disponibles
   * GET /bourses/percentages
   */
  async getPercentages(req, res) {
    try {
      // Pourcentages prédéfinis disponibles
      const availablePercentages = [25, 50, 60];
      
      return res.status(200).json({
        status: true,
        data: availablePercentages,
        message: 'Pourcentages de réduction disponibles récupérés avec succès',
      });
    } catch (error) {
      console.error('Erreur lors de la récupération des pourcentages:', error);
      return res.status(500).json({
        status: false,
        message: 'Erreur lors de la récupération des pourcentages',
        error: error.message,
      });
    }
  }

  /**
   * Récupérer les étudiants affectés à une bourse
   * GET /bourses/:id/students
   */
  async getBourseStudents(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          status: false,
          message: 'ID de la bourse requis',
        });
      }

      // Vérifier que la bourse existe
      const bourseDoc = await this.collection.doc(id).get();
      if (!bourseDoc.exists) {
        return res.status(404).json({
          status: false,
          message: 'Bourse non trouvée',
        });
      }

      // Récupérer les étudiants qui ont cette bourse
      const etudiantsSnapshot = await db.collection('etudiants')
        .where('bourse_id', '==', id)
        .get();

      const students = etudiantsSnapshot.docs.map(doc => {
        const studentData = doc.data();
        return {
          id: doc.id,
          nom: studentData.nom,
          prenom: studentData.prenom,
          email: studentData.email,
          telephone: studentData.telephone,
          classe: studentData.classe,
          status: studentData.status,
          bourse_id: studentData.bourse_id,
          createdAt: studentData.createdAt,
          updatedAt: studentData.updatedAt
        };
      });

      return res.status(200).json({
        status: true,
        data: students,
        message: `${students.length} étudiant(s) trouvé(s) pour cette bourse`,
      });
    } catch (error) {
      console.error('Erreur lors de la récupération des étudiants de la bourse:', error);
      return res.status(500).json({
        status: false,
        message: 'Erreur lors de la récupération des étudiants de la bourse',
        error: error.message,
      });
    }
  }
}

module.exports = new BourseController();
