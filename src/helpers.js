const Apify = require('apify');
const errors = require('./errors');
const consts = require('./consts');

const { PAGE_TYPES, GRAPHQL_ENDPOINT } = consts;

/**
 * Takes object from _sharedData.entry_data and parses it into simpler object
 * @param {Object} entryData 
 */
const getItemSpec = (entryData) => {
    if (entryData.LocationsPage) {
        const itemData = entryData.LocationsPage[0].graphql.location;
        return {
            pageType: PAGE_TYPES.PLACE,
            id: itemData.slug,
            locationId: itemData.id,
            locationSlug: itemData.slug,
            locationName: itemData.name,
        };
    }

    if (entryData.TagPage) {
        const itemData = entryData.TagPage[0].graphql.hashtag;
        return {
            pageType: PAGE_TYPES.HASHTAG,
            id: itemData.name,
            tagId: itemData.id,
            tagName: itemData.name,
        };
    }

    if (entryData.ProfilePage) {
        const itemData = entryData.ProfilePage[0].graphql.user;
        return {
            pageType: PAGE_TYPES.PROFILE,
            id: itemData.username,
            userId: itemData.id,
            userUsername: itemData.username,
            userFullName: itemData.full_name,
        };
    }

    throw errors.unsupportedPage();
};

/**
 * Takes type of page and data loaded through GraphQL and outputs
 * correct list of posts based on the page type.
 * @param {String} pageType Type of page we are scraping posts from
 * @param {Object} data GraphQL data
 */
const getPostsFromGraphQL = (pageType, data) => {
    let timeline;
    switch (pageType) {
        case PAGE_TYPES.PLACE: 
            timeline = data.location.edge_location_to_media;
            break;
        case PAGE_TYPES.PROFILE: 
            timeline = data.user.edge_owner_to_timeline_media;
            break;
        case PAGE_TYPES.HASHTAG: 
            timeline = data.hashtag.edge_hashtag_to_media;
            break
    }
    const posts = timeline ? timeline.edges : [];
    const hasNextPage = timeline ? timeline.page_info.has_next_page : false;
    return { posts, hasNextPage };
}

/**
 * Takes type of page and it's initial loaded data and outputs
 * correct list of posts based on the page type.
 * @param {String} pageType Type of page we are scraping posts from
 * @param {Object} data GraphQL data
 */
const getPostsFromEntryData = (pageType, data) => {
    let pageData;
    switch (pageType) {
        case PAGE_TYPES.PLACE: 
            pageData = data.LocationsPage
            break;
        case PAGE_TYPES.PROFILE: 
            pageData = data.ProfilePage;
            break;
        case PAGE_TYPES.HASHTAG: 
            pageData = data.TagPage;
            break;
    }
    if (!pageData || !pageData.length) return null;

    return getPostsFromGraphQL(pageType, pageData[0].graphql);
}

/**
 * Takes page data containing type of page and outputs short label for log line
 * @param {Object} pageData Object representing currently loaded IG page
 */
const getLogLabel = (pageData) => {
    switch (pageData.pageType) {
        case PAGE_TYPES.PLACE: return `Place "${pageData.locationName}"`;
        case PAGE_TYPES.PROFILE: return `User "${pageData.userUsername}"`;
        case PAGE_TYPES.HASHTAG: return `Tag "${pageData.tagName}"`;
    }
}

/**
 * Takes page type and outputs variable that must be present in graphql query
 * @param {String} pageType 
 */
const getCheckedVariable = (pageType) => {
    switch (pageType) {
        case PAGE_TYPES.PLACE: return `%22id%22`;
        case PAGE_TYPES.PROFILE: return '%22id%22';
        case PAGE_TYPES.HASHTAG: return '%22tag_name%22';
    }
}

/**
 * Based on parsed data from current page saves a message into log with prefix identifying current page
 * @param {Object} pageData Parsed page data
 * @param {String} message Message to be outputed
 */
const log = (pageData, message) => {
    const label = getLogLabel(pageData);
    return Apify.utils.log.info(`${label}: ${message}`);
};

const loadMoreItems = async (pageData, page, retry = 0) => {
    await page.keyboard.press('PageUp');
    const checkedVariable = getCheckedVariable(pageData.pageType);
    const responsePromise = page.waitForResponse(
        (response) => {
            const responseUrl = response.url();
            return responseUrl.startsWith(GRAPHQL_ENDPOINT) 
                && responseUrl.includes(checkedVariable) 
                && responseUrl.includes('%22first%22')
        },
        { timeout: 20000 }
    );

    let scrolled;
    for (let i = 0; i < 10; i++) {
        scrolled = await Promise.all([
            page.evaluate(() => scrollBy(0, 9999999)),
            page.waitForRequest(
                (request) => {
                    const requestUrl = request.url();
                    return requestUrl.startsWith(GRAPHQL_ENDPOINT) 
                        && requestUrl.includes(checkedVariable) 
                        && requestUrl.includes('%22first%22')
                }, 
                {
                    timeout: 1000,
                }
            ).catch(() => null),
        ]);
        if (scrolled[1]) break;
    }

    let data = null;
    if (scrolled[1]){
        try {
            const response = await responsePromise;
            const json = await response.json();
            if (json) data = json['data'];
        } catch (error) {
            Apify.utils.log.error(error);
        }
    }

    if (!data && retry < 10 && (scrolled[1] || retry < 5)) {
        let retryDelay = retry ? ++retry * retry * 1000 : ++retry * 1000;
        log(pageData, `Retry scroll after ${retryDelay / 1000} seconds`);
        await page.waitFor(retryDelay);
        return await loadMoreItems(pageData, page, retry);
    }

    await page.waitFor(500);
    return data;
};

/**
 * Scrolls page and loads data until the limit is reached or the page has no more posts
 * @param {Object} pageData 
 * @param {Object} page 
 * @param {Object} request 
 * @param {Object} posts 
 * @param {Number} length 
 */
const finiteScroll = async (pageData, page, request, posts, length = 0) => {
    const data = await loadMoreItems(pageData, page);
    if (data) {
        const timeline = getPostsFromGraphQL(pageData.pageType, data);
        if (!timeline.hasNextPage) return;
    }

    if (posts[pageData.id].length < request.userData.limit && posts[pageData.id].length !== length) {
        await finiteScroll(pageData, page, request, posts, posts[pageData.id].length)
    }
};

module.exports = {
    getItemSpec,
    getPostsFromEntryData,
    getPostsFromGraphQL,
    getCheckedVariable,
    finiteScroll,
    log,
    loadMoreItems,
};