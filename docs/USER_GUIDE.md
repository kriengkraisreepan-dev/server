# User Guide

For a new store only, sign in with username `admin` and password `123456789`. This is for the first login only; the application immediately requires a replacement password. Do not use the default password in daily operations.

Password rule: at least 8 characters. Numbers-only, letters-only, and mixed passwords are allowed. Passwords are stored with `crypto.scrypt`, never as plaintext.

## POS ordering (Sprint 8B)

Open **POS อาหาร/เครื่องดื่ม**, create a WALK_IN or TABLE draft, then add active products to the cart. The total shown is for products only and is not yet combined with the table charge. Use **ยืนยัน Order** to deduct tracked stock. A draft remains on the server when the browser is refreshed. OWNER and MANAGER can cancel a confirmed order with a reason; this restores tracked stock. Payment and combined billing are intentionally deferred to Sprint 8C.
