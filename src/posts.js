const Apify = require('apify');
const { getCheckedVariable, log, finiteScroll, filterPushedItemsAndUpdateState } = require('./helpers');
const { PAGE_TYPES, GRAPHQL_ENDPOINT } = require('./consts');
const { expandOwnerDetails } = require('./user_details');
const { getPosts } = require('./posts_graphql');

const initData = {};
const posts = {};

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
    return { posts: postItems, hasNextPage };
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

    return getPostsFromGraphQL(pageType, pageData[0].graphql);
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

/*
const finiteScroll = async (pageData, page, request) => {
    const data = await loadMore(pageData, page);
    if (data) {
        const timeline = getPostsFromGraphQL(pageData.pageType, data);
        if (!timeline.hasNextPage) return;
    }

    await page.waitFor(1500); // prevent rate limited error

    if (checkLastPostDate(request.userData, posts[pageData.id].slice(-1)[0])) {
        await finiteScroll(pageData, page, request);
    }
};
*/

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
const scrapePosts = async ({ page, request, itemSpec, entryData, requestQueue, input, scrollingState }) => {
    const timeline = getPostsFromEntryData(itemSpec.pageType, entryData);
    initData[itemSpec.id] = timeline;

    // Check if the posts loaded properly
    const el = await page.$('.ySN3v');
    if (!el) {
        throw new Error("Posts didn't load properly, opening again");
    }

    if (initData[itemSpec.id]) {
        /*
        posts[itemSpec.id] = timeline.posts;
        log(page.itemSpec, `${timeline.posts.length} posts added, ${posts[page.itemSpec.id].length} posts total`);
        */

        const postsReadyToPush = filterPushedItemsAndUpdateState({
            items: timeline.posts,
            itemSpec,
            parsingFn: parsePostsForOutput,
            scrollingState
        });
        // We save last date for the option to specify how far into the past we should scroll
        scrollingState[itemSpec.id].lastPostDate = postsReadyToPush[postsReadyToPush.length - 1].timestamp;

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
        // TODO: Refactor this check out
        const itemsScrapedCount = Object.keys(scrollingState[itemSpec.id].ids).length;
        const reachedLimit = itemsScrapedCount >= request.userData.limit
        if (reachedLimit) {
            console.warn(`Reached max results (posts or commets) limit: ${userData.limit}. Finishing scrolling...`);
        }
        const shouldGoNextGeneric = !reachedLimit && (itemsScrapedCount !== oldItemCount || scrollingState[itemSpec.id].allDuplicates);
        if (goNextPage(request.userData, timeline.posts.slice(-1)[0], posts[itemSpec.id].length)) {
            await page.waitFor(1000);
            await finiteScroll({
                pageData: itemSpec,
                page,
                request,
                scrollingState,
                loadMoreFn: loadMore,
                getItemsFromGraphQLFn: getPostsFromGraphQL,
                type: 'posts',
            });
        }
    }

    const filteredItemSpec = {};
    if (itemSpec.tagName) filteredItemSpec.queryTag = itemSpec.tagName;
    if (itemSpec.userUsername) filteredItemSpec.queryUsername = itemSpec.userUsername;
    if (itemSpec.locationName) filteredItemSpec.queryLocation = itemSpec.locationName;

    let output = parsePostsForOutput(posts[itemSpec.id]);

    if (request.userData.limit) {
        output = output.slice(0, request.userData.limit);
    }
    if (request.userData.scrapePostsUntilDate) {
        const scrapePostsUntilDate = new Date(request.userData.scrapePostsUntilDate);
        output = output.filter((item) => item.timestamp > scrapePostsUntilDate);
    }

    if (input.expandOwners && itemSpec.pageType !== PAGE_TYPES.PROFILE) {
        output = await expandOwnerDetails(output, page, input, itemSpec);
    }

    for (const post of output) {
        if (itemSpec.pageType !== PAGE_TYPES.PROFILE && (post.locationName === null || post.ownerUsername === null)) {
            // Try to scrape at post detail
            await requestQueue.addRequest({ url: post.url, userData: { label: 'postDetail' } });
        } else {
            await Apify.pushData(post);
        }
    }

    log(itemSpec, `${output.length} items saved, task finished`);
};

/**
 * Catches GraphQL responses and if they contain post data, it stores the data
 * to the global variable.
 * @param {Object} page Puppeteer Page object
 * @param {Object} response Puppeteer Response object
 */
async function handlePostsGraphQLResponse(page, response) {
    const responseUrl = response.url();

    // Get variable we look for in the query string of request
    const checkedVariable = getCheckedVariable(page.itemSpec.pageType);

    // Skip queries for other stuff then posts
    if (!responseUrl.includes(checkedVariable) || !responseUrl.includes('%22first%22')) return;

    const data = await response.json();

    const timeline = getPostsFromGraphQL(page.itemSpec.pageType, data.data);

    posts[page.itemSpec.id] = posts[page.itemSpec.id].concat(timeline.posts);

    if (!initData[page.itemSpec.id]) initData[page.itemSpec.id] = timeline;
    else if (initData[page.itemSpec.id].hasNextPage && !timeline.hasNextPage) {
        initData[page.itemSpec.id].hasNextPage = false;
    }

    // await Apify.pushData(output);
    // log(itemSpec, `${output.length} items saved, task finished`);
    log(page.itemSpec, `${timeline.posts.length} posts added, ${posts[page.itemSpec.id].length} posts total`);
}

function parsePostsForOutput (posts, itemSpec, currentScrollingPosition) {
    return posts.map(item => ({
        '#debug': {
            ...Apify.utils.createRequestDebugInfo(request),
            ...itemSpec,
            shortcode: item.node.shortcode,
            postLocationId: (item.node.location && item.node.location.id) || null,
            postOwnerId: (item.node.owner && item.node.owner.id) || null,
        },
        ...filteredItemSpec,
        alt: item.node.accessibility_caption,
        url: `https://www.instagram.com/p/${item.node.shortcode}`,
        likesCount: item.node.edge_media_preview_like.count,
        commentsCount: item.node.edge_media_to_comment.count,
        caption: item.node.edge_media_to_caption.edges && item.node.edge_media_to_caption.edges[0] && item.node.edge_media_to_caption.edges[0].node.text,
        imageUrl: item.node.display_url,
        videoUrl: item.node.video_url,
        id: item.node.id,
        mediaType: item.node.__typename ? item.node.__typename.replace('Graph', '') : (item.node.is_video ? 'Video' : 'Image'),
        shortcode: item.node.shortcode,
        firstComment: item.node.edge_media_to_comment.edges && item.node.edge_media_to_comment.edges[0] && item.node.edge_media_to_comment.edges[0].node.text,
        timestamp: new Date(parseInt(item.node.taken_at_timestamp, 10) * 1000),
        locationName: (item.node.location && item.node.location.name) || null,
        // usable by appending https://www.instagram.com/explore/locations/ to see the location
        locationId: (item.node.location && item.node.location.id) || null,
        ownerId: item.owner && item.owner.id || null,
        ownerUsername: (item.node.owner && item.node.owner.username) || null,
    }))
}

module.exports = {
    scrapePost,
    scrapePosts,
    handlePostsGraphQLResponse,
};
