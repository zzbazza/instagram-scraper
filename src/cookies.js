const { cookiesNotArray } = require('./errors');
const Apify = require('apify');

const LoginCookiesStore = class CookiesStore {
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
        const keys = []
        for (const key in this.cookiesStore) {
            if (!this.cookiesStore[key].browserPid) keys.push(key)
        }
        if (keys.length === 0) return null;
        // check active instances && cleanup used cookies
        if (this.puppeteerPool) {
            const pids = this.activeBrowserPids(this.puppeteerPool);
            for (const key in this.cookiesStore) {
                if (this.cookiesStore[key].browserPid && !pids.includes(this.cookiesStore[key].browserPid))
                    this.releaseCookie(key);
            }
        }

        const cookieKey = keys[(Math.floor(Math.random() * keys.length))];
        this.cookiesStore[cookieKey].browserPid = browserPid;
        Apify.utils.log.debug(`Selected cookies session: ${cookieKey}`);
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

        if (this.cookiesStore[cookieKey].errorCount > this.maxErrorCount) {
            Apify.utils.log.warning(`Removing cookies with session cookie: ${cookieKey}`);

            this.invalidCookiesStore[cookieKey] = { ...this.cookiesStore[cookieKey] };
            delete this.cookiesStore[cookieKey];

            if (this.autoscaledPool) {
                this.autoscaledPool.maxConcurrency = this.concurrency();
                Apify.utils.log.warning(`Drop max concurrency to ${this.concurrency()} due to small amount of usable cookies.`)
            } else Apify.utils.log.warning('AutoscaledPool missing for LoginCookiesStore')
        } else {
            this.cookiesStore[cookieKey].errorCount += 1;
        }
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
}

module.exports = {
    LoginCookiesStore,
}
