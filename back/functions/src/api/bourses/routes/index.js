/**
 * @swagger
 * components:
 *   schemas:
 *     Bourse:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: The auto-generated ID of the scholarship
 *         nom:
 *           type: string
 *           description: Name of the scholarship (e.g., "Bourse Nationale")
 *         montant:
 *           type: number
 *           description: Amount of the scholarship
 *         criteria:
 *           type: string
 *           description: Criteria for eligibility (e.g., "Nationalité Française")
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: The date the scholarship was created
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: The date the scholarship was last updated
 *     CreateBourseRequest:
 *       type: object
 *       required:
 *         - nom
 *         - montant
 *         - criteria
 *       properties:
 *         nom:
 *           type: string
 *         montant:
 *           type: number
 *         criteria:
 *           type: string
 *     UpdateBourseRequest:
 *       type: object
 *       properties:
 *         nom:
 *           type: string
 *         montant:
 *           type: number
 *         criteria:
 *           type: string
 *     BourseStats:
 *       type: object
 *       properties:
 *         totalBourses:
 *           type: number
 *         totalMontantDistributed:
 *           type: number
 *         boursesByCriteria:
 *           type: object
 *           additionalProperties:
 *             type: number
 *     SuccessResponse:
 *       type: object
 *       properties:
 *         status:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Operation successful"
 *         data:
 *           type: object
 *           description: Optional data returned by the operation
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         status:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *           example: "An error occurred"
 */

/**
 * @swagger
 * tags:
 *   name: Bourses
 *   description: Scholarship management operations
 */

/**
 * @swagger
 * /bourses:
 *   post:
 *     summary: Create a new scholarship
 *     tags: [Bourses]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateBourseRequest'
 *     responses:
 *       201:
 *         description: Scholarship created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Scholarship created successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Bourse'
 *       400:
 *         description: Invalid input
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *   get:
 *     summary: Get all scholarships
 *     tags: [Bourses]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Maximum number of scholarships to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *         description: Number of scholarships to skip
 *     responses:
 *       200:
 *         description: A list of scholarships
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Scholarships fetched successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Bourse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
const router = require('express').Router(); // Module pour créer un nouveau route
const bourseController = require('../controllers');

// CRUD complet des bourses
router.post('/', bourseController.create.bind(bourseController));
router.get('/', bourseController.getAll.bind(bourseController));

/**
 * @swagger
 * /bourses/search:
 *   get:
 *     summary: Search scholarships by criteria
 *     tags: [Bourses]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: criteria
 *         schema:
 *           type: string
 *         description: Criteria to search for scholarships (e.g., "Nationalité Française")
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Maximum number of scholarships to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *         description: Number of scholarships to skip
 *     responses:
 *       200:
 *         description: A list of matching scholarships
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Scholarships fetched successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Bourse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/search', bourseController.search.bind(bourseController));

/**
 * @swagger
 * /bourses/stats:
 *   get:
 *     summary: Get scholarship statistics
 *     tags: [Bourses]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Scholarship statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Scholarship statistics fetched successfully"
 *                 data:
 *                   $ref: '#/components/schemas/BourseStats'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/stats', bourseController.getStats.bind(bourseController));
router.get('/percentages', bourseController.getPercentages.bind(bourseController));

/**
 * @swagger
 * /bourses/{id}:
 *   get:
 *     summary: Get a scholarship by ID
 *     tags: [Bourses]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the scholarship to retrieve
 *     responses:
 *       200:
 *         description: Scholarship data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Scholarship fetched successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Bourse'
 *       404:
 *         description: Scholarship not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *   put:
 *     summary: Update a scholarship by ID
 *     tags: [Bourses]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the scholarship to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateBourseRequest'
 *     responses:
 *       200:
 *         description: Scholarship updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Scholarship updated successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Bourse'
 *       400:
 *         description: Invalid input
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Scholarship not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *   delete:
 *     summary: Delete a scholarship by ID
 *     tags: [Bourses]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the scholarship to delete
 *     responses:
 *       200:
 *         description: Scholarship deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Scholarship not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/:id', bourseController.getById.bind(bourseController));
router.get('/:id/students', bourseController.getBourseStudents.bind(bourseController));
router.put('/:id', bourseController.update.bind(bourseController));
router.delete('/:id', bourseController.delete.bind(bourseController));


module.exports = router;