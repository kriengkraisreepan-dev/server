(function (global) {
  "use strict";

  const THEME_KEY = "lucky.display.theme";
  const SCALE_KEY = "lucky.display.scale";
  const THEMES = Object.freeze(["dark", "light", "system"]);
  const SCALES = Object.freeze(["small", "normal", "large", "xlarge"]);

  class DisplayPreferencesService {
    constructor(options = {}) {
      this.root = options.root || global.document?.documentElement || null;
      this.storage = options.storage === undefined ? this.safeStorage() : options.storage;
      this.matchMedia = options.matchMedia || (typeof global.matchMedia === "function" ? global.matchMedia.bind(global) : null);
      this.theme = "dark";
      this.scale = "normal";
      this.storageAvailable = Boolean(this.storage);
      this.mediaQuery = null;
      this.listenerAttached = false;
      this.systemChange = () => {
        if (this.theme === "system") this.apply();
      };
    }

    safeStorage() {
      try {
        const storage = global.localStorage;
        if (!storage) return null;
        storage.getItem(THEME_KEY);
        return storage;
      } catch (_) {
        return null;
      }
    }

    validate(theme, scale) {
      return {
        theme: THEMES.includes(theme) ? theme : "dark",
        scale: SCALES.includes(scale) ? scale : "normal"
      };
    }

    read() {
      let theme;
      let scale;
      try {
        theme = this.storage?.getItem(THEME_KEY);
        scale = this.storage?.getItem(SCALE_KEY);
      } catch (_) {
        this.storageAvailable = false;
      }
      const valid = this.validate(theme, scale);
      this.theme = valid.theme;
      this.scale = valid.scale;
      return { ...valid, storageAvailable: this.storageAvailable };
    }

    resolvedTheme() {
      if (this.theme !== "system") return this.theme;
      try {
        return this.getMediaQuery()?.matches ? "dark" : "light";
      } catch (_) {
        return "dark";
      }
    }

    getMediaQuery() {
      if (!this.mediaQuery && this.matchMedia) this.mediaQuery = this.matchMedia("(prefers-color-scheme: dark)");
      return this.mediaQuery;
    }

    apply() {
      if (!this.root) return this.snapshot();
      this.root.dataset.themePreference = this.theme;
      this.root.dataset.resolvedTheme = this.resolvedTheme();
      this.root.dataset.uiScale = this.scale;
      return this.snapshot();
    }

    persist(key, value) {
      try {
        if (!this.storage) throw new Error("storage unavailable");
        this.storage.setItem(key, value);
        return true;
      } catch (_) {
        this.storageAvailable = false;
        return false;
      }
    }

    updateTheme(theme) {
      if (!THEMES.includes(theme)) return false;
      this.theme = theme;
      const persisted = this.persist(THEME_KEY, theme);
      this.subscribeToSystemTheme();
      this.apply();
      return persisted;
    }

    updateScale(scale) {
      if (!SCALES.includes(scale)) return false;
      this.scale = scale;
      const persisted = this.persist(SCALE_KEY, scale);
      this.apply();
      return persisted;
    }

    reset() {
      try {
        this.storage?.removeItem(THEME_KEY);
        this.storage?.removeItem(SCALE_KEY);
      } catch (_) {
        this.storageAvailable = false;
      }
      this.theme = "dark";
      this.scale = "normal";
      this.apply();
      return this.snapshot();
    }

    subscribeToSystemTheme() {
      const query = this.getMediaQuery();
      if (!query || this.listenerAttached) return false;
      if (typeof query.addEventListener === "function") query.addEventListener("change", this.systemChange);
      else if (typeof query.addListener === "function") query.addListener(this.systemChange);
      else return false;
      this.listenerAttached = true;
      return true;
    }

    snapshot() {
      return { theme: this.theme, resolvedTheme: this.resolvedTheme(), scale: this.scale, storageAvailable: this.storageAvailable };
    }
  }

  const service = new DisplayPreferencesService();
  service.read();
  service.subscribeToSystemTheme();
  service.apply();
  global.DisplayPreferencesService = DisplayPreferencesService;
  global.displayPreferences = service;
  if (typeof module !== "undefined" && module.exports) module.exports = { DisplayPreferencesService, THEME_KEY, SCALE_KEY, THEMES, SCALES };
})(typeof window !== "undefined" ? window : globalThis);
