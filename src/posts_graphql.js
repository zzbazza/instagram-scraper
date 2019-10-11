const { log, finiteQuery, QUERY_IDS } = require('./helpers');
const { PAGE_TYPES } = require('./consts');

const { placePostsQueryId, hashtagPostsQueryId, profilePostsQueryId } = QUERY_IDS;

async function getPosts(page, itemSpec, input) {
    const limit = input.resultsLimit;
    if (!limit) return [];
    log(itemSpec, `Loading posts (limit ${limit} items).`);

    const nodeTransformationFunction = (data) => {
        let timeline;
        switch (itemSpec.pageType) {
            case PAGE_TYPES.PLACE: {
                if (!data.location) throw new Error('"Posts" GraphQL query does not contain location');
                if (!data.location.edge_location_to_media) throw new Error('"Posts" GraphQL query does not contain edge_location_to_media');
                timeline = data.location.edge_location_to_media;
                break;
            }
            case PAGE_TYPES.PROFILE: {
                if (!data.user) throw new Error('"Posts" GraphQL query does not contain user');
                if (!data.user.edge_owner_to_timeline_media) throw new Error('"Posts" GraphQL query does not contain edge_owner_to_timeline_media');
                timeline = data.user.edge_owner_to_timeline_media;
                break;
            }
            case PAGE_TYPES.HASHTAG: {
                if (!data.hashtag) throw new Error('"Posts" GraphQL query does not contain hashtag');
                if (!data.hashtag.edge_hashtag_to_media) throw new Error('"Posts" GraphQL query does not contain edge_hashtag_to_media');
                timeline = data.hashtag.edge_hashtag_to_media;
                break;
            }
        }
        const pageInfo = timeline.page_info;
        const endCursor = pageInfo.end_cursor;
        const posts = timeline.edges.map((post) => post.node);
        return { nextPageCursor: endCursor, data: posts };
    }

    let queryId;
    let query;
    switch (itemSpec.pageType) {
        case PAGE_TYPES.PLACE: {
            query = { id: itemSpec.locationId },
            queryId = placePostsQueryId;
            break;
        }
        case PAGE_TYPES.PROFILE: {
            query = { id: itemSpec.userId },
            queryId = profilePostsQueryId;
            break;
        }
        case PAGE_TYPES.HASHTAG: {
            query = { tag_name: itemSpec.tagName, include_reel: false, include_logged_out: false },
            queryId = hashtagPostsQueryId;
            break;
        }
    }

    return finiteQuery(queryId, query, nodeTransformationFunction, limit, page, input, itemSpec, '[posts]');
}

module.exports = {
    getPosts,
};