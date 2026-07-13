# RackNerd Deployment

## Server paths

- App repo: `/home/deploy/apps/tonka-time`
- Nginx site file: `/etc/nginx/sites-available/tonkatimerentals.conf`
- Docker app bind: `127.0.0.1:3001 -> container:3000`

## Domain strategy

Use one codebase and one canonical hostname:

- Canonical site: `https://tonkatimerentals.com`
- Redirect aliases:
  - `https://www.tonkatimerentals.com`
  - `https://tonka-time-rentals.com`
  - `https://www.tonka-time-rentals.com`

## Cloudflare recommendation

For the initial deployment and Certbot issuance, keep these DNS records **DNS only**:

- `A tonkatimerentals.com -> 107.172.159.109`
- `A tonka-time-rentals.com -> 107.172.159.109`
- `CNAME www -> tonkatimerentals.com` on the `tonkatimerentals.com` zone
- `CNAME www -> tonka-time-rentals.com` on the `tonka-time-rentals.com` zone

After Certbot succeeds and the site is live, you can re-enable Cloudflare proxying if you want CDN/WAF features. If you proxy later, keep SSL mode at `Full (strict)`.

## First-time server bootstrap

SSH into the RackNerd server and run:

```bash
cd /home/deploy/apps
git clone <your-repo-url> tonka-time
cd tonka-time
cp .env.production.example .env.production
# edit .env.production with real secrets before going live
bash deploy/bootstrap-racknerd.sh
```

That script installs Docker, Docker Compose, Nginx, Certbot, configures the Nginx site, and issues certificates for all four hostnames.

## Port note

The app is intentionally bound to `127.0.0.1:3001` on the server, not host port `3000`.

This avoids conflicts with other services already using `3000` and keeps the Node app private behind Nginx.

If you ever need a different host port, update these two places together:

- `docker-compose.yml`
- `nginx/tonkatimerentals.conf`

## Repeatable deploy

For later updates:

```bash
cd /home/deploy/apps/tonka-time
bash deploy/deploy-app.sh
```

This script:

- checks out the current branch
- pulls the latest code
- rebuilds containers
- restarts the app
- runs Prisma migrations
- optionally seeds default data
- verifies Docker and Nginx status

For a fuller production deploy that also refreshes the OpenSign stack, reapplies both Nginx site files, runs health checks, and can prune unused Docker data:

```bash
cd /home/deploy/apps/tonka-time
bash deploy/deploy-racknerd-full.sh --with-opensign
```

Useful flags:

- `--skip-pull` keeps the current checked-out code
- `--seed` runs the Prisma seed
- `--prune` removes unused Docker build cache, images, stopped containers, and unused networks after deploy
- `--without-opensign` updates only the main Tonka app

## Self-hosted OpenSign on RackNerd

OpenSign can run on the same RackNerd server as a separate Docker stack. The official OpenSign repo publishes Docker images and a compose example for self-hosting, which we adapted here so it does not conflict with your main site Nginx listener and existing app stack.

Recommended layout:

- Main Tonka app stays at `https://tonkatimerentals.com`
- OpenSign runs on a subdomain such as `https://sign.tonkatimerentals.com`
- OpenSign client binds locally on `127.0.0.1:3100`
- OpenSign server API binds locally on `127.0.0.1:8081`

Suggested DNS:

- `A sign.tonkatimerentals.com -> 107.172.159.109`

Suggested server setup:

```bash
cd /home/deploy/apps/tonka-time
cp deploy/opensign.env.example .env.opensign
# edit .env.opensign with real values
sudo docker compose -f deploy/opensign-compose.yml up -d
sudo cp nginx/opensign.tonkatimerentals.conf /etc/nginx/sites-available/opensign.tonkatimerentals.conf
sudo ln -s /etc/nginx/sites-available/opensign.tonkatimerentals.conf /etc/nginx/sites-enabled/opensign.tonkatimerentals.conf
sudo nginx -t
sudo systemctl reload nginx
```

Then set these app env vars in `.env.production`:

- `OPENSIGN_PUBLIC_URL=https://sign.tonkatimerentals.com`
- `OPENSIGN_API_URL=https://sign.tonkatimerentals.com/api/app`
- `OPENSIGN_INTERNAL_API_URL=http://host.docker.internal:8081/app`
- `OPENSIGN_TENANT_ID=...`
- `OPENSIGN_TEMPLATE_ID_WEEKEND_RENTAL=...`
- `OPENSIGN_API_KEY=...` if you use API-key-based document creation
- `OPENSIGN_USERNAME=...` and `OPENSIGN_PASSWORD=...` for an OpenSign admin account when using the self-hosted Parse cloud-function flow
- `OPENSIGN_WEBHOOK_SECRET=...` if you use webhook validation

Why the internal URL matters:

- The customer-facing embed link should stay on `https://sign.tonkatimerentals.com`
- The Tonka backend is more reliable when the app container calls the RackNerd host's local OpenSign port via `http://host.docker.internal:8081/app`
- This avoids Cloudflare/Nginx hairpin issues and prevents the rental-agreement step from surfacing a generic host-level `502 Bad gateway` page when OpenSign is slow or unreachable through the public hostname
- The Tonka app Compose file maps `host.docker.internal` to Docker's host gateway so the container can reach that local host port

Important nginx note:

- OpenSign's backend is mounted at `/app`, so `https://sign.tonkatimerentals.com/api/app` must proxy to `http://127.0.0.1:8081/app`
- If `https://sign.tonkatimerentals.com` loads but `https://sign.tonkatimerentals.com/api/app` returns `502`, the nginx site file is usually still pointing at `/api/` instead of `/app`

Current code status:

- The Tonka app is now pointed at OpenSign endpoints and OpenSign-facing messaging.
- The app stores OpenSign session metadata and can embed or link to the OpenSign host.
- The final API-specific document creation flow still depends on your exact OpenSign tenant/template setup.

## Prisma fallback for a brand-new server

If `npm run prisma:deploy` fails with `P3015` even though `migration.sql` exists in `/app/server/prisma/migrations`, use schema push for the initial bootstrap:

```bash
cd /home/deploy/apps/tonka-time
sudo docker compose up -d --build
sudo docker compose exec app npm run prisma:generate
sudo docker compose exec app npm run prisma:push
sudo docker compose exec app npm run prisma:seed
sudo docker compose restart app
```

This is safe for the current Tonka Time production database because it is still being initialized and does not need migration history preservation yet.

## Manual certbot rerun

If you ever need to reissue certificates:

```bash
cd /home/deploy/apps/tonka-time
bash deploy/issue-certificates.sh
```

## Operations notes

- Run daily PostgreSQL backups.
- Keep video uploads in object storage instead of the repo.
- Add real Stripe, OpenSign, and email secrets before launch.
- Re-run `bash deploy/deploy-app.sh` after every production push.
