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

## Manual certbot rerun

If you ever need to reissue certificates:

```bash
cd /home/deploy/apps/tonka-time
bash deploy/issue-certificates.sh
```

## Operations notes

- Run daily PostgreSQL backups.
- Keep video uploads in object storage instead of the repo.
- Add real Stripe, DocuSeal, and email secrets before launch.
- Re-run `bash deploy/deploy-app.sh` after every production push.
