import { ThemeEvents } from '@theme/events';
import { formatMoney } from '@theme/money-formatting';

const CART_DRAWER_OPEN_EVENT = 'dialog:open';
const REWARD_GIFT_PROPERTY = '_huda_cart_reward_gift';
const REWARD_GIFT_THRESHOLD_PROPERTY = '_huda_cart_reward_threshold';
const REWARD_GIFT_PROPERTY_VALUE = 'true';
const PREVIOUS_GIFTS_STORAGE_KEY = 'huda_cart_rewards_previous_gifts';
const DISMISSED_GIFTS_STORAGE_KEY = 'huda_cart_rewards_dismissed_gifts';

let rewardGiftSyncPromise = null;

class HudaCartRewards extends HTMLElement {
  config = null;
  configText = '';
  statusElement = null;
  progressElement = null;
  milestonesElement = null;
  cartDrawer = null;
  queuedRender = null;
  domObserver = null;
  refreshQueued = false;
  cartUpdateSequence = 0;
  pendingPrefetchedCart = null;

  connectedCallback() {
    this.config = this.#readConfig();
    if (!this.config || this.config.milestones.length === 0) {
      this.hidden = true;
      return;
    }

    this.#syncElements();
    this.#observeDom();

    this.#render(this.config.cartTotal);
    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    window.addEventListener('pageshow', this.#handlePageShow);

    this.cartDrawer = this.closest('cart-drawer-component');
    this.cartDrawer?.addEventListener(CART_DRAWER_OPEN_EVENT, this.#handleCartDrawerOpen);

    this.#refreshCart();
  }

  disconnectedCallback() {
    document.removeEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    window.removeEventListener('pageshow', this.#handlePageShow);
    this.cartDrawer?.removeEventListener(CART_DRAWER_OPEN_EVENT, this.#handleCartDrawerOpen);
    this.cartDrawer = null;
    this.domObserver?.disconnect();
    this.domObserver = null;
  }

  #readConfig() {
    const configFromDom = this.#readConfigFromDom();
    this.configText = configFromDom?.text || '';

    return configFromDom?.config || null;
  }

  #readConfigFromDom() {
    const configElement = this.querySelector('[data-huda-cart-rewards-config]');
    if (!configElement?.textContent) return null;

    try {
      const configText = configElement.textContent;
      const config = JSON.parse(configText);
      const milestones = Array.isArray(config.milestones) ? config.milestones : [];

      return {
        text: configText,
        config: {
          cartTotal: Number(config.cartTotal) || 0,
          itemCount: Number(config.itemCount) || 0,
          currency: typeof config.currency === 'string' ? config.currency : 'GBP',
          moneyFormat:
            typeof config.moneyFormat === 'string' ? config.moneyFormat : '{{amount}}',
          milestones: milestones
            .map((milestone) => ({
              title: typeof milestone.title === 'string' ? milestone.title : '',
              threshold: Number(milestone.threshold) || 0,
              beforeMessage:
                typeof milestone.beforeMessage === 'string' ? milestone.beforeMessage : '',
              unlockedMessage:
                typeof milestone.unlockedMessage === 'string' ? milestone.unlockedMessage : '',
              giftVariantId:
                Number(milestone.giftVariantId) > 0 ? Number(milestone.giftVariantId) : null,
            }))
            .filter((milestone) => Boolean(milestone.title) && milestone.threshold > 0)
            // We sort purely by spend — there's no hardcoded "shipping first, gift second"
            // order, so a merchandiser can slot a new tier anywhere by setting its amount.
            .sort((a, b) => a.threshold - b.threshold),
        },
      };
    } catch (error) {
      console.warn('Huda cart rewards config could not be parsed.', error);
      return null;
    }
  }

  #handleCartUpdate = (event) => {
    const detail = event.detail;

    // Skip events we fired ourselves, otherwise we'd loop back into another sync.
    if (
      detail?.sourceId === 'huda-cart-rewards' ||
      detail?.data?.source === 'huda-cart-rewards'
    ) {
      return;
    }

    this.cartUpdateSequence += 1;

    const cart = detail?.resource;
    if (cart && typeof cart.total_price === 'number') {
      this.#queueRender(this.#getQualifyingCartTotal(cart), this.#getQualifyingItemCount(cart));
    }

    // If the event already includes the cart line items, use it directly and
    // skip the extra /cart.js call. Otherwise we fetch it the normal way.
    const prefetchedCart = cart && Array.isArray(cart.items) ? cart : null;
    this.#queueRefreshCart(prefetchedCart);
  };

  #handlePageShow = (event) => {
    if (event.persisted) {
      this.#refreshCart();
    }
  };

  #handleCartDrawerOpen = () => {
    this.#refreshCart();
  };

  async #refreshCart(prefetchedCart = null) {
    const refreshSequence = this.cartUpdateSequence;

    try {
      const cart = prefetchedCart || (await this.#fetchCart());
      if (!cart || refreshSequence !== this.cartUpdateSequence) return;

      const syncedCart = await this.#syncRewardGifts(cart);
      const cartToRender = syncedCart || cart;
      this.#render(this.#getQualifyingCartTotal(cartToRender), this.#getQualifyingItemCount(cartToRender));

      if (syncedCart) {
        this.#dispatchCartUpdate(syncedCart);
      }
    } catch (error) {
      console.warn('Huda cart rewards could not refresh the cart.', error);
    }
  }

  async #fetchCart() {
    const root = window.Shopify.routes?.root || '/';
    const response = await fetch(`${root}cart.js`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;

    const cart = await response.json();
    if (typeof cart.total_price !== 'number') return null;

    return {
      total_price: cart.total_price,
      item_count: Number(cart.item_count) || 0,
      items: Array.isArray(cart.items) ? cart.items : [],
    };
  }

  #queueRefreshCart(prefetchedCart = null) {
    // Keep the latest cart the caller handed us so the microtask picks the
    // freshest one. If the newest caller didn't pass anything, we'll fetch.
    this.pendingPrefetchedCart = prefetchedCart;

    if (this.refreshQueued) return;
    this.refreshQueued = true;

    queueMicrotask(() => {
      this.refreshQueued = false;

      if (!this.isConnected) return;

      const cartForRefresh = this.pendingPrefetchedCart;
      this.pendingPrefetchedCart = null;
      this.#refreshCart(cartForRefresh);
    });
  }

  async #syncRewardGifts(cart) {
    if (!this.#hasConfiguredRewardGifts()) return null;

    if (!rewardGiftSyncPromise) {
      rewardGiftSyncPromise = this.#syncRewardGiftsNow(cart)
        .catch((error) => {
          console.warn('Huda cart rewards could not sync the reward gift.', error);
          return null;
        })
        .finally(() => {
          rewardGiftSyncPromise = null;
        });
    }

    return rewardGiftSyncPromise;
  }

  async #syncRewardGiftsNow(cart) {
    const config = this.config;
    if (!config) return null;

    const qualifyingTotal = this.#getQualifyingCartTotal(cart);
    const configuredGiftVariantIds = new Set(
      config.milestones
        .map((milestone) => milestone.giftVariantId)
        .filter((variantId) => typeof variantId === 'number' && variantId > 0)
        .map((variantId) => String(variantId)),
    );
    const rewardGiftItems = (cart.items || []).filter((item) => this.#isRewardGiftItem(item));
    const currentGiftVariantIds = new Set(
      rewardGiftItems.filter((item) => item.quantity > 0).map((item) => String(item.variant_id)),
    );

    const previousGifts = this.#readVariantSet(PREVIOUS_GIFTS_STORAGE_KEY);
    const dismissed = this.#readVariantSet(DISMISSED_GIFTS_STORAGE_KEY);

    // If a shopper removed a gift while still above the threshold, we don't want
    // the next sync to re-add it. Spot the removal by comparing what was in the
    // cart last time against now, then mark those variants as dismissed.
    for (const milestone of config.milestones) {
      if (!milestone.giftVariantId) continue;
      const variantKey = String(milestone.giftVariantId);
      if (
        qualifyingTotal >= milestone.threshold &&
        previousGifts.has(variantKey) &&
        !currentGiftVariantIds.has(variantKey)
      ) {
        dismissed.add(variantKey);
      }
    }

    // The dismissal is only meant to stick until the cart drops back below the
    // threshold. If it has, clear it so crossing the threshold again will re-add.
    for (const milestone of config.milestones) {
      if (!milestone.giftVariantId) continue;
      const variantKey = String(milestone.giftVariantId);
      if (qualifyingTotal < milestone.threshold) {
        dismissed.delete(variantKey);
      }
    }

    const eligibleGiftMilestones = config.milestones.filter(
      (milestone) =>
        milestone.giftVariantId &&
        configuredGiftVariantIds.has(String(milestone.giftVariantId)) &&
        qualifyingTotal >= milestone.threshold,
    );
    const eligibleGiftVariantIds = new Set(
      eligibleGiftMilestones.map((milestone) => String(milestone.giftVariantId)),
    );

    let latestCart = null;
    let didAddGift = false;

    for (const item of rewardGiftItems) {
      const variantId = String(item.variant_id);
      if (!configuredGiftVariantIds.has(variantId) || !eligibleGiftVariantIds.has(variantId)) {
        latestCart = (await this.#changeCartLine(item.key, 0)) || latestCart;
      } else if (item.quantity !== 1) {
        latestCart = (await this.#changeCartLine(item.key, 1)) || latestCart;
      }
    }

    const existingRewardGiftVariantIds = new Set(
      rewardGiftItems
        .filter((item) => item.quantity > 0)
        .map((item) => String(item.variant_id)),
    );

    for (const milestone of eligibleGiftMilestones) {
      const giftVariantId = Number(milestone.giftVariantId);
      const variantKey = String(giftVariantId);
      if (existingRewardGiftVariantIds.has(variantKey)) continue;
      if (dismissed.has(variantKey)) continue;

      await this.#addRewardGift(giftVariantId, milestone.threshold);
      existingRewardGiftVariantIds.add(variantKey);
      didAddGift = true;
    }

    this.#writeVariantSet(PREVIOUS_GIFTS_STORAGE_KEY, existingRewardGiftVariantIds);
    this.#writeVariantSet(DISMISSED_GIFTS_STORAGE_KEY, dismissed);

    // /cart/add.js only returns the new line, not the whole cart, so we have
    // to fetch when a gift was added. /cart/change.js already gives us the
    // full cart back, so pure removals can skip the extra call.
    if (didAddGift) return this.#fetchCart();
    return latestCart;
  }

  #readVariantSet(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
    } catch {
      return new Set();
    }
  }

  #writeVariantSet(key, set) {
    try {
      if (set.size === 0) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(Array.from(set)));
      }
    } catch {
      // localStorage can throw in private mode or when quota is hit. Worst case
      // here is that a manually removed gift re-adds itself once on the next sync.
    }
  }

  #hasConfiguredRewardGifts() {
    return Boolean(
      this.config?.milestones.some(
        (milestone) => typeof milestone.giftVariantId === 'number' && milestone.giftVariantId > 0,
      ),
    );
  }

  #getQualifyingCartTotal(cart) {
    const giftLineTotal = (cart.items || [])
      .filter((item) => this.#isRewardGiftItem(item))
      .reduce((total, item) => total + (Number(item.final_line_price ?? item.line_price) || 0), 0);

    return Math.max(Number(cart.total_price) - giftLineTotal, 0);
  }

  #getQualifyingItemCount(cart) {
    const giftQuantity = (cart.items || [])
      .filter((item) => this.#isRewardGiftItem(item))
      .reduce((total, item) => total + (Number(item.quantity) || 0), 0);

    return Math.max((Number(cart.item_count) || 0) - giftQuantity, 0);
  }

  #isRewardGiftItem(item) {
    const properties = item.properties || {};
    return String(properties[REWARD_GIFT_PROPERTY]) === REWARD_GIFT_PROPERTY_VALUE;
  }

  async #addRewardGift(variantId, threshold) {
    const response = await fetch(Theme.routes.cart_add_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        id: variantId,
        quantity: 1,
        properties: {
          [REWARD_GIFT_PROPERTY]: REWARD_GIFT_PROPERTY_VALUE,
          [REWARD_GIFT_THRESHOLD_PROPERTY]: String(threshold),
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Reward gift add failed with status ${response.status}`);
    }
  }

  async #changeCartLine(key, quantity) {
    const response = await fetch(Theme.routes.cart_change_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ id: key, quantity }),
    });

    if (!response.ok) {
      throw new Error(`Reward gift cart change failed with status ${response.status}`);
    }

    try {
      const cart = await response.json();
      if (typeof cart.total_price !== 'number') return null;
      return {
        total_price: cart.total_price,
        item_count: Number(cart.item_count) || 0,
        items: Array.isArray(cart.items) ? cart.items : [],
      };
    } catch {
      return null;
    }
  }

  #dispatchCartUpdate(cart) {
    document.dispatchEvent(
      new CustomEvent(ThemeEvents.cartUpdate, {
        detail: {
          resource: cart,
          sourceId: 'huda-cart-rewards',
          data: {
            source: 'huda-cart-rewards',
          },
        },
      }),
    );
  }

  // Horizon swaps the cart section's markup straight after cart:update fires,
  // which can wipe out the UI we just rendered. We push our update to the next
  // microtask so it lands after that swap, not before it.
  #queueRender(cartTotal, itemCount) {
    this.queuedRender = { cartTotal, itemCount };

    queueMicrotask(() => {
      if (!this.isConnected || !this.queuedRender) return;

      const queuedRender = this.queuedRender;
      this.queuedRender = null;
      this.#render(queuedRender.cartTotal, queuedRender.itemCount);
    });
  }

  #observeDom() {
    this.domObserver?.disconnect();
    this.domObserver = new MutationObserver(this.#handleDomMutation);
    this.domObserver.observe(this, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  #handleDomMutation = () => {
    if (!this.isConnected) return;

    this.#syncConfigFromDom();

    if (!this.config || this.config.milestones.length === 0) {
      this.hidden = true;
      return;
    }

    if (!this.#needsRender()) return;

    this.#queueRender(this.config.cartTotal, this.config.itemCount);
  };

  #syncConfigFromDom() {
    const configFromDom = this.#readConfigFromDom();
    if (!configFromDom || configFromDom.text === this.configText) return;

    this.config = configFromDom.config;
    this.configText = configFromDom.text;
  }

  #syncElements() {
    this.statusElement = this.querySelector('[data-huda-cart-rewards-status]');
    this.progressElement = this.querySelector('[data-huda-cart-rewards-progress]');
    this.milestonesElement = this.querySelector('[data-huda-cart-rewards-milestones]');
  }

  #needsRender() {
    const config = this.config;
    if (!config) return false;

    this.#syncElements();

    if (config.itemCount <= 0) {
      return !this.hidden;
    }

    if (!this.statusElement || !this.progressElement || !this.milestonesElement) {
      return false;
    }

    const highestThreshold = config.milestones[config.milestones.length - 1]?.threshold || 0;
    const expectedProgressValue = Math.min(config.cartTotal, highestThreshold);

    return (
      this.hidden ||
      this.dataset.hudaCartRewardsRenderedTotal !== String(config.cartTotal) ||
      this.dataset.hudaCartRewardsRenderedItems !== String(config.itemCount) ||
      this.progressElement.max !== highestThreshold ||
      this.progressElement.value !== expectedProgressValue ||
      this.milestonesElement.children.length !== config.milestones.length
    );
  }

  #render(cartTotal, itemCount = this.config?.itemCount) {
    const config = this.config;
    if (!config) return;

    this.#syncElements();

    const normalizedItemCount = Number(itemCount) || 0;
    config.cartTotal = cartTotal;
    config.itemCount = normalizedItemCount;
    this.dataset.hudaCartRewardsRenderedTotal = String(cartTotal);
    this.dataset.hudaCartRewardsRenderedItems = String(normalizedItemCount);

    if (normalizedItemCount <= 0) {
      this.hidden = true;
      return;
    }

    this.hidden = false;

    const highestThreshold = config.milestones[config.milestones.length - 1]?.threshold || 0;
    if (highestThreshold <= 0) return;

    const progressValue = Math.min(cartTotal, highestThreshold);
    const nextMilestone = config.milestones.find((milestone) => cartTotal < milestone.threshold);
    const unlockedMilestones = config.milestones.filter(
      (milestone) => cartTotal >= milestone.threshold,
    );
    const activeMessage = nextMilestone
      ? this.#formatMessage(nextMilestone.beforeMessage, nextMilestone.threshold - cartTotal)
      : unlockedMilestones[unlockedMilestones.length - 1]?.unlockedMessage || '';

    if (this.statusElement) {
      this.statusElement.textContent = activeMessage;
    }

    if (this.progressElement) {
      this.progressElement.max = highestThreshold;
      this.progressElement.value = progressValue;
      this.progressElement.setAttribute('aria-valuemax', highestThreshold.toString());
      this.progressElement.setAttribute('aria-valuenow', progressValue.toString());
      this.progressElement.setAttribute('aria-valuetext', activeMessage || '');
    }

    this.#renderMilestones(cartTotal);
  }

  #renderMilestones(cartTotal) {
    const config = this.config;
    if (!config || !this.milestonesElement) return;

    const highestThreshold = config.milestones[config.milestones.length - 1]?.threshold || 0;

    this.milestonesElement.replaceChildren(
      ...config.milestones.map((milestone) => {
        const isUnlocked = cartTotal >= milestone.threshold;
        const position = highestThreshold > 0 ? Math.min((milestone.threshold / highestThreshold) * 100, 100) : 0;
        const item = document.createElement('li');
        item.className = `huda-cart-rewards__milestone${isUnlocked ? ' huda-cart-rewards__milestone--unlocked' : ''}`;
        item.style.setProperty('--huda-cart-rewards-milestone-position', `${position}%`);

        const title = document.createElement('span');
        title.className = 'huda-cart-rewards__milestone-title';
        title.textContent = milestone.title;

        const threshold = document.createElement('span');
        threshold.className = 'huda-cart-rewards__milestone-threshold';
        threshold.textContent = this.#formatMoney(milestone.threshold);

        item.append(title, threshold);
        return item;
      }),
    );
  }

  #formatMessage(message, amountRemaining) {
    const template = message || '';
    return template.replace(
      /\[amount_remaining\]/g,
      this.#formatMoney(Math.max(amountRemaining, 0)),
    );
  }

  #formatMoney(value) {
    if (!this.config) return '';

    return formatMoney(value, this.config.moneyFormat, this.config.currency);
  }
}

if (!customElements.get('huda-cart-rewards')) {
  customElements.define('huda-cart-rewards', HudaCartRewards);
}
