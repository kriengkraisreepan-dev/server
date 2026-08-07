# Phase 5.5 Wizard and Reauthentication — Revision 2

The packaged Generic Wizard does not accept a Device Key. Existing-machine authentication uses the unique key already protected by the Windows DPAPI vault. New-install authentication uses only the transaction-bound pending enrollment secret in Backend memory. Cross-machine records use Setup Code plus USB transactional rotation.

No fallback to the bootstrap key is allowed. Missing vault data, DPAPI decryption failure, duplicate identity, ambiguous identity, and `REAUTHENTICATION_REQUIRED` fail closed to the USB workflow. Verification uses the read-only nonce/HMAC endpoint and does not change Relay state.
