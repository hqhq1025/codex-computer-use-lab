export class UrlPolicyModel {
  constructor({ checker, now = () => Date.now(), ttlMilliseconds = 1000 }) {
    this.checker = checker;
    this.now = now;
    this.ttlMilliseconds = ttlMilliseconds;
    this.cache = new Map();
    this.generation = 0;
    this.blocked = false;
    this.currentUrl = null;
  }

  async observe({ isWebBrowser, url }) {
    this.currentUrl = url ?? null;
    if (!isWebBrowser || !url) {
      this.blocked = false;
      return { blocked: false, checkerCalled: false };
    }

    const generation = ++this.generation;
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > this.now()) {
      this.blocked = !cached.isAllowed;
      return { blocked: this.blocked, checkerCalled: false };
    }

    let isAllowed;
    try {
      isAllowed = await this.checker(url);
    } catch {
      isAllowed = true;
    }
    this.cache.set(url, {
      isAllowed,
      expiresAt: this.now() + this.ttlMilliseconds
    });
    if (generation === this.generation) {
      this.blocked = !isAllowed;
    }
    return {
      blocked: this.blocked,
      checkerCalled: true
    };
  }

  assertActionAllowed() {
    if (this.blocked) {
      const error = new Error(
        "Computer Use is not allowed on the current browser URL"
      );
      error.code = -10015;
      error.errorName = "blockedURL";
      throw error;
    }
  }
}
