const crypto = require("crypto");

const CATEGORY_STATUS = ["ACTIVE", "DISABLED"];
const PRODUCT_STATUS = ["ACTIVE", "DISABLED"];
const MOVEMENT_TYPES = ["INITIAL", "RECEIVE", "SALE", "RETURN", "ADJUST_IN", "ADJUST_OUT", "VOID_RESTORE"];
const DEFAULT_CATEGORIES = ["เครื่องดื่ม", "อาหาร", "ขนม", "อุปกรณ์", "อื่น ๆ"];

const text = value => String(value ?? "").trim();
const number = (value, label) => {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error(`${label} must be zero or greater`);
  return result;
};

class InventoryService {
  constructor(repository, { clock = () => new Date(), audit = () => {} } = {}) {
    this.repository = repository;
    this.clock = clock;
    this.audit = audit;
  }
  now() { return this.clock().toISOString(); }
  normalizeLegacyProducts() {
    let changed = false;
    for (const product of this.repository.products()) {
      if (!product.id) { product.id = crypto.randomUUID(); changed = true; }
      if (product.sku === undefined) { product.sku = ""; changed = true; }
      if (product.categoryId === undefined) { product.categoryId = ""; changed = true; }
      if (product.categoryName === undefined) { product.categoryName = text(product.category) || "อื่น ๆ"; changed = true; }
      if (product.cost === undefined) { product.cost = 0; changed = true; }
      if (product.trackStock === undefined) { product.trackStock = false; changed = true; }
      if (product.stockQuantity === undefined) { product.stockQuantity = 0; changed = true; }
      if (product.lowStockThreshold === undefined) { product.lowStockThreshold = 0; changed = true; }
      if (!product.status) { product.status = product.active === false ? "DISABLED" : "ACTIVE"; changed = true; }
      if (product.active === undefined) { product.active = product.status === "ACTIVE"; changed = true; }
      if (!product.createdAt) { product.createdAt = this.now(); changed = true; }
      if (!product.updatedAt) { product.updatedAt = product.createdAt; changed = true; }
      if (product.createdBy === undefined) { product.createdBy = "SYSTEM"; changed = true; }
      if (product.updatedBy === undefined) { product.updatedBy = product.createdBy; changed = true; }
    }
    if (changed) this.repository.persist();
    return this.repository.products();
  }
  ensureDefaultCategories() {
    const categories = this.repository.categories();
    if (categories.length) return categories;
    const now = this.now();
    DEFAULT_CATEGORIES.forEach((name, index) => categories.push({ id: crypto.randomUUID(), name, status: "ACTIVE", sortOrder: index + 1, createdAt: now, updatedAt: now }));
    this.repository.persist();
    return categories;
  }
  listCategories(role = "OWNER") {
    this.ensureDefaultCategories();
    return this.repository.categories()
      .filter(category => role !== "STAFF" || category.status === "ACTIVE")
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map(category => ({ ...category }));
  }
  publicProduct(product) { return { ...product, active: product.status === "ACTIVE", isLowStock: !!product.trackStock && product.stockQuantity <= product.lowStockThreshold, isOutOfStock: !!product.trackStock && product.stockQuantity === 0 }; }
  listProducts(query = {}, role = "OWNER") {
    this.normalizeLegacyProducts();
    const search = text(query.search).toLowerCase();
    const category = text(query.category);
    const status = text(query.status).toUpperCase();
    const lowStock = String(query.lowStock || "").toLowerCase() === "true";
    let items = this.repository.products().filter(product => {
      if (role === "STAFF" && product.status !== "ACTIVE") return false;
      if (search && ![product.sku, product.name, product.categoryName, product.category].some(value => text(value).toLowerCase().includes(search))) return false;
      if (category && product.categoryId !== category && product.categoryName !== category && product.category !== category) return false;
      if (status && product.status !== status) return false;
      if (lowStock && (!product.trackStock || product.stockQuantity > product.lowStockThreshold)) return false;
      return true;
    }).map(product => this.publicProduct(product));
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const pageSize = Math.min(1000, Math.max(1, Number.parseInt(query.pageSize, 10) || 50));
    const total = items.length;
    return { items: items.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, pagination: { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) } };
  }
  getProduct(id, role) { const product = this.repository.findProduct(id); if (!product || (role === "STAFF" && product.status !== "ACTIVE")) return null; return this.publicProduct(product); }
  createCategory(input, actorId) {
    const name = text(input.name);
    if (!name) throw new Error("Category name is required");
    if (this.repository.categories().some(item => item.name.toLowerCase() === name.toLowerCase())) throw new Error("Category name already exists");
    const now = this.now();
    const category = { id: crypto.randomUUID(), name, status: "ACTIVE", sortOrder: Number.isInteger(Number(input.sortOrder)) ? Number(input.sortOrder) : this.repository.categories().length + 1, createdAt: now, updatedAt: now };
    this.repository.saveCategory(category); this.audit("CATEGORY_CREATED", actorId, { after: category }); return category;
  }
  updateCategory(id, input, actorId) {
    const category = this.repository.findCategory(id); if (!category) throw new Error("Category not found");
    const before = { ...category };
    if (input.name !== undefined) { const name = text(input.name); if (!name) throw new Error("Category name is required"); if (this.repository.categories().some(item => item.id !== id && item.name.toLowerCase() === name.toLowerCase())) throw new Error("Category name already exists"); category.name = name; }
    if (input.sortOrder !== undefined && (!Number.isInteger(Number(input.sortOrder)) || Number(input.sortOrder) < 1)) throw new Error("Invalid category sort order");
    if (input.sortOrder !== undefined) category.sortOrder = Number(input.sortOrder);
    category.updatedAt = this.now();
    for (const product of this.repository.products()) if (product.categoryId === id) product.categoryName = category.name;
    this.repository.saveCategory(category); this.audit("CATEGORY_UPDATED", actorId, { before, after: category }); return category;
  }
  changeCategoryStatus(id, status, actorId) {
    const category = this.repository.findCategory(id); if (!category) throw new Error("Category not found");
    if (!CATEGORY_STATUS.includes(status)) throw new Error("Invalid category status");
    const before = { ...category }; category.status = status; category.updatedAt = this.now(); this.repository.saveCategory(category); this.audit(status === "ACTIVE" ? "CATEGORY_ENABLED" : "CATEGORY_DISABLED", actorId, { before, after: category }); return category;
  }
  validateProduct(input, existing = null) {
    const product = { ...existing };
    if (input.sku !== undefined) product.sku = text(input.sku);
    if (input.name !== undefined) product.name = text(input.name);
    if (!product.name) throw new Error("Product name is required");
    if (input.price !== undefined) product.price = number(input.price, "Price");
    if (input.cost !== undefined) product.cost = number(input.cost, "Cost");
    if (input.lowStockThreshold !== undefined) product.lowStockThreshold = number(input.lowStockThreshold, "Low stock threshold");
    if (input.trackStock !== undefined) product.trackStock = input.trackStock === true || input.trackStock === "true";
    if (input.status !== undefined) { const status = text(input.status).toUpperCase(); if (!PRODUCT_STATUS.includes(status)) throw new Error("Invalid product status"); product.status = status; product.active = status === "ACTIVE"; }
    if (input.categoryId !== undefined) product.categoryId = text(input.categoryId);
    const category = product.categoryId ? this.repository.findCategory(product.categoryId) : null;
    if (product.categoryId && !category) throw new Error("Category not found");
    if (category) product.categoryName = category.name;
    if (!product.categoryName) product.categoryName = text(input.categoryName) || text(product.category) || "อื่น ๆ";
    if (product.sku && this.repository.products().some(item => item.id !== product.id && text(item.sku).toLowerCase() === product.sku.toLowerCase())) throw new Error("SKU already exists");
    return product;
  }
  createProduct(input, actorId) {
    this.ensureDefaultCategories();
    const now = this.now();
    const product = this.validateProduct(input, { id: crypto.randomUUID(), sku: "", name: "", categoryId: "", categoryName: "อื่น ๆ", price: 0, cost: 0, trackStock: true, stockQuantity: 0, lowStockThreshold: 0, status: "ACTIVE", active: true, createdAt: now, updatedAt: now, createdBy: actorId, updatedBy: actorId });
    const initialStock = number(input.initialStock ?? input.stockQuantity ?? 0, "Initial stock");
    product.stockQuantity = 0;
    this.repository.saveProduct(product); this.audit("PRODUCT_CREATED", actorId, { after: product });
    if (product.trackStock && initialStock > 0) this.recordMovement(product, "INITIAL", initialStock, "Initial stock", "PRODUCT", product.id, actorId);
    return this.publicProduct(product);
  }
  updateProduct(id, input, actorId) {
    const current = this.repository.findProduct(id); if (!current) throw new Error("Product not found");
    this.normalizeLegacyProducts(); const product = this.repository.findProduct(id); const before = { ...product };
    this.validateProduct(input, product); product.active = product.status === "ACTIVE"; product.updatedAt = this.now(); product.updatedBy = actorId; this.repository.saveProduct(product); this.audit("PRODUCT_UPDATED", actorId, { before, after: product }); return this.publicProduct(product);
  }
  changeProductStatus(id, status, actorId) {
    const product = this.repository.findProduct(id); if (!product) throw new Error("Product not found"); if (!PRODUCT_STATUS.includes(status)) throw new Error("Invalid product status");
    const before = { ...product }; product.status = status; product.active = status === "ACTIVE"; product.updatedAt = this.now(); product.updatedBy = actorId; this.repository.saveProduct(product); this.audit(status === "ACTIVE" ? "PRODUCT_ENABLED" : "PRODUCT_DISABLED", actorId, { before, after: product }); return this.publicProduct(product);
  }
  recordMovement(product, type, quantityChange, reason, referenceType, referenceId, actorId) {
    if (!MOVEMENT_TYPES.includes(type)) throw new Error("Invalid stock movement type");
    const before = product.stockQuantity; const after = before + quantityChange;
    if (after < 0) throw new Error("Stock cannot be negative");
    product.stockQuantity = after; product.updatedAt = this.now(); product.updatedBy = actorId; this.repository.saveProduct(product);
    const movement = { id: crypto.randomUUID(), productId: product.id, type, quantityBefore: before, quantityChange, quantityAfter: after, reason: text(reason), referenceType: referenceType || "", referenceId: referenceId || "", createdAt: this.now(), createdBy: actorId };
    this.repository.appendMovement(movement); return movement;
  }
  receiveStock(id, input, actorId) { const product = this.repository.findProduct(id); if (!product) throw new Error("Product not found"); if (!product.trackStock) throw new Error("This product does not track stock"); const quantity = number(input.quantity, "Receive quantity"); if (quantity <= 0) throw new Error("Receive quantity must be greater than zero"); const movement = this.recordMovement(product, "RECEIVE", quantity, input.reason, "RECEIVE", input.referenceId, actorId); this.audit("STOCK_RECEIVED", actorId, { before: movement.quantityBefore, after: movement.quantityAfter, reason: movement.reason, movementId: movement.id, productId: id }); return { product: this.publicProduct(product), movement }; }
  adjustStock(id, input, actorId) { const product = this.repository.findProduct(id); if (!product) throw new Error("Product not found"); if (!product.trackStock) throw new Error("This product does not track stock"); const quantity = Number(input.quantityChange); if (!Number.isFinite(quantity) || quantity === 0) throw new Error("Adjustment quantity cannot be zero"); const reason = text(input.reason); if (!reason) throw new Error("Adjustment reason is required"); const movement = this.recordMovement(product, quantity > 0 ? "ADJUST_IN" : "ADJUST_OUT", quantity, reason, "ADJUST", input.referenceId, actorId); this.audit("STOCK_ADJUSTED", actorId, { before: movement.quantityBefore, after: movement.quantityAfter, reason, movementId: movement.id, productId: id }); return { product: this.publicProduct(product), movement }; }
  getStockMovements(id, query = {}) { if (!this.repository.findProduct(id)) throw new Error("Product not found"); const page = Math.max(1, Number.parseInt(query.page, 10) || 1), pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize, 10) || 50)), total = this.repository.movements().filter(item => item.productId === id).length, all = this.repository.movements().filter(item => item.productId === id); return { items: all.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, pagination: { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) } }; }
}

module.exports = { InventoryService, DEFAULT_CATEGORIES, MOVEMENT_TYPES };
