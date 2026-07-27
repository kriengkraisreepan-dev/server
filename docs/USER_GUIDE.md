# User Guide

For a new store only, sign in with username `admin` and password `123456789`. This is for the first login only; the application immediately requires a replacement password. Do not use the default password in daily operations.

Password rule: at least 8 characters. Numbers-only, letters-only, and mixed passwords are allowed. Passwords are stored with `crypto.scrypt`, never as plaintext.

## POS ordering (Sprint 8B)

Open **POS อาหาร/เครื่องดื่ม**, create a WALK_IN or TABLE draft, then add active products to the cart. The total shown is for products only and is not yet combined with the table charge. Use **ยืนยัน Order** to deduct tracked stock. A draft remains on the server when the browser is refreshed. OWNER and MANAGER can cancel a confirmed order with a reason; this restores tracked stock. Payment and combined billing are intentionally deferred to Sprint 8C.

## Members and loyalty (Sprint 9A.1)

Use **สมาชิก** to search member code, name, phone, or email and view the point history. OWNER and MANAGER can add, edit, enable, or disable members; CASHIER and STAFF can only look up members. At table opening or when starting a walk-in POS draft, search and select an active member if applicable.

Points are granted only when a linked bill is paid: every complete 20 THB earns one point. A void reverses the points once. Receipts for linked members show the member snapshot, points earned by that bill, and balance after payment.

## Using points (Sprint 9B)

At a member's table or walk-in billing preview, enter points to use or choose **ใช้สูงสุด**. The system shows the discount and net total before a bill is created. Points are actually deducted only after payment confirmation; points earned are calculated from that discounted total. OWNER can change the reward value, minimum points, and whether table/walk-in or partial redemption is allowed.

## Table-time points hotfix

Members earn points only after a table bill is paid: each complete hour earns five points by default. Food, drinks, and walk-in sales do not earn points. Walk-in sales do not show or accept point redemption. The table billing preview shows the estimated points from completed playing time.
