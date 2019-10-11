const Apify = require('apify');
const { expandOwnerDetails } = require('./user_details');
const { log } = require('./helpers');
const { PAGE_TYPES } = require('./consts');
const { getPosts } = require('./posts_graphql');

/**
 * Takes data from entry data and from loaded xhr requests and parses them into final output.
 * @param {Object} page Puppeteer Page object
 * @param {Object} request Apify Request object
 * @param {Object} itemSpec Parsed page data
 * @param {Object} entryData data from window._shared_data.entry_data
 * @param {Object} input Input provided by user
 * @param {Object} proxy Proxy config provided by user
 */
const scrapePosts = async (page, request, itemSpec, entryData, input, proxy) => {
    const posts = await getPosts(page, itemSpec, input);

    const filteredItemSpec = {};
    if (itemSpec.tagName) filteredItemSpec.queryTag = itemSpec.tagName;
    if (itemSpec.userUsername) filteredItemSpec.queryUsername = itemSpec.userUsername;
    if (itemSpec.locationName) filteredItemSpec.queryLocation = itemSpec.locationName;

    let output = posts.map((item, index) => ({
        '#debug': {
            ...Apify.utils.createRequestDebugInfo(request),
            index,
            ...itemSpec,
            shortcode: item.shortcode,
            postLocationId: item.location && item.location.id || null,
            postOwnerId: item.owner && item.owner.id || null,
        },
        ...filteredItemSpec,
        alt: item.accessibility_caption,
        url: 'https://www.instagram.com/p/' + item.shortcode,
        likesCount: item.edge_media_preview_like.count,
        imageUrl: item.display_url,
        firstComment: item.edge_media_to_caption.edges[0] && item.edge_media_to_caption.edges[0].node.text,
        timestamp: new Date(parseInt(item.taken_at_timestamp) * 1000),
        locationName: item.location && item.location.name || null,
        ownerId: item.owner && item.owner.id || null,
        ownerUsername: item.owner && item.owner.username || null,
    })).slice(0, request.userData.limit);

    if (input.expandOwner && itemSpec.pageType !== PAGE_TYPES.PROFILE) {
        output = await expandOwnerDetails(output, page, itemSpec, proxy);
    }

    await Apify.pushData(output);
    log(itemSpec, `${output.length} items saved, task finished`);
}

module.exports = {
    scrapePosts,
};