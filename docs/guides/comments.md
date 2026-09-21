# Add comments to the site

Run [Remark42](https://remark42.com) alongside the register and embed comment
threads in the Quartz site. Remark42 is a Go binary with an embedded database,
so there is no database service to run.

## Before you start

- The site exists and is published — see [Publish the register as a website](publish-site.md).
- The container stack is running — see [the container guide](deploy-container.md).
- You can edit `.env` and, for providers not already listed, `compose.yml`.

Remark42 always runs on the machine the register runs on, because it holds
state. What you choose below is how a browser reaches it.

## 1. Choose a topology

| What you want | Profiles | Tunnel points at | `REMARK_URL` |
|---|---|---|---|
| Nothing published; you look over an SSH tunnel | `site` `comments` | — | `http://127.0.0.1:8080/remark42` |
| Site built elsewhere, comments here | `comments` `tunnel` | `remark42:8080` | `https://comments.example.com` |
| Everything published from here | `site` `comments` `tunnel` | `site-serve:8080` | `https://example.com/remark42` |

The profiles are independent and each is opt-in, so they compose. Why:
[ADR 0085](../decisions/0085-profiles-are-independent-and-opt-in.md).

What the tunnel points at is configured in Cloudflare's dashboard, not in
`compose.yml`. Pointing it at `site-serve` publishes the site and the comments
through one hostname, because `site-serve` already proxies `/remark42`.

## 2. Set the core variables

In `.env`:

```bash
REMARK_URL=https://example.com/remark42
REMARK_SECRET=<openssl rand -hex 32>
ALLOWED_HOSTS=https://example.com
```

| Variable | What it is |
|---|---|
| `REMARK_URL` | The address a browser will really use. It builds the OAuth callbacks and the links in feeds |
| `REMARK_SECRET` | Signs the JWTs. Generate it with `openssl rand -hex 32` and treat it as a secret |
| `ALLOWED_HOSTS` | The origins allowed to embed these threads. This is the *site's* address, which with the site built off-box is a different hostname from `REMARK_URL` |
| `REMARK_SITE` | The site id. Defaults to `gamereg`; must match the `site_id` given to the widget |
| `REMARK_ADMIN_ID` | Your own Remark42 user id, which buys moderation rights. Sign in once and read it from the widget's profile panel |

> [!WARNING]
> `REMARK_URL` takes a single value. There is no configuration in which a tunnel
> hostname and a localhost address both work.

> [!NOTE]
> `.env.example` ships `ALLOWED_HOSTS=https://games.example.com`, a placeholder
> hostname nobody owns. Left as shipped, the widget refuses to load on your own
> site. Left empty, Remark42 accepts any origin, so anyone can host your threads
> on a page of their own.

Every variable is listed in the [environment reference](../reference/environment.md).

## 3. Serve the comments under the site's origin

When the `site` profile runs on the same machine, Caddy can proxy Remark42 at
`/remark42/` on the site's own origin. That buys one published port instead of
two and no CORS allowlist to keep in step with the site's address. Why:
[ADR 0086](../decisions/0086-comments-under-the-site-origin.md).

```bash
SITE_COMMENTS_UPSTREAM=remark42:8080
REMARK_URL=https://example.com/remark42
```

`REMARK_URL` must carry the same `/remark42` path. The prefix is stripped before
the request is proxied, so Remark42 sees the paths it expects.

> [!WARNING]
> `.env.example` already sets `SITE_COMMENTS_UPSTREAM=remark42:8080`. If the
> `comments` profile does not run on this machine, clear it — otherwise
> `/remark42/` proxies to a host that does not exist.

If OAuth sign-in links ever come back without the `/remark42` prefix, the escape
is to publish Remark42 on its own port and leave `SITE_COMMENTS_UPSTREAM` empty.

## 4. Reach it from outside

```bash
docker compose --profile comments --profile tunnel up -d
```

The `tunnel` profile runs cloudflared: no published port, no static address and
no certificate to renew. Set `CLOUDFLARE_TUNNEL_TOKEN` in `.env` from the
Cloudflare dashboard, and configure there what the tunnel points at — see the
table in step 1.

## 5. Choose who may comment

Auth providers are set in `.env` **and** named in `compose.yml`. Remark42 is the
only service here a stranger can reach, so it deliberately has no `env_file`:
Compose loads an entire file, which would hand a public comment engine the model
credential, the bot token, the tunnel token and the provider keys, none of which
Remark42 reads. Why:
[ADR 0089](../decisions/0089-public-service-gets-named-variables.md).

Already named in `compose.yml`, so `.env` alone is enough:

| Provider | Variables |
|---|---|
| Anonymous | `AUTH_ANON=true` |
| GitHub | `AUTH_GITHUB_CID`, `AUTH_GITHUB_CSEC` |
| Google | `AUTH_GOOGLE_CID`, `AUTH_GOOGLE_CSEC` |
| Discord | `AUTH_DISCORD_CID`, `AUTH_DISCORD_CSEC` |
| Yandex | `AUTH_YANDEX_CID`, `AUTH_YANDEX_CSEC` |
| Patreon | `AUTH_PATREON_CID`, `AUTH_PATREON_CSEC` |
| Microsoft | `AUTH_MICROSOFT_CID`, `AUTH_MICROSOFT_CSEC` |
| Telegram | `AUTH_TELEGRAM=true`, `REMARK_TELEGRAM_TOKEN` |

Fill a pair and recreate the container:

```bash
docker compose --profile comments up -d
```

For a provider *not* in that table — Apple, or SMTP email — add it to the
`remark42` service in `compose.yml` as well. Setting it only in `.env` does
nothing and says nothing: Remark42 never sees the variable, so the provider is
simply absent from the sign-in panel.

> [!WARNING]
> Boolean flags take an explicit `false`, never an empty string. Remark42 reads
> a variable's *presence* as enable, so `AUTH_TELEGRAM=""` advertises a sign-in
> method that then fails against the API.

### OAuth callbacks

Register the callback with the provider as `<REMARK_URL>/auth/<provider>/callback`.
With the same-origin proxy from step 3 and `REMARK_URL=https://example.com/remark42`,
GitHub's is `https://example.com/remark42/auth/github/callback`.

### Telegram sign-in

Telegram needs no OAuth app and no callback URL: the commenter messages a bot
and is signed in. Both variables are required — the token alone does nothing,
because `AUTH_TELEGRAM` defaults to `false`.

> [!WARNING]
> It must be its *own* bot, never the Registrar's. Telegram permits one consumer
> per bot token, so two pollers steal each other's updates and the register stops
> answering reliably. Ask @BotFather for a second bot.

## 6. Add the widget to Quartz

The plugin is declared in the vault's own `quartz/quartz.config.yaml`. gamereg
seeds that file once and never rewrites it, so this is a one-time hand edit —
and it travels with the vault, so a site built off-box picks up the same
configuration.

```yaml
plugins:
  - source: "github:cidus/remark42.quartz"
    enabled: true
    options:
      host: "https://example.com/remark42"
      site_id: "gamereg"
    layout:
      position: afterBody
      priority: 10
```

- `host` must equal `REMARK_URL`. A mismatch loads the widget from one address
  while Remark42 believes it lives at another, and nothing errors.
- `site_id` must equal `REMARK_SITE` (default `gamereg`).
- `source` takes a local path, `github:owner/repo`, a full URL, or an object.

Rebuild the site afterwards — [Publish the register as a website](publish-site.md),
step 3, or let the container's `site` loop pick up the commit.

## 7. Verify

1. Open a page on the site. The widget appears below the content.
2. Sign in with one of the providers you enabled.
3. Post a comment, then reload the page.

If the widget never appears, or sign-in fails, check `host` against `REMARK_URL`
and `ALLOWED_HOSTS` against the address in the browser's location bar — those two
mismatches fail silently. See [troubleshooting](troubleshooting.md).

## See also

- [Publish the register as a website](publish-site.md)
- [Container guide](deploy-container.md) and [container reference](../reference/container.md)
- [Environment reference](../reference/environment.md)
- [Security](../explanation/security.md)
