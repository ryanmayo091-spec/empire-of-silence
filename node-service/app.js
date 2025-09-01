const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

// In-memory players (we'll move to DB later)
let players = [];

// Test route
app.get("/", (req, res) => {
  res.json({ message: "Empire of Silence is alive..." });
});

// Add a new player
app.post("/players", (req, res) => {
  const { name } = req.body;
  const newPlayer = { id: players.length + 1, name, cash: 1000, respect: 0, heat: 0 };
  players.push(newPlayer);
  res.json(newPlayer);
});

// List players
app.get("/players", (req, res) => {
  res.json(players);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Empire of Silence running on port ${PORT}`));
