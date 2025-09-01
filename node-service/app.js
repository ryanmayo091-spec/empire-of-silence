// ============================
// Empire of Silence Backend
// Node.js + Express + PostgreSQL
// ============================

const express = require("express");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");

const app = express();
app.use(bodyParser.json());
app.use(express.static("public")); // Serve frontend

// Database connection (Render Postgres)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Secret key for JWT auth
const SECRET = process.env.JWT_SECRET || "supersecret";

// ============================
// Database Auto-Seeding
// ============================
(async () => {
  try {
    // Create required tables if missing
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at TIMESTAMP DEFAULT NOW(),
        banned BOOLEAN DEFAULT false
      );

      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id),
        name TEXT NOT NULL,
        cash INT DEFAULT 1000,
        respect INT DEFAULT 0,
        heat INT DEFAULT 0,
        in_prison_until TIMESTAMP DEFAULT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        player_id INT REFERENCES players(id),
        result TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS properties (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        owner_id INT REFERENCES players(id),
        price INT DEFAULT 1000
      );

      CREATE TABLE IF NOT EXISTS gangs (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        leader_id INT REFERENCES players(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Seed default properties if none exist
    const propCheck = await pool.query("SELECT COUNT(*) FROM properties");
    if (parseInt(propCheck.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO properties (name, price) VALUES
        ('Casino', 10000),
        ('Bullet Factory', 7500),
        ('Safehouse', 3000)
      `);
      console.log("✅ Default properties seeded");
    }

    console.log("✅ Database seeded and ready");
  } catch (err) {
    console.error("❌ DB Seed Error:", err);
  }
})();

// ============================
// Middleware
// ============================

// JWT Authentication
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

// Admin check
function adminMiddleware(req, res, next) {
  if (!req.user || (req.user.role !== "admin" && req.user.role !== "mod")) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// ============================
// Auth Routes
// ============================

// Register new user
app.post("/auth/register", async (req, res) => {
  const { username, password } = req.body;
  const hashed = await bcrypt.hash(password, 10);

  try {
    // Check if first user -> make admin
    const userCount = await pool.query("SELECT COUNT(*) FROM users");
    const role = parseInt(userCount.rows[0].count) === 0 ? "admin" : "user";

    const result = await pool.query(
      "INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role",
      [username, hashed, role]
    );
    const user = result.rows[0];

    // Auto-create player profile
    await pool.query("INSERT INTO players (user_id, name) VALUES ($1, $2)", [
      user.id,
      username
    ]);

    res.json({ message: "Registered successfully", role: user.role });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Username taken" });
  }
});

// Login
app.post("/auth/login", async (req, res) => {
  const { username, password } = req.body;
  const result = await pool.query("SELECT * FROM users WHERE username = $1", [
    username
  ]);
  if (result.rows.length === 0)
    return res.status(401).json({ error: "Invalid credentials" });

  const user = result.rows[0];
  if (user.banned) return res.status(403).json({ error: "You are banned" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    SECRET,
    { expiresIn: "2h" }
  );
  res.json({ token, role: user.role });
});

// ============================
// Player Routes
// ============================

// Get my player stats
app.get("/players/me", authMiddleware, async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM players WHERE user_id = $1",
    [req.user.id]
  );
  res.json(result.rows[0]);
});

// ============================
// Crimes + Jobs
// ============================

const crimeTypes = {
  hit: { cash: -200, respect: 5, heat: 3, jail: 300, successRate: 0.7 },
  smuggling: { cash: 500, respect: 2, heat: 4, jail: 180, successRate: 0.6 },
  bribe: { cash: -300, respect: 0, heat: -5, jail: 120, successRate: 0.9 }
};

app.post("/crimes", authMiddleware, async (req, res) => {
  const { type } = req.body;
  const crime = crimeTypes[type];
  if (!crime) return res.status(400).json({ error: "Invalid crime type" });

  const playerRes = await pool.query(
    "SELECT * FROM players WHERE user_id = $1",
    [req.user.id]
  );
  const player = playerRes.rows[0];

  // Check prison status
  if (player.in_prison_until && new Date(player.in_prison_until) > new Date()) {
    return res.status(403).json({ error: "You are in prison" });
  }

  // Roll for success
  const success = Math.random() < crime.successRate;
  let resultMessage = "";

  if (success) {
    await pool.query(
      "UPDATE players SET cash = cash + $1, respect = respect + $2, heat = heat + $3 WHERE id = $4",
      [crime.cash, crime.respect, crime.heat, player.id]
    );
    resultMessage = `Success: ${type} completed!`;
  } else {
    // Jail time if failed
    const jailUntil = new Date(Date.now() + crime.jail * 1000);
    await pool.query(
      "UPDATE players SET in_prison_until = $1 WHERE id = $2",
      [jailUntil, player.id]
    );
    resultMessage = `Failed: You got caught and are in prison for ${crime.jail} seconds.`;
  }

  await pool.query(
    "INSERT INTO jobs (type, player_id, result) VALUES ($1, $2, $3)",
    [type, player.id, resultMessage]
  );

  res.json({ message: resultMessage });
});

// Get my jobs
app.get("/jobs", authMiddleware, async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM jobs WHERE player_id IN (SELECT id FROM players WHERE user_id = $1) ORDER BY created_at DESC LIMIT 20",
    [req.user.id]
  );
  res.json(result.rows);
});

// ============================
// Admin Routes
// ============================

// Get all players
app.get("/admin/players", authMiddleware, adminMiddleware, async (req, res) => {
  const result = await pool.query("SELECT * FROM players");
  res.json(result.rows);
});

// Ban/unban user
app.post("/admin/ban", authMiddleware, adminMiddleware, async (req, res) => {
  const { userId, banned } = req.body;
  await pool.query("UPDATE users SET banned = $1 WHERE id = $2", [
    banned,
    userId
  ]);
  res.json({ message: `User ${banned ? "banned" : "unbanned"}` });
});

// Give cash
app.post("/admin/cash", authMiddleware, adminMiddleware, async (req, res) => {
  const { playerId, amount } = req.body;
  await pool.query("UPDATE players SET cash = cash + $1 WHERE id = $2", [
    amount,
    playerId
  ]);
  res.json({ message: "Cash updated" });
});

// Promote/demote role
app.post("/admin/role", authMiddleware, adminMiddleware, async (req, res) => {
  const { userId, role } = req.body;
  await pool.query("UPDATE users SET role = $1 WHERE id = $2", [role, userId]);
  res.json({ message: "Role updated" });
});

// ============================
// Server Start
// ============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Empire of Silence backend running on port ${PORT}`)
);
