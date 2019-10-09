const Apify = require('apify');
const tunnel = require('tunnel');
const { CookieJar } = require('tough-cookie')
const got = require('got');
const { URLSearchParams } = require('url');
const errors = require('./errors');
const consts = require('./consts');

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
        case PAGE_TYPES.POST: return '%22shortcode%22';
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

const queryIds = {
    "postCommentsQueryId": "97b41c52301f77ce508f55e66d17620e",
    "postLikesQueryId": "d5d763b1e2acf209d62d22d184488e57",
    "placePostsQueryId": "1b84447a4d8b6d6d0426fefb34514485",
    "hashtagPostsQueryId": "174a5243287c5f3a7de741089750ab3b",
    "profilePostsQueryId": "58b6785bea111c67129decbe6a448951",
    "profileFollowingQueryId": "d04b0a864b4b54837c0d870b0e77e076",
    "profileFollowersQueryId": "c76146de99bb02f6415203be841dd25a",
    "profileChannelQueryId": "bc78b344a68ed16dd5d7f264681c4c76",
    "profileTaggedQueryId": "ff260833edf142911047af6024eb634a"
};
const queryIdsUrl = 'https://api.apify.com/v2/key-value-stores/pPFcCAtcn7MoDfXpk/records/query-ids.json?disableRedirect=true';

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
                log(itemSpec, `${logPrefix} - Encountered rate limit error, waiting 5 seconds.`);
                await Apify.utils.sleep(5000);
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

module.exports = {
    getItemSpec,
    getCheckedVariable,
    log,
    finiteQuery,
};