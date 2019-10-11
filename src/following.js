const { log, finiteQuery, QUERY_IDS } = require('./helpers');

const { profileFollowingQueryId } = QUERY_IDS;

async function getProfileFollowing(page, itemSpec, input) {
    const limit = input.followingLimit;
    if (!limit) return [];

    log(itemSpec, `Loading users current profile follows (limit ${limit} items).`);

    const nodeTransformationFunction = (data) => {
        if (!data.user) throw new Error('"Following" GraphQL query does not contain user object');
        if (!data.user.edge_follow) throw new Error('"Following" GraphQL query does not contain edge_follow object');
        const following = data.user.edge_follow;
        const pageInfo = following.page_info;
        const endCursor = pageInfo.end_cursor;
        const users = following.edges.map((followingItem) => {
            const { node } = followingItem;
            return {
                id: node.id,
                full_name: node.full_name,
                username: node.username,
                profile_pic_url: node.profile_pic_url,
                is_private: node.is_private,
                is_verified: node.is_verified,
            };
        });
        return { nextPageCursor: endCursor, data: users };
    }

    const variables = {
        id: itemSpec.userId,
        include_reel: false,
        fetch_mutual: false,
    };

    return finiteQuery(profileFollowingQueryId, variables, nodeTransformationFunction, limit, page, input, itemSpec, '[profile following]');
}

module.exports = {
    getProfileFollowing,
};