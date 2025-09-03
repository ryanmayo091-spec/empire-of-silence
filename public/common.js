// Base API (same host as frontend)
const API = "";

// Load session
let token = localStorage.getItem("token");
let role = localStorage.getItem("role");

// Redirect to login if not logged in (except on login/register pages)
if (!token && !window.location.pathname.includes("login") && !window.location.pathname.includes("register")) {
  window.location = "/login";
}

// Save session
function setSession(t, r) {
  localStorage.setItem("token", t);
  localStorage.setItem("role", r);
  token = t;
  role = r;
}

// Logout
function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("role");
  token = null;
  role = null;
  window.location = "/login";
}

// API helpers
async function apiGet(url) {
  const res = await fetch(API + url, {
    headers: { Authorization: "Bearer " + token }
  });
  return await res.json();
}

async function apiPost(url, data) {
  const res = await fetch(API + url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token
    },
    body: JSON.stringify(data)
  });
  return await res.json();
}
