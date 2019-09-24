const Apify = require('apify');
const got = require('got');
const tunnel = require('tunnel');
const { CookieJar } = require('tough-cookie');
const { URLSearchParams } = require('url');
const { log } = require('./helpers');

const likesQueryId = 'd5d763b1e2acf209d62d22d184488e57';
const grapqlEndpoint = 'https://www.instagram.com/graphql/query/';

async function getPostLikes(limit, page, itemSpec, proxy) {
    log(itemSpec, `Loading users who liked the post.`);
    let proxyConfig = { ...proxy };

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

    let hasNextPage = true;
    let endCursor = null;
    let retries = 0;
    let likes = [];
    while (hasNextPage && retries <= 10 && likes.length < limit) {
        const query = {
            query_hash: likesQueryId,
            variables: { 
                shortcode: itemSpec.id,
                include_reel: false,
                first: 50,
            }
        };
        if (endCursor) query.variables.after = endCursor;
        const searchParams = new URLSearchParams([['query_hash', query.query_hash], ['variables', JSON.stringify(query.variables)]]);
        try {
            const { body } = await got(`${grapqlEndpoint}?${searchParams.toString()}`, { 
                json: true, 
                cookieJar, 
                agent,
                headers: {
                    'user-agent': userAgent,
                }
            });
            if (!body.data) throw new Error('Liked by GraphQL query does not contain data');
            if (!body.data.shortcode_media) throw new Error('Liked by GraphQL query does not contain shortcode_media');
            if (!body.data.shortcode_media.edge_liked_by) throw new Error('Liked by GraphQL query does not contain edge_liked_by');
            const likedBy = body.data.shortcode_media.edge_liked_by;
            const pageInfo = likedBy.page_info;
            hasNextPage = pageInfo.has_next_page;
            endCursor = pageInfo.end_cursor;
            likedBy.edges.forEach((like) => {
                likes.push(like.node);
            });
            retries = 0;
            if (hasNextPage && likes.length < limit) log(itemSpec, `So far loaded ${likes.length} likes.`);
            await Apify.utils.sleep(50);
        } catch (error) {
            if (error.message.includes(429)) {
                log(itemSpec, `Encountered rate limit error, waiting 5 seconds.`);
                await Apify.utils.sleep(5000);
            } else await Apify.utils.log.error(error);
            retries++;
        }
    }
    log(itemSpec, `Finished loading ${Math.min(likes.length, limit)} likes.`);
    return likes.slice(0, limit);
}

module.exports = {
    getPostLikes,
};