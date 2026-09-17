# Legion egress proxy — the egress wall as a per-session sidecar.
# Allowlist injected at run time via ALLOWED_HOSTS (comma-separated).
FROM alpine:3.21
# The package creates the `tinyproxy` system user (aports pre-install: `adduser -S -D -H`), and
# the proxy runs as it rather than root (05/09, audit wave 1): this sidecar parses untrusted
# traffic. Port 8888 is above 1024, so no capability is needed; with no `LogFile` or `PidFile`
# in the conf, tinyproxy writes nothing and logs to stdout under `-d`.
RUN apk add --no-cache tinyproxy
COPY tinyproxy.conf /etc/tinyproxy/tinyproxy.conf
COPY entrypoint.sh /entrypoint.sh
# The only file the entrypoint writes, created here and owned by that user so `>` can rewrite it
# without making /etc/tinyproxy (root, 755) writable. The conf stays root-owned.
RUN chmod +x /entrypoint.sh \
 && touch /etc/tinyproxy/allowlist.txt \
 && chown tinyproxy:tinyproxy /etc/tinyproxy/allowlist.txt
USER tinyproxy
ENTRYPOINT ["/entrypoint.sh"]
