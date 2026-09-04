# Nightly off-site backup of the Liefdesnestje database and uploads.
# Runs as its own Railway cron service; see README.md in this folder.
#
# postgres:18-alpine gives us a pg_dump that matches the Railway Postgres
# major version (pg_dump must be >= the server version).
FROM postgres:18-alpine
RUN apk add --no-cache curl rclone ca-certificates
COPY run.sh /run.sh
RUN chmod +x /run.sh
ENTRYPOINT ["/run.sh"]
