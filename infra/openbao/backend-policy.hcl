# Operator provisions a derived, non-exportable, non-convergent aes256-gcm96 key.
# Application can only wrap and verify/unwrap via its own authorized workflows.
path "transit/encrypt/polylink-vault" { capabilities = ["update"] }
path "transit/decrypt/polylink-vault" { capabilities = ["update"] }
path "auth/token/lookup-self" { capabilities = ["read"] }
path "auth/token/renew-self" { capabilities = ["update"] }
