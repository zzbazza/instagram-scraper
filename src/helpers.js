const Apify = require('apify');
const tunnel = require('tunnel');
const { CookieJar } = require('tough-cookie')
const got = require('got');
const safeEval = require('safe-eval');
const { URLSearchParams } = require('url');
const errors = require('./errors');
const consts = require('./consts');
const { expandOwnerDetails } = require('./user-details');

const { PAGE_TYPES } = consts;

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

    if (entryData.PostPage) {
        const itemData = entryData.PostPage[0].graphql.shortcode_media;
        return {
            pageType: PAGE_TYPES.POST,
            id: itemData.shortcode,
            postCommentsDisabled: itemData.comments_disabled,
            postIsVideo: itemData.is_video,
            postVideoViewCount: itemData.video_view_count || 0,
            postVideoDurationSecs: itemData.video_duration || 0,
        };
    }

    Apify.utils.log.info('unsupported page', entryData);

    throw errors.unsupportedPage();
};

/**
 * Takes page data containing type of page and outputs short label for log line
 * @param {Object} pageData Object representing currently loaded IG page
 */
const getLogLabel = (pageData) => {
    switch (pageData.pageType) {
        case PAGE_TYPES.PLACE: return `Place "${pageData.locationName}"`;
        case PAGE_TYPES.PROFILE: return `User "${pageData.userUsername}"`;
        case PAGE_TYPES.HASHTAG: return `Tag "${pageData.tagName}"`;
        case PAGE_TYPES.POST: return `Post "${pageData.id}"`;
        default: throw new Error('Not supported');
    }
};

/**
 * Takes page type and outputs variable that must be present in graphql query
 * @param {String} pageType
 */
const getCheckedVariable = (pageType) => {
    switch (pageType) {
        case PAGE_TYPES.PLACE: return '%22id%22';
        case PAGE_TYPES.PROFILE: return '%22id%22';
        case PAGE_TYPES.HASHTAG: return '%22tag_name%22';
        case PAGE_TYPES.POST: return '%22shortcode%22';
        default: throw new Error('Not supported');
    }
};

/**
 * Based on parsed data from current page saves a message into log with prefix identifying current page
 * @param {Object} pageData Parsed page data
 * @param {String} message Message to be outputed
 */
function log (pageData, message) {
    const label = getLogLabel(pageData);
    Apify.utils.log.info(`${label}: ${message}`);
};

const grapqlEndpoint = 'https://www.instagram.com/graphql/query/';

async function getGotParams(page, input) {
    let proxyConfig = { ...input.proxy };

    const userAgent = await page.browser().userAgent();

    let proxyUrl = null;
    if (proxyConfig.useApifyProxy) {
        proxyUrl = Apify.getApifyProxyUrl({
            groups: proxyConfig.apifyProxyGroups || [],
            session: proxyConfig.apifyProxySession || `insta_session_${Date.now()}`,
        });
    } else {
        const randomUrlIndex = Math.round(Math.random() * proxyConfig.proxyUrls.length);
        proxyUrl = proxyConfig.proxyUrls[randomUrlIndex];
    }

    const proxyUrlParts = proxyUrl.match(/http:\/\/(.*)@(.*)\/?/);
    if (!proxyUrlParts) return posts;

    const proxyHost = proxyUrlParts[2].split(':');
    proxyConfig = {
        hostname: proxyHost[0],
        proxyAuth: proxyUrlParts[1],
    }
    if (proxyHost[1]) proxyConfig.port = proxyHost[1];

    const agent = tunnel.httpsOverHttp({
        proxy: proxyConfig,
    });

    const cookies = await page.cookies();
    const cookieJar = new CookieJar();
    cookies.forEach((cookie) => {
        if (cookie.name === 'urlgen') return;
        cookieJar.setCookieSync(`${cookie.name}=${cookie.value}`, 'https://www.instagram.com/', { http: true, secure: true });
    });

    return {
        agent,
        cookieJar,
        headers: {
            'user-agent': userAgent,
        },
        json: true,
    }
}

async function query(gotParams, searchParams, nodeTransformationFunc, itemSpec, logPrefix) {
    let retries = 0;
    while (retries < 10) {
        try {
            const { body } = await got(`${grapqlEndpoint}?${searchParams.toString()}`, gotParams);
            if (!body.data) throw new Error(`${logPrefix} - GraphQL query does not contain data`);
            return nodeTransformationFunc(body.data);
        } catch (error) {
            if (error.message.includes(429)) {
                log(itemSpec, `${logPrefix} - Encountered rate limit error, waiting ${(retries + 1) * 10} seconds.`);
                await Apify.utils.sleep((retries + 1) * 10000);
            } else await Apify.utils.log.error(error);
            retries++;
        }
    }
    log(itemSpec, `${logPrefix} - Could not load more items`);
    return { nextPageCursor: null, data: [] };
}

async function finiteQuery(queryId, variables, nodeTransformationFunc, limit, page, input, itemSpec, logPrefix) {
    const gotParams = await getGotParams(page, input);

    log(itemSpec, `${logPrefix} - Loading up to ${limit} items`);
    let hasNextPage = true;
    let endCursor = null;
    let results = [];
    while (hasNextPage && results.length < limit) {
        const queryParams = {
            query_hash: queryId,
            variables: {
                ...variables,
                first: 50,
            }
        };
        if (endCursor) queryParams.variables.after = endCursor;
        const searchParams = new URLSearchParams([['query_hash', queryParams.query_hash], ['variables', JSON.stringify(queryParams.variables)]]);
        const { nextPageCursor, data } = await query(gotParams, searchParams, nodeTransformationFunc, itemSpec, logPrefix);

        data.forEach((result) => results.push(result));

        if (nextPageCursor && results.length < limit) {
            endCursor = nextPageCursor;
            log(itemSpec, `${logPrefix} - So far loaded ${results.length} items`);
        } else {
            hasNextPage = false;
        }
    }
    log(itemSpec, `${logPrefix} - Finished loading ${results.length} items`);
    return results.slice(0, limit);
}

async function singleQuery(queryId, variables, nodeTransformationFunc, page, itemSpec, logPrefix) {
    const gotParams = await getGotParams(page, itemSpec.input);
    const searchParams = new URLSearchParams([['query_hash', queryId], ['variables', JSON.stringify(variables)]]);
    return query(gotParams, searchParams, nodeTransformationFunc, itemSpec, logPrefix);
}

function parseExtendOutputFunction (extendOutputFunction) {
    let parsedExtendOutputFunction;
    if (typeof extendOutputFunction === 'string' && extendOutputFunction.trim() !== '') {
        try {
            parsedExtendOutputFunction = safeEval(extendOutputFunction);
        } catch (e) {
            throw new Error(`'extendOutputFunction' is not valid Javascript! Error: ${e}`);
        }
        if (typeof parsedExtendOutputFunction !== 'function') {
            throw new Error('extendOutputFunction is not a function! Please fix it or use just default ouput!');
        }
    }
}

function parseCaption (caption) {
    if (!caption) {
        return { hashtags: [], mentions: [] };
    }
    // TODO: Figure out more precise regexes
    // \w doesn't work because we might get non ASCI characters
    const HASHTAG_REGEX = /#[\S]+\b/g
    const MENTION_REGEX = /@[\S]+\b/g
    const hashtags = (caption.match(HASHTAG_REGEX) || []).map((hashtag) => hashtag.replace('#', ''));
    const mentions = (caption.match(MENTION_REGEX) || []).map((mention) => mention.replace('@', ''));
    return { hashtags, mentions };
}

function hasReachedLastPostDate (scrapePostsUntilDate, lastPostDate) {
    const lastPostDateAsDate = new Date(lastPostDate);
    if (scrapePostsUntilDate) {
        // We want to continue scraping (return true) if the scrapePostsUntilDate is older (smaller) than the date of the last post
        // Don't forget we scrape from the most recent ones to the past
        scrapePostsUntilDateAsDate = new Date(scrapePostsUntilDate);
        const willContinue = scrapePostsUntilDateAsDate < lastPostDateAsDate;
        if (!willContinue) {
            console.warn(`Reached post with older date than our limit: ${lastPostDateAsDate}. Finishing scrolling...`);
            console.log('returning true');
            return true;
        }
    }
    return false;
};

// Ttems can be posts or commets from scrolling
async function filterPushedItemsAndUpdateState ({ items, itemSpec, parsingFn, scrollingState, type, page }) {
    if (!scrollingState[itemSpec.id]) {
        scrollingState[itemSpec.id] = {
            allDuplicates: false,
            ids: {},
        };
    }
    const { limit, scrapePostsUntilDate } = itemSpec;
    const currentScrollingPosition = Object.keys(scrollingState[itemSpec.id].ids).length;
    const parsedItems = parsingFn(items, itemSpec, currentScrollingPosition);
    let itemsToPush = [];
    for (const item of parsedItems) {
        if (Object.keys(scrollingState[itemSpec.id].ids).length >= limit) {
            Apify.utils.log.info(`Item: ${item.id} reached limit of ${limit} results, stopping...`);
            break;
        }
        if (scrapePostsUntilDate && hasReachedLastPostDate(scrapePostsUntilDate, item.timestamp)) {
            scrollingState[itemSpec.id].reachedLastPostDate = true;
            break;
        }
        if (!scrollingState[itemSpec.id].ids[item.id]) {
            itemsToPush.push(item);
            scrollingState[itemSpec.id].ids[item.id] = true;
        } else {
            Apify.utils.log.debug(`Item: ${item.id} was already pushed, skipping...`);
        }
    }
    // We have to tell the state if we are going though duplicates so it knows it should still continue scrolling
    if (itemsToPush.length === 0) {
        scrollingState[itemSpec.id].allDuplicates = true;
    } else {
        scrollingState[itemSpec.id].allDuplicates = false;
    }
    if (type === 'posts') {
        if (itemSpec.input.expandOwners && itemSpec.pageType !== PAGE_TYPES.PROFILE) {
            itemsToPush = await expandOwnerDetails(itemsToPush, page, itemSpec);
        }

        // I think this feature was added by Tin and it could possibly increase the runtime by A LOT
        // It should be opt-in. Also needs to refactored!
        /*
        for (const post of output) {
            if (itemSpec.pageType !== PAGE_TYPES.PROFILE && (post.locationName === null || post.ownerUsername === null)) {
                // Try to scrape at post detail
                await requestQueue.addRequest({ url: post.url, userData: { label: 'postDetail' } });
            } else {
                await Apify.pushData(post);
            }
        }
        */
    }
    return itemsToPush;
}

const shouldContinueScrolling = ({ scrollingState, itemSpec, oldItemCount, type }) => {
    if (type === 'posts') {
        if (scrollingState[itemSpec.id].reachedLastPostDate) {
            return false;
        }
    }

    const itemsScrapedCount = Object.keys(scrollingState[itemSpec.id].ids).length;
    const reachedLimit = itemsScrapedCount >= itemSpec.limit
    if (reachedLimit) {
        console.warn(`Reached max results (posts or commets) limit: ${itemSpec.limit}. Finishing scrolling...`);
    }
    const shouldGoNextGeneric = !reachedLimit && (itemsScrapedCount !== oldItemCount || scrollingState[itemSpec.id].allDuplicates);
    return shouldGoNextGeneric;
}

const finiteScroll = async (context) => {
    const {
        itemSpec,
        page,
        scrollingState,
        loadMoreFn,
        getItemsFromGraphQLFn,
        type,
    } = context;
    const oldItemCount = Object.keys(scrollingState[itemSpec.id].ids).length;
    const data = await loadMoreFn(itemSpec, page);
    if (data) {
        const timeline = getItemsFromGraphQLFn({ data, pageType: itemSpec.pageType });
        if (!timeline.hasNextPage) return;
    }

    await page.waitFor(200);

    const doContinue = shouldContinueScrolling({ scrollingState, itemSpec, oldItemCount, type })

    if (doContinue) {
        await finiteScroll(context);
    }
};

module.exports = {
    getItemSpec,
    getCheckedVariable,
    log,
    finiteQuery,
    singleQuery,
    parseExtendOutputFunction,
    parseCaption,
    filterPushedItemsAndUpdateState,
    finiteScroll,
    shouldContinueScrolling,
};
