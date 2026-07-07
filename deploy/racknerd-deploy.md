# RackNerd Deployment

## App path

Deploy the repository to `/home/deploy/apps/tonka-time`.

## First-time setup

```bash
cd /home/deploy/apps
git clone <your-repo-url> tonka-time
cd tonka-time
cp .env.production.example .env.production
# edit secrets and database values
docker compose up -d --build
docker compose exec app npx prisma migrate deploy --schema server/prisma/schema.prisma
docker compose exec app npx prisma db seed --schema server/prisma/schema.prisma
```

## DNS

Create A records for:

- `tonkatimerentals.com`
- `www.tonkatimerentals.com`
- `tonka-time-rentals.com`
- `www.tonka-time-rentals.com`

All should point to the RackNerd VPS IP.

## Nginx

Use the sample config in `nginx/tonkatimerentals.conf`. It proxies the app on port `3000`, sets the canonical domain to `tonkatimerentals.com`, and redirects the hyphenated domain.

## SSL

```bash
sudo certbot --nginx \
  -d tonkatimerentals.com \
  -d www.tonkatimerentals.com \
  -d tonka-time-rentals.com \
  -d www.tonka-time-rentals.com
```

## Operations notes

- Run daily PostgreSQL backups.
- Keep video uploads in object storage instead of the repo.
- Add real Stripe, DocuSeal, and email secrets before launch.
