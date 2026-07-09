# Tonka Time Rentals

Tonka Time Rentals is a Vite + React frontend with a Node.js + Express API for Tonka Time's weekend mini excavator rental MVP. The project follows the attached Codex specs while adapting the stack to a Vite-driven client and a deployable Node backend for RackNerd.

## What is included

- Public marketing pages for Tonka Time Rentals
- Multi-step reservation flow for weekend-only rentals
- Optional customer authentication with email/password or phone-code sign-in
- Customer account area for reservation history, payment status, notifications, and cancellation
- Admin portal with authenticated order visibility plus cancellation/refund actions
- Express API routes for availability, reservations, auth, account, admin, Stripe, and OpenSign placeholders
- Embedded Stripe checkout and OpenSign signing scaffolding for the customer flow
- Prisma schema and seed data for packages, machines, service areas, videos, FAQs, and the seeded admin account
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

## Admin account

The seed now creates an admin account:

- Email: `admin@tonkatimerentals.com`
- Password: `Ang1ular1$`

Rotate this password immediately in production after the first deploy.

## Notes

- Phone authentication works through a one-time code flow. If Twilio credentials are not configured yet, the API returns a dev-only code so the flow can still be tested.
- Reservation cancellation updates the reservation status, releases the calendar slot, marks refund state, and logs customer/admin notifications.
- Self-hosted OpenSign can authenticate either with `OPENSIGN_API_KEY` or, when the hosted UI does not expose API tokens, with `OPENSIGN_MASTER_KEY` plus `OPENSIGN_APP_ID`.
- The current self-hosted create-session flow works best with `OPENSIGN_USERNAME` and `OPENSIGN_PASSWORD` for an OpenSign admin account so the Tonka API can log in, clone the template, and fetch the signer-specific document URL through Parse cloud functions.

## Deployment

 RackNerd deployment notes are in `deploy/racknerd-deploy.md`.
