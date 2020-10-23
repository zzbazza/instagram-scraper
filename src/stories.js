const Apify = require('apify');
const { utils: { requestAsBrowser } } = Apify;
const { storiesNotLoaded } = require('./errors');

/**
 * Takes type of page and data loaded through GraphQL and outputs
 * list of stories.
 * @param {Object} data GraphQL data
 */
const getStoriesFromGraphQL = (data) => {
    if (!data) return;
    const { reels_media } = data;
    const itemsExists = reels_media && reels_media[0] && reels_media[0] && reels_media[0].items;

    const storyItems = itemsExists ? reels_media[0].items : [];
    const storiesCount = itemsExists ? storyItems.length : null;

    return { stories: storyItems, storiesCount };
};

/**
 * Takes GraphQL response, checks that it's a response with more stories and then parses the stories from it
 * @param {Object} response Puppeteer Response object
 */
async function handleStoriesGraphQLResponse(response) {
    const responseUrl = response.url;
    // Check queries for other stuff then stories
    if (!responseUrl.includes('%22reel_ids%22')) return;

    const data = await JSON.parse(response.body);
    const timeline = getStoriesFromGraphQL(data.data);

    Apify.utils.log.info(`Scraped ${timeline.storiesCount} stories`);
    await Apify.pushData(timeline.stories);
}

/**
 * Make XHR request to get stories data and store them to dataset
 * @param {Request} request - request object of main page
 * @param {PuppeteerPage} page - page object
 * @param {Object} data - data object loaded from init page
 * @param {CookiesStore} loginCookiesStore - cookieStore object
 * @returns {Promise<void>}
 */
const scrapeStories = async (request, page, data, loginCookiesStore) => {
    const browser = await page.browser();
    if (!data.entry_data.StoriesPage) {
        Apify.utils.log.warning(`No stories for ${request.url}`);
        return;
    }
    const reelId = data.entry_data.StoriesPage[0].user.id;
    const url = `https://www.instagram.com/graphql/query/?query_hash=c9c56db64beb4c9dea2d17740d0259d9&variables=%7B%22reel_ids%22%3A%5B%22${reelId}%22%5D%2C%22tag_names%22%3A%5B%5D%2C%22location_ids%22%3A%5B%5D%2C%22highlight_reel_ids%22%3A%5B%5D%2C%22precomposed_overlay%22%3Afalse%2C%22show_story_viewer_list%22%3Atrue%2C%22story_viewer_fetch_count%22%3A50%2C%22story_viewer_cursor%22%3A%22%22%2C%22stories_video_dash_manifest%22%3Afalse%7D`;
    const cookies = await page.cookies();
    let serializedCookies = '';
    for (const cookie of cookies) {
        serializedCookies += `${cookie.name}=${cookie.value}; `;
    }
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const headers = {
        referer: request.url,
        "x-csrftoken": data.config.csrf_token,
        cookie: serializedCookies,
        "access-control-expose-headers": 'X-IG-Set-WWW-Claim',
        accept: '*/*',
        'accept-encoding': 'gzip, deflate, br',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'x-ig-app-id': '936619743392459',
        'x-ig-www-claim': 'hmac.AR1-yiYTI0KAovABgcl_mYe5lSWZC3Jtjc8gMfXTp8Z2t6gQ',
        'x-requested-with': 'XMLHttpRequest',
        'user-agent': userAgent,
    }

    const proxyUrl = loginCookiesStore.proxyUrl(browser.process().pid);
    const res = await requestAsBrowser({
        url,
        timeoutSecs: 30,
        proxyUrl,
        headers,
    });

    if (res.statusCode === 200) {
        await handleStoriesGraphQLResponse(res);
    } else {
        throw storiesNotLoaded(reelId);
    }
}

module.exports = {
    scrapeStories,
};
