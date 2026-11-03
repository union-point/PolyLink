#!/bin/sh
set -eu
# Empty credential configuration enables anonymous S3 in SeaweedFS. Never start that way.
test -f /config/s3.json && test -s /config/s3.json
grep -Eq '"accessKey"[[:space:]]*:[[:space:]]*"[^"[:space:]]+' /config/s3.json
grep -Eq '"secretKey"[[:space:]]*:[[:space:]]*"[^"[:space:]]+' /config/s3.json
if grep -Eq '"name"[[:space:]]*:[[:space:]]*"anonymous"' /config/s3.json; then
  echo 'Anonymous S3 identities are not permitted' >&2
  exit 1
fi
exec weed filer -ip=filer -ip.bind=0.0.0.0 -master=master:9333 \
  -defaultStoreDir=/data/filer -s3 -s3.config=/config/s3.json \
  -s3.cert.file=/tls/server.crt -s3.key.file=/tls/server.key \
  -s3.port.https=8334 -s3.port.iceberg=0 -s3.port.lance=0
