// Empire of Silence Backend
// Node.js + Express + PostgreSQL

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

const SECRET = process.env.JWT_SECRET || "supersecret";

// ============================
// Database Auto-Seeding + Schema Fixes
// ============================
(async () => {
  try {
    // Core tables
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

    // Schema fixes
    await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS xp INT DEFAULT 0`);
    await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS rank TEXT DEFAULT 'Street Rat'`);
    await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS prestige INT DEFAULT 0`);

    console.log("✅ Database seeded and schema updated");
  } catch (err) {
    console.error("❌ DB Seed Error:", err);
  }
})();

// ============================
// Middleware
// ============================
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

function adminMiddleware(req, res, next) {
  if (!req.user || (req.user.role !== "admin" && req.user.role !== "mod")) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// ============================
// Auth Routes
// ============================
app.post("/auth/register", async (req, res) => {
  const { username, password } = req.body;
  const hashed = await bcrypt.hash(password, 10);

  try {
    const userCount = await pool.query("SELECT COUNT(*) FROM users");
    const role = parseInt(userCount.rows[0].count) === 0 ? "admin" : "user";

    const result = await pool.query(
      "INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role",
      [username, hashed, role]
    );
    const user = result.rows[0];

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
// Rank + Prestige
// ============================
function getRank(xp) {
  if (xp < 100) return "Street Rat";
  if (xp < 300) return "Errand Boy";
  if (xp < 800) return "Associate";
  if (xp < 2000) return "Muscle";
  if (xp < 5000) return "Enforcer";
  if (xp < 15000) return "Caporegime";
  if (xp < 40000) return "Underboss";
  if (xp < 100000) return "Consigliere";
  if (xp < 250000) return "Boss";
  return "Godfather";
}

async function checkPrestige(player) {
  const requiredXp = 250000 * Math.pow(2, player.prestige);
  if (player.rank === "Godfather" && player.xp >= requiredXp) {
    await pool.query(
      "UPDATE players SET xp = 0, rank = 'Street Rat', prestige = prestige + 1 WHERE id = $1",
      [player.id]
    );
    return true;
  }
  return false;
}

// ============================
// Crimes
// ============================
const crimeTypes = {
  pickpocket:   { minRank: "Street Rat", xp: 5,  cash: [20, 50],    heat: 1,  jail: 30,   successRate: 0.8 },
  shoplift:     { minRank: "Errand Boy", xp: 8,  cash: [50, 120],   heat: 2,  jail: 60,   successRate: 0.75 },
  vandalism:    { minRank: "Associate",  xp: 10, cash: [80, 150],   heat: 3,  jail: 120,  successRate: 0.7 },
  car_theft:    { minRank: "Muscle",     xp: 20, cash: [300, 1000], heat: 4,  jail: 300,  successRate: 0.55 },
  smuggling:    { minRank: "Enforcer",   xp: 25, cash: [500, 1500], heat: 5,  jail: 600,  successRate: 0.6 },
  kidnap:       { minRank: "Caporegime", xp: 50, cash: [2000, 5000],heat: 8,  jail: 1200, successRate: 0.4 },
  blackmail:    { minRank: "Caporegime", xp: 40, cash: [1500, 4000],heat: 7,  jail: 900,  successRate: 0.45 },
  drug_deal:    { minRank: "Underboss",  xp: 60, cash: [3000, 7000],heat: 10, jail: 1800, successRate: 0.5 },
  hijack_truck: { minRank: "Underboss",  xp: 90, cash: [6000, 12000],heat: 12,jail: 2700, successRate: 0.3 },
  rob_bank:     { minRank: "Consigliere",xp: 120,cash: [10000, 25000],heat: 15,jail: 3600,successRate: 0.2 },
  arms_deal:    { minRank: "Consigliere",xp: 150,cash: [10000, 30000],heat: 20,jail: 7200,successRate: 0.25 },
  political_hit:{ minRank: "Boss",       xp: 200,cash: [50000, 100000],heat: 25,jail: 10800,successRate: 0.1 },
  legendary_heist:{minRank: "Godfather", xp: 500,cash: [200000, 500000],heat: 50,jail: 21600,successRate: 0.05 }
};

app.post("/crimes", authMiddleware, async (req, res) => {
  const { type } = req.body;
  const crime = crimeTypes[type];
  if (!crime) return res.status(400).json({ error: "Invalid crime type" });

  const playerRes = await pool.query("SELECT * FROM players WHERE user_id = $1", [req.user.id]);
  let player = playerRes.rows[0];

  // Check rank unlock
  const playerRank = getRank(player.xp);
  const ranks = [
    "Street Rat","Errand Boy","Associate","Muscle","Enforcer",
    "Caporegime","Underboss","Consigliere","Boss","Godfather"
  ];
  if (ranks.indexOf(playerRank) < ranks.indexOf(crime.minRank)) {
    return res.status(403).json({ error: `You must be at least ${crime.minRank} to attempt this crime.` });
  }

  // Prison check
  if (player.in_prison_until && new Date(player.in_prison_until) > new Date()) {
    return res.status(403).json({ error: "You are in prison" });
  }

  // Success/fail with prestige bonus
  const prestigeBonus = 1 + (player.prestige * 0.05);
  const successChance = crime.successRate * prestigeBonus;
  const success = Math.random() < successChance;
  let resultMessage;

  if (success) {
    const reward = Math.floor(Math.random() * (crime.cash[1] - crime.cash[0] + 1)) + crime.cash[0];
    await pool.query(
      "UPDATE players SET cash = cash + $1, xp = xp + $2, heat = heat + $3 WHERE id = $4",
      [reward, crime.xp, crime.heat, player.id]
    );
    resultMessage = `✅ Success! You earned $${reward} and ${crime.xp} XP.`;
  } else {
    const jailUntil = new Date(Date.now() + crime.jail * 1000);
    await pool.query("UPDATE players SET in_prison_until = $1 WHERE id = $2", [jailUntil, player.id]);
    resultMessage = `❌ Failed! You are in prison for ${crime.jail/60} minutes.`;
  }

  // Update rank + prestige
  const updated = await pool.query("SELECT * FROM players WHERE id = $1", [player.id]);
  player = updated.rows[0];
  const newRank = getRank(player.xp);
  if (newRank !== player.rank) {
    await pool.query("UPDATE players SET rank = $1 WHERE id = $2", [newRank, player.id]);
    resultMessage += ` You are now ranked: ${newRank}.`;
  }

  const prestiged = await checkPrestige(player);
  if (prestiged) {
    resultMessage += ` 🎖️ You have Prestiged! Prestige level is now ${player.prestige + 1}.`;
  }

  // Log job
  await pool.query("INSERT INTO jobs (type, player_id, result) VALUES ($1, $2, $3)", [type, player.id, resultMessage]);

  res.json({ message: resultMessage });
});

// ============================
// Player Routes
// ============================
app.get("/players/me", authMiddleware, async (req, res) => {
  const result = await pool.query("SELECT * FROM players WHERE user_id = $1", [req.user.id]);
  res.json(result.rows[0]);
});

// ============================
// Admin Routes
// ============================
app.get("/admin/players", authMiddleware, adminMiddleware, async (req, res) => {
  const result = await pool.query("SELECT * FROM players");
  res.json(result.rows);
});

app.post("/admin/ban", authMiddleware, adminMiddleware, async (req, res) => {
  const { userId, banned } = req.body;
  await pool.query("UPDATE users SET banned = $1 WHERE id = $2", [banned, userId]);
  res.json({ message: `User ${banned ? "banned" : "unbanned"}` });
});

app.post("/admin/cash", authMiddleware, adminMiddleware, async (req, res) => {
  const { playerId, amount } = req.body;
  await pool.query("UPDATE players SET cash = cash + $1 WHERE id = $2", [amount, playerId]);
  res.json({ message: "Cash updated" });
});

app.post("/admin/role", authMiddleware, adminMiddleware, async (req, res) => {
  const { userId, role } = req.body;
  await pool.query("UPDATE users SET role = $1 WHERE id = $2", [role, userId]);
  res.json({ message: "Role updated" });
});

// ============================
// Serve Frontend Pages
// ============================
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public/login.html")));
app.get("/register", (req, res) => res.sendFile(path.join(__dirname, "public/register.html")));
app.get("/crimes", (req, res) => res.sendFile(path.join(__dirname, "public/crimes.html")));
app.get("/jobs", (req, res) => res.sendFile(path.join(__dirname, "public/jobs.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public/admin.html")));

// ============================
// Server Start
// ============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Empire of Silence backend running on port ${PORT}`));
