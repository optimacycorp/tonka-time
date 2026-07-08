# Tonka Time Rentals

Tonka Time Rentals is a Vite + React frontend with a Node.js + Express API for Tonka Time's weekend mini excavator rental MVP. The project follows the attached Codex specs while adapting the stack to a Vite-driven client and a deployable Node backend for RackNerd.

## What is included

- Public marketing pages for Tonka Time Rentals
- Multi-step reservation flow for weekend-only rentals
- Admin portal shell with reservation and operations views
- Express API routes for availability, reservations, admin, Stripe, and DocuSeal placeholders
- Embedded Stripe checkout and embedded DocuSeal signing scaffolding for the customer flow
- Prisma schema and seed data for packages, machines, service areas, videos, and FAQs
- Docker, Docker Compose, and Nginx configuration for RackNerd

## Local development

1. Copy `.env.example` to `.env`.
2. Install dependencies with `npm install`.
3. Start PostgreSQL locally or with `docker compose up -d db`.
4. Run `npm run prisma:generate`.
5. Run `npm run prisma:migrate`.
6. Run `npm run prisma:seed`.
7. Run `npm run dev`.

The frontend runs on `http://localhost:5173` and the API runs on `http://localhost:8787`.

## Deployment

 RackNerd deployment notes are in `deploy/racknerd-deploy.md`.
