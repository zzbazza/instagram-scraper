const Apify = require('apify');
const { scrapePosts, handlePostsGraphQLResponse } = require('./posts');
const { scrapeComments, handleCommentsGraphQLResponse }  = require('./comments');
const { scrapeDetails }  = require('./details');
const { searchUrls } = require('./search');
const { getItemSpec } = require('./helpers');
const { GRAPHQL_ENDPOINT, ABORTED_RESOUCE_TYPES, SCRAPE_TYPES } = require('./consts');
const errors = require('./errors');

async function main() {
    const input = await Apify.getInput();
    const { proxy, type, limit = 200 } = input;

    const foundUrls = await searchUrls(input);
    const urls = [
        ...(input.urls || []), 
        ...foundUrls,
    ];

    if (urls.length === 0) {
        Apify.utils.log.info('No URLs to process');
        process.exit(0);
    }

    await searchUrls(input);

    try {
        if (!proxy) throw errors.proxyIsRequired();
        if (!type) throw errors.typeIsRequired();
        if (!Object.values(SCRAPE_TYPES).includes(type)) throw errors.unsupportedType(type);
    } catch (error) {
        console.log('--  --  --  --  --');
        console.log(' ');
        Apify.utils.log.error(`Run failed because the provided input is incorrect:`);
        Apify.utils.log.error(error.message);
        console.log(' ');
        console.log('--  --  --  --  --');
        process.exit(1);
    }

    const requestListSources = urls.map((url) => ({
        url,
        userData: { limit },
    }));

    const requestList = await Apify.openRequestList('request-list', requestListSources);

    const gotoFunction = async ({request, page}) => {
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            if (ABORTED_RESOUCE_TYPES.includes(request.resourceType())) return request.abort();
            request.continue();
        });

        page.on('response', async (response) => {
            const responseUrl = response.url();

            // Skip non graphql responses
            if (!responseUrl.startsWith(GRAPHQL_ENDPOINT)) return;

            // Wait for the page to parse it's data
            while (!page.itemSpec) await page.waitFor(100);

            switch (type) {
                case SCRAPE_TYPES.POSTS: return handlePostsGraphQLResponse(page, response);
                case SCRAPE_TYPES.COMMENTS: return handleCommentsGraphQLResponse(page, response);
            }
        });

        return page.goto(request.url);
    };

    const handlePageFunction = async ({ page, request }) => {
        const entryData = await page.evaluate(() => window.__initialData.data.entry_data);
        const itemSpec = getItemSpec(entryData);
        page.itemSpec = itemSpec;

        switch (type) {
            case SCRAPE_TYPES.POSTS: return scrapePosts(page, request, itemSpec, entryData);
            case SCRAPE_TYPES.COMMENTS: return scrapeComments(page, request, itemSpec, entryData);
            case SCRAPE_TYPES.DETAILS: return scrapeDetails(request, itemSpec, entryData);
        };
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