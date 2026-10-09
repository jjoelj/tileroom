# Deploying Tileroom

Nginx on the host terminates TLS and proxies to two containers on host networking:
production on `127.0.0.1:3100`, staging on `127.0.0.1:3101`. Each is its own checkout with its own
`.env` and SQLite in `server/data/`. Migrations run on startup.

## One-time setup

1. **DNS:** A records `@`, `www`, `staging` for tileroom.org → the server's public IP.
2. **OCI security list** for the server's subnet: ingress TCP 80 and 443 from `0.0.0.0/0`.
3. **Host firewall** (rules persist via iptables-persistent):
   ```sh
   sudo iptables -I INPUT 5 -p tcp -m state --state NEW -m multiport --dports 80,443 -j ACCEPT
   sudo netfilter-persistent save
   ```
4. **Nginx and certificates** (Ubuntu's certbot renews on a systemd timer):
   ```sh
   sudo apt install -y nginx certbot python3-certbot-nginx
   sudo certbot certonly --nginx -d tileroom.org -d www.tileroom.org
   sudo certbot certonly --nginx -d staging.tileroom.org
   sudo cp deploy/tileroom-proxy.conf /etc/nginx/snippets/
   cp deploy/nginx.conf.example deploy/nginx.conf   # then fill in <private IP>
   sudo cp deploy/nginx.conf /etc/nginx/sites-available/tileroom
   sudo ln -s /etc/nginx/sites-available/tileroom /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```
   443 listens on the private IP only (`ip -4 -br addr`), because tailscaled holds the tailnet IP's 443 for Funnel.
5. **Checkouts:**
   ```sh
   cd ~/docker-apps
   git clone https://github.com/jjoelj/tileroom.git tileroom   # public: HTTPS needs no key
   git clone https://github.com/jjoelj/tileroom.git tileroom-staging
   docker run --rm oven/bun:1.4.2 bunx web-push generate-vapid-keys   # once; same keys in both
   ```
   `.env` in each:
   ```sh
   PORT=3100                               # staging: 3101
   STAGING=1                               # staging only: blue icon, "Staging" name
   PUBLIC_ORIGIN=https://tileroom.org      # staging: https://staging.tileroom.org
   VAPID_PUBLIC_KEY=...
   VAPID_PRIVATE_KEY=...
   VAPID_SUBJECT=mailto:you@example.com
   ```
6. **Start**, then make the first admin (the only account without an invite) and an invite:
   ```sh
   docker compose up -d --build
   docker compose exec tileroom bun server/src/cli.ts create-admin <username>
   docker compose exec tileroom bun server/src/cli.ts create-invite
   ```

## Deploys

Staging follows `master`; production follows the newest `v*` tag. `crontab -e`:

```cron
*/5 * * * * $HOME/docker-apps/tileroom-staging/deploy/deploy.sh staging >> $HOME/tileroom-deploy.log 2>&1
*/5 * * * * $HOME/docker-apps/tileroom/deploy/deploy.sh prod >> $HOME/tileroom-deploy.log 2>&1
```

Release: `git tag vx.y.z && git push origin --tags`. Never move production off `tileroom.org`:
installed PWAs are tied to the origin.
