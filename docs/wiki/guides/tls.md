# Serving Legion over HTTPS on your own name

Legion speaks in clear. That is harmless on a tailnet, which already encrypts every link, but it
closes a door: a browser refuses to register a service worker on an insecure origin. Without HTTPS,
no PWA and no push notification. So the certificate is not there to encrypt, it is there to unlock a
browser API.

This guide describes the chosen setup, and why each piece is there rather than another. The
underlying reasoning is in [[produit/decisions]], under "TLS comes back, because the browser
requires it".

## What the setup assumes

The control plane runs on a tailnet machine, listens in clear on port 8790, and serves the built UI on
the same port. A front end terminates TLS in front of it and relays. Node never sees the certificate,
which is exactly what we want: the day the infrastructure moves to the cloud, the front end changes
name and Node does not change a line.

This setup is only safe because the API requires an operator session. A relay makes every request
arrive from itself, so a guard authorising on address would authorise everything it relays. That
guard was removed on 13 September for this reason.

## DNS-01, and why not something else

The server is not reachable from the internet, and we do not want it to become so. Let's Encrypt
therefore cannot validate through HTTP-01, which needs to reach the machine's port 80. DNS-01 proves
ownership of the domain by placing a TXT record in the zone: nothing needs to get in.

A self-signed certificate (`tls internal`) looks simpler and will not work. The domain is under
`.dev`, which is on the browsers' HSTS preload list: they force HTTPS and refuse an unrecognised
certificate, with no way to click through.

## Port 443 may already be taken

Tailscale Funnel listens on 443 when active, bound to the tailnet addresses. Caddy then cannot take
that port. To check:

```
ss -tln | grep ':443 '
tailscale serve status
```

Funnel accepts only three ports: 443, 8443 and 10000. Moving it frees 443:

```
tailscale funnel --bg --https=8443 --set-path /webhooks http://127.0.0.1:8790/webhooks
tailscale funnel --https=443 off
```

That changes the public address of inbound webhooks. Two moves follow, both in the UI: set the new
public URL in System → General, and reconnect the webhook of each repository concerned. A hook
pointing at a base that changed is a dead hook, and it does not say so.

## The OVH credentials

They are created at `api.ovh.com/createToken` and give four values: endpoint (`ovh-eu`), application
key, application secret, consumer key.

The rights to grant, limited to the zone rather than all zones:

```
GET     /domain/zone/your-domain/*
POST    /domain/zone/your-domain/*
PUT     /domain/zone/your-domain/*
DELETE  /domain/zone/your-domain/*
```

Pick unlimited validity. An expiring token silently stops certificate renewal, and you find out two
months later, when the page no longer opens.

These four values grant the right to modify the zone's DNS. They live in the Caddy container's
environment, in a `chmod 600` file, never in a repository: a committed secret stays in the history even
after deletion.

## The image

A six-line Dockerfile is enough, placed next to the front end's configuration. The official image does
not ship the module; DNS modules are compiled into the binary.

```
docker build -t caddy-ovh:2.10 .
```

## The front end configuration

If Caddy already serves other services over plain HTTP, they are declared with an explicit `http://`
prefix, and that prefix is enough to keep them from any certificate attempt. A global
`auto_https off` then becomes unnecessary, and it would prevent the one site that needs a certificate
from getting it.

The block to add:

```
legion.your-domain {
	tls {
		dns ovh {
			endpoint {$OVH_ENDPOINT}
			application_key {$OVH_APPLICATION_KEY}
			application_secret {$OVH_APPLICATION_SECRET}
			consumer_key {$OVH_CONSUMER_KEY}
		}
	}
	reverse_proxy http://CONTROL_PLANE_ADDRESS:8790
}
```

The control plane's address depends on how it runs. In `host` network mode, it has no container name
to reach: Caddy reaches it through its own network's gateway, which
`docker network inspect <network> --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}'` gives.

## The DNS record

An `A` record pointing the subdomain at the machine's tailnet address. Publishing a tailnet address in
public DNS does not expose it: it leads nowhere for anyone not on the network.

## Checking

The certificate is obtained on first start and takes a minute, while the TXT record propagates.

```
docker logs caddy --tail 30
curl -sI https://legion.your-domain | head -3
```

A `200` and a valid certificate mean the PWA becomes possible. A DNS resolution error means the record
has not propagated yet; an authorisation error means the OVH token's rights do not cover the zone.

## See also

- [[produit/decisions]] for the reasoning, and what TLS revises
- [[guides/harnais]] for the repository's gates
