# Empire of Silence

## Setup (Render)

1. Create a new PostgreSQL database on Render.
2. Copy the `DATABASE_URL` connection string.
3. Deploy this repo as a **Web Service**.
4. Set environment variables:
   - `DATABASE_URL` → (from Render Postgres)
   - `JWT_SECRET` → a long random string
5. First user who registers will automatically be **Admin**.
6. Visit the app at your Render URL.
