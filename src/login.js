const Apify = require('apify');

/**
 * Attempts log user into instagram with provided username and password
 * @param {String} username Username to use during login (can also be an email or telephone)
 * @param {String} password Password to  use during login
 * @param {Object} page Puppeteer Page object
 * @return Does not return anything
 */
const login = async (username, password, page) => {
    await Apify.utils.log.info(`Attempting to log in`);

    try {
        await page.goto('https://www.instagram.com/accounts/login/?source=auth_switcher');
        await page.waitForSelector('input[name="username"]');
        await page.waitForSelector('input[name="password"]');
        await page.waitForSelector('button[type="submit"]');

        await page.type('input[name="username"]', username, { delay: 80 });
        await page.type('input[name="password"]', password, { delay: 80 });
        await Apify.utils.sleep(1000);

        await page.click('button[type="submit"]');

        await page.waitForNavigation();

        await Apify.utils.log.info(`Successfully logged in`);
    } catch (error) {
        await Apify.utils.log.info('Failed to log in');
        await Apify.utils.log.error(error);
        process.exit(1);
    }
}

module.exports = {
    login,
};