ui = false
disable_mlock = true
api_addr = "https://localhost:18200"
cluster_addr = "https://127.0.0.1:8201"
storage "raft" {
  path = "/openbao/data"
  node_id = "polylink-1"
}
listener "tcp" {
  address = "0.0.0.0:8200"
  tls_cert_file = "/openbao/tls/server.crt"
  tls_key_file = "/openbao/tls/server.key"
  tls_min_version = "tls12"
}
