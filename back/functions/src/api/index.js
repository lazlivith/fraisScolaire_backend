const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("../../swagger");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const express = require("express");
const { authenticate, authorize } = require("../middlewares/auth");
const { 
  performanceMonitor, 
  timeoutMiddleware, 
  memoryMonitor, 
  firestoreMonitor 
} = require("../middlewares/performance");

const boursesHandler = require("./bourses/routes");
const classesHandler = require("./classes/routes");
const echeanciersHandler = require("./echeanciers/routes");
const etudiantsHandler = require("./etudiants/routes");
const facturesHandler = require("./factures/routes");
const fraisPonctuelsHandler = require("./fraisPonctuels/routes");
const paiementsHandler = require("./paiements/routes");
const activitesHandler = require("./activites/routes");
const relancesHandler = require("./relances/routes");
const tarifsHandler = require("./tarifs/routes");
const usersHandler = require("./users/routes");
const authHandler = require("./auth/routes");
const dashboardHandler = require("./dashboard/routes");
const parentsHandler = require("./parents/routes");
const uploadHandler = require("./upload/routes");
const webhooksHandler = require("./webhooks/routes");
const backupHandler = require("./backup/routes");
const paymentPlansHandler = require("./payment_plans/routes");

const app = express();

// Aligner la config CORS interne sur celle du serveur racine (autoriser 8080/8081/5173 et IPs privées en dev)
const allowedOrigins = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:8081",
  "http://127.0.0.1:8081",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];
const privateIpRegex = /^http:\/\/(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\./;
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // autoriser les requêtes sans origin
    if (allowedOrigins.includes(origin) || privateIpRegex.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(cookieParser());
app.use(bodyParser.json());

// ✅ Middlewares de performance et monitoring
app.use(performanceMonitor);
app.use(timeoutMiddleware(30000)); // 30 secondes max
app.use(memoryMonitor);
app.use(firestoreMonitor);

// ✅ Endpoint de santé pour tester la connectivité (PUBLIC)
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

// ✅ Endpoint de diagnostic avancé (PUBLIC)
app.get("/diagnostic", async (req, res) => {
  try {
    const { checkFirestoreHealth } = require('../utils/firestoreTimeout');
    
    const memUsage = process.memoryUsage();
    const firestoreHealthy = await checkFirestoreHealth();
    
    res.json({
      status: "diagnostic_complete",
      timestamp: new Date().toISOString(),
      system: {
        uptime: process.uptime(),
        memory: {
          rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
          external: Math.round(memUsage.external / 1024 / 1024) + 'MB'
        },
        nodeVersion: process.version,
        platform: process.platform
      },
      firestore: {
        healthy: firestoreHealthy,
        connection: firestoreHealthy ? 'OK' : 'ERROR'
      },
      warnings: []
    });
  } catch (error) {
    res.status(500).json({
      status: "diagnostic_failed",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.use("/bourses", authenticate, authorize(["admin", "sous-admin", "comptable"]), boursesHandler);
app.use("/classes", authenticate, authorize(["admin", "sous-admin"]), classesHandler);
app.use("/echeanciers", authenticate, authorize(["admin", "sous-admin"]), echeanciersHandler);
// Routes générales des étudiants - pour admin/sous-admin et étudiants
app.use(
  "/etudiants",
  authenticate,
  authorize(["admin", "sous-admin", "etudiant"]),
  etudiantsHandler
);

// Routes du portail étudiant - accessibles aux étudiants et parents
app.use(
  "/student-portal",
  authenticate,
  authorize(["etudiant", "parent"]),
  etudiantsHandler
);
app.use(
  "/factures",
  authenticate,
  authorize(["admin", "sous-admin", "comptable", "etudiant", "parent"]),
  facturesHandler
);
app.use(
  "/fraisPonctuels",
  authenticate,
  authorize(["admin", "sous-admin"]),
  fraisPonctuelsHandler
);
app.use(
  "/paiements",
  authenticate,
  authorize(["admin", "sous-admin", "comptable", "etudiant", "parent"]),
  paiementsHandler
);
app.use("/activites", authenticate, authorize(["admin", "sous-admin"]), activitesHandler);
app.use("/relances", authenticate, authorize(["admin", "sous-admin"]), relancesHandler);
app.use(
  "/tarifs",
  authenticate,
  authorize(["admin", "sous-admin", "comptable"]),
  tarifsHandler
);
app.use("/users", authenticate, authorize(["admin", "sous-admin", "etudiant"]), usersHandler);

app.use("/auth", authHandler);
app.use("/dashboard", authenticate, authorize(["admin", "sous-admin"]), dashboardHandler);
app.use(
  "/parents",
  authenticate,
  authorize(["admin", "sous-admin"]),
  parentsHandler
);
app.use("/upload", authenticate, authorize(["admin", "sous-admin"]), uploadHandler);
app.use("/webhooks", authenticate, authorize(["admin", "sous-admin"]), webhooksHandler);
app.use("/backup", authenticate, authorize(["admin", "sous-admin"]), backupHandler);
app.use("/payment-plans", authenticate, authorize(["admin", "sous-admin"]), paymentPlansHandler);

// Serve Swagger UI
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

module.exports = app;
