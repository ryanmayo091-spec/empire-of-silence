const express = require("express");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");

const app = express();
app.use(bodyParser.json());
app.use(express.static("public"));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const SECRET = process.env.JWT_SECRET || "supersecret"; // set in Render env vars

// ✅ Auto-create tables
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id),
        name TEXT NOT NULL,
        cash INT DEFAULT 1000,
        respect INT DEFAULT 0,
        heat INT DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        player_id INT REFERENCES players(id),
        status TEXT DEFAULT 'completed',
        result TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log("✅ Tables ready");
  } catch (err) {
    console.error("❌ Error creating tables:", err);
  }
})();

// Serve frontend at root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Middleware: verify JWT
function authMiddleware(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ error: "No token" });
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// Register
app.post("/auth/register", async (req, res) => {
  const { username, password } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  try {
    const result = await pool.query(
      "INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username",
      [username, hashed]
    );
    const user = result.rows[0];
    // auto-create player for new user
    await pool.query("INSERT INTO players (user_id, name) VALUES ($1, $2)", [user.id, username]);
    res.json({ message: "Registered successfully" });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Username taken" });
  }
});

// Login
app.post("/auth/login", async (req, res) => {
  const { username, password } = req.body;
  const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
  if (result.rows.length === 0) return res.status(401).json({ error: "Invalid credentials" });
  const user = result.rows[0];
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ id: user.id, username: user.username }, SECRET, { expiresIn: "2h" });
  res.json({ token });
});

// Get player stats (protected)
app.get("/players/me", authMiddleware, async (req, res) => {
  const result = await pool.query("SELECT * FROM players WHERE user_id = $1", [req.user.id]);
  res.json(result.rows[0]);
});

// Do a job (protected)
app.post("/jobs", authMiddleware, async (req, res) => {
  const { type } = req.body;
  const playerRes = await pool.query("SELECT * FROM players WHERE user_id = $1", [req.user.id]);
  if (playerRes.rows.length === 0) return res.status(404).json({ error: "Player not found" });
  const player = playerRes.rows[0];

  let cashChange = 0, respectChange = 0, heatChange = 0, result = "";
  switch (type) {
    case "hit": cashChange=-200; respectChange=+5; heatChange=+3; result="A rival was eliminated."; break;
    case "smuggling": cashChange=+500; respectChange=+2; heatChange=+4; result="Smuggling run successful!"; break;
    case "bribe": cashChange=-300; respectChange=0; heatChange=-5; result="The cops looked away..."; break;
    default: return res.status(400).json({ error: "Unknown job type" });
  }

  await pool.query(
    "UPDATE players SET cash = cash + $1, respect = respect + $2, heat = GREATEST(0, heat + $3) WHERE id = $4",
    [cashChange, respectChange, heatChange, player.id]
  );

  const jobRes = await pool.query(
    "INSERT INTO jobs (type, player_id, result) VALUES ($1, $2, $3) RETURNING *",
    [type, player.id, result]
  );

  res.json({ message: result, job: jobRes.rows[0] });
});

// List recent jobs
app.get("/jobs", authMiddleware, async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM jobs WHERE player_id IN (SELECT id FROM players WHERE user_id = $1) ORDER BY created_at DESC LIMIT 10",
    [req.user.id]
  );
  res.json(result.rows);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Empire of Silence running on port ${PORT}`));
