const Apify = require('apify');
const { getCheckedVariable, log } = require('./helpers');
const { PAGE_TYPES, GRAPHQL_ENDPOINT } = require('./consts');
const errors = require('./errors');

const initData = {};

/**
 * Takes type of page and data loaded through GraphQL and outputs
 * correct list of comments.
 * @param {Object} data GraphQL data
 */
const getCommentsFromGraphQL = (data) => {
    const timeline = data.shortcode_media.edge_media_to_parent_comment;
    const commentItems = timeline ? timeline.edges.reverse() : [];
    const commentsCount = timeline ? timeline.count : null;
    const hasNextPage = timeline ? timeline.page_info.has_next_page : false;
    return { comments: commentItems, hasNextPage, commentsCount };
};

/**
 * Clicks on "Load more comments" button and waits till GraphQL response is received
 * @param {Object} pageData Parsed page data
 * @param {Object} page Puppeteers page object
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
        { timeout: 100000 },
    );

    let clicked = [];
    for (let i = 0; i < 10; i++) {
        const elements = await page.$$('[aria-label="Load more comments"]');
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

    let data = null;
    if (clicked[1]) {
        try {
            const response = await responsePromise;
            const json = await response.json();
            // eslint-disable-next-line prefer-destructuring
            if (json) data = json.data;
        } catch (error) {
            Apify.utils.log.error(error);
        }
    }

    if (!data && retry < 10) {
        const retryDelay = retry ? ++retry * retry * 1000 : ++retry * 1000;
        log(pageData, `Retry scroll after ${retryDelay / 1000} seconds`);
        await page.waitFor(retryDelay);
        return loadMore(pageData, page, retry);
    }

    await page.waitFor(500);
    return data;
};

/**
 * Loads data and clicks on "Load more comments" until the limit is reached or the page has no more comments
 * @param {Object} pageData
 * @param {Object} page
 * @param {Object} request
 * @param {Number} length
 */
const finiteScroll = async ({ pageData, page, request, scrollingState, length = 0 }) => {
    const data = await loadMore(pageData, page);
    if (data) {
        const timeline = getCommentsFromGraphQL(data);
        if (!timeline.hasNextPage) return;
    }

    const commentsScrapedCount = Object.keys(scrollingState[pageData.id].commentIds).length;
    if (commentsScrapedCount < request.userData.limit && (commentsScrapedCount !== length || scrollingState[pageData.id].allDuplicates)) {
        await finiteScroll({ pageData, page, request, scrollingState, length: commentsScrapedCount });
    }
};

/**
 * Loads data from entry date and then loads comments untill limit is reached
 * @param {Object} page Puppeteer Page object
 * @param {Object} request Apify Request object
 * @param {Object} itemSpec Parsed page data
 * @param {Object} entryData data from window._shared_data.entry_data
 */
const scrapeComments = async ({ page, request, itemSpec, entryData, scrollingState }) => {
    // Check that current page is of a type which has comments
    if (itemSpec.pageType !== PAGE_TYPES.POST) throw errors.notPostPage();

    const timeline = getCommentsFromGraphQL(entryData.PostPage[0].graphql);
    initData[itemSpec.id] = timeline;

    // We want to push as soon as we have the data. We have to persist comment ids state so we don;t loose those on migration
    if (initData[itemSpec.id]) {
        const commentsReadyToPush = filterPushedCommentsAndUpdateState({ comments: timeline.comments, itemSpec, scrollingState });
        log(page.itemSpec, `${timeline.comments.length} comments loaded, ${Object.keys(scrollingState[itemSpec.id].commentIds).length}/${timeline.commentsCount} comments scraped`);

        await Apify.pushData(commentsReadyToPush);
    } else {
        log(itemSpec, 'Waiting for initial data to load');
        while (!initData[itemSpec.id]) await page.waitFor(100);
    }

    await page.waitFor(500);

    const willContinueScroll = initData[itemSpec.id].hasNextPage && Object.keys(scrollingState[itemSpec.id].commentIds).length < request.userData.limit;
    // Apify.utils.log.debug(`Post ${itemSpec.id} will continue scrolling: ${willContinueScroll}`);
    if (willContinueScroll) {
        await page.waitFor(1000);
        await finiteScroll({ pageData: itemSpec, page, request, scrollingState });
    }
};

/**
 * Takes GraphQL response, checks that it's a response with more comments and then parses the comments from it
 * @param {Object} page Puppeteer Page object
 * @param {Object} response Puppeteer Response object
 */
async function handleCommentsGraphQLResponse({ page, response, scrollingState }) {
    const responseUrl = response.url();

    // Get variable we look for in the query string of request
    const checkedVariable = getCheckedVariable(page.itemSpec.pageType);

    // Skip queries for other stuff then posts
    if (!responseUrl.includes(checkedVariable) || !responseUrl.includes('%22first%22')) return;

    const data = await response.json();
    const timeline = getCommentsFromGraphQL(data.data);

    if (!initData[page.itemSpec.id]) {
        initData[page.itemSpec.id] = timeline;
    } else if (initData[page.itemSpec.id].hasNextPage && !timeline.hasNextPage) {
        initData[page.itemSpec.id].hasNextPage = false;
    }

    const commentsReadyToPush = filterPushedCommentsAndUpdateState({ comments: timeline.comments, itemSpec: page.itemSpec, scrollingState });
    log(page.itemSpec, `${timeline.comments.length} comments loaded, ${Object.keys(scrollingState[page.itemSpec.id].commentIds).length}/${timeline.commentsCount} comments scraped`);
    await Apify.pushData(commentsReadyToPush);
}

function filterPushedCommentsAndUpdateState ({ comments, itemSpec, scrollingState }) {
    if (!scrollingState[itemSpec.id]) {
        scrollingState[itemSpec.id] = {
            allDuplicates: false,
            commentIds: {},
        };
    }
    const currentScrollingPosition = Object.keys(scrollingState[itemSpec.id]).length;
    const parsedComments = parseCommentsForOutput(comments, itemSpec, currentScrollingPosition);
    const commentsToPush = [];
    for (const comment of parsedComments) {
        if (!scrollingState[itemSpec.id].commentIds[comment.id]) {
            commentsToPush.push(comment);
            scrollingState[itemSpec.id].commentIds[comment.id] = true;
        } else {
            Apify.utils.log.debug(`Comment: ${comment.id} was already pushed, skipping...`);
        }
    }
    // We have to tell the state if we are going though duplicates so it knows it should still continue scrolling
    if (commentsToPush.length === 0) {
        scrollingState[itemSpec.id].allDuplicates = true;
    } else {
        scrollingState[itemSpec.id].allDuplicates = false;
    }
    return commentsToPush;
}

function parseCommentsForOutput (comments, itemSpec, currentScrollingPosition) {
    return comments.map((item, index) => ({
        '#debug': {
            index: index + currentScrollingPosition + 1,
            // ...Apify.utils.createRequestDebugInfo(request),
            ...itemSpec,
        },
        id: item.node.id,
        postId: itemSpec.id,
        text: item.node.text,
        position: index + currentScrollingPosition + 1,
        timestamp: new Date(parseInt(item.node.created_at, 10) * 1000),
        ownerId: item.node.owner ? item.node.owner.id : null,
        ownerIsVerified: item.node.owner ? item.node.owner.is_verified : null,
        ownerUsername: item.node.owner ? item.node.owner.username : null,
        ownerProfilePicUrl: item.node.owner ? item.node.owner.profile_pic_url : null,
    }))
}

module.exports = {
    scrapeComments,
    handleCommentsGraphQLResponse,
};
