// Empire of Silence Backend (Fully Fixed)
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
        in_prison_until TIMESTAMP DEFAULT NULL,
        xp INT DEFAULT 0,
        rank TEXT DEFAULT 'Street Rat',
        prestige INT DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        player_id INT REFERENCES players(id),
        result TEXT,
        xp_at_time INT,
        rank_at_time TEXT,
        prestige_at_time INT,
        prison_start TIMESTAMP,
        prison_end TIMESTAMP,
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
// Auth Routes (Fixed)
// ============================

// Register
app.post("/auth/register", async (req, res) => {
  const rawUsername = req.body.username;
  const password = req.body.password;

  if (!rawUsername || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  const username = rawUsername.trim().toLowerCase(); // normalized for DB
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
      rawUsername.trim() // keep display name with original casing
    ]);

    res.json({ message: "Registered successfully", role: user.role });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Username already exists" });
  }
});

// Login
app.post("/auth/login", async (req, res) => {
  const username = req.body.username?.trim().toLowerCase();
  const password = req.body.password;

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  const result = await pool.query("SELECT * FROM users WHERE username = $1", [
    username
  ]);
  if (result.rows.length === 0)
    return res.status(401).json({ error: "Invalid username or password" });

  const user = result.rows[0];
  if (user.banned) return res.status(403).json({ error: "You are banned" });

  const match = await bcrypt.compare(password, user.password);
  if (!match)
    return res.status(401).json({ error: "Invalid username or password" });

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
app.get("/players/me", authMiddleware, async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM players WHERE user_id = $1",
    [req.user.id]
  );
  res.json(result.rows[0]);
});

app.get("/admin/players", authMiddleware, adminMiddleware, async (req, res) => {
  const result = await pool.query("SELECT * FROM players");
  res.json(result.rows);
});

// ============================
// Crimes (XP, Ranks, Prestige)
// ============================
const crimeTypes = {
  pickpocket: { minRank: "Street Rat", successXP: 5, cashMin: 10, cashMax: 50, jailMinutes: 1 },
  shoplift: { minRank: "Errand Boy", successXP: 10, cashMin: 20, cashMax: 100, jailMinutes: 2 },
  vandalism: { minRank: "Associate", successXP: 15, cashMin: 50, cashMax: 200, jailMinutes: 3 },
  car_theft: { minRank: "Muscle", successXP: 25, cashMin: 200, cashMax: 800, jailMinutes: 5 },
  smuggling: { minRank: "Enforcer", successXP: 40, cashMin: 500, cashMax: 1500, jailMinutes: 10 },
  kidnap: { minRank: "Caporegime", successXP: 60, cashMin: 1000, cashMax: 2500, jailMinutes: 15 },
  blackmail: { minRank: "Caporegime", successXP: 70, cashMin: 1200, cashMax: 3000, jailMinutes: 15 },
  drug_deal: { minRank: "Underboss", successXP: 90, cashMin: 2000, cashMax: 5000, jailMinutes: 20 },
  hijack_truck: { minRank: "Underboss", successXP: 120, cashMin: 3000, cashMax: 7000, jailMinutes: 20 },
  rob_bank: { minRank: "Consigliere", successXP: 200, cashMin: 10000, cashMax: 20000, jailMinutes: 30 },
  arms_deal: { minRank: "Consigliere", successXP: 250, cashMin: 12000, cashMax: 25000, jailMinutes: 30 },
  political_hit: { minRank: "Boss", successXP: 500, cashMin: 25000, cashMax: 50000, jailMinutes: 60 },
  legendary_heist: { minRank: "Godfather", successXP: 1000, cashMin: 50000, cashMax: 100000, jailMinutes: 120 }
};

const ranks = [
  { name: "Street Rat", xp: 0 },
  { name: "Errand Boy", xp: 100 },
  { name: "Associate", xp: 300 },
  { name: "Muscle", xp: 800 },
  { name: "Enforcer", xp: 2000 },
  { name: "Caporegime", xp: 5000 },
  { name: "Underboss", xp: 15000 },
  { name: "Consigliere", xp: 40000 },
  { name: "Boss", xp: 100000 },
  { name: "Godfather", xp: 250000 }
];

function getRankByXP(xp) {
  let rank = "Street Rat";
  for (const r of ranks) {
    if (xp >= r.xp) rank = r.name;
  }
  return rank;
}

app.post("/crimes", authMiddleware, async (req, res) => {
  const { type } = req.body;
  const crime = crimeTypes[type];
  if (!crime) return res.status(400).json({ error: "Invalid crime" });

  const playerRes = await pool.query("SELECT * FROM players WHERE user_id = $1", [req.user.id]);
  let player = playerRes.rows[0];

  if (player.in_prison_until && new Date(player.in_prison_until) > new Date()) {
    return res.status(403).json({ error: "You are in prison" });
  }

  const playerRankIndex = ranks.findIndex(r => r.name === player.rank);
  const crimeRankIndex = ranks.findIndex(r => r.name === crime.minRank);
  if (playerRankIndex < crimeRankIndex) {
    return res.status(403).json({ error: `You need to be at least ${crime.minRank} to do this crime` });
  }

  const success = Math.random() < 0.6;
  let message;

  if (success) {
    const cashEarned = Math.floor(Math.random() * (crime.cashMax - crime.cashMin + 1)) + crime.cashMin;
    const newXP = player.xp + crime.successXP;

    let newRank = getRankByXP(newXP);
    let prestigeMsg = "";
    if (newRank === "Godfather" && player.rank === "Godfather") {
      await pool.query("UPDATE players SET prestige = prestige + 1, xp = 0 WHERE id = $1", [player.id]);
      prestigeMsg = ` You have Prestiged! Prestige level is now ${player.prestige + 1}.`;
    } else {
      await pool.query("UPDATE players SET cash = cash + $1, xp = xp + $2, rank = $3 WHERE id = $4", [
        cashEarned, crime.successXP, newRank, player.id
      ]);
    }

    message = `Success! You earned $${cashEarned} and ${crime.successXP} XP.`;
    if (newRank !== player.rank) message += ` You are now ranked: ${newRank}.`;
    if (prestigeMsg) message += prestigeMsg;

    await pool.query("INSERT INTO jobs (type, player_id, result, xp_at_time, rank_at_time, prestige_at_time) VALUES ($1, $2, $3, $4, $5, $6)", [
      type, player.id, message, newXP, newRank, player.prestige
    ]);
  } else {
    const jailUntil = new Date(Date.now() + crime.jailMinutes * 60000);
    await pool.query("UPDATE players SET in_prison_until = $1 WHERE id = $2", [jailUntil, player.id]);

    message = `Failed! You are in prison for ${crime.jailMinutes} minutes.`;

    await pool.query("INSERT INTO jobs (type, player_id, result, prison_start, prison_end) VALUES ($1, $2, $3, $4, $5)", [
      type, player.id, message, new Date(), jailUntil
    ]);
  }

  res.json({ message });
});

// ============================
// Prison System: Bail + Bust
// ============================
app.post("/prison/bail", authMiddleware, async (req, res) => {
  const playerRes = await pool.query("SELECT * FROM players WHERE user_id = $1", [req.user.id]);
  let player = playerRes.rows[0];
  if (!player.in_prison_until || new Date(player.in_prison_until) <= new Date()) {
    return res.status(400).json({ error: "You are not in prison" });
  }

  const diff = new Date(player.in_prison_until).getTime() - Date.now();
  const minutesLeft = Math.ceil(diff / 60000);
  const bailCost = minutesLeft * 100;

  if (player.cash < bailCost) {
    return res.status(400).json({ error: `Bail costs $${bailCost}, but you only have $${player.cash}` });
  }

  await pool.query("UPDATE players SET cash = cash - $1, in_prison_until = NULL WHERE id = $2", [bailCost, player.id]);

  await pool.query(
    "INSERT INTO jobs (type, player_id, result, prison_start, prison_end) VALUES ($1, $2, $3, $4, $5)",
    ["bail", player.id, `${player.name} paid $${bailCost} bail and was freed.`, new Date(), new Date()]
  );

  res.json({ message: `You paid $${bailCost} bail and are now free.` });
});

app.post("/prison/bust", authMiddleware, async (req, res) => {
  const { targetId } = req.body;

  const targetRes = await pool.query("SELECT * FROM players WHERE id = $1", [targetId]);
  const target = targetRes.rows[0];
  if (!target || !target.in_prison_until || new Date(target.in_prison_until) <= new Date()) {
    return res.status(400).json({ error: "That player is not in prison" });
  }

  const rescuerRes = await pool.query("SELECT * FROM players WHERE user_id = $1", [req.user.id]);
  const rescuer = rescuerRes.rows[0];

  const rankIndex = ranks.findIndex(r => r.name === rescuer.rank);
  const successChance = 0.2 + (rankIndex * 0.05);

  const success = Math.random() < successChance;

  if (success) {
    await pool.query("UPDATE players SET in_prison_until = NULL WHERE id = $1", [target.id]);
    await pool.query(
      "INSERT INTO jobs (type, player_id, result, prison_start, prison_end) VALUES ($1, $2, $3, $4, $5)",
      ["bust", rescuer.id, `${rescuer.name} busted ${target.name} out of prison.`, new Date(), new Date()]
    );
    res.json({ message: `You successfully busted ${target.name} out of prison!` });
  } else {
    const jailUntil = new Date(Date.now() + 300000);
    await pool.query("UPDATE players SET in_prison_until = $1 WHERE id = $2", [jailUntil, rescuer.id]);
    await pool.query(
      "INSERT INTO jobs (type, player_id, result, prison_start, prison_end) VALUES ($1, $2, $3, $4, $5)",
      ["bust_fail", rescuer.id, `${rescuer.name} failed to bust ${target.name} out and got jailed themselves.`, new Date(), jailUntil]
    );
    res.json({ message: `You failed and got jailed for 5 minutes.` });
  }
});

// ============================
// Serve Pages
// ============================
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public/login.html")));
app.get("/register", (req, res) => res.sendFile(path.join(__dirname, "public/register.html")));
app.get("/crimes", (req, res) => res.sendFile(path.join(__dirname, "public/crimes.html")));
app.get("/jobs", (req, res) => res.sendFile(path.join(__dirname, "public/jobs.html")));
app.get("/prison", (req, res) => res.sendFile(path.join(__dirname, "public/prison.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public/admin.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Empire of Silence running on port ${PORT}`));
