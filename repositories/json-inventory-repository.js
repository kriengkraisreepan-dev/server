class JsonInventoryRepository {
  constructor({ getStore, save }) { this.getStore = getStore; this.save = save; }
  collection(name) {
    const store = this.getStore();
    if (!Array.isArray(store[name])) store[name] = [];
    return store[name];
  }
  products() { return this.collection("products"); }
  categories() { return this.collection("productCategories"); }
  movements() { return this.collection("stockMovements"); }
  findProduct(id) { return this.products().find(product => product.id === id) || null; }
  findCategory(id) { return this.categories().find(category => category.id === id) || null; }
  saveProduct(product) { const items = this.products(); const index = items.findIndex(item => item.id === product.id); if (index < 0) items.push(product); else items[index] = product; this.save(); return product; }
  saveCategory(category) { const items = this.categories(); const index = items.findIndex(item => item.id === category.id); if (index < 0) items.push(category); else items[index] = category; this.save(); return category; }
  appendMovement(movement) { this.movements().unshift(movement); this.save(); return movement; }
  persist() { this.save(); }
}

module.exports = { JsonInventoryRepository };
