# Layanan backup SANSU: pg_dump terjadwal + salinan offsite (rclone, opsional, terenkripsi)
FROM postgres:18.6
RUN apt-get update \
 && apt-get install -y --no-install-recommends rclone openssl curl ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*
COPY backup.sh restore.sh external-backup.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/external-backup.sh
HEALTHCHECK --interval=10m --timeout=10s --start-period=30m \
  CMD find /backups/last-success -mmin -1560 | grep -q . || exit 1
ENTRYPOINT ["/usr/local/bin/backup.sh"]
CMD ["loop"]
