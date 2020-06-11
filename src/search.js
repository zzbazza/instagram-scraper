const Apify = require('apify');
const request = require('request-promise-native');
const { SEARCH_TYPES, PAGE_TYPES } = require('./consts');
const errors = require('./errors');

// Helper functions that create direct links to search results
const formatPlaceResult = item => ({
    url: `https://www.instagram.com/explore/locations/${item.place.location.pk}/${item.place.slug}/`,
    pageType: PAGE_TYPES.PLACE,
})
const formatUserResult = item => ({
    url: `https://www.instagram.com/${item.user.username}/`,
    pageType: PAGE_TYPES.PROFILE,
});
const formatHashtagResult = item => ({
    url: `https://www.instagram.com/explore/tags/${item.hashtag.name}/`,
    pageType: PAGE_TYPES.HASHTAG,
})

/**
 * Attempts to query Instagram search and parse found results into direct links to instagram pages
 * @param {Object} input Input loaded from Apify.getInput();
 */
const searchUrls = async (input) => {
    const { search, searchType, searchLimit = 10 } = input;
    if (!search) return [];

    try {
        if (!searchType) throw errors.searchTypeIsRequired();
        if (!Object.values(SEARCH_TYPES).includes(searchType)) throw errors.unsupportedSearchType(searchType);
    } catch (error) {
        Apify.utils.log.info('--  --  --  --  --');
        Apify.utils.log.info(' ');
        Apify.utils.log.error('Run failed because the provided input is incorrect:');
        Apify.utils.log.error(error.message);
        Apify.utils.log.info(' ');
        Apify.utils.log.info('--  --  --  --  --');
        process.exit(1);
    }

    Apify.utils.log.info(`Searching for "${search}"`);

    const searchUrl = `https://www.instagram.com/web/search/topsearch/?context=${searchType}&query=${encodeURIComponent(search)}`;
    const response = await request({
        url: searchUrl,
        json: true,
    });

    let urls;
    if (searchType === SEARCH_TYPES.USER) urls = response.users.map(formatUserResult);
    else if (searchType === SEARCH_TYPES.PLACE) urls = response.places.map(formatPlaceResult);
    else if (searchType === SEARCH_TYPES.HASHTAG) urls = response.hashtags.map(formatHashtagResult);

    Apify.utils.log.info(`Found  search results. Limited to ${searchLimit}.`);
    const originalLength = urls.length;
    urls = urls.slice(0, searchLimit);

    Apify.utils.log.info(`Search found ${originalLength} URLs after limiting to ${searchLimit}:`);
    console.dir(urls);

    return urls;
};

module.exports = {
    searchUrls,
};
