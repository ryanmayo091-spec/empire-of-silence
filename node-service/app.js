const express = require("express");
const bodyParser = require("body-parser");
const { Pool } = require("pg");

const app = express();
app.use(bodyParser.json());

// Connect to Postgres on Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ✅ Auto-create the players table if it doesn’t exist
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        cash INT DEFAULT 1000,
        respect INT DEFAULT 0,
        heat INT DEFAULT 0
      )
    `);
    console.log("✅ Players table ready");
  } catch (err) {
    console.error("❌ Error creating players table:", err);
  }
})();

// Serve frontend at root
const path = require("path");
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


// Add a new player
app.post("/players", async (req, res) => {
  const { name } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO players (name) VALUES ($1) RETURNING *",
      [name]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add player" });
  }
});

// List all players
app.get("/players", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM players");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch players" });
  }
});

// ✅ Auto-create tables if not exist
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
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

// Commit a crime (job)
app.post("/jobs", async (req, res) => {
  const { playerId, type } = req.body;

  try {
    // Check if player exists
    const playerResult = await pool.query("SELECT * FROM players WHERE id = $1", [playerId]);
    if (playerResult.rows.length === 0) {
      return res.status(404).json({ error: "Player not found" });
    }
    let player = playerResult.rows[0];

    // Job effects
    let cashChange = 0;
    let respectChange = 0;
    let heatChange = 0;
    let result = "";

    switch (type) {
      case "hit":
        cashChange = -200; // cost of arranging a hit
        respectChange = +5;
        heatChange = +3;
        result = "A rival was found floating in the river...";
        break;

      case "smuggling":
        cashChange = +500; // profit
        respectChange = +2;
        heatChange = +4;
        result = "Your smuggling run was successful!";
        break;

      case "bribe":
        cashChange = -300;
        respectChange = 0;
        heatChange = -5; // lowers police heat
        result = "The cops looked the other way this time...";
        break;

      default:
        return res.status(400).json({ error: "Unknown job type" });
    }

    // Update player stats
    await pool.query(
      "UPDATE players SET cash = cash + $1, respect = respect + $2, heat = GREATEST(0, heat + $3) WHERE id = $4",
      [cashChange, respectChange, heatChange, playerId]
    );

    // Insert job record
    const jobResult = await pool.query(
      "INSERT INTO jobs (type, player_id, result) VALUES ($1, $2, $3) RETURNING *",
      [type, playerId, result]
    );

    res.json({
      message: result,
      playerUpdate: { cashChange, respectChange, heatChange },
      job: jobResult.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Job failed" });
  }
});

// List jobs
app.get("/jobs", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 20");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch jobs" });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Empire of Silence running on port ${PORT}`));
