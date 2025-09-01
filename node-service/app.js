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

// Root test route
app.get("/", (req, res) => {
  res.json({ message: "Empire of Silence is alive..." });
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


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Empire of Silence running on port ${PORT}`));
