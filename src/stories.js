const Apify = require('apify');

/**
 * Takes type of page and data loaded through GraphQL and outputs
 * list of stories.
 * @param {Object} data GraphQL data
 */
const getStoriesFromGraphQL = ({ data }) => {
    if (!data) return;
    const { reels_media } = data;
    const itemsExists = reels_media && reels_media[0] && reels_media[0] && reels_media[0].items;

    const storyItems = itemsExists ? reels_media[0].items : [];
    const storiesCount = itemsExists ? storyItems.length : null;

    return { stories: storyItems, storiesCount };
};

/**
 * Takes GraphQL response, checks that it's a response with more stories and then parses the stories from it
 * @param {Object} page Puppeteer Page object
 * @param {Object} response Puppeteer Response object
 */
async function handleStoriesGraphQLResponse({ page, response }) {
    const responseUrl = response.url();

    // Skip queries for other stuff then posts
    if (!responseUrl.includes('%22reel_ids%22')) return;

    const data = await response.json();
    const timeline = getStoriesFromGraphQL({ data: data.data });

    Apify.utils.log.info(`Scraped ${timeline.storiesCount} stories`);
    await Apify.pushData(timeline.stories);
}

module.exports = {
    handleStoriesGraphQLResponse,
};
