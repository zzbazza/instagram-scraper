const Apify = require('apify');
const helpers = require('./helpers');
const errors = require('./errors');
const consts = require('./consts');

const { getItemSpec, getPostsFromEntryData, getPostsFromGraphQL, getCheckedVariable, finiteScroll, log } = helpers;
const { GRAPHQL_ENDPOINT } = consts;

const initData = [];
const posts = {};

async function main() {
    const input = await Apify.getValue('INPUT');
    const { proxy, urls } = input;

    try {
        if (!proxy) throw errors.proxyIsRequired();
        if (!urls || !urls.length) throw errors.urlsAreRequired();
    } catch (error) {
        console.log('--  --  --  --  --');
        console.log(' ');
        Apify.utils.log.error(`Run failed because the provided input is incorrect:`);
        Apify.utils.log.error(error.message);
        console.log(' ');
        console.log('--  --  --  --  --');
        process.exit(1);
    }

    const requestListSources = urls.map(({ key, value }) => ({
        url: key,
        userData: { limit: value },
    }));

    const requestList = await Apify.openRequestList('request-list', requestListSources);

    const gotoFunction = async ({request, page}) => {
        const resources = [
            'stylesheet',
            'image',
            'media',
            'font',
            'texttrack',
            'fetch',
            'eventsource',
            'websocket',
            'manifest',
            'other'
        ];

        await page.setRequestInterception(true);
        page.on('request', (request) => {
            if (resources.includes(request.resourceType())) return request.abort();
            request.continue();
        });
        page.on('response', async (response) => {

            const responseUrl = response.url();

            // Skip non graphql responses
            if (!responseUrl.startsWith(GRAPHQL_ENDPOINT)) return;

            // Wait for the page to parse it's data
            while (!page.itemSpec) await page.waitFor(100);

            // Get variable we look for in the query string of request
            const checkedVariable = getCheckedVariable(page.itemSpec.pageType);

            // Skip queries for other stuff then posts
            if (!responseUrl.includes(checkedVariable)) return;

            const data = await response.json();
            const timeline = getPostsFromGraphQL(page.itemSpec.pageType, data['data']);

            posts[page.itemSpec.id] = posts[page.itemSpec.id].concat(timeline.posts);

            if (!initData[page.itemSpec.id]) initData[page.itemSpec.id] = timeline;

            log(page.itemSpec, `${timeline.posts.length} items added, ${posts[page.itemSpec.id].length} items total`);
        });

        return page.goto(request.url);
    };

    const handlePageFunction = async ({ page, request }) => {
        const entryData = await page.evaluate(() => window.__initialData.data.entry_data);
        const itemSpec = getItemSpec(entryData);
        page.itemSpec = itemSpec;

        const timeline = getPostsFromEntryData(itemSpec.pageType, entryData);
        initData[itemSpec.id] = timeline;

        if (initData[itemSpec.id]) {
            posts[itemSpec.id] = timeline.posts;
            log(page.itemSpec, `${timeline.posts.length} items added, ${posts[page.itemSpec.id].length} items total`);
        } else {
            log(itemSpec, 'Waiting for initial data to load');
            while (!initData[itemSpec.id]) await page.waitFor(100);
        }

        if (initData[itemSpec.id].hasNextPage && posts[itemSpec.id].length < request.userData.limit) {
            await page.waitFor(1000);
            await finiteScroll(itemSpec, page, request, posts);
        }

        const output = posts[itemSpec.id].map((item, index) => ({
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

    const crawler = new Apify.PuppeteerCrawler({
        requestList,
        gotoFunction,
        maxConcurrency: 1,
        puppeteerPoolOptions: {
            maxOpenPagesPerInstance: 1
        },
        launchPuppeteerOptions: {
            ...proxy,
        },
        handlePageTimeoutSecs: 12 * 60 * 60,
        handlePageFunction,

        // If request failed 4 times then this function is executed.
        handleFailedRequestFunction: async ({request}) => {
            Apify.utils.log.error(`${request.url}: Request ${request.url} failed 4 times`);
            await Apify.pushData({
                '#error': request.url
            });
        },
    });

    await crawler.run();
};

module.exports = main;