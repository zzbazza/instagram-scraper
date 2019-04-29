const Apify = require('apify');
const errors = require('./errors');
const consts = require('./consts');

const { PAGE_TYPES, GRAPHQL_ENDPOINT, REQUEST_TIMEOUT } = consts;

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
    switch (pageType) {
        case PAGE_TYPES.PLACE: return data.location.edge_location_to_media.edges;
        case PAGE_TYPES.PROFILE: return data.user.edge_owner_to_timeline_media.edges;
        case PAGE_TYPES.HASHTAG: return data.hashtag.edge_hashtag_to_media.edges;
    }
}

/**
 * Takes type of page and it's initial loaded data and outputs
 * correct list of posts based on the page type.
 * @param {String} pageType Type of page we are scraping posts from
 * @param {Object} data GraphQL data
 */
const getPostsFromEntryData = (pageType, data) => {
    switch (pageType) {
        case PAGE_TYPES.PLACE: return getPostsFromGraphQL(pageType, data.LocationsPage[0].graphql);
        case PAGE_TYPES.PROFILE: return getPostsFromGraphQL(pageType, data.ProfilePage[0].graphql);
        case PAGE_TYPES.HASHTAG: return getPostsFromGraphQL(pageType, data.TagPage[0].graphql);
    }
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

const wait = ms => new Promise(ok => setTimeout(ok, ms));

const log = (pageData, message) => {
    const label = getLogLabel(pageData);
    return Apify.utils.log.info(`${label}: ${message}`);
};

const loadMoreItems = async (pageData, page, retry = 0) => {
    await page.keyboard.press('PageUp');
    const checkedVariable = getCheckedVariable(pageData.pageType);
    const scrolled = await Promise.all([
        page.evaluate(() => scrollBy(0, 9999999)),
        page.waitForRequest(request => {
            return request.url().startsWith(GRAPHQL_ENDPOINT) && request.url().includes(checkedVariable)
        }, {
            REQUEST_TIMEOUT
        }).catch(() => null),
        page.waitForResponse(response => response.url().startsWith(GRAPHQL_ENDPOINT) && response.url().includes(checkedVariable), {
            REQUEST_TIMEOUT
        }).catch(() => null)
    ]);

    const data = scrolled[2] && (await scrolled[2].json().catch(() => ({})))['data'];
    const retryAttempts = pageData.pageType === PAGE_TYPES.HASHTAG ? 100 : 10;
    if (!data && retry < retryAttempts && (scrolled[1] || retry < 5)) {
        let retryDelay = retry ? ++retry * retry * REQUEST_TIMEOUT : ++retry * REQUEST_TIMEOUT;
        if (!scrolled[1] && pageData.pageType === PAGE_TYPES.HASHTAG) retryDelay = 100;
        log(pageData, `Retry scroll after ${retryDelay / 1000} seconds`);
        await wait(retryDelay);
        return await loadMoreItems(pageData, page, retry);
    } else return data;
};

const finiteScroll = async (pageData, page, limit, request, posts, length = 0) => {
    const data = await loadMoreItems(pageData, page);

    if (data) {
        const edges = getPostsFromGraphQL(pageData.pageType, data);
        posts[pageData.id] = posts[pageData.id].concat(edges);
        log(pageData, `${edges.length} items added, ${posts[pageData.id].length} items total`);
    }

    if (posts[pageData.id].length < limit && posts[pageData.id].length !== length) {
        await finiteScroll(pageData, page, limit, request, posts, posts[pageData.id].length)
    }
};

module.exports = {
    getItemSpec,
    getPostsFromEntryData,
    finiteScroll,
    wait,
    log,
    loadMoreItems,
};