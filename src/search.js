const Apify = require('apify');
const request = require('request-promise-native');
const { SEARCH_TYPES } = require('./consts');
const errors = require('./errors');

const { log } = Apify.utils;

// Helper functions that create direct links to search results
const formatPlaceResult = item => `https://www.instagram.com/explore/locations/${item.place.location.pk}/${item.place.slug}/`;
const formatUserResult = item => `https://www.instagram.com/${item.user.username}/`;
const formatHashtagResult = item => `https://www.instagram.com/explore/tags/${item.hashtag.name}/`;

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
        log.info('--  --  --  --  --');
        log.info(' ');
        log.error('Run failed because the provided input is incorrect:');
        log.error(error.message);
        log.info(' ');
        log.info('--  --  --  --  --');
        process.exit(1);
    }

    log.info(`Searching for "${search}"`);

    const searchUrl = `https://www.instagram.com/web/search/topsearch/?context=${searchType}&query=${encodeURIComponent(search)}`;
    const response = await request({
        url: searchUrl,
        json: true,
    });

    let urls;
    if (searchType === SEARCH_TYPES.USER) urls = response.users.map(formatUserResult);
    else if (searchType === SEARCH_TYPES.PLACE) urls = response.places.map(formatPlaceResult);
    else if (searchType === SEARCH_TYPES.HASHTAG) urls = response.hashtags.map(formatHashtagResult);

    log.info(`Found  search results. Limited to ${searchLimit}.`);
    const originalLength = urls.length;
    urls = urls.slice(0, searchLimit);

    log.info(`Search found ${originalLength} URLs after limiting to ${searchLimit}:`);
    console.dir(urls);

    return urls;
};

module.exports = {
    searchUrls,
};
