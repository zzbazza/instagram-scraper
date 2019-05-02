module.exports = {
    PAGE_TYPES: {
        PLACE: 'location',
        PROFILE: 'user',
        HASHTAG: 'hashtag',
        POST: 'post',
    },
    SCRAPE_TYPES: {
        POSTS: 'posts',
        COMMENTS: 'comments',
        FOLLOWING: 'following',
        FOLLOWERS: 'followers',
    },
    GRAPHQL_ENDPOINT: 'https://www.instagram.com/graphql/query/?query_hash=',
    ABORTED_RESOUCE_TYPES: [
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
    ],
};