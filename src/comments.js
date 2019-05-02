const { getCheckedVariable, log } = require('./helpers');
const { GRAPHQL_ENDPOINT } = require('./consts');
const errors = require('./errors');

const initData = {};
const comments = {};

/**
 * Takes type of page and data loaded through GraphQL and outputs
 * correct list of comments.
 * @param {String} pageType Type of page we are scraping comments from
 * @param {Object} data GraphQL data
 */
const getCommentsFromGraphQL = (pageType, data) => {
    if (pageType !== PAGE_TYPES.POST) throw errors.notPostPage();

    const timeline = data.post.edge_media_to_comment;
    const comments = timeline ? timeline.edges : [];
    const hasNextPage = timeline ? timeline.page_info.has_next_page : false;
    return { comments, hasNextPage };
}

/**
 * Takes type of page and it's initial loaded data and outputs
 * correct list of comments.
 * @param {String} pageType Type of page we are scraping comments from
 * @param {Object} data GraphQL data
 */
const getCommentsFromEntryData = (pageType, data) => {
    if (pageType !== PAGE_TYPES.POST) throw errors.notPostPage();

    const pageData = data.PostPage;

    return getCommentsFromGraphQL(pageType, pageData[0].graphql);
}

const loadMore = async (pageData, page, retry = 0) => {
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
        return loadMore(pageData, page, retry);
    }

    await page.waitFor(500);
    return data;
};

/**
 * Scrolls page and loads data until the limit is reached or the page has no more comments
 * @param {Object} pageData 
 * @param {Object} page 
 * @param {Object} request 
 * @param {Number} length 
 */
const finiteScroll = async (pageData, page, request, length = 0) => {
    const data = await loadMore(pageData, page);
    if (data) {
        const timeline = getCommentsFromGraphQL(pageData.pageType, data);
        if (!timeline.hasNextPage) return;
    }

    if (comments[pageData.id].length < request.userData.limit && comments[pageData.id].length !== length) {
        await finiteScroll(pageData, page, request, comments[pageData.id].length)
    }
};

const scrapeComments = async (page, request, itemSpec) => {
    const timeline = getCommentsFromEntryData(itemSpec.pageType, entryData);
    initData[itemSpec.id] = timeline;

    if (initData[itemSpec.id]) {
        comments[itemSpec.id] = timeline.comments;
        log(page.itemSpec, `${timeline.comments.length} items added, ${comments[page.itemSpec.id].length} items total`);
    } else {
        log(itemSpec, 'Waiting for initial data to load');
        while (!initData[itemSpec.id]) await page.waitFor(100);
    }

    await page.waitFor(500);

    if (initData[itemSpec.id].hasNextPage && comments[itemSpec.id].length < request.userData.limit) {
        await page.waitFor(1000);
        await finiteScroll(itemSpec, page, request);
    }

    const output = comments[itemSpec.id].map((item, index) => ({
        '#debug': {
            index,
            ...itemSpec,
            shortcode: item.node.shortcode,
            postLocationId: item.node.location && item.node.location.id || null,
            postOwnerId: item.node.owner && item.node.owner.id || null,
        },
        url: 'https://www.instagram.com/p/' + item.node.shortcode,
        likesCount: item.node.edge_media_preview_like.count,
        imageUrl: item.node.display_url,
        firstComment: item.node.edge_media_to_caption.edges[0] && item.node.edge_media_to_caption.edges[0].node.text,
        timestamp: new Date(parseInt(item.node.taken_at_timestamp) * 1000),
        locationName: item.node.location && item.node.location.name || null,
        ownerUsername: item.node.owner && item.node.owner.username || null,
    })).slice(0, request.userData.limit);

    await Apify.pushData(output);
    log(itemSpec, `${output.length} items saved, task finished`);
}

async function handleCommentsGraphQLResponse(page, response) {
    const responseUrl = response.url();

    // Get variable we look for in the query string of request
    const checkedVariable = getCheckedVariable(page.itemSpec.pageType);

    // Skip queries for other stuff then posts
    if (!responseUrl.includes(checkedVariable) || !responseUrl.includes('%22first%22')) return;

    const data = await response.json();
    const timeline = getCommentsFromGraphQL(page.itemSpec.pageType, data['data']);
    
    comments[page.itemSpec.id] = comments[page.itemSpec.id].concat(timeline.comments);

    if (!initData[page.itemSpec.id]) initData[page.itemSpec.id] = timeline;
    else if (initData[page.itemSpec.id].hasNextPage && !timeline.hasNextPage) {
        initData[page.itemSpec.id].hasNextPage = false;
    }

    log(page.itemSpec, `${timeline.comments.length} items added, ${posts[page.itemSpec.id].length} items total`);
}


module.exports = {
    scrapeComments,
    handleCommentsGraphQLResponse,
};