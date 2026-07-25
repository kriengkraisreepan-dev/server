# Offline License Architecture — Sprint -1

## Recommendation

Use a signed **license file** (for example `license.lucky.json`) containing a canonical JSON payload and a detached Base64 signature. Prefer Ed25519 for compact signatures and straightforward offline verification. The License Manager holds the Ed25519 private key; Lucky Snooker Manager embeds only the public key.

Example logical payload (illustrative, not a production key or format):

```json
{
  "licenseVersion": 1,
  "licenseId": "LIC-...",
  "customerId": "CUST-...",
  "customerName": "...",
  "shopName": "...",
  "edition": "STANDARD",
  "enabledModules": ["core.tables", "standard.pos"],
  "issuedAt": "2026-07-26T00:00:00Z",
  "expiresAt": null,
  "lifetime": true,
  "allowedMajorVersion": 1,
  "machineBinding": null,
  "signature": "base64-ed25519-signature"
}
```

The signature must cover canonicalized payload bytes excluding `signature`. A license key that merely encodes edition text is rejected as a design: it is not tamper-resistant. A short activation key may be used as a customer-facing reference, but the signed file remains the source of entitlement.

## Key policy

- Generate a production private key once under an owner-controlled key-management policy; do not generate it at every build.
- Keep it only in Lucky License Manager's protected signing environment. It must never be committed, placed in `.env` distributed to customers, copied into a build, or sent to Lucky Snooker Manager.
- Store the public key as a versioned application asset. Support public-key rotation by trusting a small, versioned public-key set.
- Do not create a production private key in this sprint.

## Runtime flow and edition upgrade

1. Customer imports the signed file into User Data `license/`.
2. Startup verifies syntax, canonical payload, signature, dates, major-version policy, and optional machine binding.
3. The verified, in-memory feature set is supplied to backend module guards and renderer navigation.
4. Replacing a Standard license with a signed Pro license changes only entitlement. It must not reinstall the app or mutate unrelated user data/schema.
5. Expired/invalid/corrupt licenses enter a restricted, clearly explained state; do not trust cached editable claims.

## Machine binding and offline limits

Machine binding can reduce casual file copying but creates support burden after hardware/Windows changes. If used, derive a documented, privacy-minimized machine fingerprint, store only a hash in the license, and provide an owner-operated reissue workflow.

Offline revocation cannot be immediate: a license already delivered can continue to verify while offline. Future mitigations without making Sprint -1 online include expiry/renewal periods, signed revocation packages imported manually, support-issued replacement licenses, and optional periodic online revocation checks. None provides instant revocation to a permanently offline computer.

## Lucky License Manager

Build it as a separate owner-only desktop application with its own private database, customer/licensing history, export workflow, and audit log. It can issue, renew, upgrade, and mark licenses revoked internally. Internal revocation is not proof of remote revocation until the customer imports a later signed revocation package or connects to an opt-in service.
