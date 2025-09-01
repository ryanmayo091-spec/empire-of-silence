const API = window.location.origin;
let token = localStorage.getItem("token");
let role = localStorage.getItem("role");

function setSession(t, r) {
  token = t;
  role = r;
  localStorage.setItem("token", t);
  localStorage.setItem("role", r);
}

async function apiGet(url) {
  const res = await fetch(API + url, {
    headers: { Authorization: "Bearer " + token }
  });
  return res.json();
}

async function apiPost(url, body) {
  const res = await fetch(API + url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(body)
  });
  return res.json();
}
