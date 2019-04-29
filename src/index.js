const Apify = require('apify');
const helpers = require('./helpers');

const { getItemSpec, getPostsFromEntryData, wait, finiteScroll, log } = helpers;

const initData = [];
const posts = {};

async function main() {
    const input = await Apify.getValue('INPUT');
    const limit = input.itemLimit || 200;

    if (!Array.isArray(input.startUrls))
        throw new Error('Invalid input. Correct input format: {"itemLimit": String(optional), "startUrls": Array}.');

    const requestList = await Apify.openRequestList('_instagram', input.startUrls);

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

        return page.goto(request.url);
    };

    const handlePageFunction = async ({ page, request }) => {
        const entryData = await page.evaluate(() => window.__initialData.data.entry_data);
        const itemSpec = getItemSpec(entryData);
        page.itemSpec = itemSpec;

        posts[itemSpec.id] = getPostsFromEntryData(itemSpec.pageType, entryData);
        initData[itemSpec.id] = posts[itemSpec.id];

        log(itemSpec, `${posts[itemSpec.id].length} items added, ${posts[itemSpec.id].length} items total`);

        if (posts[itemSpec.id].length < limit) {
            await wait(1000);
            await finiteScroll(itemSpec, page, limit, request, posts);
        }

        const output = posts[itemSpec.id].map((item, index) => ({
            '#debug': {
                index,
                ...itemSpec,
                shortcode: item.node.shortcode,
                postLocationId: item.node.location && item.node.location.id || null,
                postLocationName: item.node.location && item.node.location.name || null,
                postOwnerId: item.node.owner && item.node.owner.id || null,
                postOwnerUsername: item.node.owner && item.node.owner.username || null,
            },
            pageName: itemSpec.name,
            url: 'https://www.instagram.com/p/' + item.node.shortcode,
            likesCount: item.node.edge_media_preview_like.count,
            imageUrl: item.node.display_url,
            firstComment: item.node.edge_media_to_caption.edges[0] && item.node.edge_media_to_caption.edges[0].node.text,
            timestamp: new Date(parseInt(item.node.taken_at_timestamp) * 1000)
        })).slice(0, limit);

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
            useApifyProxy: true,
            devTools: true,
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