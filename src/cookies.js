const { cookiesNotArray } = require('./errors');
const Apify = require('apify');
const crypto = require('crypto');

const processCookiesInput = (loginCookies) => {
    const cookiesStore = {};
    if (!Array.isArray(loginCookies)) throw cookiesNotArray();

    if (Array.isArray(loginCookies[0])) {
        for (const cookies of loginCookies) {
            cookiesStore[cookieKey(cookies)] = cookies;
        }
    } else {
        cookiesStore[cookieKey(loginCookies)] = loginCookies;
    }
    return { cookiesStore, usingLogin: Object.keys(cookiesStore).length > 0 };
}

const randomCookie = (cookiesStore) => {
    const keys = Object.keys(cookiesStore);
    const cookieKey = keys[(Math.floor(Math.random() * keys.length))];
    Apify.utils.log.debug(`Selected cookies session: ${cookieKey}`);
    const session = crypto.createHash('sha256').update(cookieKey).digest('hex')
    return { cookieKey, cookies: cookiesStore[cookieKey], session };
}

function cookieKey(cookies) {
    for (const cookie of cookies) {
        if (cookie.name === 'sessionid')
            return cookie.value;
    }
}

const cookiesCount = (cookiesStore) => {
    return Object.keys(cookiesStore).length;
}

const removeCookie = (cookiesStore, cookieKey) => {
    Apify.utils.log.info(`Removing cookies with session cookie: ${cookieKey}`);
    delete cookiesStore[cookieKey];
}

module.exports = {
    processCookiesInput,
    randomCookie,
    cookiesCount,
    removeCookie
}
