# MinIO als Railway-Dienst (S3-kompatibler Objektspeicher).
# Railway kann keinen Start-Befehl setzen — daher fest im Image.
# Volume auf /data mounten, öffentliche Domain auf Port 9000.
FROM minio/minio:latest
EXPOSE 9000 9001
CMD ["server", "/data", "--console-address", ":9001"]
