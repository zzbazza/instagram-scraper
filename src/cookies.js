const { cookiesNotArray } = require('./errors');
const Apify = require('apify');
const { utils: { log } } = Apify;

const LoginCookiesStore = class CookiesStore {
    cookiesStorage = 'LOGIN_COOKIES_STORE';
    cookiesStore = {};
    invalidCookiesStore = {};
    loginEnabled = false;
    puppeteerPool = null;
    autoscaledPool = null;
    cookiesPerConcurrency = 1;

    constructor(loginCookies, cookiesPerConcurrency = 1, maxErrorCount = 3) {
        if (!loginCookies) return;
        if (!Array.isArray(loginCookies)) throw cookiesNotArray();

        if (Array.isArray(loginCookies[0])) {
            for (const cookies of loginCookies) {
                this.buildCookie(cookies);
            }
        } else {
            this.buildCookie(loginCookies);
        }
        this.loginEnabled = true;
        this.cookiesPerConcurrency = cookiesPerConcurrency;
        this.maxErrorCount = maxErrorCount;

        Apify.events.on('persistState', async (_o) => {
            await this.storeCookiesSession();
        });
    }

    buildCookie(loginCookies) {
        const key = this.cookieKey(loginCookies);
        this.cookiesStore[key] = {};
        this.cookiesStore[key]['cookies'] = loginCookies;
        this.cookiesStore[key].browserPid = null;
        this.cookiesStore[key].errorCount = 0;
    }

    usingLogin() {
        return this.loginEnabled;
    }

    concurrency() {
        if (this.cookiesCount() < this.cookiesPerConcurrency) return 1;
        return Math.floor(this.cookiesCount() / this.cookiesPerConcurrency);
    }

    randomCookie(browserPid = null) {
        if (!this.usingLogin()) return null;

        // check active instances && cleanup used cookies
        if (this.puppeteerPool) {
            const pids = this.activeBrowserPids(this.puppeteerPool);
            for (const key in this.cookiesStore) {
                if (this.cookiesStore[key].browserPid && !pids.includes(this.cookiesStore[key].browserPid))
                    this.releaseCookie(key);
            }
        }

        const keys = []
        for (const key in this.cookiesStore) {
            if (!this.cookiesStore[key].browserPid) keys.push(key)
        }
        if (keys.length === 0) return null;

        const cookieKey = keys[(Math.floor(Math.random() * keys.length))];
        this.cookiesStore[cookieKey].browserPid = browserPid;
        log.debug(`Selected cookies session: ${cookieKey}`);
        return this.cookiesStore[cookieKey]['cookies'];
    }

    releaseCookie(cookieKey) {
        this.cookiesStore[cookieKey].browserPid = null;
    }

    cookiesCount() {
        return Object.keys(this.cookiesStore).length;
    }

    markAsBad(browserPid) {
        const cookieKey = this.browserCookies(browserPid);
        if (!this.cookiesStore[cookieKey]) return;

        if (this.cookiesStore[cookieKey].errorCount >= this.maxErrorCount) {
            log.warning(`Removing cookies with session cookie: ${cookieKey}`);
            this.invalidateCookies(cookieKey);
        } else {
            this.cookiesStore[cookieKey].errorCount += 1;
            log.debug(`Increment error count to: ${this.cookiesStore[cookieKey].errorCount}`);
        }
    }

    retire(browserPid) {
        const cookieKey = this.browserCookies(browserPid);
        if (!this.cookiesStore[cookieKey]) return;
        log.warning(`Retiring cookies with session cookie: ${cookieKey}`);

        this.invalidateCookies(cookieKey);
    }

    invalidateCookies(cookieKey) {
        this.invalidCookiesStore[cookieKey] = { ...this.cookiesStore[cookieKey] };

        delete this.cookiesStore[cookieKey];
        if (this.autoscaledPool) {
            this.autoscaledPool.maxConcurrency = this.concurrency();
            log.warning(`Drop max concurrency to ${this.concurrency()} due to small amount of usable cookies.`)
        } else log.warning('AutoscaledPool missing for LoginCookiesStore');
    }

    markAsGood(browserPid) {
        const cookieKey = this.browserCookies(browserPid);
        if (!this.cookiesStore[cookieKey]) return;
        this.cookiesStore[cookieKey].errorCount = 0;
    }

    browserCookies(browserPid) {
        for (const key in this.cookiesStore) {
            if (this.cookiesStore[key].browserPid === browserPid)
                return key;
        }
    }

    invalidCookies() {
        return Object.keys(this.invalidCookiesStore);
    }

    setPuppeteerPool(puppeteerPool) {
        if (!this.puppeteerPool)
            this.puppeteerPool = puppeteerPool;
    }

    setAutoscaledPool(autoscaledPool) {
        if (!this.autoscaledPool)
            this.autoscaledPool = autoscaledPool;
    }

    activeBrowserPids() {
        const pids = [];
        const activeInstances = this.puppeteerPool.activeInstances;
        for (const key in activeInstances) {
            const browser = activeInstances[key];
            if (browser.childProcess)
                pids.push(browser.childProcess.pid);
        }
        return pids;
    }

    cookieKey(cookies) {
        for (const cookie of cookies) {
            if (cookie.name === 'sessionid')
                return cookie.value;
        }
    }

    async storeCookiesSession() {
        const storage = await Apify.openKeyValueStore();
        await storage.setValue(this.cookiesStorage, this.toJson());
    }

    async loadCookiesSession() {
        const storage = await Apify.openKeyValueStore();
        const state = await storage.getValue(this.cookiesStorage);
        if (state && state.cookiesStore) {
            this.cookiesStore = state.cookiesStore;
            this.invalidCookiesStore = state.invalidCookiesStore;
        }
    }

    toJson() {
        return {
            cookiesStore: this.cookiesStore,
            invalidCookiesStore: this.invalidCookiesStore,
            loginEnabled: this.loginEnabled,
            cookiesPerConcurrency: this.cookiesPerConcurrency,
        }
    }
}

module.exports = {
    LoginCookiesStore,
}
