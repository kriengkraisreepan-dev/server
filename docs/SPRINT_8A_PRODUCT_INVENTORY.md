# Sprint 8A — Product & Inventory Foundation

## Architecture

`Route → permission middleware → InventoryService → JsonInventoryRepository → data/store.json`.

Routes contain only HTTP handling. Product, category, validation, stock movement, and legacy normalization rules are in `services/inventory-service.js`.

## Data model

- `products[]`: `id`, `sku`, `name`, `categoryId`, `categoryName`, `price`, `cost`, `trackStock`, `stockQuantity`, `lowStockThreshold`, `status`, audit timestamps and actors. Legacy `category` and `active` remain for POS compatibility.
- `productCategories[]`: `id`, `name`, `status`, `sortOrder`, timestamps.
- `stockMovements[]`: immutable movement record with before/change/after quantities, reason, reference, time, and actor.

New stores with no category receive five default categories: เครื่องดื่ม, อาหาร, ขนม, อุปกรณ์, อื่น ๆ. Existing products are normalized additively. They default to `trackStock=false`, so existing sellable products never become unavailable just because stock data did not exist.

## API and permissions

| Method | Path | Permission |
|---|---|---|
| GET | `/api/products` and `/api/products/:id` | `product.view` |
| POST/PATCH | `/api/products` and `/api/products/:id` | `product.manage` |
| PATCH | `/api/products/:id/status` | `product.manage` |
| POST | `/api/products/:id/stock/receive` | `inventory.manage` |
| POST | `/api/products/:id/stock/adjust` | `inventory.manage` |
| GET | `/api/products/:id/stock-movements` | `product.view` |
| GET/POST/PATCH | `/api/product-categories` | view/manage respectively |
| PATCH | `/api/product-categories/:id/status` | `product.manage` |

OWNER has all access. MANAGER can manage product/category/stock. CASHIER has read-only product and stock access. STAFF receives active products/categories only. Backend permission middleware is enforced on every product/inventory endpoint.

## Validation and audit

SKU is unique when supplied; product name is required; prices, cost, thresholds, and stock values cannot be negative. Adjustments require a non-zero quantity and reason. Stock can never go below zero. Every stock change records a movement and relevant product/category/stock actions write an audit event with actor and before/after data.

## UI

OWNER and MANAGER see **จัดการสินค้า**. It provides search/category/status/low-stock filters, product CRUD, category creation/status, stock receive/adjust, movement history, loading/empty/error states, and system confirmation modals. Cashier/Staff do not see the management menu; backend authorization remains the source of truth.

## Test results

`node tests/sprint8a-products-inventory.test.js` passes: legacy compatibility, defaults, create/update validation, unique SKU, initial/receive/adjust movements, negative rejection, audit events, and role permissions. `node tests/sprint8a-product-routes.test.js` starts an isolated server with temporary data and verifies JSON responses for the product/category endpoints, 401 JSON for no session, and JSON 404 for unknown API routes. Sprint 5–7D and emergency-recovery regressions also pass.

## Manual browser checklist

1. OWNER: add category, add tracked product, receive stock, adjust stock, view movement, disable/enable it.
2. MANAGER: repeat management and stock actions.
3. CASHIER: verify product read endpoint succeeds and management endpoint is rejected with 403.
4. STAFF: verify only active product/category API data is returned and management endpoint is rejected with 403.
5. Reopen POS, Dashboard, Bills, Reports, Staff, and Sessions; confirm existing pages still render.

## Known limitations before Sprint 8B

- This sprint deliberately does not deduct stock on POS sale, return stock on void, or merge items with a bill. Those workflows belong to Sprint 8B.
- JSON remains the production runtime; no SQLite migration/cutover occurred.
- Manual browser validation still needs to be run on the shop device.
