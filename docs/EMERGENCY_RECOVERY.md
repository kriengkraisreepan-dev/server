# Emergency Password Recovery

Use only when the OWNER has lost access. This recovery resets only the existing `admin` account; it never creates a user or changes business data.

Windows CMD:

```cmd
set LUCKY_EMERGENCY_RESET=1
node index.js
```

PowerShell:

```powershell
$env:LUCKY_EMERGENCY_RESET="1"
node index.js
```

Linux/macOS:

```bash
export LUCKY_EMERGENCY_RESET=1
node index.js
```

After a successful reset, sign in once as `admin` with `123456789`. The application forces an immediate password change. Remove the environment variable and restart in normal mode after recovery. The password is hashed with `crypto.scrypt`; plaintext is never saved to the JSON store or audit log.

If `admin` does not exist, recovery skips without creating it. The reset affects no other user, session, bill, table, product, member, or backup.
