const GEO_CACHE_KEY = 'hudaMarketRoutingIpGeo';
const COUNTRY_PARAM = 'country';
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

class HudaMarketRoutingBanner extends HTMLElement {
  config = null;
  messageElement = null;
  linkElement = null;
  dismissButton = null;
  resizeObserver = null;

  connectedCallback() {
    this.config = this.#readConfig();

    this.messageElement = this.querySelector('[data-huda-market-message]');
    this.linkElement = this.querySelector('[data-huda-market-link]');
    this.dismissButton = this.querySelector('[data-huda-market-dismiss]');

    this.#hide();
    if (!this.config) return;

    this.dismissButton?.addEventListener('click', this.#handleDismiss);
    this.#init();
  }

  disconnectedCallback() {
    this.dismissButton?.removeEventListener('click', this.#handleDismiss);
    this.resizeObserver?.disconnect();
  }

  async #init() {
    const config = this.config;
    if (!config) {
      this.#hide();
      return;
    }

    const geo = await this.#detectCountry();
    const countryCode = geo?.countryCode;
    if (!countryCode) {
      this.#hide();
      return;
    }

    const targetRegion = this.#findRegion(countryCode);
    if (
      !targetRegion?.regionCode ||
      !targetRegion.storeUrl ||
      !targetRegion.bannerMessage ||
      !targetRegion.ctaLabel
    ) {
      this.#hide();
      return;
    }

    if (targetRegion.regionCode === config.currentRegionCode) {
      this.#hide();
      return;
    }
    if (this.#isDismissed(targetRegion.regionCode)) {
      this.#hide();
      return;
    }

    this.#show(targetRegion, geo);
  }

  #readConfig() {
    const configElement = this.querySelector('[data-huda-market-config]');
    if (!configElement?.textContent) return null;

    try {
      const config = JSON.parse(configElement.textContent);
      const regions = Array.isArray(config.regions) ? config.regions : [];
      const currentRegionCode = this.#normalizeRegionCode(config.currentRegionCode);
      if (!currentRegionCode) return null;

      return {
        currentRegionCode,
        geoEndpoint:
          typeof config.geoEndpoint === 'string' ? config.geoEndpoint : '',
        regions: regions
          .map((region) => ({
              regionCode: this.#normalizeRegionCode(region.regionCode),
              regionName:
                typeof region.regionName === 'string' ? region.regionName : '',
              countryCodes: Array.isArray(region.countryCodes)
                ? region.countryCodes
                    .map((countryCode) => this.#normalizeCountryCode(countryCode))
                    .filter(Boolean)
                : [],
              storeUrl: typeof region.storeUrl === 'string' ? region.storeUrl : '',
              ctaLabel: typeof region.ctaLabel === 'string' ? region.ctaLabel : '',
              bannerMessage:
                typeof region.bannerMessage === 'string'
                  ? region.bannerMessage
                  : '',
            }))
          .filter(
            (region) =>
              Boolean(region.regionCode) && region.countryCodes.length > 0,
          ),
      };
    } catch (error) {
      console.warn('Huda market routing config could not be parsed.', error);
      return null;
    }
  }

  async #detectCountry() {
    const overrideCountry = this.#getCountryOverride();
    if (overrideCountry) {
      // ?country=XX is a QA/demo shortcut — lets a reviewer (or me on a Loom)
      // simulate any region without a VPN. We deliberately skip caching so each
      // visit honours whatever's in the URL.
      return {
        countryCode: overrideCountry,
        countryName: this.#getCountryName(overrideCountry),
      };
    }

    const cachedGeo = this.#readGeoCache();
    if (cachedGeo?.countryCode) return cachedGeo;

    try {
      const geoEndpoint = this.config?.geoEndpoint;
      if (!geoEndpoint) return null;

      const response = await fetch(geoEndpoint, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return null;

      const data = await response.json();
      const countryCode = this.#normalizeCountryCode(data.country_code || data.country || data.countryCode);
      if (!countryCode) return null;

      const geo = {
        countryCode,
        countryName: data.country_name || data.countryName || data.country || countryCode,
      };

      this.#writeGeoCache(geo);
      return geo;
    } catch (error) {
      console.warn('Huda market routing country detection failed.', error);
      return null;
    }
  }

  #getCountryOverride() {
    const params = new URLSearchParams(window.location.search);
    return this.#normalizeCountryCode(params.get(COUNTRY_PARAM));
  }

  #getCountryName(countryCode) {
    try {
      const DisplayNames = Intl.DisplayNames;
      if (!DisplayNames) return countryCode;

      const locale = document.documentElement.lang || navigator.language || 'en';
      return new DisplayNames(locale, { type: 'region' }).of(countryCode) || countryCode;
    } catch (_error) {
      return countryCode;
    }
  }

  #readGeoCache() {
    try {
      const cached = window.sessionStorage.getItem(GEO_CACHE_KEY);
      if (!cached) return null;

      const geo = JSON.parse(cached);
      const countryCode = this.#normalizeCountryCode(geo.countryCode);
      if (!countryCode) return null;

      return {
        countryCode,
        countryName: geo.countryName || countryCode,
      };
    } catch (_error) {
      return null;
    }
  }

  #writeGeoCache(geo) {
    try {
      window.sessionStorage.setItem(GEO_CACHE_KEY, JSON.stringify(geo));
    } catch (_error) {
      // sessionStorage can throw in private mode. Skipping the cache is fine —
      // we'll just hit the geo endpoint again on the next page load.
    }
  }

  #findRegion(countryCode) {
    const config = this.config;
    if (!config) return undefined;

    // If a country shows up in more than one entry, the first one in the
    // metaobject list wins. Admin should keep country codes unique in practice.
    return config.regions.find((region) => region.countryCodes.includes(countryCode));
  }

  #show(region, geo) {
    if (!this.messageElement || !this.linkElement) return;

    this.messageElement.textContent = this.#replaceTokens(region.bannerMessage, region, geo);
    this.linkElement.textContent = region.ctaLabel;
    this.linkElement.href = region.storeUrl;
    this.linkElement.hidden = false;
    this.dataset.targetRegion = region.regionCode;
    this.hidden = false;
    this.#watchStickyOffset();
  }

  #hide() {
    this.hidden = true;
    delete this.dataset.targetRegion;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    document.body.style.removeProperty('--huda-market-routing-banner-height');

    if (this.messageElement) {
      this.messageElement.textContent = '';
    }

    if (this.linkElement) {
      this.linkElement.textContent = '';
      this.linkElement.removeAttribute('href');
      this.linkElement.hidden = true;
    }
  }

  #replaceTokens(message, region, geo) {
    const replacements = {
      region_name: region.regionName || region.regionCode,
      country_code: geo.countryCode,
      country_name: geo.countryName || geo.countryCode,
    };

    return message.replace(
      /\[(region_name|country_code|country_name)\]/g,
      (_match, token) => replacements[token] || ''
    );
  }

  #watchStickyOffset() {
    this.#syncStickyOffset();

    if (!('ResizeObserver' in window)) return;

    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.#syncStickyOffset());
    this.resizeObserver.observe(this);
  }

  #syncStickyOffset() {
    document.body.style.setProperty(
      '--huda-market-routing-banner-height',
      `${this.offsetHeight}px`
    );
  }

  #handleDismiss = () => {
    const targetRegion = this.dataset.targetRegion;
    if (targetRegion) {
      try {
        window.sessionStorage.setItem(this.#dismissKey(targetRegion), 'true');
      } catch (_error) {
        // Private mode or quota — we still hide it for this view, but the
        // banner will come back on the next page load. Acceptable fallback.
      }
    }

    this.#hide();
  };

  #isDismissed(targetRegion) {
    try {
      return window.sessionStorage.getItem(this.#dismissKey(targetRegion)) === 'true';
    } catch (_error) {
      return false;
    }
  }

  #dismissKey(targetRegion) {
    return `hudaMarketRoutingDismissed:${this.config?.currentRegionCode || 'unknown'}:${targetRegion}`;
  }

  #normalizeCountryCode(value) {
    const countryCode = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return COUNTRY_CODE_PATTERN.test(countryCode) ? countryCode : '';
  }

  #normalizeRegionCode(value) {
    return typeof value === 'string' ? value.trim().toUpperCase() : '';
  }
}

if (!customElements.get('huda-market-routing-banner')) {
  customElements.define('huda-market-routing-banner', HudaMarketRoutingBanner);
}
