const express = require('express');
const app = express();
const path = require('path');
require("dotenv").config();
const bodyParser = require('body-parser');

app.use(bodyParser.json());

app.use(express.json());
const routes = require('./src/routes/index');

app.use(express.static(path.join(__dirname)));

// cors
const cors = require("cors");
app.use(cors({
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  origin: "*",
}));

// helmet
app.use(require("helmet")());


// API routes
app.use('/api', routes);



const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`Server is running on port http://localhost:${PORT}`);
});