module.exports = {
    // Types of pages which this actor is able to process
    PAGE_TYPES: {
        PLACE: 'location',
        PROFILE: 'user',
        HASHTAG: 'hashtag',
        POST: 'post',
    },
    // Types of scrapes this actor can do
    SCRAPE_TYPES: {
        POSTS: 'posts',
        COMMENTS: 'comments',
        DETAILS: 'details',
    },
    // Types of search queries available in instagram search
    SEARCH_TYPES: {
        PLACE: 'place',
        USER: 'user',
        HASHTAG: 'hashtag',
    },
    // Instagrams GraphQL Endpoint URL
    GRAPHQL_ENDPOINT: 'https://www.instagram.com/graphql/query/?query_hash=',
    // Resource types blocked from loading to speed up the solution
    ABORT_RESOURCE_TYPES: [
        'image',
        'media',
        'font',
        'texttrack',
        'fetch',
        'eventsource',
        'websocket',
        'other',
        // Manifest and stylesheets have to be present!!!
    ],
    ABORT_RESOURCE_URL_INCLUDES: [
        'map_tile.php',
        'connect.facebook.net',
        'logging_client_events',
    ],
    // These are needed for scrolling to work
    // TODO: Retest this
    ABORT_RESOURCE_URL_EXCLUDES_SCROLL: [
        'es6/Consumer',
        'es6/ProfilePageContainer',
        'es6/cs_CZ.js',
        'es6/en',
        'es6/Vendor',
    ]
};
