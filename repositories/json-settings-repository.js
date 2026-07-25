class JsonSettingsRepository {
  constructor({ getStore, save }) { this.getStore = getStore; this.save = save; }
  get() { return { ...this.getStore().settings }; }
  replace(settings) { this.getStore().settings = { ...settings }; this.save(); return this.get(); }
}
module.exports = { JsonSettingsRepository };
