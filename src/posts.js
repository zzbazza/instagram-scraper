const Apify = require('apify');
const { getCheckedVariable, log, finiteScroll, filterPushedItemsAndUpdateState, shouldContinueScrolling } = require('./helpers');
const { PAGE_TYPES, GRAPHQL_ENDPOINT } = require('./consts');
const { formatSinglePost } = require('./details');

const initData = {};

/**
 * Takes type of page and data loaded through GraphQL and outputs
 * correct list of posts based on the page type.
 * @param {String} pageType Type of page we are scraping posts from
 * @param {Object} data GraphQL data
 */
const getPostsFromGraphQL = ({ pageType, data }) => {
    let timeline;
    switch (pageType) {
        case PAGE_TYPES.PLACE:
            timeline = data.location.edge_location_to_media;
            break;
        case PAGE_TYPES.PROFILE:
            timeline = data && data.user && data.user.edge_owner_to_timeline_media;
            break;
        case PAGE_TYPES.HASHTAG:
            timeline = data.hashtag.edge_hashtag_to_media;
            break;
        default: throw new Error('Not supported');
    }
    const postItems = timeline ? timeline.edges : [];
    const hasNextPage = timeline ? timeline.page_info.has_next_page : false;
    const postsCount = timeline ? timeline.count : null;
    return { posts: postItems, hasNextPage, postsCount };
};

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
            pageData = data.LocationsPage;
            break;
        case PAGE_TYPES.PROFILE:
            pageData = data.ProfilePage;
            break;
        case PAGE_TYPES.HASHTAG:
            pageData = data.TagPage;
            break;
        default: throw new Error('Not supported');
    }
    if (!pageData || !pageData.length) return null;

    return getPostsFromGraphQL({ pageType, data: pageData[0].graphql });
};

/**
 * Attempts to scroll window and waits for XHR response, when response is fired
 * it returns back to caller, else it retries the attempt again.
 * @param {Object} pageData Object containing parsed page data
 * @param {Object} page Puppeteer Page object
 * @param {Integer} retry Retry attempts counter
 */
const loadMore = async (pageData, page, retry = 0) => {
    await page.keyboard.press('PageUp');
    const checkedVariable = getCheckedVariable(pageData.pageType);
    const responsePromise = page.waitForResponse(
        (response) => {
            const responseUrl = response.url();
            return responseUrl.startsWith(GRAPHQL_ENDPOINT)
                && responseUrl.includes(checkedVariable)
                && responseUrl.includes('%22first%22');
        },
        { timeout: 20000 },
    ).catch(() => null);

    let clicked;
    for (let i = 0; i < 10; i++) {
        const elements = await page.$x("//div[contains(text(), 'Show More Posts')]");
        if (elements.length === 0) {
            break;
        }
        const [button] = elements;

        clicked = await Promise.all([
            button.click(),
            page.waitForRequest(
                (request) => {
                    const requestUrl = request.url();
                    return requestUrl.startsWith(GRAPHQL_ENDPOINT)
                        && requestUrl.includes(checkedVariable)
                        && requestUrl.includes('%22first%22');
                },
                {
                    timeout: 1000,
                },
            ).catch(() => null),
        ]);
        if (clicked[1]) break;
    }

    let scrolled;
    for (let i = 0; i < 10; i++) {
        scrolled = await Promise.all([
            // eslint-disable-next-line no-restricted-globals
            page.evaluate(() => scrollBy(0, 9999999)),
            page.waitForRequest(
                (request) => {
                    const requestUrl = request.url();
                    return requestUrl.startsWith(GRAPHQL_ENDPOINT)
                        && requestUrl.includes(checkedVariable)
                        && requestUrl.includes('%22first%22');
                },
                {
                    timeout: 1000,
                },
            ).catch(() => null),
        ]);
        if (scrolled[1]) break;
    }

    let data = null;
    if (scrolled[1]) {
        try {
            const response = await responsePromise;
            const json = await response.json();
            // eslint-disable-next-line prefer-destructuring
            if (json) data = json.data;
        } catch (error) {
            Apify.utils.log.error(error);
        }
    }

    if (!data && retry < 10 && (scrolled[1] || retry < 5)) {
        const retryDelay = retry ? ++retry * retry * 1000 : ++retry * 1000;
        log(pageData, `Retry scroll after ${retryDelay / 1000} seconds`);
        await page.waitFor(retryDelay);
        const returnData = await loadMore(pageData, page, retry);
        return returnData;
    }

    await page.waitFor(500);
    return data;
};


const scrapePost = (request, itemSpec, entryData) => {
    const item = entryData.PostPage[0].graphql.shortcode_media;

    return {
        '#debug': {
            ...Apify.utils.createRequestDebugInfo(request),
            ...itemSpec,
            shortcode: item.shortcode,
            postLocationId: (item.location && item.location.id) || null,
            postOwnerId: (item.owner && item.owner.id) || null,
        },
        alt: item.accessibility_caption,
        url: `https://www.instagram.com/p/${item.shortcode}`,
        likesCount: item.edge_media_preview_like.count,
        imageUrl: item.display_url,
        firstComment: item.edge_media_to_caption.edges[0] && item.edge_media_to_caption.edges[0].node.text,
        timestamp: new Date(parseInt(item.taken_at_timestamp, 10) * 1000),
        locationName: (item.location && item.location.name) || null,
        ownerUsername: (item.owner && item.owner.username) || null,
    };
};

/**
 * Takes data from entry data and from loaded xhr requests and parses them into final output.
 * @param {Object} page Puppeteer Page object
 * @param {Object} request Apify Request object
 * @param {Object} itemSpec Parsed page data
 * @param {Object} entryData data from window._shared_data.entry_data
 * @param {Object} input Input provided by user
 */
const scrapePosts = async ({ page, itemSpec, entryData, scrollingState }) => {
    const timeline = getPostsFromEntryData(itemSpec.pageType, entryData);
    initData[itemSpec.id] = timeline;

    // Check if the posts loaded properly
    if (itemSpec.pageType === PAGE_TYPES.PROFILE) {
        const profilePageSel = '.ySN3v';
        const el = await page.$(`${profilePageSel}`);
        if (!el) {
            throw new Error("Posts didn't load properly, opening again");
        }
        const privatePageSel = '.rkEop';
        const elPrivate = await page.$(`${privatePageSel}`);
        if (elPrivate) {
            Apify.utils.log.info('Profile is private exiting..');
            return;
        }
    }

    if (initData[itemSpec.id]) {
        const postsReadyToPush = await filterPushedItemsAndUpdateState({
            items: timeline.posts,
            itemSpec,
            parsingFn: parsePostsForOutput,
            scrollingState,
            type: 'posts',
            page,
        });
        // We save last date for the option to specify how far into the past we should scroll
        if (postsReadyToPush.length > 0) {
            scrollingState[itemSpec.id].lastPostDate = postsReadyToPush[postsReadyToPush.length - 1].timestamp;
        }

        log(page.itemSpec, `${timeline.posts.length} posts loaded, ${Object.keys(scrollingState[itemSpec.id].ids).length}/${timeline.postsCount} posts scraped`);
        await Apify.pushData(postsReadyToPush);
    } else {
        log(itemSpec, 'Waiting for initial data to load');
        while (!initData[itemSpec.id]) await page.waitFor(100);
    }

    await page.waitFor(500);

    const hasMostRecentPostsOnHashtagPage = itemSpec.pageType === PAGE_TYPES.HASHTAG
        ? await page.evaluate(() => document.querySelector('article > h2') !== null
        && document.querySelector('article > h2').textContent === 'Most recent')
        : true;

    if (initData[itemSpec.id].hasNextPage && hasMostRecentPostsOnHashtagPage) {
        const shouldContinue = shouldContinueScrolling({ itemSpec, scrollingState, oldItemCount: 0, type: 'posts' });
        if (shouldContinue) {
            await page.waitFor(1000);
            await finiteScroll({
                itemSpec,
                page,
                scrollingState,
                loadMoreFn: loadMore,
                getItemsFromGraphQLFn: getPostsFromGraphQL,
                type: 'posts',
            });
        }
    }
};

/**
 * Catches GraphQL responses and if they contain post data, it stores the data
 * to the global variable.
 * @param {Object} page Puppeteer Page object
 * @param {Object} response Puppeteer Response object
 */
async function handlePostsGraphQLResponse({ page, response, scrollingState }) {
    const responseUrl = response.url();

    const { itemSpec } = page;

    // Get variable we look for in the query string of request
    const checkedVariable = getCheckedVariable(itemSpec.pageType);

    // Skip queries for other stuff then posts
    if (!responseUrl.includes(checkedVariable) || !responseUrl.includes('%22first%22')) return;

    const data = await response.json();

    const timeline = getPostsFromGraphQL({ pageType: itemSpec.pageType, data: data.data });

    if (!initData[itemSpec.id]) initData[itemSpec.id] = timeline;
    else if (initData[itemSpec.id].hasNextPage && !timeline.hasNextPage) {
        initData[itemSpec.id].hasNextPage = false;
    }

    const postsReadyToPush = await filterPushedItemsAndUpdateState({
        items: timeline.posts,
        itemSpec,
        parsingFn: parsePostsForOutput,
        scrollingState,
        type: 'posts',
        page,
    });
    // We save last date for the option to specify how far into the past we should scroll
    if (postsReadyToPush.length > 0) {
        scrollingState[itemSpec.id].lastPostDate = postsReadyToPush[postsReadyToPush.length - 1].timestamp;
    }

    log(itemSpec, `${timeline.posts.length} posts loaded, ${Object.keys(scrollingState[itemSpec.id].ids).length}/${timeline.postsCount} posts scraped`);
    await Apify.pushData(postsReadyToPush);
}

function parsePostsForOutput (posts, itemSpec, currentScrollingPosition) {
    return posts.map((item, index) => ({
        '#debug': {
            ...itemSpec,
            shortcode: item.node.shortcode,
            postLocationId: (item.node.location && item.node.location.id) || null,
            postOwnerId: (item.node.owner && item.node.owner.id) || null,
        },
        queryTag: itemSpec.tagName,
        queryUsername: itemSpec.userUsername,
        queryLocation: itemSpec.locationName,
        position: currentScrollingPosition + 1 + index,
        ...formatSinglePost(item.node),
    }))
}

module.exports = {
    scrapePost,
    scrapePosts,
    handlePostsGraphQLResponse,
};
